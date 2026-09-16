import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { ensureUserProfile } from "../../user-provisioning";
import { stampSignupAttribution } from "../../attribution";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import bcrypt from "bcryptjs";
import { sessionSecret } from "../../secrets";
import { isDeleted } from "../../account-data";

/** The host part of a configured URL — "https://sparktower.app/" → "sparktower.app". */
function hostOf(url: string | undefined): string | null {
  const value = url?.trim();
  if (!value) return null;
  try { return new URL(/^https?:\/\//.test(value) ? value : `https://${value}`).host.toLowerCase(); }
  catch { return null; }
}

/**
 * Where Google sends somebody back to, which has to be the host they started
 * on: the session cookie is set on that host and no other, so a callback on the
 * wrong one signs them in somewhere they aren't looking and returns them to the
 * site signed out — with nothing in the log about it.
 *
 * In order:
 *
 *  - `AUTH_HOST`, so the callback can be pointed at a LAN address while testing
 *    with other people on the same wifi. Without it this used to be hard-wired
 *    to localhost, and localhost on a tester's phone is the tester's phone.
 *  - `PUBLIC_URL`, the site's real address once there's a custom domain. This
 *    is the one that was missing: a deployment answering as sparktower.app was
 *    still sending people back to the platform's own hostname.
 *  - the platform's hostname, then localhost.
 *
 * Whatever comes out, the matching redirect URI has to exist in the Google
 * console — see docs/ops/custom-domain.md.
 */
export function googleCallbackUrl(env: NodeJS.ProcessEnv = process.env): string {
  const domain =
    env.AUTH_HOST ||
    hostOf(env.PUBLIC_URL) ||
    env.REPLIT_DOMAINS?.split(",")[0] ||
    `localhost:${env.PORT || "5001"}`;
  // Anything on the local network is plain http; only a real domain is https.
  const isLocal = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(domain);
  return `${isLocal ? "http" : "https"}://${domain}/api/auth/google/callback`;
}

export function getSession() {
  const sessionTtlSeconds = 7 * 24 * 60 * 60;
  const sessionTtlMs = sessionTtlSeconds * 1000;
  const isProduction = process.env.NODE_ENV === "production";
  /*
   * No fallback, in any environment: unset throws, and so, in production, does
   * a short or publicly known value (server/secrets.ts). There used to be a
   * development default here, which any deploy not running with NODE_ENV
   * exactly "production" would quietly sign cookies with.
   */
  const secret = sessionSecret();
  const sessionFn: any = (session as any)?.default || session;
  const pgStore = connectPg(sessionFn);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtlSeconds,
    tableName: "sessions",
  });
  return sessionFn({
    secret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "lax" : "lax",
      maxAge: sessionTtlMs,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: any, cb) => cb(null, user.id));
  passport.deserializeUser(async (serialized: any, cb) => {
    try {
      const userId = typeof serialized === "object" && serialized?.claims?.sub
        ? serialized.claims.sub
        : String(serialized);
      const user = await authStorage.getUser(userId);
      // A closed account is nobody: its sessions are deleted at deletion, and any that outlive it resolve to no user.
      cb(null, user && !isDeleted(user) ? user : null);
    } catch (err) {
      cb(err);
    }
  });

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const user = await authStorage.getUserByEmail(email);
          if (!user || isDeleted(user)) {
            return done(null, false, { message: "Invalid email or password" });
          }
          if (!user.passwordHash) {
            return done(null, false, { message: "This account uses Google sign-in. Please log in with Google." });
          }
          const isValid = await bcrypt.compare(password, user.passwordHash);
          if (!isValid) {
            return done(null, false, { message: "Invalid email or password" });
          }
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: googleCallbackUrl(),
          /* So a new account can be stamped with the link that brought them. */
          passReqToCallback: true,
        },
        async (req: any, _accessToken: string, _refreshToken: string, profile: any, done: any) => {
          try {
            const email = profile.emails?.[0]?.value;
            const existingUser = await authStorage.getUserByGoogleId(profile.id);
            if (existingUser) {
              // Also runs for returning users: accounts created before
              // provisioning existed get their profile on next sign-in.
              await ensureUserProfile(existingUser);
              return done(null, existingUser);
            }
            if (email) {
              const emailUser = await authStorage.getUserByEmail(email);
              if (emailUser) {
                const updated = await authStorage.linkGoogleAccount(emailUser.id, profile.id);
                await ensureUserProfile(updated);
                return done(null, updated);
              }
            }
            const newUser = await authStorage.upsertUser({
              email: email || undefined,
              firstName: profile.name?.givenName || profile.displayName,
              lastName: profile.name?.familyName || "",
              profileImageUrl: profile.photos?.[0]?.value || undefined,
              authProvider: "google",
              googleId: profile.id,
              // Google has already checked the address; asking its owner to prove it again is theatre.
              emailVerifiedAt: new Date(),
            });
            await ensureUserProfile(newUser);
            // Only here, on the branch that actually creates an account —
            // the two branches above are returning users.
            await stampSignupAttribution(newUser.id, req);
            return done(null, newUser);
          } catch (err) {
            return done(err);
          }
        }
      )
    );
    /*
     * Printed at boot because the failure it prevents is invisible: a callback
     * on the wrong host signs people in somewhere they aren't looking. This is
     * the string that has to appear verbatim in the Google console. No secrets
     * in it.
     */
    console.log("Google OAuth callback URL:", googleCallbackUrl());
  }
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};
