/**
 * Company accounts: making one, seeing it, and the people who act for it.
 *
 *   POST   /api/companies                      → a new company; you are its owner
 *   GET    /api/companies                      → the companies you belong to, with your role
 *   GET    /api/companies/:id                  → { company, role, members } (the page shell reads this)
 *   PATCH  /api/companies/:id                  → an admin edits what it says about itself
 *   DELETE /api/companies/:id                  → the owner, and only the owner
 *   POST   /api/companies/:id/invite-link      → an admin gets a link to hand to a colleague
 *   POST   /api/company-invites/accept         → whoever holds the link joins
 *   PATCH  /api/companies/:id/members/:userId  → an admin changes someone's role
 *   DELETE /api/companies/:id/members/:userId  → an admin removes someone, or you leave
 *
 * Who may do what is decided once, in shared/companies.ts and
 * server/company-access.ts; nothing here restates the rule.
 *
 * ## Why invite links are signed rather than stored
 *
 * A project invite is a row: a random token whose hash is kept, so it can be
 * revoked and used once. Company invites had no table and were not to gain
 * one, so the link carries its own meaning instead — which company, which
 * role, until when — signed with the session secret. Nobody can forge one or
 * change the role in it without the secret, and it expires on its own. What it
 * gives up is revocation and single use: a link handed round an office admits
 * anyone in that office until it expires, which is what a team link is for,
 * and why links are short-lived and can only ever make someone a member or an
 * admin — never an owner.
 */
import type { Express, Request } from "express";
import crypto from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { companies, companyMembers, users, userProfiles } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { feedDisplayName } from "./feed-routes";
import { publicBaseUrl } from "./public-url";
import { companyFor, companyRole } from "./company-access";
import { COMPANY_ROLES, COMPANY_SIZES, INDUSTRIES, canCompany, slugify, type CompanyRole } from "@shared/companies";

/** How long an invite link works. A week: long enough to reach someone on holiday, short enough that an old link in a chat is dead. */
export const COMPANY_INVITE_DAYS = 7;
/** The roles a link can carry. Ownership is handed over by an owner, deliberately, never by a link. */
const LINK_ROLES = ["member", "admin"] as const;

/* ── Signed invite tokens ─────────────────────────────────────────────── */

function inviteSecret(): string {
  const secret = process.env.SESSION_SECRET;
  /*
   * Refuse rather than fall back to a constant. A default secret would be the
   * same on every install, and anyone who read this file could mint an admin
   * link to any company.
   */
  if (!secret) throw new Error("SESSION_SECRET is not set; company invite links can't be signed.");
  return secret;
}

/** Kept apart from any other use of the session secret, so a signature made for one purpose never verifies for another. */
const sign = (payload: string) =>
  crypto.createHmac("sha256", inviteSecret()).update(`company-invite:${payload}`).digest("base64url");

export function makeCompanyInviteToken(companyId: string, role: (typeof LINK_ROLES)[number], expiresAt: Date): string {
  // The nonce makes two links minted in the same millisecond different, so one can't be mistaken for the other in a log.
  const payload = Buffer.from(JSON.stringify({ c: companyId, r: role, e: expiresAt.getTime(), n: crypto.randomBytes(6).toString("base64url") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readCompanyInviteToken(token: unknown, now = Date.now()):
  | { ok: true; companyId: string; role: (typeof LINK_ROLES)[number]; expiresAt: Date }
  | { ok: false; reason: "invalid" | "expired" } {
  if (typeof token !== "string" || token.length > 400) return { ok: false, reason: "invalid" };
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return { ok: false, reason: "invalid" };
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  // Constant time, so the signature can't be discovered a byte at a time from how long a refusal takes.
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: "invalid" };
  let body: { c?: unknown; r?: unknown; e?: unknown };
  try { body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false, reason: "invalid" }; }
  if (typeof body.c !== "string" || typeof body.e !== "number" || !(LINK_ROLES as readonly unknown[]).includes(body.r)) {
    return { ok: false, reason: "invalid" };
  }
  if (body.e <= now) return { ok: false, reason: "expired" };
  return { ok: true, companyId: body.c, role: body.r as (typeof LINK_ROLES)[number], expiresAt: new Date(body.e) };
}

/* ── Input ────────────────────────────────────────────────────────────── */

type CompanyInput = { name: string; website: string | null; industry: string | null; size: string | null; description: string | null };

/**
 * What a company says about itself, checked.
 *
 * `partial` is for an edit: a field left out stays as it is, and a field sent
 * as empty is cleared. The name can be changed but never cleared.
 */
function readCompanyInput(raw: any, partial: boolean):
  | { ok: true; value: Partial<CompanyInput> }
  | { ok: false; field: string; message: string } {
  const body = raw ?? {};
  const value: Partial<CompanyInput> = {};
  const text = (v: unknown) => (v == null ? "" : String(v).trim());

  if (!partial || body.name !== undefined) {
    const name = text(body.name);
    if (name.length < 2 || name.length > 80) return { ok: false, field: "name", message: "A company name is 2 to 80 characters." };
    value.name = name;
  }
  if (body.website !== undefined) {
    let website = text(body.website);
    if (website) {
      // People type "acme.com"; a link needs a scheme, and only the web ones are allowed.
      if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
      let ok = false;
      try { const u = new URL(website); ok = (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes("."); } catch { ok = false; }
      if (!ok || website.length > 200) return { ok: false, field: "website", message: "That doesn't look like a web address." };
    }
    value.website = website || null;
  }
  if (body.industry !== undefined) {
    const industry = text(body.industry);
    if (industry && !(INDUSTRIES as readonly string[]).includes(industry)) return { ok: false, field: "industry", message: "Pick an industry from the list." };
    value.industry = industry || null;
  }
  if (body.size !== undefined) {
    const size = text(body.size);
    if (size && !(COMPANY_SIZES as readonly string[]).includes(size)) return { ok: false, field: "size", message: `Pick a size: ${COMPANY_SIZES.join(", ")}.` };
    value.size = size || null;
  }
  if (body.description !== undefined) {
    const description = text(body.description);
    if (description.length > 600) return { ok: false, field: "description", message: "Keep the description under 600 characters." };
    value.description = description || null;
  }
  return { ok: true, value };
}

const publicCompany = (c: typeof companies.$inferSelect) => ({
  id: c.id, name: c.name, slug: c.slug, website: c.website, industry: c.industry,
  size: c.size, description: c.description, projectId: c.projectId,
});

/** Everyone who acts for the company, owners first, then by when they joined. */
export async function companyMembersOf(companyId: string) {
  const rows = await db
    .select({
      userId: companyMembers.userId, role: companyMembers.role, joinedAt: companyMembers.joinedAt,
      firstName: users.firstName, lastName: users.lastName,
      displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl,
    })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, companyMembers.userId))
    .where(eq(companyMembers.companyId, companyId))
    .orderBy(asc(companyMembers.joinedAt));
  const order = (r: string) => COMPANY_ROLES.indexOf(r as CompanyRole);
  return rows
    .sort((a, b) => order(a.role) - order(b.role))
    .map((r) => ({
      userId: r.userId,
      name: feedDisplayName(r, { displayName: r.displayName }),
      role: r.role as CompanyRole,
      avatarUrl: r.avatarUrl ?? null,
    }));
}

const inviteUrl = (req: Request, token: string) => `${publicBaseUrl(req)}/companies?invite=${encodeURIComponent(token)}`;

export function registerCompanyRoutes(app: Express): void {
  /** Make a company. Whoever makes it owns it. */
  app.post("/api/companies", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const checked = readCompanyInput(req.body, false);
      if (!checked.ok) return res.status(400).json({ message: checked.message, code: "invalid_input", field: checked.field });
      const input = checked.value as CompanyInput;
      const now = new Date();
      const company = await db.transaction(async (tx) => {
        const [row] = await tx.insert(companies).values({
          name: input.name,
          // Random rather than counted, so a slug says nothing about how many companies share a name.
          slug: slugify(input.name, crypto.randomBytes(4).toString("hex")),
          website: input.website ?? null, industry: input.industry ?? null, size: input.size ?? null,
          description: input.description ?? null, createdBy: req.user.id, createdAt: now,
        }).returning();
        await tx.insert(companyMembers).values({ companyId: row.id, userId: req.user.id, role: "owner", joinedAt: now });
        return row;
      });
      res.status(201).json({ company: publicCompany(company), role: "owner" });
    } catch (error) {
      console.error("Company create error:", error);
      res.status(500).json({ message: "Couldn't create that company." });
    }
  });

  /** The companies I act for. */
  app.get("/api/companies", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db
        .select({ company: companies, role: companyMembers.role, members: sql<number>`(select count(*)::int from ${companyMembers} m where m.company_id = ${companies.id})` })
        .from(companyMembers)
        .innerJoin(companies, eq(companies.id, companyMembers.companyId))
        .where(eq(companyMembers.userId, req.user.id))
        .orderBy(asc(companies.name));
      res.json({ companies: rows.map((r) => ({ ...publicCompany(r.company), role: r.role, memberCount: r.members })) });
    } catch (error) {
      console.error("Company list error:", error);
      res.status(500).json({ message: "Couldn't load your companies." });
    }
  });

  /** One company, as its page needs it. The shape is relied on by every tab — change it with care. */
  app.get("/api/companies/:id", isAuthenticated, async (req: any, res) => {
    try {
      const found = await companyFor(res, String(req.params.id), req.user.id, "view");
      if (!found) return;
      res.json({ company: publicCompany(found.company), role: found.role, members: await companyMembersOf(found.company.id) });
    } catch (error) {
      console.error("Company read error:", error);
      res.status(500).json({ message: "Couldn't load that company." });
    }
  });

  app.patch("/api/companies/:id", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyFor(res, String(req.params.id), req.user.id, "manage");
      if (!found) return;
      const checked = readCompanyInput(req.body, true);
      if (!checked.ok) return res.status(400).json({ message: checked.message, code: "invalid_input", field: checked.field });
      if (Object.keys(checked.value).length === 0) return res.json({ company: publicCompany(found.company) });
      // The slug stays put when the name changes: links people already shared keep working.
      const [row] = await db.update(companies).set(checked.value).where(eq(companies.id, found.company.id)).returning();
      res.json({ company: publicCompany(row) });
    } catch (error) {
      console.error("Company update error:", error);
      res.status(500).json({ message: "Couldn't save those changes." });
    }
  });

  app.delete("/api/companies/:id", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyFor(res, String(req.params.id), req.user.id, "delete");
      if (!found) return;
      // Members, watches and the rest go with it (foreign keys cascade). Its private seasons stay as history for the people who played them.
      await db.delete(companies).where(eq(companies.id, found.company.id));
      res.json({ ok: true });
    } catch (error) {
      console.error("Company delete error:", error);
      res.status(500).json({ message: "Couldn't delete that company." });
    }
  });

  /* ── The team ───────────────────────────────────────────────────────── */

  /** A link an admin hands to a colleague. Shown once; the server keeps nothing. */
  app.post("/api/companies/:id/invite-link", isAuthenticated, rateLimit("invite"), async (req: any, res) => {
    try {
      const found = await companyFor(res, String(req.params.id), req.user.id, "manage");
      if (!found) return;
      const role = req.body?.role == null || req.body.role === "" ? "member" : String(req.body.role);
      if (!(LINK_ROLES as readonly string[]).includes(role)) {
        return res.status(400).json({ message: "A link can make someone a member or an admin.", code: "invalid_input", field: "role" });
      }
      const expiresAt = new Date(Date.now() + COMPANY_INVITE_DAYS * 86_400_000);
      const token = makeCompanyInviteToken(found.company.id, role as (typeof LINK_ROLES)[number], expiresAt);
      res.status(201).json({ url: inviteUrl(req, token), token, role, expiresAt });
    } catch (error) {
      console.error("Company invite error:", error);
      res.status(500).json({ message: "Couldn't make an invite link." });
    }
  });

  /** Join from a link. Someone already in the company keeps the role they have — a member link never demotes an admin. */
  app.post("/api/company-invites/accept", isAuthenticated, rateLimit("inviteLookup"), async (req: any, res) => {
    try {
      const read = readCompanyInviteToken(req.body?.token);
      if (!read.ok) {
        return read.reason === "expired"
          ? res.status(410).json({ message: "This invite link has expired. Ask for a new one.", code: "invite_expired" })
          : res.status(404).json({ message: "This invite link isn't valid.", code: "invite_not_found" });
      }
      const [company] = await db.select().from(companies).where(eq(companies.id, read.companyId));
      // A signed link to a company that has since been deleted.
      if (!company) return res.status(404).json({ message: "This invite link isn't valid.", code: "invite_not_found" });

      const existing = await companyRole(company.id, req.user.id);
      if (existing) return res.json({ companyId: company.id, name: company.name, role: existing, alreadyMember: true });

      await db.insert(companyMembers)
        .values({ companyId: company.id, userId: req.user.id, role: read.role, joinedAt: new Date() })
        .onConflictDoNothing();
      const role = (await companyRole(company.id, req.user.id)) ?? read.role;
      res.json({ companyId: company.id, name: company.name, role, alreadyMember: false });
    } catch (error) {
      console.error("Company invite accept error:", error);
      res.status(500).json({ message: "Couldn't accept that invite." });
    }
  });

  /**
   * Change someone's role.
   *
   * Admins run the team, but ownership is the owners' own business: only an
   * owner can make someone an owner or change an owner's role. And the last
   * owner can never stop being one — a company nobody can delete or hand on
   * is stuck for ever.
   */
  app.patch("/api/companies/:id/members/:userId", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const found = await companyFor(res, String(req.params.id), req.user.id, "manage");
      if (!found) return;
      const role = String(req.body?.role ?? "");
      if (!(COMPANY_ROLES as readonly string[]).includes(role)) {
        return res.status(400).json({ message: `Pick a role: ${COMPANY_ROLES.join(", ")}.`, code: "invalid_input", field: "role" });
      }
      const targetId = String(req.params.userId);
      const outcome = await db.transaction(async (tx) => {
        /*
         * The company row is locked for the whole decision. Two owners each
         * demoting the other at the same moment would both count two owners,
         * both succeed, and leave none; holding the lock makes the second one
         * count again after the first has landed.
         */
        await tx.execute(sql`select 1 from ${companies} where ${companies.id} = ${found.company.id} for update`);
        const members = await tx.select({ userId: companyMembers.userId, role: companyMembers.role })
          .from(companyMembers).where(eq(companyMembers.companyId, found.company.id));
        const target = members.find((m) => m.userId === targetId);
        if (!target) return { status: 404, body: { message: "That person isn't in this company." } } as const;
        if ((target.role === "owner" || role === "owner") && found.role !== "owner") {
          return { status: 403, body: { message: "Only an owner can change who owns the company.", code: "not_owner" } } as const;
        }
        if (target.role === "owner" && role !== "owner" && members.filter((m) => m.role === "owner").length <= 1) {
          return { status: 409, body: { message: "Every company needs an owner. Make someone else an owner first.", code: "last_owner" } } as const;
        }
        await tx.update(companyMembers).set({ role: role as CompanyRole })
          .where(and(eq(companyMembers.companyId, found.company.id), eq(companyMembers.userId, targetId)));
        return { status: 200, body: { ok: true, userId: targetId, role } } as const;
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      console.error("Company role change error:", error);
      res.status(500).json({ message: "Couldn't change that role." });
    }
  });

  /** Remove someone — an admin's call — or leave, which anyone may do. Not the last owner either way. */
  app.delete("/api/companies/:id/members/:userId", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const companyId = String(req.params.id);
      const targetId = String(req.params.userId);
      const leaving = targetId === req.user.id;
      const found = await companyFor(res, companyId, req.user.id, leaving ? "view" : "manage");
      if (!found) return;
      const outcome = await db.transaction(async (tx) => {
        // Locked for the same reason as a role change: two removals must not both see a second owner.
        await tx.execute(sql`select 1 from ${companies} where ${companies.id} = ${found.company.id} for update`);
        const members = await tx.select({ userId: companyMembers.userId, role: companyMembers.role })
          .from(companyMembers).where(eq(companyMembers.companyId, found.company.id));
        const target = members.find((m) => m.userId === targetId);
        if (!target) return { status: 404, body: { message: "That person isn't in this company." } } as const;
        if (!leaving && target.role === "owner" && !canCompany(found.role, "delete")) {
          return { status: 403, body: { message: "Only an owner can remove an owner.", code: "not_owner" } } as const;
        }
        if (target.role === "owner" && members.filter((m) => m.role === "owner").length <= 1) {
          return { status: 409, body: { message: "Every company needs an owner. Make someone else an owner first.", code: "last_owner" } } as const;
        }
        await tx.delete(companyMembers)
          .where(and(eq(companyMembers.companyId, found.company.id), eq(companyMembers.userId, targetId)));
        return { status: 200, body: { ok: true } } as const;
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      console.error("Company member remove error:", error);
      res.status(500).json({ message: "Couldn't remove that person." });
    }
  });
}
