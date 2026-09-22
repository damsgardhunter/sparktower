/**
 * The rhythm a company on the Run path keeps: the weekly check-in, the
 * recurring jobs, and the monthly report — plus the one company route that
 * starts it, which makes a company its Run project.
 *
 * Every route here belongs to the people on the project and nobody else. A
 * company's weekly numbers are the most private thing it keeps on this site,
 * so a stranger asking is told the project doesn't exist (404) rather than
 * that they may not see it — the same rule the company routes follow.
 *
 * The arithmetic lives in shared/company-rhythm.ts, where it can be tested
 * without a database; these routes load rows, check who is asking, and write.
 * Dates are YYYY-MM-DD text computed in UTC, and timestamps are JS Dates
 * passed through Drizzle, never compared against the database's own clock.
 */
import type { Express, Response } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import { db, pool } from "./db";
import {
  companies, companyMembers, projectCheckins, projectMembers, projects, quarterGoals, recurringJobRuns, recurringJobs,
  rhythmSettings, insertProjectSchema,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { storage } from "./storage";
import { requireCredits, modelFor } from "./entitlements";
import { getOpenAI, openAiConfigured } from "./openai-client";
import { CREDIT_COSTS } from "@shared/plans";
import { instantiatePathTree } from "./phase-trees";
import { companyCan, companyMember, powersOf } from "./company-access";
import { completeRunMilestone } from "./company-rhythm-jobs";
import { PROJECT_CATEGORIES } from "@shared/categories";
import {
  weekOf, isMonday, isYmd, isMonth, todayYmd, addDays, lastDayOfMonth, addMonthsToMonth, completeJob, isOverdue, advanceDue,
  isJobInterval, cleanNumbers, metricsForProject, buildCheckinReply, buildMonthlyReport, asRunSubcategory, anchorFor,
  isCheckinDay, quarterOf, quarterRange, isQuarter, addQuarters, goalProgress,
  metricFor, RUN_SUBCATEGORIES, type RunSubcategory, type JobInterval,
} from "@shared/company-rhythm";

type Project = typeof projects.$inferSelect;

/**
 * The project, if this person is on it; otherwise a 404 has been sent. The
 * same rule as `isProjectMember` in server/routes.ts — the owner, or a row in
 * project_members — re-read here because that one isn't exported.
 */
async function projectFor(res: Response, projectId: string, userId: string): Promise<Project | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  let member = !!project && project.ownerId === userId;
  if (project && !member) {
    const [row] = await db.select({ id: projectMembers.id }).from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    member = !!row;
  }
  if (!project || !member) {
    res.status(404).json({ message: "No such project." });
    return null;
  }
  return project;
}

async function memberIds(project: Project): Promise<Set<string>> {
  const rows = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, project.id));
  return new Set([project.ownerId, ...rows.map((r) => r.userId)]);
}

async function membersOf(project: Project) {
  const ids = [...(await memberIds(project))];
  const rows = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl })
    .from(users).where(inArray(users.id, ids));
  return rows.map((u) => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(" ") || "Team member", profileImageUrl: u.profileImageUrl }));
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** The check-ins a reply compares against: the twelve before this week, which is more than the five-week window needs. */
async function historyBefore(projectId: string, week: string) {
  return db.select().from(projectCheckins)
    .where(and(eq(projectCheckins.projectId, projectId), lt(projectCheckins.weekOf, week)))
    .orderBy(desc(projectCheckins.weekOf)).limit(12);
}

async function latestCheckin(projectId: string) {
  const [row] = await db.select().from(projectCheckins).where(eq(projectCheckins.projectId, projectId))
    .orderBy(desc(projectCheckins.weekOf)).limit(1);
  return row ?? null;
}

const jobsOf = (projectId: string) =>
  db.select().from(recurringJobs).where(and(eq(recurringJobs.projectId, projectId), eq(recurringJobs.active, true)))
    .orderBy(asc(recurringJobs.nextDue), asc(recurringJobs.createdAt));

/** A project's rhythm settings, or the defaults (Monday, everyone) when it never chose. */
async function settingsOf(projectId: string) {
  const [row] = await db.select().from(rhythmSettings).where(eq(rhythmSettings.projectId, projectId));
  return { checkinDay: row?.checkinDay ?? 0, remindUserIds: row?.remindUserIds ?? [] };
}

/*
 * The setup milestones that close themselves when the real work happens.
 * Each is checked where that work is done, and each check is cheap and safe
 * to repeat: completeRunMilestone only ever closes an open milestone.
 */
async function closeTeamMilestone(project: Project, userId: string) {
  if ((await memberIds(project)).size >= 2) await completeRunMilestone(project.id, "RUN.S2.1", userId);
}

/** Three jobs on the board is what "the jobs that come round" asks for. */
const JOBS_FOR_S22 = 3;

/** The advisory-lock namespace for setting up a company's Run project; the second key is the company id's hash. */
const RUN_PROJECT_LOCK = 918_2710;

/** Which Run subcategory a company most likely is, from the industry it gave. A guess the project can change later. */
function subcategoryForIndustry(industry: string | null | undefined): RunSubcategory {
  const i = (industry ?? "").toLowerCase();
  if (/e-?commerce|retail|shop/.test(i)) return "retail";
  if (/saas|web app|mobile app|ai\/ml|devops|software|blockchain/.test(i)) return "software";
  if (/design|marketing|content|agency|studio/.test(i)) return "agency";
  if (/restaurant|caf|food|hospitality/.test(i)) return "restaurant";
  if (/service|consult|health|education/.test(i)) return "service";
  return "other";
}

export function registerCompanyRhythmRoutes(app: Express): void {
  /*
   * The rhythm at a glance: this week's key, the numbers the project watches,
   * this week's check-in if filed, recent weeks, and the jobs — what the Run
   * section and the company page both open with.
   */
  /**
   * Which company this project belongs to, and what you may do there.
   *
   * The project manager's rail offers a company's people a simulation season
   * for this team, and the rail belongs to every project — most of which no
   * company owns. Rather than teach the client to join projects to companies,
   * it asks here: null when this is somebody's own project, and otherwise the
   * company with the powers this person holds in it, which is what decides
   * whether the panel can start a season or only watch one.
   */
  app.get("/api/projects/:id/company", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const [company] = await db.select({ id: companies.id, name: companies.name })
      .from(companies).where(eq(companies.projectId, project.id));
    if (!company) return res.json({ company: null, powers: [] as string[] });
    const membership = await companyMember(company.id, req.user.id);
    /*
     * Not a member of the company, though they are on its project — an
     * outside collaborator. They see that the project belongs to a company
     * and nothing they could act on, which is the truth.
     */
    res.json({ company, role: membership?.role ?? null, powers: membership ? powersOf(membership) : [] });
  });

  app.get("/api/projects/:id/rhythm", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const today = todayYmd();
    const thisWeek = weekOf(today);
    const [recent, jobs, members, settings] = await Promise.all([
      db.select().from(projectCheckins).where(eq(projectCheckins.projectId, project.id)).orderBy(desc(projectCheckins.weekOf)).limit(12),
      jobsOf(project.id),
      membersOf(project),
      settingsOf(project.id),
    ]);
    // People join a project in several places (invites, the company's Run project); checking here catches them all.
    if (members.length >= 2) await completeRunMilestone(project.id, "RUN.S2.1", req.user.id);
    res.json({
      today,
      weekOf: thisWeek,
      subcategory: asRunSubcategory(project.subcategory),
      metrics: metricsForProject(project.subcategory, recent[0]),
      current: recent.find((c) => c.weekOf === thisWeek) ?? null,
      checkins: recent,
      jobs,
      overdue: jobs.filter((j) => isOverdue(j, today)),
      members,
      settings,
      quarter: quarterOf(today),
    });
  });

  app.get("/api/projects/:id/rhythm/checkins", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const limit = Math.min(52, Math.max(1, Number(req.query.limit) || 12));
    const rows = await db.select().from(projectCheckins).where(eq(projectCheckins.projectId, project.id))
      .orderBy(desc(projectCheckins.weekOf)).limit(limit);
    res.json(rows);
  });

  /*
   * File (or re-file) one week's check-in. One row per project per week: a
   * second save for the same week replaces the first, because the numbers
   * are "how the week went", not a log of edits. The reply is recomputed
   * from the numbers every time and is always there.
   */
  app.put("/api/projects/:id/rhythm/checkins/:weekOf", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;
    const week = req.params.weekOf;
    if (!isMonday(week)) return res.status(400).json({ message: "A week is named by its Monday, as YYYY-MM-DD." });
    if (week > weekOf(todayYmd())) return res.status(400).json({ message: "That week hasn't started yet." });
    const cleaned = cleanNumbers(req.body?.numbers);
    if (!cleaned.ok) return res.status(400).json({ message: cleaned.message });

    const wentRight = text(req.body?.wentRight, 2000);
    const wentWrong = text(req.body?.wentWrong, 2000);
    const history = await historyBefore(project.id, week);
    const metrics = metricsForProject(project.subcategory, { numbers: cleaned.numbers });
    const reply = buildCheckinReply({ metrics, current: { weekOf: week, numbers: cleaned.numbers, wentRight, wentWrong }, history });

    const now = new Date();
    const [row] = await db.insert(projectCheckins).values({
      projectId: project.id, userId, weekOf: week, numbers: cleaned.numbers, wentRight, wentWrong, reply: reply.text, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [projectCheckins.projectId, projectCheckins.weekOf],
      set: { userId, numbers: cleaned.numbers, wentRight, wentWrong, reply: reply.text, updatedAt: now },
    }).returning();
    await completeRunMilestone(project.id, "RUN.S1.4", userId);
    res.json({ checkin: row, reply });
  });

  /*
   * Nova's version of the reply, on request. Optional by design: the
   * computed reply is already saved, so a failure here — no key, a timeout,
   * an unreadable answer — leaves it in place and charges nothing.
   */
  app.post("/api/projects/:id/rhythm/checkins/:weekOf/nova", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;
    const week = req.params.weekOf;
    const [row] = isMonday(week)
      ? await db.select().from(projectCheckins).where(and(eq(projectCheckins.projectId, project.id), eq(projectCheckins.weekOf, week)))
      : [];
    if (!row) return res.status(404).json({ message: "No check-in for that week yet." });
    if (!openAiConfigured()) return res.json({ checkin: row, ai: false, message: "Nova isn't available right now, so the reply is the one worked out from your numbers." });

    const ent = await requireCredits(res, userId, CREDIT_COSTS.novaGuide, "Nova's reply to your check-in");
    if (!ent) return;

    const history = await historyBefore(project.id, week);
    const metrics = metricsForProject(project.subcategory, row);
    const computed = buildCheckinReply({ metrics, current: row, history });
    try {
      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          {
            role: "system",
            content: "You are Nova, answering a business owner's weekly check-in. In under 120 words of plain English: say what changed this week compared with previous weeks, using the figures given, then name the one thing most worth doing about it this week. No headings, no lists longer than three items, no jargon. Never invent numbers.",
          },
          {
            role: "user",
            content: [
              `Business: ${project.title} (${asRunSubcategory(project.subcategory)})`,
              `Week of ${week}`,
              `What changed (computed):\n${computed.lines.join("\n")}`,
              `Suggested focus: ${computed.focus}`,
              row.wentRight ? `What went right: ${row.wentRight}` : "",
              row.wentWrong ? `What went wrong: ${row.wentWrong}` : "",
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });
      const answer = completion.choices[0]?.message?.content?.trim();
      if (!answer) throw new Error("empty answer");
      const [updated] = await db.update(projectCheckins).set({ reply: answer.slice(0, 4000), updatedAt: new Date() })
        .where(eq(projectCheckins.id, row.id)).returning();
      await storage.deductCredits(userId, CREDIT_COSTS.novaGuide);
      res.json({ checkin: updated, ai: true });
    } catch (err) {
      console.error("[company-rhythm] Nova's check-in reply failed:", err);
      res.json({ checkin: row, ai: false, message: "Nova couldn't answer just now, so the reply is the one worked out from your numbers. Nothing was charged." });
    }
  });

  // ─── Recurring jobs ────────────────────────────────────────────────────────

  app.get("/api/projects/:id/rhythm/jobs", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const today = todayYmd();
    const jobs = await jobsOf(project.id);
    res.json({ today, jobs, overdue: jobs.filter((j) => isOverdue(j, today)) });
  });

  /** Owner and backup must be people on the project, or nobody. Returns an error sentence, or null when fine. */
  async function checkPeople(project: Project, body: any): Promise<string | null> {
    const ids = await memberIds(project);
    for (const k of ["ownerId", "backupId"] as const) {
      const v = body?.[k];
      if (v != null && v !== "" && (typeof v !== "string" || !ids.has(v))) return `The ${k === "ownerId" ? "owner" : "backup"} has to be someone on the project.`;
    }
    return null;
  }

  app.post("/api/projects/:id/rhythm/jobs", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const title = text(req.body?.title, 140);
    if (!title) return res.status(400).json({ message: "Give the job a name." });
    if (!isJobInterval(req.body?.every)) return res.status(400).json({ message: "Say how often it comes round: every week, fortnight or month." });
    const nextDue = req.body?.nextDue ?? todayYmd();
    if (!isYmd(nextDue)) return res.status(400).json({ message: "The due date should be a date, as YYYY-MM-DD." });
    const bad = await checkPeople(project, req.body);
    if (bad) return res.status(400).json({ message: bad });
    const [job] = await db.insert(recurringJobs).values({
      projectId: project.id, title, notes: text(req.body?.notes, 2000), every: req.body.every,
      ownerId: req.body?.ownerId || null, backupId: req.body?.backupId || null, nextDue, anchorDay: anchorFor(req.body.every, nextDue),
      active: true, createdAt: new Date(),
    }).returning();
    if ((await jobsOf(project.id)).length >= JOBS_FOR_S22) await completeRunMilestone(project.id, "RUN.S2.2", req.user.id);
    await closeTeamMilestone(project, req.user.id);
    res.json(job);
  });

  app.patch("/api/projects/:id/rhythm/jobs/:jobId", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const set: Partial<typeof recurringJobs.$inferInsert> = {};
    if (req.body?.title !== undefined) {
      const title = text(req.body.title, 140);
      if (!title) return res.status(400).json({ message: "Give the job a name." });
      set.title = title;
    }
    if (req.body?.notes !== undefined) set.notes = text(req.body.notes, 2000);
    if (req.body?.every !== undefined) {
      if (!isJobInterval(req.body.every)) return res.status(400).json({ message: "Say how often it comes round: every week, fortnight or month." });
      set.every = req.body.every;
    }
    if (req.body?.nextDue !== undefined) {
      if (!isYmd(req.body.nextDue)) return res.status(400).json({ message: "The due date should be a date, as YYYY-MM-DD." });
      set.nextDue = req.body.nextDue;
    }
    const bad = await checkPeople(project, req.body);
    if (bad) return res.status(400).json({ message: bad });
    if (req.body?.ownerId !== undefined) set.ownerId = req.body.ownerId || null;
    if (req.body?.backupId !== undefined) set.backupId = req.body.backupId || null;
    if (req.body?.active !== undefined) set.active = !!req.body.active;
    if (Object.keys(set).length === 0) return res.status(400).json({ message: "Nothing to change." });
    // Moving the due date or the interval moves the day a monthly job belongs on with it.
    if (set.nextDue !== undefined || set.every !== undefined) {
      const [current] = await db.select().from(recurringJobs).where(and(eq(recurringJobs.id, req.params.jobId), eq(recurringJobs.projectId, project.id)));
      if (!current) return res.status(404).json({ message: "No such job." });
      set.anchorDay = anchorFor((set.every ?? current.every) as JobInterval, set.nextDue ?? current.nextDue);
    }
    const [job] = await db.update(recurringJobs).set(set)
      .where(and(eq(recurringJobs.id, req.params.jobId), eq(recurringJobs.projectId, project.id))).returning();
    if (!job) return res.status(404).json({ message: "No such job." });
    res.json(job);
  });

  /*
   * Removing a job stops it coming round but keeps its history: the runs are
   * what past monthly reports counted, and a report that changes after the
   * fact because somebody tidied the board is one nobody trusts.
   */
  app.delete("/api/projects/:id/rhythm/jobs/:jobId", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const [job] = await db.update(recurringJobs).set({ active: false })
      .where(and(eq(recurringJobs.id, req.params.jobId), eq(recurringJobs.projectId, project.id))).returning();
    if (!job) return res.status(404).json({ message: "No such job." });
    res.json({ ok: true });
  });

  /*
   * Done: records the occurrence that was due, on time or not, and moves the
   * job one interval on.
   *
   * The client says which due date it is marking (`dueOn`, the one it showed).
   * Without that, two teammates ticking the same job from screens loaded
   * earlier both succeeded: the second tick advanced the job again and filed
   * next month's occurrence as done, on time, weeks early. Now the second one
   * is told it's already done. The move is also conditional on the due date
   * still being the one read, for two ticks landing at the same instant.
   *
   * An occurrence further off than one interval can't be ticked: finishing
   * next week's stock take today is fine, finishing next quarter's isn't a
   * thing anyone means to do.
   */
  app.post("/api/projects/:id/rhythm/jobs/:jobId/done", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;
    const today = todayYmd();
    const doneOn = req.body?.doneOn ?? today;
    if (!isYmd(doneOn) || doneOn > today) return res.status(400).json({ message: "When it was done should be a date no later than today." });
    const dueOn = req.body?.dueOn;
    if (!isYmd(dueOn)) return res.status(400).json({ message: "Say which due date you're marking done, as YYYY-MM-DD." });
    const [job] = await db.select().from(recurringJobs)
      .where(and(eq(recurringJobs.id, req.params.jobId), eq(recurringJobs.projectId, project.id), eq(recurringJobs.active, true)));
    if (!job) return res.status(404).json({ message: "No such job." });
    if (dueOn !== job.nextDue) {
      return res.status(409).json({ message: "That one has already been marked done.", code: "already_done", nextDue: job.nextDue });
    }

    // A job saved before anchors existed takes its anchor from the due date it has now, and keeps it from here on.
    const anchorDay = job.every === "month" ? (job.anchorDay ?? anchorFor("month", job.nextDue)) : job.anchorDay;
    if (job.nextDue > advanceDue(today, job.every, anchorDay)) {
      return res.status(400).json({ message: "That one isn't due for a while yet. Mark it done once it comes round.", code: "too_early" });
    }
    const step = completeJob({ nextDue: job.nextDue, every: job.every, anchorDay }, doneOn);
    const result = await db.transaction(async (tx) => {
      const [moved] = await tx.update(recurringJobs).set({ nextDue: step.nextDue, anchorDay })
        .where(and(eq(recurringJobs.id, job.id), eq(recurringJobs.nextDue, job.nextDue))).returning();
      if (!moved) return null;
      /*
       * A run for this due date can already exist when someone moved the job's
       * date back to one it had been done for. That occurrence is done, so the
       * job still moves on and the first record stands — refusing would leave
       * the job stuck on a date it can never be marked done for.
       */
      const [inserted] = await tx.insert(recurringJobRuns).values({
        jobId: job.id, projectId: project.id, dueOn: step.dueOn, doneOn, doneBy: userId, onTime: step.onTime, createdAt: new Date(),
      }).onConflictDoNothing().returning();
      const run = inserted ?? (await tx.select().from(recurringJobRuns)
        .where(and(eq(recurringJobRuns.jobId, job.id), eq(recurringJobRuns.dueOn, step.dueOn))))[0];
      return { job: moved, run };
    });
    if (!result) return res.status(409).json({ message: "That one has already been marked done.", code: "already_done" });
    res.json({ ...result, overdue: isOverdue(result.job, today) });
  });

  // ─── The monthly report ───────────────────────────────────────────────────

  app.get("/api/projects/:id/rhythm/report/:month", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const month = req.params.month;
    if (!isMonth(month)) return res.status(400).json({ message: "A month is written YYYY-MM." });
    const first = `${month}-01`;
    const last = lastDayOfMonth(month);
    // Five weeks back from the start, so the month's first week has something to compare against.
    const [checkins, jobs, runs] = await Promise.all([
      db.select().from(projectCheckins).where(and(
        eq(projectCheckins.projectId, project.id), gte(projectCheckins.weekOf, addDays(first, -35)), lte(projectCheckins.weekOf, last),
      )).orderBy(asc(projectCheckins.weekOf)),
      db.select().from(recurringJobs).where(eq(recurringJobs.projectId, project.id)),
      db.select().from(recurringJobRuns).where(and(
        eq(recurringJobRuns.projectId, project.id), gte(recurringJobRuns.dueOn, first), lte(recurringJobRuns.dueOn, last),
      )),
    ]);
    const latest = await latestCheckin(project.id);
    const report = buildMonthlyReport({
      month, metrics: metricsForProject(project.subcategory, latest), checkins, jobs, runs, today: todayYmd(),
    });
    // Reading a month with something in it is what "read your first monthly report" asks. A glance from
    // the company page (?glance=1) shows only the headline, so it doesn't count as reading it.
    if (report.filed > 0 && req.query.glance !== "1") await completeRunMilestone(project.id, "RUN.S3.4", req.user.id);
    res.json({ ...report, previousMonth: addMonthsToMonth(month, -1), nextMonth: addMonthsToMonth(month, 1) });
  });

  // ─── The rhythm's settings ─────────────────────────────────────────────────

  app.get("/api/projects/:id/rhythm/settings", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const [settings, members] = await Promise.all([settingsOf(project.id), membersOf(project)]);
    res.json({ ...settings, members });
  });

  /*
   * The day the check-in happens and who is reminded of it. Nobody chosen
   * means everybody on the project, which is also what a project that never
   * opened this gets. Choosing is what "Set the rhythm" asks for, so saving
   * closes it.
   */
  app.put("/api/projects/:id/rhythm/settings", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;
    const checkinDay = req.body?.checkinDay;
    if (!isCheckinDay(checkinDay)) return res.status(400).json({ message: "Pick the check-in day, Monday to Sunday." });
    const raw = req.body?.remindUserIds ?? [];
    if (!Array.isArray(raw) || raw.some((v: unknown) => typeof v !== "string")) return res.status(400).json({ message: "Say who to remind as a list of people on the project." });
    const ids = await memberIds(project);
    const remindUserIds = [...new Set(raw as string[])];
    if (remindUserIds.some((id) => !ids.has(id))) return res.status(400).json({ message: "Only people on the project can be reminded." });
    const now = new Date();
    // `remindedWeek` is left alone: changing the day mid-week shouldn't send this week's reminder twice.
    const [row] = await db.insert(rhythmSettings).values({ projectId: project.id, checkinDay, remindUserIds, updatedAt: now })
      .onConflictDoUpdate({ target: rhythmSettings.projectId, set: { checkinDay, remindUserIds, updatedAt: now } }).returning();
    await completeRunMilestone(project.id, "RUN.S4.4", userId);
    res.json({ checkinDay: row.checkinDay, remindUserIds: row.remindUserIds });
  });

  // ─── The quarter's goals ───────────────────────────────────────────────────

  /** Most a quarter can hold. The milestone asks for three; ten leaves room without becoming a to-do list. */
  const MAX_GOALS = 10;

  /** The goals of a quarter with where each stands, measured from that quarter's check-ins. */
  async function goalsWithProgress(project: Project, quarter: string, today: string) {
    const { start, end } = quarterRange(quarter);
    const [goals, checkins] = await Promise.all([
      db.select().from(quarterGoals).where(and(eq(quarterGoals.projectId, project.id), eq(quarterGoals.quarter, quarter)))
        .orderBy(asc(quarterGoals.createdAt)),
      db.select({ weekOf: projectCheckins.weekOf, numbers: projectCheckins.numbers }).from(projectCheckins)
        .where(and(eq(projectCheckins.projectId, project.id), gte(projectCheckins.weekOf, start), lte(projectCheckins.weekOf, end))),
    ]);
    return goals.map((g) => ({ ...g, progress: goalProgress(g, checkins, quarter, today) }));
  }

  /** Reads and checks the goal fields a request sent. Returns an error sentence, or the fields to write. */
  async function goalFields(project: Project, body: any, existing?: typeof quarterGoals.$inferSelect): Promise<{ error: string } | { set: Partial<typeof quarterGoals.$inferInsert> }> {
    const set: Partial<typeof quarterGoals.$inferInsert> = {};
    if (body?.title !== undefined || !existing) {
      const title = text(body?.title, 140);
      if (!title) return { error: "Give the goal a name." };
      set.title = title;
    }
    if (body?.metricId !== undefined) {
      if (body.metricId === null || body.metricId === "") set.metricId = null;
      else {
        const latest = await latestCheckin(project.id);
        const known = metricsForProject(project.subcategory, latest).map((m) => m.id);
        if (typeof body.metricId !== "string" || !known.includes(body.metricId)) return { error: "Measure it by one of the numbers your check-ins track." };
        set.metricId = body.metricId;
      }
    }
    if (body?.target !== undefined) {
      if (body.target === null || body.target === "") set.target = null;
      else {
        const n = typeof body.target === "number" ? body.target : Number(String(body.target).replace(/,/g, ""));
        if (!Number.isFinite(n)) return { error: "The target should be a number." };
        set.target = n;
      }
    }
    if (body?.direction !== undefined) {
      if (body.direction !== null && body.direction !== "up" && body.direction !== "down") return { error: "Say whether the number should go up or down." };
      set.direction = body.direction;
    }
    if (body?.ownerId !== undefined) {
      if (body.ownerId && (typeof body.ownerId !== "string" || !(await memberIds(project)).has(body.ownerId))) return { error: "The goal's owner has to be someone on the project." };
      set.ownerId = body.ownerId || null;
    }
    if (body?.status !== undefined) {
      if (!["active", "done", "dropped"].includes(body.status)) return { error: "A goal is active, done or dropped." };
      set.status = body.status;
    }
    // A target means nothing without a number to measure it by.
    const metricId = set.metricId !== undefined ? set.metricId : existing?.metricId ?? null;
    const target = set.target !== undefined ? set.target : existing?.target ?? null;
    if (target != null && !metricId) return { error: "Pick the number the target is measured by." };
    // Which way is good defaults to the number's own — food cost down, covers up — whenever the number is chosen or changed.
    if (!metricId) set.direction = null;
    else if (set.direction == null && (!existing || set.metricId !== undefined)) set.direction = metricFor(metricId).better;
    return { set };
  }

  app.get("/api/projects/:id/rhythm/goals", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const today = todayYmd();
    const quarter = req.query.quarter === undefined ? quarterOf(today) : String(req.query.quarter);
    if (!isQuarter(quarter)) return res.status(400).json({ message: "A quarter is written like 2026-Q3." });
    const latest = await latestCheckin(project.id);
    res.json({
      quarter, ...quarterRange(quarter), today,
      previousQuarter: addQuarters(quarter, -1), nextQuarter: addQuarters(quarter, 1),
      metrics: metricsForProject(project.subcategory, latest),
      goals: await goalsWithProgress(project, quarter, today),
    });
  });

  app.post("/api/projects/:id/rhythm/goals", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;
    const quarter = req.body?.quarter ?? quarterOf(todayYmd());
    if (!isQuarter(quarter)) return res.status(400).json({ message: "A quarter is written like 2026-Q3." });
    const fields = await goalFields(project, req.body);
    if ("error" in fields) return res.status(400).json({ message: fields.error });
    const already = await db.select({ id: quarterGoals.id }).from(quarterGoals)
      .where(and(eq(quarterGoals.projectId, project.id), eq(quarterGoals.quarter, quarter)));
    if (already.length >= MAX_GOALS) return res.status(400).json({ message: `${MAX_GOALS} goals is the most a quarter can hold. Drop or finish one first.` });
    const [goal] = await db.insert(quarterGoals).values({
      ...fields.set, title: fields.set.title!, projectId: project.id, quarter, status: "active", createdAt: new Date(),
    }).returning();
    // The quarter's first goal is the start of "the quarter's three goals" — the rest follow on the same card.
    await completeRunMilestone(project.id, "RUN.S4.3", userId);
    const [withProgress] = (await goalsWithProgress(project, quarter, todayYmd())).filter((g) => g.id === goal.id);
    res.json(withProgress ?? goal);
  });

  app.patch("/api/projects/:id/rhythm/goals/:goalId", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const [existing] = await db.select().from(quarterGoals)
      .where(and(eq(quarterGoals.id, req.params.goalId), eq(quarterGoals.projectId, project.id)));
    if (!existing) return res.status(404).json({ message: "No such goal." });
    const fields = await goalFields(project, req.body, existing);
    if ("error" in fields) return res.status(400).json({ message: fields.error });
    if (Object.keys(fields.set).length === 0) return res.status(400).json({ message: "Nothing to change." });
    await db.update(quarterGoals).set(fields.set).where(eq(quarterGoals.id, existing.id));
    const [withProgress] = (await goalsWithProgress(project, existing.quarter, todayYmd())).filter((g) => g.id === existing.id);
    res.json(withProgress);
  });

  app.delete("/api/projects/:id/rhythm/goals/:goalId", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const [gone] = await db.delete(quarterGoals)
      .where(and(eq(quarterGoals.id, req.params.goalId), eq(quarterGoals.projectId, project.id))).returning({ id: quarterGoals.id });
    if (!gone) return res.status(404).json({ message: "No such goal." });
    res.json({ ok: true });
  });

  // ─── Starting the rhythm from a company ────────────────────────────────────

  /*
   * Make a company its Run project: a project on the Run a company path,
   * titled after the company, with every company member on it, and linked
   * from the company so its page can show the rhythm.
   *
   * Always private, whatever the creator's plan. This project holds the
   * company's cash, takings and bad weeks; it is internal operations, not a
   * showcase. Letting the private-project quota decide made it public on a
   * free plan, where it then turned up in other companies' scouting
   * suggestions. So the quota is deliberately not consulted here, and nothing
   * about it is posted to the feed.
   *
   * One at a time per company. Creating the project, its path and its
   * members is several writes (some inside the path machinery, which uses
   * its own connections), so rather than one transaction the whole thing runs
   * under an advisory lock keyed on the company: a double-click or two admins
   * at once queue up, and the second finds the project already linked. If
   * anything fails after the project exists, the project is deleted again so
   * no half-made one is left behind.
   */
  app.post("/api/companies/:id/run-project", isAuthenticated, rateLimit("project"), async (req: any, res) => {
    const userId = req.user.id;
    // Whoever holds the "Run the business" power — every leader, and any member a leader gave it to.
    const found = await companyCan(res, req.params.id, userId, "run_business");
    if (!found) return;
    const companyId = found.company.id;

    const lock = await pool.connect();
    let createdId: string | null = null;
    try {
      await lock.query("SELECT pg_advisory_lock($1, hashtext($2))", [RUN_PROJECT_LOCK, companyId]);
      // Read again under the lock: whoever held it before may have just linked one.
      const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
      if (!company) return res.status(404).json({ message: "No such company." });
      if (company.projectId) return res.status(409).json({ message: "This company already has its Run project.", projectId: company.projectId });

      const requested = req.body?.subcategory;
      const subcategory: RunSubcategory = (RUN_SUBCATEGORIES as readonly string[]).includes(requested) ? requested : subcategoryForIndustry(company.industry);
      const category = (PROJECT_CATEGORIES as readonly string[]).includes(company.industry ?? "") ? company.industry! : "Other";
      const validated = insertProjectSchema.parse({
        ownerId: userId,
        title: company.name.slice(0, 120),
        description: company.description?.trim() || `How ${company.name} is run week to week: the numbers it watches, the team's recurring work, and what to fix next.`,
        category,
        goal: "run_company",
        subcategory,
        isPrivate: true,
      });

      const project = await storage.createProject(validated);
      createdId = project.id;
      await instantiatePathTree(project.id, "run_company", subcategory)
        .catch((err) => console.error("[phase-trees] Failed to instantiate the Run path:", err));

      const people = await db.select({ userId: companyMembers.userId, role: companyMembers.role }).from(companyMembers)
        .where(eq(companyMembers.companyId, company.id));
      const already = new Set((await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, project.id))).map((r) => r.userId));
      const toAdd = people.filter((p) => !already.has(p.userId));
      if (toAdd.length) {
        await db.insert(projectMembers).values(toAdd.map((p) => ({ projectId: project.id, userId: p.userId, role: p.role === "member" ? "Member" : "Admin" })));
      }

      // Still conditional, for anything that links a project without going through this route.
      const [linked] = await db.update(companies).set({ projectId: project.id })
        .where(and(eq(companies.id, company.id), isNull(companies.projectId))).returning();
      if (!linked) {
        await db.delete(projects).where(eq(projects.id, project.id));
        createdId = null;
        return res.status(409).json({ message: "Someone else has just set up this company's Run project." });
      }
      createdId = null; // Linked: it's the company's now, and stays.
      res.json({ project, company: linked, isPrivate: project.isPrivate });
    } catch (err) {
      if (createdId) await db.delete(projects).where(eq(projects.id, createdId)).catch((e) => console.error("[company-rhythm] couldn't remove a half-made Run project:", e));
      console.error("[company-rhythm] run-project failed:", err);
      if (!res.headersSent) res.status(500).json({ message: "Couldn't set up the Run project. Nothing was left half-made; try again." });
    } finally {
      await lock.query("SELECT pg_advisory_unlock($1, hashtext($2))", [RUN_PROJECT_LOCK, companyId]).catch(() => {});
      lock.release();
    }
  });
}
