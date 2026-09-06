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

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;          // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 60;

/**
 * Signing secret for access tokens. Falls back to SESSION_SECRET so the app
 * boots in development without extra setup, but a dedicated
 * MOBILE_TOKEN_SECRET is preferable in production.
 */
function tokenSecret(): string {
  const secret = process.env.MOBILE_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("MOBILE_TOKEN_SECRET or SESSION_SECRET must be set");
  return secret;
}

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString("base64url");

/**
 * Minimal HS256 JWT. Implemented here rather than adding a dependency —
 * it's ~20 lines and the payload is a user id plus an expiry.
 */
function signAccessToken(userId: string): { token: string; expiresIn: number } {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    sub: userId,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  }));
  const body = `${header}.${payload}`;
  const signature = crypto.createHmac("sha256", tokenSecret()).update(body).digest("base64url");
  return { token: `${body}.${signature}`, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/** Returns the user id, or null when the token is invalid, tampered, or expired. */
export function verifyAccessToken(token: string): string | null {
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
    return claims.sub;
  } catch {
    return null;
  }
}

const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

/** Issues a refresh token, storing only its hash. */
async function issueRefreshToken(userId: string, device?: string): Promise<string> {
  const raw = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await db.insert(mobileRefreshTokens).values({
    userId,
    tokenHash: hashToken(raw),
    device: device?.slice(0, 200) || null,
    expiresAt,
  });
  return raw;
}

/** The payload every auth endpoint returns. */
async function buildSession(userId: string, device?: string) {
  const { token, expiresIn } = signAccessToken(userId);
  const refreshToken = await issueRefreshToken(userId, device);
  const user = await storage.getUser(userId);
  const safeUser = user ? { ...user, passwordHash: undefined } : null;
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

    const userId = verifyAccessToken(header.slice(7).trim());
    if (!userId) return next();

    const user = await storage.getUser(userId);
    if (!user) return next();

    req.user = user;
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

      res.json(await buildSession(user.id, device));
    } catch (error) {
      console.error("Mobile login error:", error);
      res.status(500).json({ message: "Sign-in failed" });
    }
  });

  /** Registration, so someone can create an account from the app. */
  app.post("/api/auth/mobile/register", async (req, res) => {
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
        }
      }

      res.json(await buildSession(user.id, device));
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
    try {
      const { refreshToken, device } = req.body as { refreshToken?: string; device?: string };
      if (!refreshToken) return res.status(400).json({ message: "refreshToken is required" });

      const [row] = await db
        .select()
        .from(mobileRefreshTokens)
        .where(and(
          eq(mobileRefreshTokens.tokenHash, hashToken(refreshToken)),
          isNull(mobileRefreshTokens.revokedAt),
          gt(mobileRefreshTokens.expiresAt, new Date()),
        ));

      if (!row) {
        return res.status(401).json({ message: "Your session expired. Please sign in again.", code: "refresh_invalid" });
      }

      await db.update(mobileRefreshTokens)
        .set({ revokedAt: new Date(), lastUsedAt: new Date() })
        .where(eq(mobileRefreshTokens.id, row.id));

      res.json(await buildSession(row.userId, device || row.device || undefined));
    } catch (error) {
      console.error("Mobile refresh error:", error);
      res.status(500).json({ message: "Could not refresh your session" });
    }
  });

  /** Signs this device out. Other devices keep their sessions. */
  app.post("/api/auth/mobile/logout", async (req, res) => {
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
  app.get("/api/auth/mobile/me", async (req: any, res) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    const profile = await storage.getUserProfile(req.user.id).catch(() => undefined);
    res.json({ user: { ...req.user, passwordHash: undefined }, profile: profile ?? null });
  });
}
