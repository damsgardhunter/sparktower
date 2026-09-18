/**
 * Getting back in without the password.
 *
 * Until now this product had no way back: a forgotten password meant a lost
 * account, and the sign-in lockout message pointed at a reset that didn't
 * exist. That gap got worse as the password rules got stricter — a policy that
 * refuses common and breached passwords produces more people who can't
 * remember what they settled on.
 *
 * The rules this flow is built on, each one load-bearing:
 *
 *   - **It never says whether an account exists.** Every request answers the
 *     same way. A reset form that says "no account with that address" is an
 *     account-enumeration oracle anyone can query, and the people it exposes
 *     are the ones who least want their membership known.
 *
 *   - **The link is the credential, so it's treated like one.** Stored as a
 *     SHA-256 hash, good for an hour, spent once, and every other outstanding
 *     link for that account dies with it.
 *
 *   - **A reset signs out everything.** If someone is resetting because they
 *     think they've been compromised, leaving the intruder's session alive is
 *     the one outcome that makes the whole flow pointless.
 *
 *   - **It clears the sign-in lockout.** Twelve failed guesses locks an
 *     account for fifteen minutes; that lock must not also trap the real owner
 *     who just proved they read the account's email.
 *
 *   - **Following the link proves the address.** Anyone who can open it can
 *     read mail there, which is exactly what verification asks — so an
 *     unverified account comes out verified.
 */
import crypto from "node:crypto";
import type { Express } from "express";
import { and, eq, isNull, ne, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { passwordResetTokens, users, mobileRefreshTokens, rateLimitHits } from "@shared/schema";
import { sql } from "drizzle-orm";
import { sendEmail } from "./email";
import { checkPassword } from "@shared/passwords";
import { isBreached, BREACHED_MESSAGE } from "./password-breach";
import { enforceRateLimit, ipKey, accountKey } from "./moderation";
import { RESET_TTL_MINUTES, type ResetFailure } from "@shared/password-reset";
import { publicBaseUrl } from "./public-url";

// The window and the failure codes are shared, so the pages that render them
// can't drift from the server that decides them (@shared/password-reset).
export { RESET_TTL_MINUTES, type ResetFailure } from "@shared/password-reset";

const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const normalise = (email: string) => email.trim().toLowerCase();



/**
 * Sends a reset link, if there is anything to send one to.
 *
 * Returns nothing the caller can use to tell the difference, and the route
 * answers identically either way. The token comes back for tests and the
 * development outbox only.
 */
export async function sendPasswordResetEmail(
  emailAsTyped: string,
  req?: any,
): Promise<{ token?: string; outcome: "sent" | "no_account" | "google_account" | "failed" }> {
  const email = normalise(emailAsTyped ?? "");
  if (!email) return { outcome: "no_account" };

  try {
    const [user] = await db.select({ id: users.id, email: users.email, firstName: users.firstName, passwordHash: users.passwordHash })
      // Case-insensitively: somebody who types their address with a capital
      // still gets the email, rather than a silent "no account".
      .from(users).where(sql`lower(${users.email}) = ${String(email).trim().toLowerCase()}`);
    if (!user?.email) return { outcome: "no_account" };

    /*
     * A Google account has no password to reset. Saying so in mail — to the
     * address that owns it, never in the HTTP response — is the one place it's
     * safe to be specific, and it answers the question the person actually
     * has, which is "why isn't my password working".
     */
    if (!user.passwordHash) {
      await sendEmail({
        to: user.email,
        subject: "Signing in to SparkTower",
        tag: "reset-google-account",
        text: `Hi ${user.firstName?.trim() || "there"},\n\nSomeone asked to reset the password for this address on SparkTower.\n\nThis account signs in with Google, so it has no SparkTower password to reset — use "Continue with Google" on the sign-in page.\n\nIf that wasn't you, nothing has changed and there's nothing you need to do.\n`,
      });
      return { outcome: "google_account" };
    }

    const token = crypto.randomBytes(32).toString("base64url");
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hash(token),
      email,
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
      requestedIp: req ? ipKey(req).replace(/^ip:/, "") : null,
    });

    const link = `${publicBaseUrl(req)}/reset-password?token=${encodeURIComponent(token)}`;
    await sendEmail({
      to: user.email,
      subject: "Reset your SparkTower password",
      tag: "password-reset",
      text: `Hi ${user.firstName?.trim() || "there"},\n\nSet a new password for your SparkTower account:\n\n${link}\n\nThe link works once and expires in ${RESET_TTL_MINUTES} minutes. Setting a new password signs you out everywhere else.\n\nIf you didn't ask for this, you can ignore this email — your password hasn't changed, and nobody can use this link without opening it from your inbox.\n`,
    });
    return { token, outcome: "sent" };
  } catch (err) {
    // Never fails the request: the answer is the same either way, and a person
    // who gets no mail can ask again.
    console.error("[password-reset] couldn't send (non-fatal):", err);
    return { outcome: "failed" };
  }
}

/**
 * Spends a link and sets the new password, or explains why it can't.
 *
 * Everything that must happen together happens in one transaction: the token
 * is claimed, its siblings are killed, the password changes, and every session
 * and device is cut. A half-applied reset — new password, old sessions still
 * alive — is the failure mode worth designing against.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ ok: true; email: string; sessionsEnded: number; devicesSignedOut: number } | { ok: false; reason: ResetFailure; message?: string }> {
  if (!token) return { ok: false, reason: "invalid" };

  const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, hash(token)));
  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "invalid" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, row.userId));
  if (!user) return { ok: false, reason: "invalid" };
  // The link was for the address it was sent to. If the account's email has
  // changed since, whoever holds that inbox is no longer this account's owner.
  if (normalise(user.email ?? "") !== row.email) return { ok: false, reason: "invalid" };

  /*
   * The same bar as every other place a password is set — checked here, before
   * the token is spent, so someone who picks a weak password gets to try again
   * with the link they still have rather than having to request a new one.
   */
  const weak = checkPassword(newPassword, { email: user.email });
  if (weak) return { ok: false, reason: "invalid_input", message: weak.message };
  if (await isBreached(newPassword)) return { ok: false, reason: "breached_password", message: BREACHED_MESSAGE };

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const now = new Date();

  return db.transaction(async (tx) => {
    // The token row is the lock: two clicks of the same link, or two tabs
    // submitting at once, and only one of them claims it.
    const [claimed] = await tx.update(passwordResetTokens).set({ usedAt: now })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt)))
      .returning();
    if (!claimed) return { ok: false, reason: "invalid" } as const;

    // Every other live link for this account dies here. Asking for three and
    // using one should not leave two more working keys in an inbox.
    await tx.update(passwordResetTokens).set({ usedAt: now })
      .where(and(
        eq(passwordResetTokens.userId, user.id),
        ne(passwordResetTokens.id, row.id),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ));

    await tx.update(users).set({
      passwordHash,
      // Cuts every mobile access token that hasn't expired yet.
      accessTokensRevokedAt: now,
      // Opening the link proved they can read mail at this address, which is
      // all verification ever asked for.
      emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now})`,
    }).where(eq(users.id, user.id));

    /*
     * Everything, including whatever session the person is reading this from.
     * A password change keeps the caller signed in because they proved they
     * knew the old password; a reset can't assume that, so nothing survives.
     */
    const ended = await tx.execute(sql`DELETE FROM sessions WHERE sess->'passport'->>'user' = ${user.id}`);
    const devices = await tx.update(mobileRefreshTokens).set({ revokedAt: now })
      .where(and(eq(mobileRefreshTokens.userId, user.id), isNull(mobileRefreshTokens.revokedAt)))
      .returning({ id: mobileRefreshTokens.id });

    /*
     * And let them in. If guessing locked this account, the lock is still
     * counting down — the person who just proved they own the address should
     * not be held out by the attack they're recovering from.
     */
    await tx.delete(rateLimitHits).where(and(
      eq(rateLimitHits.userId, accountKey(user.email ?? "") ?? ""),
      eq(rateLimitHits.action, "loginAccount"),
    ));

    return { ok: true, email: user.email ?? row.email, sessionsEnded: Number((ended as any).rowCount ?? 0), devicesSignedOut: devices.length } as const;
  });
}

export function registerPasswordResetRoutes(app: Express) {
  /**
   * Asks for a link. Public, and deliberately uninformative: the answer is the
   * same for an address with an account, without one, and misspelled.
   */
  app.post("/api/auth/forgot-password", async (req: any, res) => {
    // public-write: nothing — it sends mail to an address it already holds; limited per address and per account
    if (!(await enforceRateLimit(res, ipKey(req), "passwordReset"))) return;
    const asked = accountKey(req.body?.email);
    // Per account as well, so one address can't be mailbombed from many machines.
    if (asked && !(await enforceRateLimit(res, asked, "passwordReset"))) return;

    const result = await sendPasswordResetEmail(String(req.body?.email ?? ""), req);
    /*
     * One answer for every outcome, including the failures. A caller must not
     * be able to tell an account from a non-account by status code, body, or
     * by how long the reply took — which is why nothing branches after here.
     */
    res.json({
      ok: true,
      message: "If there's an account for that address, a reset link is on its way.",
      // Only ever populated outside production, for the development outbox and tests.
      ...(process.env.NODE_ENV !== "production" && result.token ? { devToken: result.token } : {}),
    });
  });

  /** Spends a link and sets the new password. Public: the link is the credential. */
  app.post("/api/auth/reset-password", async (req: any, res) => {
    // public-write: the emailed token, by hash, unexpired, spent once; limited per address
    /*
     * The looser limit, not the three-links-per-quarter-hour one. Spending a
     * link is not the abusable half — a token nobody holds can't be guessed at
     * a useful rate — and sharing that budget punished exactly the wrong
     * person: ask for a link, ask again because the first didn't arrive, open
     * one, mistype the new password, and the retry is refused with "try again
     * in 14 minutes" at the last step of getting back into your account.
     */
    if (!(await enforceRateLimit(res, ipKey(req), "session"))) return;
    try {
      const result = await resetPassword(String(req.body?.token ?? ""), String(req.body?.password ?? ""));
      if (!result.ok) {
        const message = result.message ?? (result.reason === "expired"
          ? "That link has expired. Ask for a new one and we'll send another."
          : "That link isn't valid any more — it may already have been used. Ask for a new one.");
        return res.status(400).json({ message, code: result.reason, ...(result.reason === "invalid_input" ? { field: "password" } : {}) });
      }
      res.json({ ok: true, email: result.email, sessionsEnded: result.sessionsEnded, devicesSignedOut: result.devicesSignedOut });
    } catch (err) {
      console.error("[password-reset] reset failed:", err);
      res.status(500).json({ message: "Couldn't set that password. Nothing was changed." });
    }
  });
}
