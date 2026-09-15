/**
 * Token authentication for the native mobile apps.
 *
 * The web app uses cookie sessions. A native client can't: there's no shared
 * cookie jar with the API origin, `sameSite` blocks it, and Google refuses
 * OAuth inside app WebViews. So mobile gets a short-lived signed access token
 * plus a rotating refresh token.
 *
 * Both auth styles coexist — `attachBearerUser` populates `req.user` from a
 * Bearer token when there's no session, so every existing `isAuthenticated`
 * route works unchanged for mobile.
 */
import type { Express, RequestHandler } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { db } from "./db";
import { users, mobileRefreshTokens } from "@shared/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { storage } from "./storage";
import { ACCESS_TOKEN_KEY_LABEL, mobileTokenKey } from "./secrets";
import { ensureUserProfile } from "./user-provisioning";
import { stampSignupAttribution } from "./attribution";
import { enforceRateLimit, ipKey, rateLimit } from "./moderation";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { checkSecondFactor, limitMfaAttempts, mfaEnabledFor, mfaRequiredFor, readMfaChallenge, signMfaChallenge } from "./mfa";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;          // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 60;

export { ACCESS_TOKEN_KEY_LABEL };

/**
 * The key access tokens are signed with.
 *
 * MOBILE_TOKEN_SECRET when it's set. Without it, a key DERIVED from
 * SESSION_SECRET — HMAC-SHA256 over a fixed label — never SESSION_SECRET
 * itself: the raw secret signs web session cookies, and one key doing two
 * jobs means a flaw or leak in either reaches both. Derivation keeps the app
 * booting with one secret while the two keys stay separate. (Access tokens
 * signed with the raw secret before this stop verifying; the app refreshes
 * with its refresh token, which is stored by hash and doesn't depend on it.)
 */
export const tokenSecret = mobileTokenKey;

/** Said once at boot in production: a dedicated secret is still the better setup. */
export function warnIfSharedTokenSecret(): void {
  if (process.env.NODE_ENV === "production" && !process.env.MOBILE_TOKEN_SECRET) {
    console.warn("[auth] MOBILE_TOKEN_SECRET is not set; mobile access tokens use a key derived from SESSION_SECRET. Set a separate MOBILE_TOKEN_SECRET so rotating one secret doesn't touch the other.");
  }
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

/**
 * Minimal HS256 JWT. Implemented here rather than adding a dependency —
 * it's ~20 lines and the payload is a user id plus an expiry.
 */
function signAccessToken(userId: string, mfa = false): { token: string; expiresIn: number } {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    sub: userId,
    iat: now,
    // Milliseconds, because revocation is: a token issued in the same second as "sign out everywhere" must still die.
    iat_ms: Date.now(),
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    // Passed a second factor at sign-in (server/mfa.ts); privileged routes need it.
    ...(mfa ? { mfa: true } : {}),
  }));
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  return { token: `${body}.${signature}`, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** Returns the user id and when the token was issued, or null when it's invalid, tampered, or expired. */
export function verifyAccessToken(token: string): { userId: string; issuedAtMs: number; mfa: boolean } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  const expected = crypto.createHmac("sha256", tokenSecret()).update(`${header}.${payload}`).digest("base64url");
  // Constant-time compare so a wrong signature can't be brute-forced by timing.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims.sub !== "string") return null;
    if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof claims.iat !== "number") return null;
    // Tokens from before iat_ms existed count from the start of their second — revoked when in doubt.
    return { userId: claims.sub, issuedAtMs: typeof claims.iat_ms === "number" ? claims.iat_ms : claims.iat * 1000, mfa: claims.mfa === true };
  } catch {
    return null;
  }
}

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

/** Issues a refresh token, storing only its hash. */
async function issueRefreshToken(userId: string, device?: string, mfa = false): Promise<string> {
  const raw = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await db.insert(mobileRefreshTokens).values({
    userId,
    tokenHash: hashToken(raw),
    device: device?.slice(0, 200) || null,
    expiresAt,
    mfa,
  });
  return raw;
}

/** How long after rotation a spent token can come back without it meaning theft: a response lost to a dropped connection. */
export const REFRESH_REUSE_GRACE_MS = 30_000;

/**
 * A refresh token that was already rotated, presented again later, means two
 * holders — the device and whoever copied it. Which one is the thief can't be
 * told, so every live session for that account on mobile ends; the real user
 * signs in again, the copy is worthless. Within the grace window it's only a
 * refused retry.
 */
async function revokeOnReuse(tokenHash: string): Promise<void> {
  const [spent] = await db.select().from(mobileRefreshTokens).where(eq(mobileRefreshTokens.tokenHash, tokenHash));
  if (!spent?.revokedAt || Date.now() - spent.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS) return;
  const ended = await db.update(mobileRefreshTokens).set({ revokedAt: new Date() })
    .where(and(eq(mobileRefreshTokens.userId, spent.userId), isNull(mobileRefreshTokens.revokedAt)))
    .returning({ id: mobileRefreshTokens.id });
  // And the access tokens those sessions hold — the thief's included.
  await db.update(users).set({ accessTokensRevokedAt: new Date() }).where(eq(users.id, spent.userId));
  console.warn(`[auth] refresh token reused for user ${spent.userId}; ended ${ended.length} mobile session(s)`);
}

/** The payload every auth endpoint returns. */
async function buildSession(userId: string, device?: string, opts: { mfa?: boolean } = {}) {
  const { token, expiresIn } = signAccessToken(userId, !!opts.mfa);
  const refreshToken = await issueRefreshToken(userId, device, !!opts.mfa);
  const user = await storage.getUser(userId);
  const safeUser = user ? { ...user, passwordHash: undefined } : null;

  /*
   * Provisioned here rather than at each of the four mobile entry points
   * (register, login, Google, refresh) — every session is built through this
   * function, so no sign-in route can forget it.
   */
  if (user) await ensureUserProfile(user);

  const profile = await storage.getUserProfile(userId).catch(() => undefined);
  return {
    accessToken: token,
    expiresIn,
    refreshToken,
    user: safeUser,
    profile: profile ?? null,
  };
}

/**
 * Populates `req.user` from an `Authorization: Bearer` header.
 *
 * Runs before the routes and only when there's no session, so cookie auth on
 * web is untouched and `isAuthenticated` needs no changes.
 */
export const attachBearerUser: RequestHandler = async (req: any, _res, next) => {
  try {
    if (req.user) return next();

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return next();

    const verified = verifyAccessToken(header.slice(7).trim());
    if (!verified) return next();

    const user = await storage.getUser(verified.userId);
    if (!user) return next();
    // Revoked with the account's sessions (sign out everywhere, a stolen refresh token): refused before its expiry.
    if (user.accessTokensRevokedAt && verified.issuedAtMs <= user.accessTokensRevokedAt.getTime()) return next();

    req.user = user;
    // Whether this token's sign-in passed a second factor (server/mfa.ts).
    req.mfaVerified = verified.mfa;
    // Passport's isAuthenticated() checks this; make it true for token auth so
    // every existing guarded route accepts a mobile caller.
    req.isAuthenticated = () => true;
    next();
  } catch (err) {
    console.error("Bearer auth error (continuing unauthenticated):", err);
    next();
  }
};

export function registerMobileAuthRoutes(app: Express) {
  /** Email + password sign-in for mobile. */
  app.post("/api/auth/mobile/login", async (req, res) => {
    // public-write: the password it checks; limited per address (login)
    if (!(await enforceRateLimit(res, ipKey(req), "login"))) return;
    try {
      const { email, password, device } = req.body as {
        email?: string; password?: string; device?: string;
      };
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }

      const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim()));
      // Same message either way so the endpoint can't be used to enumerate accounts.
      const invalid = { message: "Invalid email or password" };
      if (!user?.passwordHash) return res.status(401).json(invalid);

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json(invalid);

      // Two-factor accounts get a challenge, not tokens; /api/auth/mobile/mfa/verify finishes with a code.
      if (mfaEnabledFor(user)) return res.json({ mfaRequired: true, challengeToken: signMfaChallenge(user.id) });
      res.json({ ...(await buildSession(user.id, device)), mfaEnrollmentRequired: mfaRequiredFor(user) });
    } catch (error) {
      console.error("Mobile login error:", error);
      res.status(500).json({ message: "Sign-in failed" });
    }
  });

  /** Registration, so someone can create an account from the app. */
  app.post("/api/auth/mobile/register", async (req, res) => {
    // public-write: nothing — it creates an account; limited per address (login)
    if (!(await enforceRateLimit(res, ipKey(req), "login"))) return;
    try {
      const { email, password, firstName, lastName, device } = req.body as Record<string, string>;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const normalized = email.toLowerCase().trim();
      const [existing] = await db.select().from(users).where(eq(users.email, normalized));
      if (existing) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }

      const [user] = await db.insert(users).values({
        email: normalized,
        passwordHash: await bcrypt.hash(password, 12),
        firstName: firstName || "",
        lastName: lastName || "",
        authProvider: "local",
      }).returning();
      // The app carries its own attribution — there is no landing page here to
      // have stamped a cookie on. See server/attribution.ts.
      await stampSignupAttribution(user.id, req);

      res.json(await buildSession(user.id, device));
    } catch (error) {
      console.error("Mobile register error:", error);
      res.status(500).json({ message: "Could not create your account" });
    }
  });

  /**
   * Native Google sign-in.
   *
   * The app runs Google's native SDK (which opens a real browser or the system
   * account picker — Google blocks OAuth inside WebViews) and posts the
   * resulting ID token here for verification.
   */
  app.post("/api/auth/mobile/google", async (req, res) => {
    // public-write: a Google ID token verified server-side against our client ids; limited per address
    if (!(await enforceRateLimit(res, ipKey(req), "login"))) return;
    try {
      const { idToken, device } = req.body as { idToken?: string; device?: string };
      if (!idToken) return res.status(400).json({ message: "idToken is required" });

      const clientIds = [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_IOS_CLIENT_ID,
        process.env.GOOGLE_ANDROID_CLIENT_ID,
      ].filter(Boolean) as string[];

      if (clientIds.length === 0) {
        return res.status(503).json({ message: "Google sign-in isn't configured on the server." });
      }

      const client = new OAuth2Client();
      let payload;
      try {
        const ticket = await client.verifyIdToken({ idToken, audience: clientIds });
        payload = ticket.getPayload();
      } catch (verifyErr: any) {
        console.error("Google ID token verification failed:", verifyErr?.message);
        return res.status(401).json({ message: "That Google sign-in couldn't be verified." });
      }

      if (!payload?.sub || !payload.email) {
        return res.status(401).json({ message: "Google didn't return an email address." });
      }
      if (payload.email_verified === false) {
        return res.status(401).json({ message: "That Google email isn't verified." });
      }

      const email = payload.email.toLowerCase();
      // Link by Google id first, then by email so someone who signed up with a
      // password doesn't end up with a duplicate account.
      let [user] = await db.select().from(users).where(eq(users.googleId, payload.sub));
      if (!user) {
        const [byEmail] = await db.select().from(users).where(eq(users.email, email));
        if (byEmail) {
          [user] = await db.update(users)
            .set({ googleId: payload.sub, profileImageUrl: byEmail.profileImageUrl || payload.picture || null })
            .where(eq(users.id, byEmail.id))
            .returning();
        } else {
          [user] = await db.insert(users).values({
            email,
            googleId: payload.sub,
            firstName: payload.given_name || "",
            lastName: payload.family_name || "",
            profileImageUrl: payload.picture || null,
            authProvider: "google",
          }).returning();
          // Only this branch creates an account; the two above return one that
          // already existed.
          await stampSignupAttribution(user.id, req);
        }
      }

      if (mfaEnabledFor(user)) return res.json({ mfaRequired: true, challengeToken: signMfaChallenge(user.id) });
      res.json({ ...(await buildSession(user.id, device)), mfaEnrollmentRequired: mfaRequiredFor(user) });
    } catch (error) {
      console.error("Mobile Google auth error:", error);
      res.status(500).json({ message: "Google sign-in failed" });
    }
  });

  /**
   * Exchanges a refresh token for a new pair.
   *
   * The old token is revoked on use (rotation), so a stolen refresh token is
   * only good until the real device next refreshes.
   */
  app.post("/api/auth/mobile/refresh", async (req, res) => {
    // public-write: the refresh token, looked up by SHA-256 hash, unexpired, claimed atomically once; a spent token reused ends every mobile session (test/integration/auth-hardening.test.ts)
    if (!(await enforceRateLimit(res, ipKey(req), "login"))) return;
    try {
      const { refreshToken, device } = req.body as { refreshToken?: string; device?: string };
      if (!refreshToken) return res.status(400).json({ message: "refreshToken is required" });

      // Claimed atomically: of two requests racing with one token, only one gets a session.
      const [row] = await db.update(mobileRefreshTokens)
        .set({ revokedAt: new Date(), lastUsedAt: new Date() })
        .where(and(
          eq(mobileRefreshTokens.tokenHash, hashToken(refreshToken)),
          isNull(mobileRefreshTokens.revokedAt),
          gt(mobileRefreshTokens.expiresAt, new Date()),
        ))
        .returning();

      if (!row) {
        await revokeOnReuse(hashToken(refreshToken));
        return res.status(401).json({ message: "Your session expired. Please sign in again.", code: "refresh_invalid" });
      }

      // A session that passed a second factor keeps that through rotation.
      res.json(await buildSession(row.userId, device || row.device || undefined, { mfa: row.mfa }));
    } catch (error) {
      console.error("Mobile refresh error:", error);
      res.status(500).json({ message: "Could not refresh your session" });
    }
  });

  /** Finishing a mobile sign-in that stopped at the second factor: the challenge from login, and a code. */
  app.post("/api/auth/mobile/mfa/verify", rateLimit("login"), async (req, res) => {
    // public-write: a signed five-minute challenge that only a correct password produced, plus a one-time code; limited per address and per account
    try {
      const userId = readMfaChallenge(req.body?.challengeToken);
      if (!userId) return res.status(401).json({ message: "That sign-in has expired. Enter your password again.", code: "mfa_challenge_expired" });
      if (!(await limitMfaAttempts(req, res, userId))) return;
      const method = await checkSecondFactor(userId, String(req.body?.code ?? ""));
      if (!method) return res.status(401).json({ message: "That code isn't right. Check your authenticator app and try again.", code: "mfa_invalid_code" });
      res.json({ ...(await buildSession(userId, typeof req.body?.device === "string" ? req.body.device : undefined, { mfa: true })), mfaMethod: method });
    } catch (error) {
      console.error("Mobile MFA verify error:", error);
      res.status(500).json({ message: "Sign-in failed" });
    }
  });

  /** Signs this device out. Other devices keep their sessions. */
  app.post("/api/auth/mobile/logout", async (req, res) => {
    // public-write: the refresh token it revokes, by hash; it can only end the session it names
    if (!(await enforceRateLimit(res, ipKey(req), "session"))) return;
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (refreshToken) {
        await db.update(mobileRefreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(mobileRefreshTokens.tokenHash, hashToken(refreshToken)));
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Mobile logout error:", error);
      res.status(500).json({ message: "Sign-out failed" });
    }
  });

  /** Current user for a Bearer token — the app's session bootstrap. */
  // Guarded explicitly, like every other signed-in route, rather than relying on attachBearerUser having run first.
  app.get("/api/auth/mobile/me", isAuthenticated, async (req: any, res) => {
    const profile = await storage.getUserProfile(req.user.id).catch(() => undefined);
    res.json({ user: { ...req.user, passwordHash: undefined }, profile: profile ?? null });
  });
}
