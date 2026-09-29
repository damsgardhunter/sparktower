/**
 * Proving a domain, before there is a company to hang it on.
 *
 * The order matters and is the point. A company row that exists before
 * anybody has proved anything is a company that can be named "Stripe" and left
 * sitting there — so a verification is started against a *person*, passed, and
 * then spent on a company created in the same breath. There is no window in
 * which an unverified company exists.
 *
 * Everything about the proof itself is in server/company-verification.ts; this
 * is the part that talks to people, counts attempts and decides who may spend
 * a verification on what.
 */
import type { Express } from "express";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { companies, companyVerifications } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { checkDomain, newVerificationToken, type CheckDeps } from "./company-verification";
import {
  MAX_CHECK_ATTEMPTS, VERIFICATION_TTL_MS, normaliseDomain, unclaimableReason, verificationSteps,
} from "@shared/company-verification";

/** A seam, so the integration tests can prove a domain without a nameserver. */
let deps: CheckDeps = {};
export function setVerificationDeps(next: CheckDeps) { deps = next; }

const row = (v: typeof companyVerifications.$inferSelect) => ({
  id: v.id,
  domain: v.domain,
  token: v.token,
  verified: !!v.verifiedAt,
  method: v.method,
  spent: !!v.companyId,
  attempts: v.attempts,
  attemptsLeft: Math.max(0, MAX_CHECK_ATTEMPTS - v.attempts),
  lastError: v.lastError,
  expiresAt: v.expiresAt,
  steps: verificationSteps(v.domain, v.token),
});

export function registerCompanyVerificationRoutes(app: Express): void {
  /**
   * Start one, or hand back the one already running for this domain.
   *
   * Idempotent per person and domain on purpose: somebody who closes the tab
   * halfway through and comes back must get the *same* token, or the file they
   * already uploaded stops working and they have no way to know why.
   */
  app.post("/api/company-verifications", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    const domain = normaliseDomain(req.body?.website ?? req.body?.domain);
    if (!domain) {
      return res.status(400).json({ code: "bad_domain", message: "That doesn't look like a website. Use the domain your company's site is on, like acme.com." });
    }
    const unclaimable = unclaimableReason(domain);
    if (unclaimable) return res.status(400).json({ code: "unclaimable_domain", message: unclaimable });

    /*
     * Taken already? Say so before they go and edit DNS for an hour. One
     * domain belongs to one company, and that rule is what stops a second
     * "ACME Inc." existing at all.
     */
    const [taken] = await db.select({ id: companies.id, name: companies.name })
      .from(companies).where(eq(companies.verifiedDomain, domain));
    if (taken) {
      return res.status(409).json({
        code: "domain_taken",
        message: `${domain} is already verified by a company on SparkTower. If that's yours and you've lost access to it, get in touch — we won't hand it over on a form.`,
      });
    }

    const now = new Date();
    const [existing] = await db.select().from(companyVerifications).where(and(
      eq(companyVerifications.userId, req.user.id),
      eq(companyVerifications.domain, domain),
      isNull(companyVerifications.companyId),
      gt(companyVerifications.expiresAt, now),
    )).orderBy(desc(companyVerifications.createdAt)).limit(1);
    if (existing) return res.json({ verification: row(existing) });

    const [made] = await db.insert(companyVerifications).values({
      userId: req.user.id,
      domain,
      token: newVerificationToken(),
      expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
      createdAt: now,
    }).returning();
    res.status(201).json({ verification: row(made) });
  });

  /** Everything this person has going, so a half-finished one is findable. */
  app.get("/api/company-verifications", isAuthenticated, async (req: any, res) => {
    const rows = await db.select().from(companyVerifications)
      .where(eq(companyVerifications.userId, req.user.id))
      .orderBy(desc(companyVerifications.createdAt)).limit(20);
    res.json({ verifications: rows.map(row) });
  });

  /**
   * Go and look.
   *
   * Rate limited *and* counted on the row. The limit stops a person hammering
   * it; the count stops one token being ground against a third party's site
   * over days, which no per-minute limit would catch.
   */
  app.post("/api/company-verifications/:id/check", isAuthenticated, rateLimit("external"), async (req: any, res) => {
    const [v] = await db.select().from(companyVerifications).where(and(
      eq(companyVerifications.id, req.params.id),
      eq(companyVerifications.userId, req.user.id),
    ));
    if (!v) return res.status(404).json({ message: "No such verification." });
    if (v.verifiedAt) return res.json({ verification: row(v), alreadyVerified: true });
    if (v.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ code: "expired", message: "This one has expired. Start it again and you'll get a fresh token." });
    }
    if (v.attempts >= MAX_CHECK_ATTEMPTS) {
      return res.status(429).json({ code: "too_many_checks", message: "That's been checked a lot without finding the token. Start it again for a fresh one." });
    }

    const outcome = await checkDomain(v.domain, v.token, deps);
    if (!outcome.ok) {
      const [bumped] = await db.update(companyVerifications)
        .set({ attempts: sql`${companyVerifications.attempts} + 1`, lastError: outcome.detail.slice(0, 500) })
        .where(eq(companyVerifications.id, v.id)).returning();
      return res.status(422).json({ code: "not_found_yet", message: outcome.detail, verification: row(bumped) });
    }

    /*
     * Won by somebody else while this one was being set up. Checked again here
     * rather than trusted from the start call, because the gap between the two
     * is however long it takes a person to edit DNS.
     */
    const [taken] = await db.select({ id: companies.id })
      .from(companies).where(eq(companies.verifiedDomain, v.domain));
    if (taken) {
      return res.status(409).json({ code: "domain_taken", message: `${v.domain} was claimed by another company while you were setting this up.` });
    }

    const [done] = await db.update(companyVerifications)
      .set({ verifiedAt: new Date(), method: outcome.method, lastError: null })
      .where(eq(companyVerifications.id, v.id)).returning();
    res.json({ verification: row(done), detail: outcome.detail });
  });
}

/**
 * The verification a company creation may spend, or the reason it may not.
 *
 * Read inside the caller's transaction and spent in the same one, so two
 * companies cannot be created from a single proof.
 */
export async function spendableVerification(tx: any, userId: string, verificationId: unknown) {
  if (typeof verificationId !== "string" || !verificationId) {
    return { ok: false as const, status: 400, code: "verification_required", message: "Verify your company's website first — it's what stops anybody posting challenges in your name." };
  }
  const [v] = await tx.select().from(companyVerifications).where(and(
    eq(companyVerifications.id, verificationId),
    eq(companyVerifications.userId, userId),
  ));
  if (!v) return { ok: false as const, status: 404, code: "no_verification", message: "That verification isn't yours, or doesn't exist." };
  if (!v.verifiedAt) return { ok: false as const, status: 409, code: "not_verified", message: "That domain hasn't been proved yet. Put the file or the DNS record in place and check it." };
  if (v.companyId) return { ok: false as const, status: 409, code: "verification_spent", message: "That verification has already been used for a company. Each one is good for exactly one." };
  if (v.expiresAt.getTime() < Date.now()) {
    return { ok: false as const, status: 410, code: "expired", message: "That verification has expired. Start it again." };
  }
  return { ok: true as const, verification: v };
}
