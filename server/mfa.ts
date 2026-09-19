/**
 * Two-factor sign-in for the accounts that can do the most damage.
 *
 * Required for reviewers, admins and the platform owner — the accounts that
 * take content down, suspend people, toggle surfaces, release money, and
 * export or erase analytics — and enforced for anyone who has turned it on.
 *
 *  - Enrolled: a correct password doesn't sign you in. The web keeps a pending
 *    sign-in in the session for five minutes; mobile gets a signed challenge.
 *    A code from the authenticator app finishes it.
 *  - Required but not enrolled: sign-in works, but every privileged route
 *    answers 403 `mfa_enrollment_required` until 2FA is set up.
 *  - A session (web) or token pair (mobile) that passed a second factor is
 *    marked; privileged routes check the mark (`mfaGate`, called by
 *    requireReviewer, requireOwner and the admin guard).
 *
 * Secrets are sealed at rest (secret-box); a code
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
import QRCode from "qrcode";
import { atLeast, isOwner } from "./platform-roles";
import { enforceRejectionLimit, countRejection, ipKey, rateLimit } from "./moderation";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";

export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;

type UserRow = typeof users.$inferSelect;

/** Accounts that must have a second factor before they can use what their role allows. */
export const mfaRequiredFor = (user: Pick<UserRow, "platformRole" | "email"> | null | undefined) =>
  !!user && (atLeast(user.platformRole, "reviewer") || isOwner(user.email));

/** Accounts that are asked for a code at every sign-in. */
export const mfaEnabledFor = (user: Pick<UserRow, "mfaEnabledAt" | "mfaSecret"> | null | undefined) =>
  !!user?.mfaEnabledAt && !!user?.mfaSecret;

/** This request's session (web) or token (mobile) passed a second factor. */
/**
 * Whether this request passed a second factor — and the account still has one.
 *
 * Both halves matter. The mark lives in the session (web) or in the token's
 * signed `mfa` claim (mobile), and either can outlive the thing it was about:
 * a support reset (`npm run mfa:reset`) turns 2FA off while sessions and
 * 15-minute tokens from before it are still in the wild, and they would
 * otherwise keep counting as verified. Asking the account as well means a mark
 * is only ever as good as the enrolment behind it.
 */
export const mfaSatisfied = (req: any) =>
  mfaEnabledFor(req.user) && (!!req.session?.mfaVerifiedAt || req.mfaVerified === true);

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


/**
 * A second factor for an enrolled account: an authenticator code (once per
 * time step — recorded atomically, so a replayed or raced code fails) or a
 * app. Returns "totp" when it matched, or null.
 */
export async function checkSecondFactor(userId: string, code: string): Promise<"totp" | null> {
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
  /*
   * And that is the whole list. There used to be a second branch here for a
   * one-time recovery code, and it is gone on purpose: ten printable strings
   * that each sign in once are a second password, kept wherever people keep
   * things — a screenshot, a notes app, a text to themselves — and they bypass
   * the factor they are supposed to be protecting.
   *
   * What replaces them is not nothing. An account that loses its phone is
   * reset by an operator with database access (script/reset-mfa.ts), after
   * confirming who the person is some other way. That is slower, and it is
   * meant to be: a lockout that needs a human is recoverable, and a recovery
   * code someone screenshotted is not revocable.
   */
  return null;
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
/**
 * Whether this account may try another second-factor code.
 *
 * Checks without counting: a wrong code is counted by `countWrongMfaCode`
 * below, once the code has actually been judged. It used to count every call —
 * every enrolment, every sign-in, and the successful ones too — against eight
 * attempts in fifteen minutes, shared between turning 2FA on and using it. So
 * somebody enrolling could spend the budget on the setup screen and be told
 * "too many sign-in attempts" on their first real code. What this is defending
 * against is somebody guessing six digits, and a guess that works is not a
 * guess.
 */
export async function limitMfaAttempts(_req: Request, res: Response, userId: string): Promise<boolean> {
  return enforceRejectionLimit(res, `mfa:${userId}`, "mfaCode");
}

/** A code that wasn't right. This is the only thing that brings the limit closer. */
export async function countWrongMfaCode(userId: string): Promise<void> {
  await countRejection(`mfa:${userId}`, "mfaCode");
}

const safeUser = (u: UserRow) => {
  const { passwordHash: _p, mfaSecret: _s, mfaPendingSecret: _ps, mfaLastStep: _l, ...rest } = u;
  return rest;
};

/**
 * The enrolment QR, drawn twice over if it has to be.
 *
 * PNG first, because it is what every camera and every browser handles without
 * argument. But PNG encoding goes through zlib and a pixel buffer, and that is
 * the part that fails on a host with an unusual build of the runtime — which is
 * exactly how somebody ended up staring at "Couldn't draw the QR code this
 * time" while the same code drew it happily in development and in the tests.
 *
 * So when PNG fails, SVG: a different renderer, no compression, no pixel
 * buffer, nothing but a string of rectangles. It is handed back base64-encoded
 * in a data URL like the PNG, so the page still renders it as an *image* and
 * never as markup — an SVG injected as HTML is a script tag waiting to happen.
 *
 * Both failing is survivable: the key below the picture does the same job, and
 * refusing to set up 2FA because a decoration wouldn't draw would be worse.
 * Which renderer answered comes back with it, because "it works for me" is not
 * a diagnosis and the next person to hit this deserves the answer.
 */
export async function drawQr(url: string): Promise<{ dataUrl: string | null; drawnAs: "png" | "svg" | null }> {
  try {
    const png = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240, color: { dark: "#000000ff", light: "#ffffffff" } });
    return { dataUrl: png, drawnAs: "png" };
  } catch (err) {
    console.error("[mfa] couldn't draw the enrolment QR as a PNG, trying SVG:", (err as Error)?.message ?? err);
  }
  try {
    const svg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 240, color: { dark: "#000000ff", light: "#ffffffff" } });
    return { dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`, drawnAs: "svg" };
  } catch (err) {
    // The key below still works; a missing picture is not a reason to fail setup.
    console.error("[mfa] couldn't draw the enrolment QR as an SVG either:", (err as Error)?.message ?? err);
    return { dataUrl: null, drawnAs: null };
  }
}

export function registerMfaRoutes(app: Express) {
  /** Where this account stands: whether its role needs 2FA, whether it's on, whether this session passed it. */
  app.get("/api/auth/mfa/status", isAuthenticated, (req: any, res) => {
    res.json({ required: mfaRequiredFor(req.user), enabled: mfaEnabledFor(req.user), verified: mfaSatisfied(req) });
  });

  /**
   * Finishing a web sign-in that stopped at the second factor. The pending
   * sign-in lives in the session the password check started, for five minutes.
   */
  app.post("/api/auth/mfa/verify", async (req: any, res, next) => {
    // public-write: a pending sign-in in this session, started by a correct password, plus a one-time code; limited per address and per account
    /*
     * The per-address limit used to be `rateLimit("login")` — the same eight
     * attempts per quarter hour that password sign-ins draw from, counted on
     * every call including the ones that worked. So signing in a few times
     * while setting 2FA up spent the budget, and the first correct code came
     * back "Too many sign-in attempts. Try again in 15 minutes." Both limits
     * here now count wrong codes and nothing else, and they have their own
     * budget rather than sharing the password one.
     */
    if (!(await enforceRejectionLimit(res, ipKey(req), "mfaCode"))) return;
    const pending = req.session?.mfaPending as { userId: string; at: number } | undefined;
    if (!pending || Date.now() - pending.at > MFA_CHALLENGE_TTL_MS) {
      if (req.session) delete req.session.mfaPending;
      return res.status(401).json({ message: "That sign-in has expired. Enter your password again.", code: "mfa_challenge_expired" });
    }
    if (!(await limitMfaAttempts(req, res, pending.userId))) return;
    const method = await checkSecondFactor(pending.userId, String(req.body?.code ?? ""));
    if (!method) {
      await countRejection(ipKey(req), "mfaCode");
      await countWrongMfaCode(pending.userId);
      return res.status(401).json({ message: "That code isn't right. Check your authenticator app and try again.", code: "mfa_invalid_code" });
    }
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
    const url = otpauthUrl(secret, req.user.email ?? req.user.id);

    /*
     * The same otpauth:// URL as a picture, because the alternative is asking
     * someone to hand-type thirty-two characters into a phone. Every
     * authenticator worth having — Google Authenticator, Duo Mobile, 1Password,
     * Authy, Microsoft Authenticator, Bitwarden — reads this one QR; TOTP is a
     * standard (RFC 6238) and none of them needs anything app-specific.
     *
     * Drawn here rather than in the browser: the page already has the secret,
     * so nothing is more exposed, and it keeps a QR library out of the bundle
     * of a page most people open once. A data URL rather than raw SVG markup
     * so the client renders it as an image and never as HTML.
     *
     * Black on white regardless of theme — a QR inverted for dark mode is one
     * many phone cameras will not read.
     */
    const { dataUrl: qrDataUrl, drawnAs } = await drawQr(url);
    res.json({ secret, otpauthUrl: url, qrDataUrl, drawnAs });
  });

  /** Confirms setup with a code from the app: 2FA is on and this session counts as verified. */
  app.post("/api/auth/mfa/enable", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    if (!(await limitMfaAttempts(req, res, req.user.id))) return;
    const [user] = await db.select().from(users).where(eq(users.id, req.user.id));
    if (mfaEnabledFor(user)) return res.status(409).json({ message: "Two-factor authentication is already on.", code: "mfa_already_enabled" });
    const secret = user?.mfaPendingSecret ? open(user.mfaPendingSecret) : null;
    if (!secret) return res.status(400).json({ message: "Start setup first.", code: "mfa_not_started" });
    const step = verifyTotp(secret, String(req.body?.code ?? ""));
    if (step == null) {
      await countWrongMfaCode(req.user.id);
      return res.status(401).json({ message: "That code isn't right. Check the time on your phone and try the next one.", code: "mfa_invalid_code" });
    }
    await db.update(users).set({
      mfaSecret: seal(secret), mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastStep: step,
    }).where(eq(users.id, req.user.id));
    if (req.session) req.session.mfaVerifiedAt = Date.now();
    res.json({ enabled: true, reauthenticate: !req.session });
  });

}
