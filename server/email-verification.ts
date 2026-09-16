/**
 * Confirming that the person who signed up can read mail at the address they
 * gave.
 *
 * Signing up works immediately — nobody is held at the door waiting for an
 * email — but until the address is confirmed, nothing this account does can
 * reach another person: no posts, no comments, no messages, no invites, no
 * reports. That is the whole point. An unverified address is either a typo, in
 * which case a wall of "check your email" helps nobody, or someone else's
 * address, in which case what matters is that they can't send from it.
 *
 * Links are stored by hash, expire, and work once. A resend issues another
 * rather than invalidating the one already in someone's inbox: people click the
 * first link they find.
 */
import crypto from "node:crypto";
import type { Express, RequestHandler } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { emailVerificationTokens, users } from "@shared/schema";
import { sendEmail } from "./email";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit, ipKey } from "./moderation";

export const VERIFICATION_TTL_HOURS = 48;
/** The code a blocked write answers with, so a client can offer "resend" rather than a dead end. */
export const EMAIL_UNVERIFIED = "email_unverified" as const;

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const normalise = (email: string) => email.trim().toLowerCase();

/** Where the confirm link points: the public address if we know it, else this request's own host. */
function baseUrl(req?: { headers: Record<string, any>; protocol?: string }): string {
  const configured = process.env.PUBLIC_URL || process.env.REPLIT_DOMAINS?.split(",")[0];
  if (configured) return /^https?:\/\//.test(configured) ? configured.replace(/\/$/, "") : `https://${configured}`;
  const host = String(req?.headers?.["x-forwarded-host"] ?? req?.headers?.host ?? "localhost:5001").split(",")[0];
  const protocol = String(req?.headers?.["x-forwarded-proto"] ?? req?.protocol ?? (host.startsWith("localhost") ? "http" : "https")).split(",")[0];
  return `${protocol}://${host}`;
}

/**
 * Issues a link and sends it. Never throws and never fails the request that
 * triggered it: an account is created whether or not the mail goes out, and
 * the person can ask for another.
 */
export async function sendVerificationEmail(
  user: { id: string; email: string | null; firstName?: string | null },
  req?: any,
): Promise<{ sent: boolean; token?: string }> {
  if (!user.email) return { sent: false };
  try {
    const token = crypto.randomBytes(32).toString("base64url");
    await db.insert(emailVerificationTokens).values({
      userId: user.id,
      tokenHash: hash(token),
      email: normalise(user.email),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_HOURS * 3600_000),
    });
    const link = `${baseUrl(req)}/verify-email?token=${encodeURIComponent(token)}`;
    const name = user.firstName?.trim() || "there";
    await sendEmail({
      to: user.email,
      subject: "Confirm your email for SparkTower",
      tag: "verify-email",
      text: `Hi ${name},\n\nConfirm this address to post, comment and message on SparkTower:\n\n${link}\n\nThe link works once and expires in ${VERIFICATION_TTL_HOURS} hours. If you didn't sign up, ignore this — nothing was created in your name.\n`,
    });
    // The token is returned for tests and the development outbox, never to a client.
    return { sent: true, token };
  } catch (err) {
    console.error("[verify-email] couldn't send (non-fatal):", err);
    return { sent: false };
  }
}

/** Spends a link: marks the account confirmed and the token used, once. */
export async function confirmVerification(token: string): Promise<{ ok: true; userId: string } | { ok: false; reason: "invalid" | "expired" | "address_changed" }> {
  if (!token) return { ok: false, reason: "invalid" };
  const [row] = await db.select().from(emailVerificationTokens).where(eq(emailVerificationTokens.tokenHash, hash(token)));
  if (!row) return { ok: false, reason: "invalid" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  return db.transaction(async (tx) => {
    // The token row is the lock, so a double-click spends one link once.
    const [claimed] = await tx.update(emailVerificationTokens).set({ usedAt: new Date() })
      .where(and(eq(emailVerificationTokens.id, row.id), isNull(emailVerificationTokens.usedAt)))
      .returning();
    const [user] = await tx.select({ id: users.id, email: users.email, verifiedAt: users.emailVerifiedAt })
      .from(users).where(eq(users.id, row.userId));
    if (!user) return { ok: false, reason: "invalid" } as const;
    // Already confirmed — by an earlier click of this link or another one — is a success, not an error.
    if (!claimed && !user.verifiedAt) return { ok: false, reason: "invalid" } as const;
    if (normalise(user.email ?? "") !== row.email) return { ok: false, reason: "address_changed" } as const;
    if (!user.verifiedAt) {
      await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    }
    return { ok: true, userId: user.id } as const;
  });
}

/** True when this account may do things that reach other people. */
export const isVerified = (user: { emailVerifiedAt?: Date | null } | null | undefined): boolean => !!user?.emailVerifiedAt;

/**
 * The paths an unconfirmed account can't use: everything that puts words in
 * front of someone else. Reading, and their own project's work, are untouched.
 */
const REACHES_OTHERS: RegExp[] = [
  /^\/api\/feed$/,
  /^\/api\/feed\/[^/]+\/comments$/,
  /^\/api\/projects\/[^/]+\/comments$/,
  /^\/api\/projects\/[^/]+\/invites$/,
  /^\/api\/messages\/[^/]+$/,
  /^\/api\/connections\/request$/,
  /^\/api\/reports$/,
];

/**
 * Mounted globally, like the suspension check: a gate that only covers the
 * routes someone remembered to decorate is not a gate. Reads pass, and so does
 * everything that stays inside the person's own project.
 */
export const requireVerifiedEmail: RequestHandler = async (req: any, res, next) => {
  try {
    if (!req.user?.id) return next();
    if (req.method === "GET" || req.method === "HEAD") return next();
    if (!REACHES_OTHERS.some((p) => p.test(req.path))) return next();
    if (req.user.emailVerifiedAt) return next();

    // Loaded fresh: someone who confirms in another tab shouldn't have to sign in again.
    const [row] = await db.select({ at: users.emailVerifiedAt }).from(users).where(eq(users.id, req.user.id));
    if (row?.at) { req.user.emailVerifiedAt = row.at; return next(); }

    return res.status(403).json({
      message: "Confirm your email address first — we sent you a link when you signed up.",
      code: EMAIL_UNVERIFIED,
    });
  } catch (err) {
    // A check that can't run mustn't silence the site: this is spam prevention, not authorisation.
    console.error("[verify-email] check failed, allowing:", err);
    next();
  }
};

export function registerEmailVerificationRoutes(app: Express) {
  /** Confirms an address from the link. Public: the link is the credential, and it may be opened signed out. */
  app.post("/api/auth/verify-email", async (req: any, res) => {
    // public-write: the emailed token, by hash, unexpired, spent once; limited per address
    if (!(await enforceRateLimit(res, ipKey(req), "session"))) return;
    try {
      const result = await confirmVerification(String(req.body?.token ?? ""));
      if (!result.ok) {
        const message = result.reason === "expired"
          ? "That link has expired. Sign in and ask for another."
          : result.reason === "address_changed"
            ? "That link was for a different address. Ask for a new one."
            : "That link isn't valid. Ask for a new one.";
        return res.status(400).json({ message, code: result.reason });
      }
      // Whoever is signed in on this device may not be the account confirmed; say who it was for.
      res.json({ ok: true, userId: result.userId });
    } catch (err) {
      console.error("[verify-email] confirm failed:", err);
      res.status(500).json({ message: "Couldn't confirm that link. Try again." });
    }
  });

  /** Sends another link to the signed-in account's address. */
  app.post("/api/auth/verify-email/send", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;
    try {
      if (req.user.emailVerifiedAt) return res.json({ ok: true, alreadyVerified: true });
      const [user] = await db.select({ id: users.id, email: users.email, firstName: users.firstName, verifiedAt: users.emailVerifiedAt })
        .from(users).where(eq(users.id, req.user.id));
      if (!user?.email) return res.status(400).json({ message: "Your account has no email address." });
      if (user.verifiedAt) return res.json({ ok: true, alreadyVerified: true });
      // Not more than a handful of live links at once, however often the button is pressed.
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(emailVerificationTokens)
        .where(and(eq(emailVerificationTokens.userId, user.id), isNull(emailVerificationTokens.usedAt), gt(emailVerificationTokens.expiresAt, new Date())));
      if (n >= 5) return res.status(429).json({ message: "We've sent several links already — check your inbox and spam folder.", code: "too_many_links" });
      await sendVerificationEmail(user, req);
      res.json({ ok: true, sentTo: user.email });
    } catch (err) {
      console.error("[verify-email] resend failed:", err);
      res.status(500).json({ message: "Couldn't send that. Try again." });
    }
  });
}
