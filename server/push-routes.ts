/**
 * The three things the app needs in order to be buzzed, and to stop being.
 *
 *   POST   /api/push/token    → this installation can be reached here
 *   DELETE /api/push/token    → forget it (sign-out, on this device only)
 *   GET    /api/push/state    → is it on, and how many devices
 *   PATCH  /api/push/state    → turn it on or off for this person
 *
 * Registering is not a one-off. The app posts on every launch, because an Expo
 * push token can be reissued — a restored backup, a reinstall, an OS that
 * decides to — and a stale one is an address that silently reaches nobody. So
 * the route is an upsert and `lastSeenAt` is how a phone left in a drawer
 * eventually stops being written to.
 */
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { pushTokens, users } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { forgetDevice, isExpoPushToken, registerDevice } from "./push";

export function registerPushRoutes(app: Express) {
  app.post("/api/push/token", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    try {
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!isExpoPushToken(token)) {
        return res.status(400).json({ message: "That isn't an Expo push token.", code: "invalid_input", field: "token" });
      }
      const platform = req.body?.platform === "ios" || req.body?.platform === "android" ? req.body.platform : null;
      if (!platform) {
        return res.status(400).json({ message: "Say which platform this is.", code: "invalid_input", field: "platform" });
      }
      const device = typeof req.body?.device === "string" ? req.body.device.slice(0, 120) : null;
      await registerDevice({ userId: req.user.id, token, platform, device });
      res.json({ ok: true });
    } catch (error) {
      console.error("Push register error:", error);
      res.status(500).json({ message: "Couldn't save where to reach you." });
    }
  });

  app.delete("/api/push/token", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    try {
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!token) return res.status(400).json({ message: "Which token?", code: "invalid_input", field: "token" });
      await forgetDevice({ userId: req.user.id, token });
      /*
       * 200 whether or not a row went. Signing out should not depend on the
       * server agreeing that this device was ever registered, and the app is
       * about to drop its session either way.
       */
      res.json({ ok: true });
    } catch (error) {
      console.error("Push forget error:", error);
      res.status(500).json({ message: "Couldn't forget this device." });
    }
  });

  app.get("/api/push/state", isAuthenticated, async (req: any, res) => {
    try {
      const [me] = await db.select({ enabled: users.pushEnabled }).from(users).where(eq(users.id, req.user.id));
      const devices = await db.select({ token: pushTokens.token, device: pushTokens.device, platform: pushTokens.platform, lastSeenAt: pushTokens.lastSeenAt })
        .from(pushTokens).where(eq(pushTokens.userId, req.user.id));
      res.json({ enabled: me?.enabled ?? true, devices });
    } catch (error) {
      console.error("Push state error:", error);
      res.status(500).json({ message: "Couldn't load your notification settings." });
    }
  });

  app.patch("/api/push/state", isAuthenticated, rateLimit("write"), async (req: any, res) => {
    try {
      if (typeof req.body?.enabled !== "boolean") {
        return res.status(400).json({ message: "Say on or off.", code: "invalid_input", field: "enabled" });
      }
      await db.update(users).set({ pushEnabled: req.body.enabled }).where(eq(users.id, req.user.id));
      /*
       * The device rows stay. Turning push back on should work without
       * reinstalling the app, and the OS permission is untouched either way.
       */
      res.json({ enabled: req.body.enabled });
    } catch (error) {
      console.error("Push switch error:", error);
      res.status(500).json({ message: "Couldn't change that." });
    }
  });
}
