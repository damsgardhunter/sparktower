/**
 * Your data: take a copy, or leave.
 *
 * Both routes act only on the caller's own account — there is no id in either
 * path, so there is nothing to tamper with. Deleting asks for the password
 * again (and a second factor where one is set up), because a borrowed session
 * must not be able to erase someone's work.
 *
 * What each one does with which tables is in server/account-data.ts.
 */
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { deleteAccount, exportAccount } from "./account-data";
import { checkSecondFactor, countWrongMfaCode, limitMfaAttempts, mfaEnabledFor } from "./mfa";

export function registerAccountRoutes(app: Express) {
  /** Everything we hold on the account, as a JSON file. */
  app.get("/api/account/export", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    try {
      const data = await exportAccount(req.user.id);
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="sparktower-export-${stamp}.json"`);
      res.send(JSON.stringify(data, null, 2));
    } catch (error: any) {
      if (error?.status === 404) return res.status(404).json({ message: "No such account" });
      console.error("Account export error:", error);
      res.status(500).json({ message: "Couldn't build your export. Try again in a minute." });
    }
  });

  /**
   * Closes the account for good.
   *
   * `keepPosts` is the person's choice about what other people can still read:
   * their posts and comments stay under "Deleted account", or go with
   * everything else. Projects with other members are handed over, never deleted.
   */
  app.post("/api/account/delete", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ message: "No such account" });

      // Proof it's them, not a borrowed tab. An account with no password (Google only) is asked to type the phrase instead.
      if (user.passwordHash) {
        const password = String(req.body?.password ?? "");
        if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
          return res.status(401).json({ message: "That password isn't right.", code: "bad_password", field: "password" });
        }
      } else if (String(req.body?.confirm ?? "").trim().toLowerCase() !== "delete my account") {
        return res.status(400).json({ message: 'Type "delete my account" to confirm.', code: "confirm_required", field: "confirm" });
      }

      if (mfaEnabledFor(user)) {
        if (!(await limitMfaAttempts(req, res, userId))) return;
        const method = await checkSecondFactor(userId, String(req.body?.code ?? ""));
        if (!method) {
          await countWrongMfaCode(userId);
          return res.status(401).json({ message: "That code isn't right.", code: "mfa_invalid_code", field: "code" });
        }
      }

      const outcome = await deleteAccount(userId, { keepPosts: req.body?.keepPosts === true });

      // The session this came in on is already gone from the store; clear the cookie too.
      req.logout?.(() => {
        req.session?.destroy?.(() => {
          res.clearCookie("connect.sid");
          res.json({ ok: true, ...outcome });
        });
      });
      // No passport on this request (a bearer-token client): answer anyway.
      if (!req.logout) res.json({ ok: true, ...outcome });
    } catch (error) {
      console.error("Account delete error:", error);
      res.status(500).json({ message: "Couldn't close the account. Nothing was changed." });
    }
  });
}
