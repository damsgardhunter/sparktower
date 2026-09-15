/**
 * Two-factor sign-in for the accounts that can do the most damage.
 *
 * Required for reviewers, admins and the platform owner — the accounts that
 * take content down, suspend people, toggle surfaces, release money, and
 * export or erase analytics — and enforced for anyone who has turned it on.
 *
 *  - Enrolled: a correct password doesn't sign you in. The web keeps a pending
 *    sign-in in the session for five minutes; mobile gets a signed challenge.
 *    A code from the authenticator app (or a one-time recovery code) finishes it.
 *  - Required but not enrolled: sign-in works, but every privileged route
 *    answers 403 `mfa_enrollment_required` until 2FA is set up.
 *  - A session (web) or token pair (mobile) that passed a second factor is
 *    marked; privileged routes check the mark (`mfaGate`, called by
 *    requireReviewer, requireOwner and the admin guard).
 *
 * Secrets are sealed at rest (secret-box); recovery codes are hashed; a code
 * works once (the accepted time step is recorded); attempts are limited per
 * account and per address.
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { seal, open } from "./secret-box";
import { deriveKey, mobileTokenKey } from "./secrets";
import { newTotpSecret, otpauthUrl, verifyTotp } from "./totp";
import { atLeast, isOwner } from "./platform-roles";
import { enforceRateLimit, rateLimit } from "./moderation";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";

export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
export const RECOVERY_CODE_COUNT = 10;

type UserRow = typeof users.$inferSelect;

/** Accounts that must have a second factor before they can use what their role allows. */
export const mfaRequiredFor = (user: Pick<UserRow, "platformRole" | "email"> | null | undefined) =>
  !!user && (atLeast(user.platformRole, "reviewer") || isOwner(user.email));

/** Accounts that are asked for a code at every sign-in. */
export const mfaEnabledFor = (user: Pick<UserRow, "mfaEnabledAt" | "mfaSecret"> | null | undefined) =>
  !!user?.mfaEnabledAt && !!user?.mfaSecret;

/** This request's session (web) or token (mobile) passed a second factor. */
export const mfaSatisfied = (req: any) => !!req.session?.mfaVerifiedAt || req.mfaVerified === true;

/**
 * For a privileged route, after its role check: refuses (and answers) when the
 * account needs a second factor this session hasn't passed. True means go on.
 */
export function mfaGate(req: any, res: Response): boolean {
  if (!mfaRequiredFor(req.user) || mfaSatisfied(req)) return true;
  const enrolled = mfaEnabledFor(req.user);
  res.status(403).json(enrolled
    ? { message: "Sign in again with your authenticator code to use this.", code: "mfa_required" }
    : { message: "Set up two-factor authentication to use this.", code: "mfa_enrollment_required" });
  return false;
}

const hashRecovery = (code: string) => crypto.createHash("sha256").update(code.toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
const newRecoveryCodes = () => Array.from({ length: RECOVERY_CODE_COUNT }, () => {
  const raw = crypto.randomBytes(5).toString("hex"); // 40 bits each
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
});

/**
 * A second factor for an enrolled account: an authenticator code (once per
 * time step — recorded atomically, so a replayed or raced code fails) or a
 * recovery code (removed as it's used). Returns what matched, or null.
 */
export async function checkSecondFactor(userId: string, code: string): Promise<"totp" | "recovery" | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!mfaEnabledFor(user)) return null;
  const secret = open(user!.mfaSecret!);
  if (!secret) return null;
  const step = verifyTotp(secret, code, { lastUsedStep: user!.mfaLastStep });
  if (step != null) {
    const claimed = await db.update(users).set({ mfaLastStep: step })
      .where(and(eq(users.id, userId), or(isNull(users.mfaLastStep), lt(users.mfaLastStep, step))))
      .returning({ id: users.id });
    return claimed.length ? "totp" : null;
  }
  const hashed = hashRecovery(code);
  if (!/^[0-9a-f]{5}-?[0-9a-f]{5}$/i.test(code.trim()) || !(user!.mfaRecoveryCodes ?? []).includes(hashed)) return null;
  const used = await db.update(users).set({ mfaRecoveryCodes: sql`array_remove(${users.mfaRecoveryCodes}, ${hashed})` })
    .where(and(eq(users.id, userId), sql`${hashed} = any(${users.mfaRecoveryCodes})`))
    .returning({ id: users.id });
  return used.length ? "recovery" : null;
}

// --- Mobile: a signed, short-lived challenge instead of a server session ---------

/** Derived from the mobile token key, which throws when no secret is set: never an empty or default key. */
const challengeKey = () => deriveKey(mobileTokenKey(), "sparktower:mfa-challenge:v1");

export function signMfaChallenge(userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: now + MFA_CHALLENGE_TTL_MS, p: "mfa" })).toString("base64url");
  const sig = crypto.createHmac("sha256", challengeKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readMfaChallenge(token: unknown, now = Date.now()): string | null {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", challengeKey()).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.p === "mfa" && typeof claims.sub === "string" && claims.exp > now ? claims.sub : null;
  } catch { return null; }
}

/** Attempts at a code, per account: eight tries in fifteen minutes, then wait. (Per address is the route's own rateLimit.) */
export async function limitMfaAttempts(_req: Request, res: Response, userId: string): Promise<boolean> {
  return enforceRateLimit(res, `mfa:${userId}`, "login");
}

const safeUser = (u: UserRow) => {
  const { passwordHash: _p, mfaSecret: _s, mfaPendingSecret: _ps, mfaRecoveryCodes: _r, mfaLastStep: _l, ...rest } = u;
  return rest;
};

export function registerMfaRoutes(app: Express) {
  /** Where this account stands: whether its role needs 2FA, whether it's on, whether this session passed it. */
  app.get("/api/auth/mfa/status", isAuthenticated, (req: any, res) => {
    res.json({ required: mfaRequiredFor(req.user), enabled: mfaEnabledFor(req.user), verified: mfaSatisfied(req), recoveryCodesLeft: req.user.mfaRecoveryCodes?.length ?? 0 });
  });

  /**
   * Finishing a web sign-in that stopped at the second factor. The pending
   * sign-in lives in the session the password check started, for five minutes.
   */
  app.post("/api/auth/mfa/verify", rateLimit("login"), async (req: any, res, next) => {
    // public-write: a pending sign-in in this session, started by a correct password, plus a one-time code; limited per address and per account
    const pending = req.session?.mfaPending as { userId: string; at: number } | undefined;
    if (!pending || Date.now() - pending.at > MFA_CHALLENGE_TTL_MS) {
      if (req.session) delete req.session.mfaPending;
      return res.status(401).json({ message: "That sign-in has expired. Enter your password again.", code: "mfa_challenge_expired" });
    }
    if (!(await limitMfaAttempts(req, res, pending.userId))) return;
    const method = await checkSecondFactor(pending.userId, String(req.body?.code ?? ""));
    if (!method) return res.status(401).json({ message: "That code isn't right. Check your authenticator app and try again.", code: "mfa_invalid_code" });
    const [user] = await db.select().from(users).where(eq(users.id, pending.userId));
    if (!user) return res.status(401).json({ message: "That account no longer exists.", code: "mfa_challenge_expired" });
    delete req.session.mfaPending;
    req.login(user, (err: any) => {
      if (err) return next(err);
      // Marked after login: passport starts a fresh session, and the mark belongs to that one.
      req.session.mfaVerifiedAt = Date.now();
      req.session.save(() => res.json({ ...safeUser(user), mfaMethod: method }));
    });
  });

  /** Starts setting up 2FA: a new secret to put in an authenticator app. Nothing changes until a code from it is confirmed. */
  app.post("/api/auth/mfa/setup", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    if (mfaEnabledFor(req.user)) return res.status(409).json({ message: "Two-factor authentication is already on.", code: "mfa_already_enabled" });
    const secret = newTotpSecret();
    await db.update(users).set({ mfaPendingSecret: seal(secret) }).where(eq(users.id, req.user.id));
    res.json({ secret, otpauthUrl: otpauthUrl(secret, req.user.email ?? req.user.id) });
  });

  /** Confirms setup with a code from the app: 2FA is on, this session counts as verified, and the recovery codes are shown once. */
  app.post("/api/auth/mfa/enable", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    if (!(await limitMfaAttempts(req, res, req.user.id))) return;
    const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
    if (mfaEnabledFor(user)) return res.status(409).json({ message: "Two-factor authentication is already on.", code: "mfa_already_enabled" });
    const secret = user?.mfaPendingSecret ? open(user.mfaPendingSecret) : null;
    if (!secret) return res.status(400).json({ message: "Start setup first.", code: "mfa_not_started" });
    const step = verifyTotp(secret, String(req.body?.code ?? ""));
    if (step == null) return res.status(401).json({ message: "That code isn't right. Check the time on your phone and try the next one.", code: "mfa_invalid_code" });
    const codes = newRecoveryCodes();
    await db.update(users).set({
      mfaSecret: seal(secret), mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastStep: step,
      mfaRecoveryCodes: codes.map(hashRecovery),
    }).where(eq(users.id, req.user.id));
    if (req.session) req.session.mfaVerifiedAt = Date.now();
    res.json({ enabled: true, recoveryCodes: codes, reauthenticate: !req.session });
  });

  /** New recovery codes (the old ones stop working). Needs a verified session. */
  app.post("/api/auth/mfa/recovery-codes", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    if (!mfaEnabledFor(req.user)) return res.status(400).json({ message: "Two-factor authentication isn't on.", code: "mfa_not_enabled" });
    if (!mfaSatisfied(req)) return res.status(403).json({ message: "Sign in again with your authenticator code first.", code: "mfa_required" });
    const codes = newRecoveryCodes();
    await db.update(users).set({ mfaRecoveryCodes: codes.map(hashRecovery) }).where(eq(users.id, req.user.id));
    res.json({ recoveryCodes: codes });
  });
}
