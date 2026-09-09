import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import passport from "passport";
import bcrypt from "bcryptjs";
import { ensureUserProfile } from "../../user-provisioning";
import { stampSignupAttribution } from "../../attribution";
import { enforceRateLimit } from "../../moderation";

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

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect("/");
    });
  });
}
