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

export function getSession() {
  const sessionTtlSeconds = 7 * 24 * 60 * 60;
  const sessionTtlMs = sessionTtlSeconds * 1000;
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be set in production");
  }
  // Debug: log session secret presence and session import
  try {
    // eslint-disable-next-line no-console
    console.log("getSession() SESSION_SECRET=", Boolean(process.env.SESSION_SECRET));
    // eslint-disable-next-line no-console
    console.log("express-session type:", typeof session);
  } catch (e) {}
  const sessionFn: any = (session as any)?.default || session;
  const pgStore = connectPg(sessionFn);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtlSeconds,
    tableName: "sessions",
  });
  return sessionFn({
    secret: process.env.SESSION_SECRET || "dev-session-secret",
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
      cb(null, user || null);
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
          if (!user) {
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
    const defaultPort = process.env.PORT || "5001";
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || `localhost:${defaultPort}`;
    const protocol = domain.includes("localhost") ? "http" : "https";
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${protocol}://${domain}/api/auth/google/callback`,
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
    // Debug: log the configured Google callback URL (does not include secrets)
    try {
      // eslint-disable-next-line no-console
      console.log("Google OAuth callback URL:", `${protocol}://${domain}/api/auth/google/callback`);
    } catch (e) {}
  }
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};
