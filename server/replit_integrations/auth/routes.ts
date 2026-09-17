import type { Express } from "express";
import { sendVerificationEmail } from "../../email-verification";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import passport from "passport";
import bcrypt from "bcryptjs";
import { ensureUserProfile } from "../../user-provisioning";
import { stampSignupAttribution } from "../../attribution";
import { enforceRateLimit, ipKey, rateLimit, enforceReservedLimit, refundAttempt, accountKey } from "../../moderation";
import { db } from "../../db";
import { mobileRefreshTokens, users } from "@shared/models/auth";
import { mfaEnabledFor, mfaRequiredFor } from "../../mfa";
import { and, eq, isNull, sql } from "drizzle-orm";
import { checkPassword } from "@shared/passwords";
import { isBreached, BREACHED_MESSAGE } from "../../password-breach";
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
    // public-write: nothing — it creates an account; limited per address (login)
    // Registration attempts count with sign-in attempts: same address, same budget.
    if (!(await enforceRateLimit(res, ipKey(req), "login"))) return;
    try {
      const { email, password, firstName, lastName } = req.body;
      if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      const weak = checkPassword(password, { email });
      if (weak) return res.status(400).json({ message: weak.message, code: "invalid_input", field: weak.field });
      // The list of what people guess is not the list of what has already
      // leaked; this is the second one (server/password-breach.ts).
      if (await isBreached(password)) {
        return res.status(400).json({ message: BREACHED_MESSAGE, code: "breached_password", field: "password" });
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
      // The link goes out now; the account works meanwhile, minus anything that reaches other people.
      await sendVerificationEmail(user, req);

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
    // public-write: the password it checks; limited per address (login)
    /*
     * Durable and IP-keyed. This replaced an in-memory map, which was one
     * counter per instance and forgot everything on restart — on autoscale
     * that is N times the limit, and a deploy was a free reset for whoever was
     * guessing passwords at the time.
     */
    if (!(await enforceRateLimit(res, ipKey(req), "login"))) return;
    /*
     * And against the account being signed in to. Only failures count, so a
     * correct password never brings this closer; what it stops is a list of
     * passwords tried against one account from a thousand addresses, which the
     * per-address limit above never sees.
     *
     * Keyed on the address as typed, existing account or not, so the limit
     * can't be used to find out which addresses have accounts.
     */
    /*
     * The attempt is taken BEFORE the password is checked, and given back if
     * it turns out to be the right one. Counting only failures, after the
     * fact, means the check and the increment are two steps — and a stuffing
     * script doesn't send its guesses one at a time. Two hundred simultaneous
     * attempts all read the same count, all find room under twelve, and all
     * get a guess. Reserving first makes them queue behind each other
     * (server/moderation.ts, reserveAttempt); refunding on success means a
     * person signing in correctly still never spends from this budget.
     */
    const attempted = accountKey(req.body?.email);
    if (attempted && !(await enforceReservedLimit(res, attempted, "loginAccount"))) return;
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      // Right password: this attempt shouldn't have cost them anything.
      if (attempted) void refundAttempt(attempted, "loginAccount");
      // Two-factor accounts: the password alone doesn't sign in. The session holds a pending sign-in for
      // /api/auth/mfa/verify to finish with a code (server/mfa.ts).
      if (mfaEnabledFor(user)) {
        req.session.regenerate((err: any) => {
          if (err) return next(err);
          (req.session as any).mfaPending = { userId: user.id, at: Date.now() };
          req.session.save(() => res.json({ mfaRequired: true }));
        });
        return;
      }
      req.login(user, async (err: any) => {
        if (err) return next(err);
        // Heals accounts created before profiles were provisioned at sign-up.
        await ensureUserProfile(user);
        const { passwordHash, ...safeUser } = user;
        // Signed in; but a role that needs 2FA can't use what it allows until it's set up.
        res.json({ ...safeUser, mfaEnrollmentRequired: mfaRequiredFor(user) });
      });
    })(req, res, next);
  });

  app.get("/api/auth/google", passport.authenticate("google", {
    scope: ["profile", "email"],
  }));

  app.get("/api/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/?auth=failed" }),
    (req: any, res, next) => {
      // Google proved who you are; a two-factor account still needs its code. Undo the sign-in, keep it pending.
      if (mfaEnabledFor(req.user)) {
        const userId = req.user.id;
        return req.logout((err: any) => {
          if (err) return next(err);
          req.session.regenerate((err2: any) => {
            if (err2) return next(err2);
            req.session.mfaPending = { userId, at: Date.now() };
            req.session.save(() => res.redirect("/mfa"));
          });
        });
      }
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
  /*
   * No auth guard, on purpose: signing out has to work with an expired or
   * half-broken session, or the cookie could never be cleared.
   *
   * What it mustn't do is sign someone out from another site. Browsers label
   * every request with Sec-Fetch-Site, and a link or form on someone else's
   * page arrives as "cross-site" (or "same-site" from a sibling subdomain).
   * Those are refused; this site's own requests ("same-origin"), a typed or
   * bookmarked URL ("none"), and clients that don't send the header — the
   * mobile app, older browsers — work as before.
   */
  const fromElsewhere = (req: any) => {
    const site = String(req.headers["sec-fetch-site"] ?? "");
    return site !== "" && site !== "same-origin" && site !== "none";
  };
  app.post("/api/logout", (req: any, res) => {
    // public-write: the session cookie it destroys; refuses cross-site requests
    if (fromElsewhere(req)) return res.status(403).json({ message: "Sign out from SparkTower itself.", code: "cross_site" });
    endSession(req, res, () => res.json({ ok: true }));
  });
  /*
   * The GET form exists for links that predate the button and for a typed or
   * bookmarked URL. A GET that changes something is fetched by things that
   * aren't a person deciding: a browser prefetching a link it thinks you'll
   * click, a mail client scanning URLs for safety, an <img> pointed at it. So
   * it only acts on a real navigation — a request the browser labels as a
   * document, and not one it labels as a prefetch. Anything else is sent home
   * with the session intact, and the button (POST) is unaffected.
   */
  const isPrefetchOrSubresource = (req: any): boolean => {
    const purpose = `${req.headers["sec-purpose"] ?? ""} ${req.headers["purpose"] ?? ""} ${req.headers["x-moz"] ?? ""}`.toLowerCase();
    if (purpose.includes("prefetch") || purpose.includes("prerender")) return true;
    const dest = String(req.headers["sec-fetch-dest"] ?? "").toLowerCase();
    // Absent on older browsers: those get the old behaviour rather than a sign-out that silently stops working.
    return dest !== "" && dest !== "document";
  };
  app.get("/api/logout", (req: any, res) => {
    if (fromElsewhere(req) || isPrefetchOrSubresource(req)) return res.redirect("/");
    endSession(req, res, () => res.redirect("/"));
  });

  /**
   * Sign out everywhere: every web session for this user and every mobile
   * refresh token. For a lost phone or a shared computer. The current
   * session goes too, so the caller ends signed out.
   */
  /**
   * Changing a password.
   *
   * Somebody changes their password because they think somebody else knows it,
   * so the change has to take the other sessions with it — otherwise whoever
   * knew the old one keeps their seat and the change bought nothing. Every
   * other session row goes, every mobile device is signed out, and access
   * tokens already handed out stop working now rather than in fifteen minutes.
   *
   * This session stays: the person doing it is here, authenticated, and has
   * just typed the old password.
   */
  app.post("/api/auth/change-password", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ message: "No such account" });
      if (!user.passwordHash) {
        return res.status(400).json({ message: "This account signs in with Google, so it has no password to change.", code: "no_password" });
      }

      const current = String(req.body?.currentPassword ?? "");
      if (!current || !(await bcrypt.compare(current, user.passwordHash))) {
        return res.status(401).json({ message: "That isn't your current password.", code: "bad_password", field: "currentPassword" });
      }
      const next = String(req.body?.newPassword ?? "");
      const weak = checkPassword(next, { email: user.email });
      if (weak) return res.status(400).json({ message: weak.message, code: "invalid_input", field: "newPassword" });
      // Changing a password is often a response to worrying about one; landing
      // on a breached password would be the worst possible outcome of that.
      if (await isBreached(next)) {
        return res.status(400).json({ message: BREACHED_MESSAGE, code: "breached_password", field: "newPassword" });
      }
      if (next === current) {
        return res.status(400).json({ message: "That's the password you already have.", code: "invalid_input", field: "newPassword" });
      }

      const passwordHash = await bcrypt.hash(next, 12);
      await db.update(users).set({ passwordHash, accessTokensRevokedAt: new Date() }).where(eq(users.id, userId));

      // Everywhere else, now. This session's row is spared so the person isn't signed out of the page they're on.
      const keep = req.sessionID;
      const ended = await db.execute(sql`DELETE FROM sessions WHERE sess->'passport'->>'user' = ${userId} AND sid <> ${keep}`);
      const devices = await db.update(mobileRefreshTokens).set({ revokedAt: new Date() })
        .where(and(eq(mobileRefreshTokens.userId, userId), isNull(mobileRefreshTokens.revokedAt))).returning({ id: mobileRefreshTokens.id });

      res.json({ ok: true, sessionsEnded: Number((ended as any).rowCount ?? 0), devicesSignedOut: devices.length });
    } catch (err) {
      console.error("change-password failed:", err);
      res.status(500).json({ message: "Couldn't change your password. Nothing was changed." });
    }
  });

  // Its own limit, not just the write floor: one call deletes every session row for the account and
  // revokes every device token, and a script calling it in a loop is a way to make the database work.
  app.post("/api/auth/logout-all", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    const userId = req.user.id;
    try {
      const sessions = await db.execute(sql`DELETE FROM sessions WHERE sess->'passport'->>'user' = ${userId}`);
      const tokens = await db.update(mobileRefreshTokens).set({ revokedAt: new Date() })
        .where(and(eq(mobileRefreshTokens.userId, userId), isNull(mobileRefreshTokens.revokedAt))).returning({ id: mobileRefreshTokens.id });
      // Access tokens already handed out stop working now, not in up to 15 minutes.
      await db.update(users).set({ accessTokensRevokedAt: new Date() }).where(eq(users.id, userId));
      res.clearCookie(SESSION_COOKIE);
      res.json({ ok: true, sessionsEnded: Number((sessions as any).rowCount ?? 0), devicesSignedOut: tokens.length });
    } catch (err) {
      console.error("logout-all failed:", err);
      res.status(500).json({ message: "Couldn't sign out everywhere. Try again." });
    }
  });
}
