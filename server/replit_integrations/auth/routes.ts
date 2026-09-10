import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import passport from "passport";
import bcrypt from "bcryptjs";
import { ensureUserProfile } from "../../user-provisioning";
import { stampSignupAttribution } from "../../attribution";
import { enforceRateLimit, ipKey } from "../../moderation";
import { db } from "../../db";
import { mobileRefreshTokens } from "@shared/models/auth";
import { and, eq, isNull, sql } from "drizzle-orm";
/** The session cookie's name, as express-session is configured. */
const SESSION_COOKIE = "connect.sid";

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const user = await authStorage.getUser(req.user.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post("/api/auth/register", async (req, res, next) => {
    // Registration attempts count with sign-in attempts: same address, same budget.
    if (!(await enforceRateLimit(res, ipKey(req), "login"))) return;
    try {
      const { email, password, firstName, lastName } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const existing = await authStorage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "An account with this email already exists" });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await authStorage.upsertUser({
        email,
        passwordHash,
        firstName: firstName || "",
        lastName: lastName || "",
        authProvider: "local",
      });
      // The profile is part of having an account, not something the user
      // stumbles into later — see server/user-provisioning.ts.
      await ensureUserProfile(user);
      // Where they came from, from the cookie stamped on their first page.
      // Here and not in ensureUserProfile, which also runs on every sign-in.
      await stampSignupAttribution(user.id, req);

      req.login(user, (err: any) => {
        if (err) return next(err);
        const { passwordHash: _, ...safeUser } = user;
        res.status(201).json(safeUser);
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/auth/login", async (req, res, next) => {
    /*
     * Durable and IP-keyed. This replaced an in-memory map, which was one
     * counter per instance and forgot everything on restart — on autoscale
     * that is N times the limit, and a deploy was a free reset for whoever was
     * guessing passwords at the time.
     */
    const ip = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
    if (!(await enforceRateLimit(res, `ip:${String(ip).split(",")[0].trim()}`, "login"))) return;
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      req.login(user, async (err: any) => {
        if (err) return next(err);
        // Heals accounts created before profiles were provisioned at sign-up.
        await ensureUserProfile(user);
        const { passwordHash, ...safeUser } = user;
        res.json(safeUser);
      });
    })(req, res, next);
  });

  app.get("/api/auth/google", passport.authenticate("google", {
    scope: ["profile", "email"],
  }));

  app.get("/api/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/?auth=failed" }),
    (_req, res) => {
      res.redirect("/");
    }
  );

  app.get("/api/login", (_req, res) => {
    res.redirect("/");
  });

  /**
   * Signing out destroys the session row, not just the login state on it:
   * a cookie that is later replayed finds nothing. POST is the real form;
   * GET stays for existing links and does the same before redirecting.
   */
  const endSession = (req: any, res: any, then: () => void) => {
    req.logout(() => {
      const done = () => { res.clearCookie(SESSION_COOKIE); then(); };
      if (req.session) req.session.destroy(done); else done();
    });
  };
  app.post("/api/logout", (req: any, res) => endSession(req, res, () => res.json({ ok: true })));
  app.get("/api/logout", (req: any, res) => endSession(req, res, () => res.redirect("/")));

  /**
   * Sign out everywhere: every web session for this user and every mobile
   * refresh token. For a lost phone or a shared computer. The current
   * session goes too, so the caller ends signed out.
   */
  app.post("/api/auth/logout-all", isAuthenticated, async (req: any, res) => {
    const userId = req.user.id;
    try {
      const sessions = await db.execute(sql`DELETE FROM sessions WHERE sess->'passport'->>'user' = ${userId}`);
      const tokens = await db.update(mobileRefreshTokens).set({ revokedAt: new Date() })
        .where(and(eq(mobileRefreshTokens.userId, userId), isNull(mobileRefreshTokens.revokedAt))).returning({ id: mobileRefreshTokens.id });
      res.clearCookie(SESSION_COOKIE);
      res.json({ ok: true, sessionsEnded: Number((sessions as any).rowCount ?? 0), devicesSignedOut: tokens.length });
    } catch (err) {
      console.error("logout-all failed:", err);
      res.status(500).json({ message: "Couldn't sign out everywhere. Try again." });
    }
  });
}
