/**
 * From the app to the website, still signed in.
 *
 * The phone doesn't have every page the website has — companies, challenges,
 * talent, a season invite — and a notification about one of those has to go
 * somewhere. It opens the page in the in-app browser, which shares nothing
 * with the app: the app signs in with a Bearer token, the browser has no
 * cookie, and the website's signed-out router sends every page it doesn't
 * know to the home page. "Alex added you to their company" landed on the
 * marketing page, and a season invite's code was lost on the way.
 *
 *   POST /api/auth/mobile/web-handoff   (signed in)  { next } → { path }
 *   GET  /api/auth/web-handoff?token=…  (anyone)     → a session, then `next`
 *
 * The token is a password for a minute: 32 random bytes, stored only as a
 * hash, good once. Redeeming starts a fresh session (no fixation) with the
 * same standing the app's sign-in had — a second factor passed in the app
 * counts on the web, and one not passed doesn't, so a two-factor account
 * whose app token predates its second factor is asked for a code rather than
 * waved through.
 *
 * `next` is a path on this site and nothing else: it must start with one
 * slash, and never two or a backslash, or the link would be an open redirect
 * that signs you in on the way out.
 */
import crypto from "crypto";
import type { Express } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db";
import { webHandoffTokens } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { storage } from "./storage";
import { isDeleted } from "./account-data";
import { mfaEnabledFor } from "./mfa";

const LIFETIME_MS = 60_000;
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** A path on this site, or null. */
export function safeNext(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 500) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  // No scheme smuggled in after the slash, and nothing that isn't printable.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  return raw;
}

export function registerWebHandoffRoutes(app: Express) {
  app.post("/api/auth/mobile/web-handoff", isAuthenticated, rateLimit("session"), async (req: any, res) => {
    const next = safeNext(req.body?.next);
    if (!next) return res.status(400).json({ message: "That isn't a page on this site.", code: "bad_next" });
    const token = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    await db.insert(webHandoffTokens).values({
      tokenHash: hash(token),
      userId: req.user.id,
      // What this sign-in actually proved: a cookie session's flag, or the app token's claim.
      mfa: !!req.session?.mfaVerifiedAt || req.mfaVerified === true,
      next,
      expiresAt: new Date(now.getTime() + LIFETIME_MS),
      createdAt: now,
    });
    res.json({ path: `/api/auth/web-handoff?token=${token}` });
  });

  app.get("/api/auth/web-handoff", async (req: any, res, next) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) return res.redirect("/");
    try {
      // Spent in the same statement that finds it: two opens of one link sign in once.
      const [row] = await db.update(webHandoffTokens)
        .set({ usedAt: new Date() })
        .where(and(
          eq(webHandoffTokens.tokenHash, hash(token)),
          isNull(webHandoffTokens.usedAt),
          gt(webHandoffTokens.expiresAt, new Date()),
        ))
        .returning();
      if (!row) return res.redirect("/?handoff=expired");

      const user = await storage.getUser(row.userId);
      if (!user || isDeleted(user)) return res.redirect("/");
      const destination = safeNext(row.next) ?? "/";

      req.session.regenerate((err: any) => {
        if (err) return next(err);
        // A two-factor account whose app sign-in didn't pass it: the code, as on any other sign-in.
        if (mfaEnabledFor(user) && !row.mfa) {
          req.session.mfaPending = { userId: user.id, at: Date.now() };
          return req.session.save(() => res.redirect("/mfa"));
        }
        req.login(user, (loginErr: any) => {
          if (loginErr) return next(loginErr);
          if (row.mfa) req.session.mfaVerifiedAt = Date.now();
          req.session.save(() => res.redirect(destination));
        });
      });
    } catch (err) {
      next(err);
    }
  });
}
