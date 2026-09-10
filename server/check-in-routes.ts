/**
 * The weekly check-in loop.
 *
 * Six steps, from the Phase 1 spec: trigger, compose, publish, share, feedback,
 * next week. This module owns the first four; comments (step 5) live with the
 * project comment system, and step 6 is served by `GET .../check-ins/latest`,
 * which is what the composer prefills from.
 *
 * The load-bearing decision here is that a check-in has a **public address**.
 * Everything downstream — sharing it, someone commenting on it, it counting as
 * an artifact — needs a URL that works for someone with no account. That's why
 * `GET /api/check-ins/:id` is unauthenticated, and why visibility is a stored
 * property rather than an assumption.
 */
import type { Express } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import {
  projectCheckIns, projects, users, userProfiles, projectComments,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireSurface } from "./surfaces";
import { rateLimit } from "./moderation";
import { refreshPace } from "./phase-trees";
import OpenAI from "openai";
import { requireCredits, modelFor } from "./entitlements";
import { CREDIT_COSTS } from "@shared/plans";
import {
  validateCheckIn, weekStartOf, weekKey, CHECK_IN_VISIBILITY, DEFAULT_VISIBILITY,
  CHECK_IN_LIMITS,
} from "@shared/check-in";
import { recordLoopEvent, loopMetrics } from "./loop-metrics";
import { requireReviewer } from "./platform-roles";
import { LOOP_EVENTS } from "@shared/loop-events";

/** The only events a browser may report. Everything else is server-side. */
const CLIENT_EVENTS = [LOOP_EVENTS.checkInStarted, LOOP_EVENTS.shareInitiated] as const;

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const raw = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const baseURL = raw ? (raw.endsWith("/v1") ? raw : `${raw.replace(/\/$/, "")}/v1`) : undefined;
    _openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL });
  }
  return _openai;
}

async function isMember(userId: string, projectId: string): Promise<boolean> {
  const [project] = await db.select({ ownerId: projects.ownerId })
    .from(projects).where(eq(projects.id, projectId));
  if (!project) return false;
  if (project.ownerId === userId) return true;
  const members = await storage.getProjectMembers(projectId).catch(() => []);
  return members.some((m) => m.userId === userId);
}

/** The public shape. Never leaks an email or anything the author didn't publish. */
function publicView(row: {
  checkIn: typeof projectCheckIns.$inferSelect;
  projectTitle: string;
  projectLogo: string | null;
  authorName: string | null;
  authorAvatar: string | null;
}) {
  const c = row.checkIn;
  return {
    id: c.id,
    projectId: c.projectId,
    projectTitle: row.projectTitle,
    projectLogo: row.projectLogo,
    author: { name: row.authorName || "A builder", avatarUrl: row.authorAvatar },
    weekStart: c.weekStart,
    goal: c.goal,
    proof: c.proof,
    blocker: c.blocker,
    nextStep: c.nextStep,
    visibility: c.visibility,
    needsFeedback: c.needsFeedback,
    createdAt: c.createdAt,
  };
}

export function registerCheckInRoutes(app: Express) {
  // Nested under /api/projects/:id, so the prefix guards in routes.ts can't
  // reach these — mounted here instead, same effect.
  app.use("/api/projects/:id/check-ins", requireSurface("checkIns"));

  // ------------------------------------------------------------- compose

  /**
   * What the composer needs to open: last week's check-in, and whether this
   * week's already exists.
   *
   * Step 6 of the loop — "new check-in shows last Goal/Next step" — is served
   * from here, so the builder starts from what they said they'd do rather than
   * from an empty box.
   */
  app.get("/api/projects/:id/check-ins/context", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isMember(req.user.id, projectId))) {
        return res.status(403).json({ message: "Not a project member" });
      }

      const thisWeek = weekStartOf();
      const mine = await db.select().from(projectCheckIns)
        .where(and(
          eq(projectCheckIns.projectId, projectId),
          eq(projectCheckIns.userId, req.user.id),
        ))
        .orderBy(desc(projectCheckIns.weekStart))
        .limit(2);

      const current = mine.find((c) => weekKey(c.weekStart) === weekKey(thisWeek)) ?? null;
      const previous = mine.find((c) => weekKey(c.weekStart) !== weekKey(thisWeek)) ?? null;

      res.json({
        weekStart: thisWeek,
        /** Already checked in this week — the composer edits instead of adding. */
        current,
        /** Last week's goal and next step, to carry forward. */
        previous: previous
          ? { goal: previous.goal, nextStep: previous.nextStep, weekStart: previous.weekStart }
          : null,
        limits: CHECK_IN_LIMITS,
      });
    } catch (error) {
      console.error("Check-in context error:", error);
      res.status(500).json({ message: "Couldn't open the composer" });
    }
  });

  /**
   * Every project you can check in on, and whether you have this week.
   *
   * Drives the home page. The loop only works if the prompt to write one is
   * where you land, not four clicks inside a project — so this exists to let
   * the landing page ask the question rather than waiting to be visited.
   */
  app.get("/api/me/check-in-status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const mine = await storage.getUserProjects(userId).catch(() => []);
      if (mine.length === 0) return res.json({ weekStart: weekStartOf(), projects: [] });

      const thisWeek = weekStartOf();
      const ids = mine.map((p: any) => p.id);

      const rows = await db.select().from(projectCheckIns)
        .where(and(
          eq(projectCheckIns.userId, userId),
          inArray(projectCheckIns.projectId, ids),
        ))
        .orderBy(desc(projectCheckIns.weekStart));

      const byProject = new Map<string, typeof rows>();
      for (const r of rows) {
        const list = byProject.get(r.projectId) ?? [];
        list.push(r);
        byProject.set(r.projectId, list);
      }

      const projects = mine.map((p: any) => {
        const history = byProject.get(p.id) ?? [];
        const current = history.find((c) => weekKey(c.weekStart) === weekKey(thisWeek)) ?? null;
        const previous = history.find((c) => weekKey(c.weekStart) !== weekKey(thisWeek)) ?? null;

        /*
         * Consecutive weeks, counted back from this one. A streak that breaks
         * the moment you're mid-week would read as lost progress on a Monday,
         * so the current week counts only if it's actually filed.
         */
        let streak = 0;
        const weeks = new Set(history.map((c) => weekKey(c.weekStart)));
        const cursor = new Date(thisWeek);
        if (!weeks.has(weekKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 7);
        while (weeks.has(weekKey(cursor))) {
          streak++;
          cursor.setUTCDate(cursor.getUTCDate() - 7);
        }

        return {
          id: p.id,
          title: p.title,
          logoUrl: p.logoUrl ?? null,
          views: p.views ?? 0,
          checkedIn: !!current,
          checkIn: current ? { id: current.id, goal: current.goal } : null,
          lastNextStep: previous?.nextStep ?? null,
          streak,
        };
      });

      res.json({ weekStart: thisWeek, projects });
    } catch (error) {
      console.error("Check-in status error:", error);
      res.status(500).json({ message: "Couldn't load your projects" });
    }
  });

  // ------------------------------------------------------------- publish

  /**
   * Publishes a check-in.
   *
   * Validated against the shared rules rather than trusting the client — the
   * old handler spread `req.body` straight into the insert, so a one-character
   * check-in was a valid one.
   */
  app.post("/api/projects/:id/check-ins", isAuthenticated, rateLimit("checkIn"), async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isMember(req.user.id, projectId))) {
        return res.status(403).json({ message: "Not a project member" });
      }

      const draft = {
        goal: str(req.body.goal, CHECK_IN_LIMITS.goal.max + 50),
        proof: str(req.body.proof, CHECK_IN_LIMITS.proof.max + 100),
        blocker: str(req.body.blocker, CHECK_IN_LIMITS.blocker.max + 50) || null,
        nextStep: str(req.body.nextStep, CHECK_IN_LIMITS.nextStep.max + 50),
      };

      const errors = validateCheckIn(draft);
      if (Object.keys(errors).length > 0) {
        return res.status(422).json({ message: "Some fields need another look", errors });
      }

      const visibility = CHECK_IN_VISIBILITY.includes(req.body.visibility)
        ? req.body.visibility
        : DEFAULT_VISIBILITY;
      const weekStart = weekStartOf();

      /*
       * One per person per project per week, enforced by a unique index.
       * Re-submitting the same week updates it rather than erroring — a
       * builder correcting a typo shouldn't hit a wall, and the permalink they
       * may already have shared has to keep resolving.
       */
      const [checkIn] = await db.insert(projectCheckIns).values({
        projectId,
        userId: req.user.id,
        weekStart,
        ...draft,
        visibility,
        needsFeedback: Boolean(req.body.needsFeedback),
      }).onConflictDoUpdate({
        target: [projectCheckIns.projectId, projectCheckIns.userId, projectCheckIns.weekStart],
        set: {
          ...draft,
          visibility,
          needsFeedback: Boolean(req.body.needsFeedback),
        },
      }).returning();

      await storage.logActivity({
        projectId, userId: req.user.id,
        action: "posted a check-in", entityType: "check-in", entityId: checkIn.id,
      }).catch(() => {});

      // Not awaited on the response path: a metrics write must never be the
      // reason someone's check-in appears to fail.
      void recordLoopEvent({
        name: LOOP_EVENTS.checkInSubmitted,
        userId: req.user.id,
        projectId,
        checkInId: checkIn.id,
        sessionId: typeof req.body.sessionId === "string" ? req.body.sessionId : null,
        props: { visibility, needsFeedback: Boolean(req.body.needsFeedback) },
      });

      // A check-in is a sign of life: it holds the projected date and stops decay.
      void refreshPace(projectId).catch(() => {});

      res.json(checkIn);
    } catch (error) {
      console.error("Create check-in error:", error);
      res.status(500).json({ message: "Couldn't publish that check-in" });
    }
  });

  /**
   * Nova drafts this week's check-in from what actually happened.
   *
   * Drafts, never publishes. The output lands in the composer for the builder
   * to edit and send — a check-in is a public statement in someone's own
   * voice, and auto-posting one would put words in their mouth on a page they
   * share with their backers.
   *
   * Everything in the prompt is real project state: tasks finished this week,
   * milestones, and what they said they'd do last time. If nothing shipped,
   * Nova is told to say so rather than dress it up.
   */
  app.post("/api/projects/:id/check-ins/draft", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      const userId = req.user.id;
      if (!(await isMember(userId, projectId))) {
        return res.status(403).json({ message: "Not a project member" });
      }

      /*
       * Deliberately not behind a plan gate. The check-in is the loop the whole
       * product is built on, and the assist that makes it a two-minute job
       * rather than a blank page belongs on every tier — gating it would mean
       * the people least likely to have the habit are the ones asked to pay for
       * help forming it. Credits are the only limit: one per draft against the
       * free tier's monthly allowance, which covers a weekly check-in several
       * times over.
       */
      const ent = await requireCredits(res, userId, CREDIT_COSTS.checkInDraft, "a check-in draft");
      if (!ent) return;

      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (!project) return res.status(404).json({ message: "Project not found" });

      const weekStart = weekStartOf();
      const [previous] = await db.select().from(projectCheckIns)
        .where(and(
          eq(projectCheckIns.projectId, projectId),
          eq(projectCheckIns.userId, userId),
        ))
        .orderBy(desc(projectCheckIns.weekStart))
        .limit(1);

      const [tasks, milestones] = await Promise.all([
        storage.getProjectKanbanTasks(projectId).catch(() => []),
        storage.getProjectMilestones(projectId).catch(() => []),
      ]);

      // Only what moved this week — a list of everything ever finished would
      // have Nova claiming last month's work as this week's proof.
      const finishedThisWeek = (tasks as any[]).filter(
        (t) => t.status === "done" && t.completedAt && new Date(t.completedAt) >= weekStart,
      );
      const inProgress = (tasks as any[]).filter((t) => t.status === "in-progress");

      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: `You are drafting a builder's weekly check-in, in their voice, for them to edit.

Four fields, and the limits are hard:
- goal: one sentence, ${CHECK_IN_LIMITS.goal.min}-${CHECK_IN_LIMITS.goal.max} characters, what they were aiming for this week.
- proof: ${CHECK_IN_LIMITS.proof.min}-${CHECK_IN_LIMITS.proof.max} characters, what exists now. Name the actual things finished. Never invent a link.
- blocker: optional, under ${CHECK_IN_LIMITS.blocker.max} characters, or null if nothing is in the way.
- nextStep: ${CHECK_IN_LIMITS.nextStep.min}-${CHECK_IN_LIMITS.nextStep.max} characters, ONE thing, and it MUST start with a verb.

Write plainly, first person, no marketing language and no exclamation marks.
If little or nothing was finished, say that honestly — a thin week stated plainly is
worth more than a padded one, and the builder will edit this before it goes out.

Respond ONLY with valid JSON, no markdown fences:
{"goal":"","proof":"","blocker":null,"nextStep":""}`,
          },
          {
            role: "user",
            content: [
              `PROJECT: ${project.title}`,
              project.description ? `ABOUT: ${project.description}` : "",
              previous ? `LAST WEEK'S GOAL: ${previous.goal}` : "",
              previous ? `LAST WEEK THEY SAID THEY'D: ${previous.nextStep}` : "",
              `FINISHED THIS WEEK (${finishedThisWeek.length}):`,
              finishedThisWeek.length
                ? finishedThisWeek.map((t) => `- ${t.title}`).join("\n")
                : "- nothing marked done on the board this week",
              `IN PROGRESS: ${inProgress.map((t) => t.title).join(", ") || "nothing"}`,
              `MILESTONES: ${(milestones as any[]).map((m) => `${m.title} [${m.status}]`).join(", ") || "none"}`,
            ].filter(Boolean).join("\n"),
          },
        ],
      });

      let parsed: any;
      try {
        const raw = completion.choices[0].message.content || "{}";
        parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
      } catch {
        return res.status(502).json({ message: "Nova's draft came back unreadable. Try again." });
      }

      const draft = {
        goal: str(parsed.goal, CHECK_IN_LIMITS.goal.max),
        proof: str(parsed.proof, CHECK_IN_LIMITS.proof.max),
        blocker: str(parsed.blocker, CHECK_IN_LIMITS.blocker.max) || null,
        nextStep: str(parsed.nextStep, CHECK_IN_LIMITS.nextStep.max),
      };

      await storage.deductCredits(userId, CREDIT_COSTS.checkInDraft);

      /*
       * The draft is returned with its own validation result rather than being
       * rejected. A near-miss is still a useful starting point, and the
       * composer already shows exactly which field needs a hand.
       */
      res.json({
        draft,
        errors: validateCheckIn(draft),
        basedOn: {
          finishedThisWeek: finishedThisWeek.length,
          carriedFrom: previous?.nextStep ?? null,
        },
        creditsCharged: CREDIT_COSTS.checkInDraft,
      });
    } catch (error) {
      console.error("Check-in draft error:", error);
      res.status(500).json({ message: "Nova couldn't draft that" });
    }
  });

  /** The project's own list, for members. */
  app.get("/api/projects/:id/check-ins", isAuthenticated, async (req: any, res) => {
    try {
      const projectId = req.params.id;
      if (!(await isMember(req.user.id, projectId))) {
        return res.status(403).json({ message: "Not a project member" });
      }

      const rows = await db.select({
        checkIn: projectCheckIns,
        displayName: userProfiles.displayName,
        avatarUrl: userProfiles.avatarUrl,
        firstName: users.firstName,
      }).from(projectCheckIns)
        .leftJoin(users, eq(users.id, projectCheckIns.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, projectCheckIns.userId))
        .where(eq(projectCheckIns.projectId, projectId))
        .orderBy(desc(projectCheckIns.weekStart), desc(projectCheckIns.createdAt));

      res.json(rows.map((r) => ({
        ...r.checkIn,
        author: {
          name: r.displayName || r.firstName || "A builder",
          avatarUrl: r.avatarUrl,
        },
      })));
    } catch (error) {
      console.error("List check-ins error:", error);
      res.status(500).json({ message: "Couldn't load check-ins" });
    }
  });

  // -------------------------------------------------------- the permalink

  /**
   * One check-in, by id, with no authentication.
   *
   * This is the address the whole share step depends on. Unlisted means "not
   * listed anywhere" — it is still readable by anyone holding the link, which
   * is exactly what makes a link worth copying. Guessing an id means guessing
   * a UUID.
   */
  app.get("/api/check-ins/:id", async (req, res) => {
    try {
      const [row] = await db.select({
        checkIn: projectCheckIns,
        projectTitle: projects.title,
        projectLogo: projects.logoUrl,
        displayName: userProfiles.displayName,
        avatarUrl: userProfiles.avatarUrl,
        firstName: users.firstName,
        isPrivateProject: projects.isPrivate,
        projectOwnerId: projects.ownerId,
      }).from(projectCheckIns)
        .innerJoin(projects, eq(projects.id, projectCheckIns.projectId))
        .leftJoin(users, eq(users.id, projectCheckIns.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, projectCheckIns.userId))
        .where(eq(projectCheckIns.id, String(req.params.id)));

      if (!row) return res.status(404).json({ message: "Check-in not found" });

      /*
       * A private project's check-ins stay inside the project, whatever the
       * check-in's own visibility says. The stricter of the two settings wins,
       * so turning a project private can't be undone by an old link.
       */
      if (row.isPrivateProject) {
        const viewerId = (req as any).user?.id;
        if (!viewerId || !(await isMember(viewerId, row.checkIn.projectId))) {
          return res.status(404).json({ message: "Check-in not found" });
        }
      }

      const [commentCount] = await db.select({ n: sql<number>`count(*)::int` })
        .from(projectComments)
        .where(and(
          eq(projectComments.targetType, "check_in"),
          eq(projectComments.targetId, row.checkIn.id),
        ));

      void recordLoopEvent({
        name: LOOP_EVENTS.checkInViewed,
        userId: (req as any).user?.id ?? null,
        projectId: row.checkIn.projectId,
        checkInId: row.checkIn.id,
      });

      res.json({
        ...publicView({
          checkIn: row.checkIn,
          projectTitle: row.projectTitle,
          projectLogo: row.projectLogo,
          authorName: row.displayName || row.firstName,
          authorAvatar: row.avatarUrl,
        }),
        commentCount: commentCount?.n ?? 0,
        /*
         * Whether this viewer can remove comments here. Sent as a boolean
         * rather than an owner id so the page can match the server's rule —
         * author or project owner — without publishing who the owner is.
         */
        viewerCanModerate: (req as any).user?.id === row.projectOwnerId,
      });
    } catch (error) {
      console.error("Get check-in error:", error);
      res.status(500).json({ message: "Couldn't load that check-in" });
    }
  });

  /** Editing your own check-in — content, visibility, or the feedback flag. */
  app.patch("/api/check-ins/:id", isAuthenticated, async (req: any, res) => {
    try {
      const [existing] = await db.select().from(projectCheckIns)
        .where(eq(projectCheckIns.id, String(req.params.id)));
      if (!existing) return res.status(404).json({ message: "Check-in not found" });
      if (existing.userId !== req.user.id) {
        return res.status(403).json({ message: "That isn't your check-in" });
      }

      const updates: Record<string, unknown> = {};

      // Content changes are re-validated as a whole draft: a valid edit to one
      // field can still leave the check-in invalid overall.
      const touchesContent = ["goal", "proof", "blocker", "nextStep"]
        .some((k) => req.body[k] !== undefined);
      if (touchesContent) {
        const draft = {
          goal: req.body.goal !== undefined ? str(req.body.goal, 200) : existing.goal,
          proof: req.body.proof !== undefined ? str(req.body.proof, 600) : existing.proof,
          blocker: req.body.blocker !== undefined ? (str(req.body.blocker, 400) || null) : existing.blocker,
          nextStep: req.body.nextStep !== undefined ? str(req.body.nextStep, 220) : existing.nextStep,
        };
        const errors = validateCheckIn(draft);
        if (Object.keys(errors).length > 0) {
          return res.status(422).json({ message: "Some fields need another look", errors });
        }
        Object.assign(updates, draft);
      }

      if (CHECK_IN_VISIBILITY.includes(req.body.visibility)) {
        updates.visibility = req.body.visibility;
      }
      if (req.body.needsFeedback !== undefined) {
        updates.needsFeedback = Boolean(req.body.needsFeedback);
      }

      if (Object.keys(updates).length === 0) return res.json(existing);

      const [updated] = await db.update(projectCheckIns).set(updates)
        .where(eq(projectCheckIns.id, existing.id)).returning();
      res.json(updated);
    } catch (error) {
      console.error("Update check-in error:", error);
      res.status(500).json({ message: "Couldn't save that change" });
    }
  });

  app.delete("/api/check-ins/:id", isAuthenticated, async (req: any, res) => {
    try {
      const [existing] = await db.select().from(projectCheckIns)
        .where(eq(projectCheckIns.id, String(req.params.id)));
      if (!existing) return res.status(404).json({ message: "Check-in not found" });
      if (existing.userId !== req.user.id) {
        return res.status(403).json({ message: "That isn't your check-in" });
      }
      await db.delete(projectCheckIns).where(eq(projectCheckIns.id, existing.id));
      res.json({ deleted: true });
    } catch (error) {
      console.error("Delete check-in error:", error);
      res.status(500).json({ message: "Couldn't delete that check-in" });
    }
  });

  /**
   * Client-side loop events: a composer opening, a link being copied.
   *
   * Only the names the loop is measured by are accepted — this is a metrics
   * pipe for six specific numbers, not a general event sink someone can fill
   * with whatever they like.
   */
  app.post("/api/loop-events", rateLimit("track"), async (req: any, res) => {
    try {
      const name = String(req.body?.name || "");
      if (!CLIENT_EVENTS.includes(name as any)) {
        return res.status(400).json({ message: "Unknown event" });
      }
      await recordLoopEvent({
        name: name as (typeof CLIENT_EVENTS)[number],
        userId: req.user?.id ?? null,
        projectId: req.body.projectId ? String(req.body.projectId) : null,
        checkInId: req.body.checkInId ? String(req.body.checkInId) : null,
        sessionId: req.body.sessionId ? String(req.body.sessionId).slice(0, 64) : null,
      });
      // 204: the caller has nothing to do with the result and shouldn't wait.
      res.status(204).end();
    } catch {
      res.status(204).end();
    }
  });

  /** Phase 4's gate, computed from the stream. Reviewer-only. */
  app.get("/api/admin/loop-metrics", isAuthenticated, requireReviewer, async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
      res.json(await loopMetrics(days));
    } catch (error) {
      console.error("Loop metrics error:", error);
      res.status(500).json({ message: "Couldn't compute the metrics" });
    }
  });

  /**
   * The needs-feedback queue: public check-ins whose author asked for a read.
   *
   * Pull-based by design — the spec rules out outbound pings, so this is the
   * only route by which a check-in finds a responder.
   */
  app.get("/api/check-ins/queue/needs-feedback", async (_req, res) => {
    try {
      const rows = await db.select({
        checkIn: projectCheckIns,
        projectTitle: projects.title,
        projectLogo: projects.logoUrl,
        displayName: userProfiles.displayName,
        avatarUrl: userProfiles.avatarUrl,
        firstName: users.firstName,
      }).from(projectCheckIns)
        .innerJoin(projects, eq(projects.id, projectCheckIns.projectId))
        .leftJoin(users, eq(users.id, projectCheckIns.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, projectCheckIns.userId))
        .where(and(
          eq(projectCheckIns.needsFeedback, true),
          eq(projectCheckIns.visibility, "public"),
          eq(projects.isPrivate, false),
        ))
        .orderBy(desc(projectCheckIns.createdAt))
        .limit(50);

      res.json(rows.map((r) => publicView({
        checkIn: r.checkIn,
        projectTitle: r.projectTitle,
        projectLogo: r.projectLogo,
        authorName: r.displayName || r.firstName,
        authorAvatar: r.avatarUrl,
      })));
    } catch (error) {
      console.error("Feedback queue error:", error);
      res.status(500).json({ message: "Couldn't load the queue" });
    }
  });
}
