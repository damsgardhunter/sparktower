import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import passport from "passport";
import bcrypt from "bcryptjs";

// Simple in-memory rate limiter for auth endpoints (IP-based)
const loginAttempts: Map<string, { count: number; firstAttempt: number }> = new Map();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip: string) {
  const now = Date.now();
  const data = loginAttempts.get(ip);
  if (!data) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true };
  }
  if (now - data.firstAttempt > WINDOW_MS) {
    // reset window
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true };
  }
  data.count += 1;
  loginAttempts.set(ip, data);
  if (data.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: Math.ceil((WINDOW_MS - (now - data.firstAttempt)) / 1000) };
  }
  return { allowed: true };
}

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

  app.post("/api/auth/login", (req, res, next) => {
    const ip = req.ip || req.headers["x-forwarded-for"] || req.connection?.remoteAddress || "unknown";
    const rate = checkRateLimit(String(ip));
    if (!rate.allowed) {
      return res.status(429).json({ message: "Too many login attempts", retryAfter: rate.retryAfter });
    }
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      req.login(user, (err: any) => {
        if (err) return next(err);
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
