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
import { db } from "./db";
import {
  companies, companyMembers, projectCheckins, projectMembers, projects, recurringJobRuns, recurringJobs,
  insertProjectSchema,
} from "@shared/schema";
import { users } from "@shared/models/auth";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { storage } from "./storage";
import { requireCredits, checkPrivateProjectQuota, modelFor } from "./entitlements";
import { getOpenAI, openAiConfigured } from "./openai-client";
import { CREDIT_COSTS } from "@shared/plans";
import { instantiatePathTree } from "./phase-trees";
import { companyFor } from "./company-access";
import { PROJECT_CATEGORIES } from "@shared/categories";
import {
  weekOf, isMonday, isYmd, isMonth, todayYmd, addDays, lastDayOfMonth, addMonthsToMonth, completeJob, isOverdue,
  isJobInterval, cleanNumbers, metricsForProject, buildCheckinReply, buildMonthlyReport, asRunSubcategory,
  RUN_SUBCATEGORIES, type RunSubcategory,
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
  app.get("/api/projects/:id/rhythm", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;
    const today = todayYmd();
    const thisWeek = weekOf(today);
    const [recent, jobs, members] = await Promise.all([
      db.select().from(projectCheckins).where(eq(projectCheckins.projectId, project.id)).orderBy(desc(projectCheckins.weekOf)).limit(12),
      jobsOf(project.id),
      membersOf(project),
    ]);
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
      ownerId: req.body?.ownerId || null, backupId: req.body?.backupId || null, nextDue, active: true, createdAt: new Date(),
    }).returning();
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
   * job one interval on. The move is conditional on the due date still being
   * the one read, so two people ticking the same job at once record it once.
   */
  app.post("/api/projects/:id/rhythm/jobs/:jobId/done", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;
    const today = todayYmd();
    const doneOn = req.body?.doneOn ?? today;
    if (!isYmd(doneOn) || doneOn > today) return res.status(400).json({ message: "When it was done should be a date no later than today." });
    const [job] = await db.select().from(recurringJobs)
      .where(and(eq(recurringJobs.id, req.params.jobId), eq(recurringJobs.projectId, project.id), eq(recurringJobs.active, true)));
    if (!job) return res.status(404).json({ message: "No such job." });

    const step = completeJob({ nextDue: job.nextDue, every: job.every }, doneOn);
    const result = await db.transaction(async (tx) => {
      const [moved] = await tx.update(recurringJobs).set({ nextDue: step.nextDue })
        .where(and(eq(recurringJobs.id, job.id), eq(recurringJobs.nextDue, job.nextDue))).returning();
      if (!moved) return null;
      const [run] = await tx.insert(recurringJobRuns).values({
        jobId: job.id, projectId: project.id, dueOn: step.dueOn, doneOn, doneBy: userId, onTime: step.onTime, createdAt: new Date(),
      }).onConflictDoNothing().returning();
      if (!run) { tx.rollback(); }
      return { job: moved, run };
    }).catch((err) => {
      if (String(err?.message ?? err).includes("Rollback")) return null;
      throw err;
    });
    if (!result) return res.status(409).json({ message: "That one has already been marked done." });
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
    res.json({ ...report, previousMonth: addMonthsToMonth(month, -1), nextMonth: addMonthsToMonth(month, 1) });
  });

  // ─── Starting the rhythm from a company ────────────────────────────────────

  /*
   * Make a company its Run project: a project on the Run a company path,
   * titled after the company, with every company member on it, and linked
   * from the company so its page can show the rhythm. Private where the
   * owner's plan allows — a company's weekly numbers aren't for the feed —
   * and never announced on the feed either way.
   */
  app.post("/api/companies/:id/run-project", isAuthenticated, rateLimit("project"), async (req: any, res) => {
    const userId = req.user.id;
    const found = await companyFor(res, req.params.id, userId, "manage");
    if (!found) return;
    const { company } = found;
    if (company.projectId) return res.status(409).json({ message: "This company already has its Run project.", projectId: company.projectId });

    const requested = req.body?.subcategory;
    const subcategory: RunSubcategory = (RUN_SUBCATEGORIES as readonly string[]).includes(requested) ? requested : subcategoryForIndustry(company.industry);
    const category = (PROJECT_CATEGORIES as readonly string[]).includes(company.industry ?? "") ? company.industry! : "Other";
    const quota = await checkPrivateProjectQuota(userId);
    const validated = insertProjectSchema.parse({
      ownerId: userId,
      title: company.name.slice(0, 120),
      description: company.description?.trim() || `How ${company.name} is run week to week: the numbers it watches, the team's recurring work, and what to fix next.`,
      category,
      goal: "run_company",
      subcategory,
      isPrivate: quota.allowed,
    });

    const project = await storage.createProject(validated);
    await instantiatePathTree(project.id, "run_company", subcategory)
      .catch((err) => console.error("[phase-trees] Failed to instantiate the Run path:", err));

    const people = await db.select({ userId: companyMembers.userId, role: companyMembers.role }).from(companyMembers)
      .where(eq(companyMembers.companyId, company.id));
    const already = new Set((await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, project.id))).map((r) => r.userId));
    const toAdd = people.filter((p) => !already.has(p.userId));
    if (toAdd.length) {
      await db.insert(projectMembers).values(toAdd.map((p) => ({ projectId: project.id, userId: p.userId, role: p.role === "member" ? "Member" : "Admin" })));
    }

    // Only link it if nobody linked another one while this was being built.
    const [linked] = await db.update(companies).set({ projectId: project.id })
      .where(and(eq(companies.id, company.id), isNull(companies.projectId))).returning();
    if (!linked) return res.status(409).json({ message: "Someone else has just set up this company's Run project." });
    res.json({ project, company: linked, isPrivate: project.isPrivate });
  });
}
