import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";
import bcrypt from "bcryptjs";

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
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
    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost:5000";
    const protocol = domain.includes("localhost") ? "http" : "https";
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${protocol}://${domain}/api/auth/google/callback`,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            const existingUser = await authStorage.getUserByGoogleId(profile.id);
            if (existingUser) {
              return done(null, existingUser);
            }
            if (email) {
              const emailUser = await authStorage.getUserByEmail(email);
              if (emailUser) {
                const updated = await authStorage.linkGoogleAccount(emailUser.id, profile.id);
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
            return done(null, newUser);
          } catch (err) {
            return done(err);
          }
        }
      )
    );
  }
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};
