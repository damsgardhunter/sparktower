/**
 * The security console: who can get in, what is being refused, and the two
 * things an operator needs to be able to do at three in the morning.
 *
 * Until now both of those were a shell and a database URL. Resetting somebody's
 * second factor was `npm run mfa:reset`, which matters more since recovery
 * codes were removed: a person who loses their phone cannot get themselves back
 * in, by design, and the only way anyone could help them was with production
 * credentials on a laptop. Cutting a compromised account's sessions was not
 * possible at all — suspending them leaves every signed-in session alive.
 *
 * Every control here writes to the moderation log, which the database refuses
 * to update or delete (`applyModerationLogRules`). An administrative action
 * nobody can reconstruct afterwards is indistinguishable from an intrusion.
 *
 * Two rules the routes hold to:
 *
 *   - Admin *and* a session that passed its own second factor (`requireAdmin`
 *     below folds in `mfaGate`). A stolen session cookie is not enough.
 *   - Nobody may take their own second factor off. A self-reset would let a
 *     stolen admin session remove the very thing protecting it, and it helps
 *     nobody anyway: a person locked out cannot reach this page. That case is
 *     still the CLI, deliberately, because it needs the database.
 */
import type { Express, RequestHandler, Response } from "express";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { users, mobileRefreshTokens, rateLimitHits, moderationLog, activityEvents } from "@shared/schema";
import { SAFETY_EVENTS } from "@shared/safety";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { mfaGate } from "./mfa";
import { atLeast } from "./platform-roles";
import { logModeration, rateLimit } from "./moderation";
import { normalizeEmail } from "@shared/email-address";

/** Admin, with a session that proved its second factor. Anything less doesn't learn this page exists. */
const requireAdmin: RequestHandler = (req: any, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not signed in" });
  if (!atLeast(req.user.platformRole, "admin")) return res.status(404).json({ message: "Not found" });
  if (!mfaGate(req, res)) return;
  next();
};

/** Enough to identify an account without printing everyone's address in full. */
const maskEmail = (email: string | null): string => {
  if (!email) return "(no address)";
  const [local, domain] = email.split("@");
  if (!domain) return "(no address)";
  return `${local.slice(0, 2)}${local.length > 2 ? "***" : ""}@${domain}`;
};

/** Cuts every way into an account: browser sessions and mobile tokens both. */
async function endEverySession(userId: string): Promise<{ sessions: number; devices: number }> {
  const now = new Date();
  await db.update(users).set({ accessTokensRevokedAt: now, updatedAt: now }).where(eq(users.id, userId));
  const devices = await db.update(mobileRefreshTokens).set({ revokedAt: now })
    .where(and(eq(mobileRefreshTokens.userId, userId), isNull(mobileRefreshTokens.revokedAt)))
    .returning({ id: mobileRefreshTokens.id });
  const ended = await db.execute(sql`DELETE FROM sessions WHERE sess->'passport'->>'user' = ${userId}`);
  return { sessions: Number((ended as any).rowCount ?? 0), devices: devices.length };
}

export function registerAdminSecurityRoutes(app: Express) {
  /**
   * What an operator needs on one screen: who holds power and whether their
   * sign-in is actually protected, what the limits have been refusing, and the
   * administrative actions taken recently.
   */
  app.get("/api/admin/security/overview", isAuthenticated, requireAdmin, async (_req: any, res: Response) => {
    try {
      const privileged = await db
        .select({
          id: users.id, email: users.email, firstName: users.firstName,
          role: users.platformRole, mfaEnabledAt: users.mfaEnabledAt,
          suspendedAt: users.suspendedAt, emailVerifiedAt: users.emailVerifiedAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(sql`${users.platformRole} in ('admin', 'reviewer')`)
        .orderBy(desc(users.platformRole));

      /*
       * The refusals, by kind, over a day. This is the number that says whether
       * anything is being attacked: a hundred `loginAccount` refusals against
       * one account is somebody working through a password list.
       *
       * It used to count `rate_limit_hits`, which is the opposite number. A row
       * lands in that table when an action *passes* — it is the limiter's
       * tally of allowed uses, not of refusals — so the panel labelled
       * "refusals in the last day" was reporting successful activity. A quiet
       * day of ordinary use read as an attack, and a real attack, which is
       * refused and therefore writes no hits, read as nothing happening. That
       * is worse than no number: it points an operator at the wrong thing at
       * the hour they can least afford it.
       *
       * A real refusal is an activity event named SAFETY_EVENTS.limitRefused
       * (`recordRefusal` in server/moderation.ts). Those rows are bucketed —
       * one row per person, limit and minute, carrying `count` — so they are
       * summed rather than counted, the same way server/safety-routes.ts reads
       * them. The allowed-attempt tally is kept alongside under a name that
       * says what it is, since "refused 3 out of 900 attempts" and "refused 3
       * out of 4" are very different situations.
       */
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const refusals = await db
        .select({
          action: sql<string>`${activityEvents.props}->>'action'`,
          n: sql<number>`coalesce(sum(coalesce((${activityEvents.props}->>'count')::int, 1)), 0)::int`,
          subjects: sql<number>`count(distinct coalesce(${activityEvents.userId}, ${activityEvents.visitorId}))::int`,
        })
        .from(activityEvents)
        .where(and(eq(activityEvents.name, SAFETY_EVENTS.limitRefused), gt(activityEvents.createdAt, since)))
        .groupBy(sql`${activityEvents.props}->>'action'`)
        .orderBy(sql`coalesce(sum(coalesce((${activityEvents.props}->>'count')::int, 1)), 0) desc`);

      /** What got through, for scale. Not refusals — see above. */
      const attempts = await db
        .select({ action: rateLimitHits.action, n: sql<number>`count(*)::int`, subjects: sql<number>`count(distinct ${rateLimitHits.userId})::int` })
        .from(rateLimitHits)
        .where(gt(rateLimitHits.createdAt, since))
        .groupBy(rateLimitHits.action)
        .orderBy(sql`count(*) desc`);

      const suspended = await db
        .select({ id: users.id, email: users.email, suspendedAt: users.suspendedAt, reason: users.suspendedReason })
        .from(users).where(sql`${users.suspendedAt} is not null`).limit(50);

      const recentActions = await db
        .select({
          id: moderationLog.id, action: moderationLog.action, actorId: moderationLog.actorId,
          targetUserId: moderationLog.targetUserId, reason: moderationLog.reason, createdAt: moderationLog.createdAt,
        })
        .from(moderationLog).orderBy(desc(moderationLog.createdAt)).limit(25);

      res.json({
        privileged: privileged.map((p) => ({
          ...p,
          email: maskEmail(p.email),
          // The thing worth seeing at a glance: power without a second factor.
          twoFactor: p.mfaEnabledAt ? "on" : "OFF",
        })),
        refusalsLastDay: refusals,
        /** Renamed, not removed: this is what the old `refusalsLastDay` really held. */
        allowedAttemptsLastDay: attempts,
        suspended: suspended.map((s) => ({ ...s, email: maskEmail(s.email) })),
        recentActions,
      });
    } catch (error) {
      console.error("[admin-security] overview failed:", error);
      res.status(500).json({ message: "Couldn't read the security overview" });
    }
  });

  /**
   * Finds one account by its exact address, so the two controls below can be
   * used on anybody — not only on the admins and reviewers the overview lists.
   *
   * The console's main job is the person who lost their phone, and that person
   * is almost never staff. Until this existed, the overview was the only way to
   * reach the buttons, so an ordinary member locked out of their account could
   * not be helped from here at all.
   *
   * An exact match, deliberately not a search: an operator who already knows
   * whose account it is can find it, and nobody can page through the members.
   * The address travels in the body rather than the URL so it is not written
   * into access logs along the way.
   */
  app.post("/api/admin/security/lookup", isAuthenticated, requireAdmin, rateLimit("review"), async (req: any, res) => {
    try {
      const wanted = normalizeEmail(String(req.body?.email ?? ""));
      if (!wanted || !wanted.includes("@")) {
        return res.status(400).json({ message: "Enter the account's full email address.", code: "invalid_input", field: "email" });
      }
      const [found] = await db
        .select({
          id: users.id, email: users.email, firstName: users.firstName,
          role: users.platformRole, mfaEnabledAt: users.mfaEnabledAt,
          suspendedAt: users.suspendedAt, emailVerifiedAt: users.emailVerifiedAt,
          createdAt: users.createdAt, deletedAt: users.deletedAt,
        })
        .from(users)
        .where(sql`lower(${users.email}) = ${wanted}`);
      if (!found || found.deletedAt) return res.status(404).json({ message: "No account with that address.", code: "not_found" });
      const { deletedAt: _deleted, ...row } = found;
      res.json({ account: { ...row, email: maskEmail(row.email), twoFactor: row.mfaEnabledAt ? "on" : "OFF" } });
    } catch (error) {
      console.error("[admin-security] lookup failed:", error);
      res.status(500).json({ message: "Couldn't look that up" });
    }
  });

  /**
   * Turns 2FA off for somebody who lost their phone, after you have confirmed
   * who they are some other way. It signs them out everywhere at the same time:
   * a reset that left old sessions alive would be a way to keep access rather
   * than restore it.
   */
  app.post("/api/admin/security/users/:id/reset-mfa", isAuthenticated, requireAdmin, rateLimit("review"), async (req: any, res) => {
    try {
      const targetId = String(req.params.id);
      if (targetId === req.user.id) {
        return res.status(400).json({
          message: "You can't take your own second factor off here — a stolen session would use this first. Use npm run mfa:reset, which needs the database.",
          code: "no_self_reset",
        });
      }
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 8) {
        return res.status(400).json({ message: "Say how you confirmed who they are. It goes in the log.", code: "invalid_input", field: "reason" });
      }

      const [target] = await db.select().from(users).where(eq(users.id, targetId));
      if (!target) return res.status(404).json({ message: "No such account" });
      if (!target.mfaEnabledAt) return res.status(400).json({ message: "That account doesn't have 2FA on.", code: "mfa_not_enabled" });

      await db.update(users).set({
        mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null, updatedAt: new Date(),
      }).where(eq(users.id, targetId));
      const cut = await endEverySession(targetId);

      await logModeration({
        action: "security.reset_mfa",
        actorId: req.user.id,
        targetUserId: targetId,
        reason,
        previousState: { twoFactor: "on" },
        resultingState: { twoFactor: "off", ...cut },
      });

      res.json({ ok: true, ...cut });
    } catch (error) {
      console.error("[admin-security] reset-mfa failed:", error);
      res.status(500).json({ message: "Couldn't reset that account's 2FA" });
    }
  });

  /**
   * Ends every session and device token an account holds, without changing
   * anything else about it. For a laptop left on a train, or an account you
   * think somebody else is in.
   */
  app.post("/api/admin/security/users/:id/sign-out", isAuthenticated, requireAdmin, rateLimit("review"), async (req: any, res) => {
    try {
      const targetId = String(req.params.id);
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 8) {
        return res.status(400).json({ message: "Say why. It goes in the log.", code: "invalid_input", field: "reason" });
      }
      const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId));
      if (!target) return res.status(404).json({ message: "No such account" });

      const cut = await endEverySession(targetId);
      await logModeration({
        action: "security.sign_out_everywhere",
        actorId: req.user.id,
        targetUserId: targetId,
        reason,
        resultingState: cut,
      });
      res.json({ ok: true, ...cut });
    } catch (error) {
      console.error("[admin-security] sign-out failed:", error);
      res.status(500).json({ message: "Couldn't sign that account out" });
    }
  });
}
