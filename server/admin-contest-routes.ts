/**
 * Creating and editing contests.
 *
 * Contests were in the main navigation, had a detail page, a join route, a
 * submission route, a participants list and a badge award — and no way
 * whatsoever to make one. `storage.createContest` existed and nothing called
 * it, from any route, script or seed. The page was therefore guaranteed to be
 * empty for ever: a permanent link in everyone's navigation to a room that
 * could not be furnished.
 *
 * So this is the missing half, built like the promotions admin beside it:
 * admin role *and* a session that has passed its own second factor, because a
 * contest is a thing the platform publishes to everybody, and a stolen session
 * cookie should not be able to put an announcement in front of the whole site.
 *
 * Deliberately not here: deleting a contest. People will have entered it, and
 * a delete would take their entries with it — `status: "completed"` is how a
 * contest ends. Nothing on this page destroys anybody else's record.
 */
import type { Express, RequestHandler } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { badges, contestParticipants, contests } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit, logModeration } from "./moderation";
import { atLeast } from "./platform-roles";
import { mfaGate } from "./mfa";
import { validateContestInput } from "@shared/contests";

/** Admins with a proved second factor. Anyone else doesn't learn this exists. */
const requireAdmin: RequestHandler = (req: any, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not signed in" });
  if (!atLeast(req.user.platformRole, "admin")) return res.status(404).json({ message: "Not found" });
  if (!mfaGate(req, res)) return;
  next();
};

export function registerAdminContestRoutes(app: Express) {
  /** Every contest, in one query with its entrant count, plus the badges to choose from. */
  app.get("/api/admin/contests", isAuthenticated, requireAdmin, async (_req, res) => {
    try {
      const rows = await db
        .select({
          contest: contests,
          participantCount: sql<number>`(select count(*)::int from ${contestParticipants} where ${contestParticipants.contestId} = ${contests.id})`,
        })
        .from(contests)
        .orderBy(desc(contests.promoted), desc(contests.createdAt))
        .limit(200);
      const badgeRows = await db.select({ id: badges.id, name: badges.name }).from(badges).limit(200);
      res.json({
        contests: rows.map((r) => ({ ...r.contest, participantCount: Number(r.participantCount ?? 0) })),
        badges: badgeRows,
      });
    } catch (error) {
      console.error("Admin contests list error:", error);
      res.status(500).json({ message: "Couldn't load contests" });
    }
  });

  /** Make one. */
  app.post("/api/admin/contests", isAuthenticated, requireAdmin, rateLimit("review"), async (req: any, res) => {
    try {
      const checked = validateContestInput(req.body ?? {});
      if (!checked.ok) return res.status(400).json({ message: checked.message, code: "invalid_input", field: checked.field });
      if (checked.value.badgeId) {
        const [badge] = await db.select({ id: badges.id }).from(badges).where(eq(badges.id, checked.value.badgeId));
        // A badge id that doesn't exist would raise a foreign-key error and
        // lose the whole contest over a decoration.
        if (!badge) return res.status(400).json({ message: "That badge doesn't exist.", code: "invalid_input", field: "badgeId" });
      }
      const [contest] = await db.insert(contests).values(checked.value).returning();
      /*
       * In the moderation log like every other administrative action. A
       * contest is published to everybody, and "who put this in front of the
       * whole site, and when" must be answerable afterwards — the log is
       * append-only by database rule (`applyModerationLogRules`).
       */
      void logModeration({
        action: "contest_created", actorId: req.user.id,
        targetType: "contest", targetId: contest.id,
        reason: contest.title, resultingState: { status: contest.status, promoted: contest.promoted },
      });
      res.status(201).json({ contest: { ...contest, participantCount: 0 } });
    } catch (error) {
      console.error("Admin contest create error:", error);
      res.status(500).json({ message: "Couldn't create that contest" });
    }
  });

  /** Edit one. */
  app.put("/api/admin/contests/:id", isAuthenticated, requireAdmin, rateLimit("review"), async (req: any, res) => {
    try {
      const [before] = await db.select().from(contests).where(eq(contests.id, String(req.params.id)));
      if (!before) return res.status(404).json({ message: "Contest not found" });
      /*
       * The body merged over what is stored, so a partial edit keeps the rest —
       * and then validated, which is also what picks the allowed fields. Read
       * into a local first rather than spreading `req.body` inline: spreading a
       * request body anywhere near a write is the shape of a mass-assignment
       * bug, and shared/security-checks.ts refuses to let the pattern into the
       * codebase even where it happens to be safe.
       */
      const body = (req.body ?? {}) as Record<string, unknown>;
      const checked = validateContestInput({ ...before, ...body });
      if (!checked.ok) return res.status(400).json({ message: checked.message, code: "invalid_input", field: checked.field });
      if (checked.value.badgeId && checked.value.badgeId !== before.badgeId) {
        const [badge] = await db.select({ id: badges.id }).from(badges).where(eq(badges.id, checked.value.badgeId));
        if (!badge) return res.status(400).json({ message: "That badge doesn't exist.", code: "invalid_input", field: "badgeId" });
      }
      /*
       * A cap can't be lowered below the people already in. The entries exist;
       * a cap that excludes them would be a promise broken after the fact, and
       * `joinContest` would then read the contest as permanently full.
       */
      if (checked.value.maxParticipants != null) {
        const [row] = await db.select({ n: sql<number>`count(*)::int` })
          .from(contestParticipants).where(eq(contestParticipants.contestId, before.id));
        const joined = Number(row?.n ?? 0);
        if (checked.value.maxParticipants < joined) {
          return res.status(400).json({
            message: `${joined} people have already entered. The cap can't be lower than that.`,
            code: "invalid_input", field: "maxParticipants",
          });
        }
      }
      const [contest] = await db.update(contests).set(checked.value).where(eq(contests.id, before.id)).returning();
      void logModeration({
        action: "contest_updated", actorId: req.user.id,
        targetType: "contest", targetId: contest.id, reason: contest.title,
        previousState: { status: before.status, promoted: before.promoted, maxParticipants: before.maxParticipants },
        resultingState: { status: contest.status, promoted: contest.promoted, maxParticipants: contest.maxParticipants },
      });
      res.json({ contest });
    } catch (error) {
      console.error("Admin contest update error:", error);
      res.status(500).json({ message: "Couldn't save that contest" });
    }
  });
}
