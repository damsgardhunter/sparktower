/**
 * "What would it take?" — the Run path's roadmap to a company of a chosen size.
 *
 * An owner picks one of four targets ($1m, $100m, $1bn or $50bn a year) and
 * gets the route from the company they actually have to that one: the
 * arithmetic of the gap, the stages, what has to be true at each, what breaks
 * first, the first ninety days, and an honest verdict.
 *
 * Two rules shape this module.
 *
 * The first is that the numbers are the company's own. The Run path already
 * holds them — the weekly check-ins, the five numbers it watches, its
 * subcategory, its recurring jobs, its quarter goals — so the roadmap is built
 * from those and nothing else. A company that has filed nothing is told what to
 * file rather than handed invented figures, because a generic roadmap dressed
 * up as a reading of your business is worse than no roadmap: it is wrong and it
 * looks personal.
 *
 * The second is that the honesty is not Nova's job. The gap, the ladder of
 * stages and the verdict are computed in shared/what-would-it-take.ts before
 * the model is called, and Nova is given them as facts it may not change.
 * Models flatter. Asked "can my café become a $50bn company", a model will find
 * something encouraging to say, and an owner who believes it will make real
 * decisions on it. So the verdict stored on the row is the computed one, the
 * prompt tells Nova what verdict it is writing to, and the client shows the
 * computed multiple next to whatever Nova wrote.
 *
 * Every run is kept. Re-running in six months and comparing is the point (see
 * the table comment in shared/schema.ts), so nothing here updates a row in
 * place.
 */
import type { Express, Response } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  projectCheckins, projectKanbanTasks, projectMembers, projects, quarterGoals, recurringJobs, whatWouldItTakeRoadmaps,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { storage } from "./storage";
import { requireCredits, modelFor } from "./entitlements";
import { getOpenAI, openAiConfigured } from "./openai-client";
import { parseModelJson, respondToAiError } from "./ai-json";
import { applyOperationsOnce, idempotencyKeyFor } from "./operation-idempotency";
import { CREDIT_COSTS } from "@shared/plans";
import { completeRunMilestone } from "./company-rhythm-jobs";
import { asRunSubcategory, metricsForProject, quarterOf, todayYmd, type CheckinLike } from "@shared/company-rhythm";
import {
  WWIT_TARGETS, arithmeticLines, gapTo, isWwitTargetId, movementBetween, readMargin, readUnits, readWeeklyRevenue,
  stageLadder, verdictWithMargin, whatItImplies, worthLine, wwitTarget, REVENUE_ADVICE,
  type Gap, type MarginRead, type RevenueRead, type UnitRead, type WwitGrounding, type WwitRoadmapBody, type WwitStage,
  type WwitStep, type WwitTarget, type WwitTargetId,
} from "@shared/what-would-it-take";

type Project = typeof projects.$inferSelect;

/**
 * The project, if this person is on it; otherwise a 404 has been sent. The
 * same rule and the same silence as the rhythm routes: a company's revenue is
 * the most private thing it keeps here, so a stranger is told the project
 * doesn't exist rather than that they may not see it.
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

/** How many check-ins back the revenue read looks. A quarter of a year is enough to smooth a quiet week without going stale. */
const WEEKS_READ = 8;
/** Everything on file, for the counts and the metric list. Two years is plenty. */
const CHECKIN_LIMIT = 104;

interface Ground {
  grounding: WwitGrounding;
  revenue: RevenueRead | null;
  units: UnitRead | null;
  margin: MarginRead | null;
  checkins: CheckinLike[];
}

/**
 * Everything the roadmap is built on, read once. Used by the GET (to say
 * whether running it is worth it yet) and by the POST (to build it), so the
 * "you need to file X first" answer and the roadmap can never disagree about
 * what the company has filed.
 */
async function groundOf(project: Project): Promise<Ground> {
  const [checkinRows, goals, jobs] = await Promise.all([
    db.select().from(projectCheckins).where(eq(projectCheckins.projectId, project.id))
      .orderBy(desc(projectCheckins.weekOf)).limit(CHECKIN_LIMIT),
    db.select().from(quarterGoals).where(eq(quarterGoals.projectId, project.id)).orderBy(desc(quarterGoals.quarter)).limit(12),
    db.select({ id: recurringJobs.id }).from(recurringJobs)
      .where(and(eq(recurringJobs.projectId, project.id), eq(recurringJobs.active, true))),
  ]);
  const checkins = checkinRows as unknown as CheckinLike[];
  const revenue = readWeeklyRevenue(project.subcategory, checkins, WEEKS_READ);
  const units = readUnits(project.subcategory, checkins, WEEKS_READ);
  const margin = readMargin(project.subcategory, checkins, WEEKS_READ);
  const latest = checkinRows[0] ?? null;
  const latestNumbers = (latest?.numbers ?? {}) as Record<string, number | null>;

  return {
    revenue,
    units,
    margin,
    checkins,
    grounding: {
      subcategory: asRunSubcategory(project.subcategory),
      annualRevenue: revenue ? Math.round(revenue.annual) : null,
      weeklyRevenue: revenue ? Math.round(revenue.weekly) : null,
      revenueFrom: revenue?.from ?? null,
      weeksUsed: revenue?.weeksUsed ?? 0,
      latestWeek: latest?.weekOf ?? null,
      checkinsOnFile: checkinRows.length,
      units,
      margin,
      metrics: metricsForProject(project.subcategory, latest).map((m) => ({
        id: m.id, label: m.label, unit: m.unit, latest: typeof latestNumbers[m.id] === "number" ? latestNumbers[m.id]! : null,
      })),
      quarterGoals: goals.filter((g) => g.status === "active").map((g) => g.title).slice(0, 6),
      recurringJobs: jobs.length,
      // Distinct months a check-in was filed in — what the monthly report reads from.
      monthsWithReports: new Set(checkinRows.map((c) => c.weekOf.slice(0, 7))).size,
    },
  };
}

/**
 * Why this isn't worth running yet, or null when it is.
 *
 * Deliberately a sentence naming the missing thing rather than a flag. The
 * whole promise of the feature is "built from your real numbers", and the
 * moment it falls back to generic advice that promise is broken — so it
 * refuses, and says what to file.
 */
function notReadyReason(ground: Ground): string | null {
  if (!ground.checkins.length) {
    return "You haven't filed a weekly check-in yet. This roadmap is built from your own numbers, so file one week first — it takes five minutes — and it will have something to work from.";
  }
  if (!ground.revenue) {
    return `Your check-ins don't yet have a number this can read as revenue. ${REVENUE_ADVICE[ground.grounding.subcategory]}`;
  }
  return null;
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, max: number, count: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, count) : [];

/** A target with the parts the client shows next to it, so the price and the plain-English note come from one place. */
const targetForClient = (t: WwitTarget) => ({
  id: t.id, revenue: t.revenue, label: t.label, short: t.short,
  whatItIs: t.whatItIs, worth: worthLine(t), howMany: t.howMany ?? null,
});

/** A stored row, as the client reads it. */
const rowForClient = (row: typeof whatWouldItTakeRoadmaps.$inferSelect) => ({
  id: row.id,
  target: row.target,
  generatedAt: row.generatedAt,
  annualRevenue: row.annualRevenue,
  grounding: row.grounding as WwitGrounding,
  roadmap: row.roadmap as { gap: Gap | null; body: WwitRoadmapBody },
});

/**
 * Nova writes the words; the arithmetic is handed to it done.
 *
 * The prompt states the verdict rather than asking for one. Asked to judge,
 * a model reaches for encouragement — and an owner who is told a 26,000×
 * gap is "ambitious but achievable with focus" may act on it. So the model is
 * told which of the three verdicts it is writing to, and told what the stages
 * and multiples are. Its job is what has to be true, what breaks, what it
 * costs, and the first ninety days: the parts that need judgement about this
 * kind of business, not arithmetic.
 */
function buildPrompt(input: {
  project: Project; target: WwitTarget; gap: Gap; revenue: RevenueRead; units: UnitRead | null;
  margin: MarginRead | null; ladder: ReturnType<typeof stageLadder>; grounding: WwitGrounding;
  implies: string; call: ReturnType<typeof verdictWithMargin>;
}) {
  const { project, target, gap, revenue, units, margin, ladder, grounding, implies, call } = input;
  const verdict = call.verdict;

  const system = `You are Nova, answering a business owner who has asked what it would take to turn their company into a ${target.label} business.

You are given the arithmetic already worked out. DO NOT recompute it, restate it differently, or soften it. Never invent a figure the owner did not give you.

The verdict for this one is: "${verdict}". Write to that verdict. If it is "a different business", say so plainly and early — do not hedge, do not suggest that working harder or being more focused closes the gap, and do not open with congratulation. An owner acting on false encouragement here loses real money. If it is "reachable", say that plainly too; do not manufacture drama.${call.tightenedByMargin ? `

This verdict is harder than the revenue gap alone: on revenue it would read "${call.onRevenueAlone}", and what makes it "${verdict}" is that the business keeps too little to fund a build this size. Say that. The problem to write about is money to grow with, not effort.` : ""}

Revenue is not money kept, and you must not treat them as the same. ${margin ? `This business's margin is ${Math.round(margin.fraction * 100)}% ${margin.kind}. A gross margin is not what the business keeps; if it is gross, do not describe it as profit.` : "No margin has been filed, so never state or imply a profit figure — talk about revenue, capacity and cost, and note where the answer would depend on the margin."}

Plain English throughout. No jargon, no consulting words ("leverage", "synergies", "10x"), no exclamation marks. Short sentences. Talk about staff, sites, machines, stock, vans, cash and margin — the things this owner actually deals with.

Respond ONLY with valid JSON, no markdown fences:
{
  "headline": "one sentence an owner would say out loud about this gap",
  "stages": [ { "title": "short name for the stage", "mustBeTrue": ["3-5 things that must be true by the end of it: people, capacity, cash, margin"], "breaksFirst": "the first thing that breaks at this size, named concretely", "costToFix": "what fixing it costs, in money or in hires" } ],
  "first90": [ { "title": "a concrete step someone could start on Monday", "why": "one line on why this one" } ],
  "verdictText": "3-6 sentences. Whether it is reachable from here, and if it is not, what would have to change about the business for it to be — a different product, a different way of selling, outside money, or accepting a smaller target."
}

"stages" must have exactly ${ladder.length} entries, in order, matching the stages given. "first90" must have 4 to 6 entries, all inside the first stage, all things this owner can actually start.`;

  const user = [
    `THE BUSINESS\n${project.title} — a ${grounding.subcategory === "other" ? "small business" : grounding.subcategory} business.${project.description ? `\n${project.description.slice(0, 600)}` : ""}`,
    `ITS OWN NUMBERS (from its weekly check-ins — ${grounding.checkinsOnFile} filed, latest ${grounding.latestWeek})\n${grounding.metrics.map((m) => `- ${m.label}: ${m.latest ?? "not filled in"}`).join("\n")}`,
    units ? `WHAT IT SELLS\n${units.how}` : null,
    `REVENUE\nAbout $${Math.round(revenue.weekly).toLocaleString("en-GB")} a week, $${Math.round(revenue.annual).toLocaleString("en-GB")} a year. Source: ${revenue.from}.`,
    `WHAT IT KEEPS\n${margin ? `About ${Math.round(margin.fraction * 100)}% ${margin.kind} margin — ${margin.from}.` : "Not filed. Do not guess at a profit figure."}\n${call.note}`,
    `THE GAP (worked out, do not change)\n${arithmeticLines(target, revenue, gap, units).map((l) => `- ${l}`).join("\n")}`,
    `THE STAGES (worked out, do not change — write one entry per stage, in this order)\n${ladder.map((s) => `- Stage ${s.number}: ${s.multiple}× bigger, ending at about $${s.endsAt.toLocaleString("en-GB")} a year. ${s.howLong}.`).join("\n")}`,
    `WHAT THIS TARGET IS\n${target.whatItIs}\n${worthLine(target)}`,
    `WHAT THAT SIZE IMPLIES FOR THIS BUSINESS (worked out, agree with it)\n${implies}`,
    grounding.quarterGoals.length ? `ITS GOALS THIS QUARTER\n${grounding.quarterGoals.map((g) => `- ${g}`).join("\n")}` : null,
    `HOW IT IS RUN\n${grounding.recurringJobs} recurring jobs on the board, check-ins filed across ${grounding.monthsWithReports} month(s).`,
  ].filter(Boolean).join("\n\n");

  return { system, user };
}

export function registerWhatWouldItTakeRoutes(app: Express): void {
  /*
   * The picker and everything already run. Free and instant: choosing a target
   * costs nothing, only generating does, and the price is quoted here so the
   * button can name it before anyone presses it.
   */
  app.get("/api/projects/:id/what-would-it-take", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;

    const ground = await groundOf(project);
    const rows = await db.select().from(whatWouldItTakeRoadmaps)
      .where(eq(whatWouldItTakeRoadmaps.projectId, project.id))
      .orderBy(desc(whatWouldItTakeRoadmaps.generatedAt)).limit(40);

    /*
     * The latest run for each target and the one before it. The previous run is
     * sent even though nothing on screen shows it in full, because the movement
     * line ("the gap closed from 48× to 31×") is computed from the pair and a
     * client that had only the latest could never draw it.
     */
    const byTarget = Object.fromEntries(WWIT_TARGETS.map((t) => {
      const mine = rows.filter((r) => r.target === t.id);
      const latest = mine[0] ?? null;
      const previous = mine[1] ?? null;
      return [t.id, {
        latest: latest ? rowForClient(latest) : null,
        previous: previous ? rowForClient(previous) : null,
        runs: mine.length,
        movement: latest && previous
          ? movementBetween(t, { annualRevenue: previous.annualRevenue }, { annualRevenue: latest.annualRevenue })
          : null,
      }];
    }));

    res.json({
      today: todayYmd(),
      quarter: quarterOf(),
      subcategory: ground.grounding.subcategory,
      targets: WWIT_TARGETS.map(targetForClient),
      credits: CREDIT_COSTS.whatWouldItTake,
      aiAvailable: openAiConfigured(),
      /** What a roadmap would be built from right now, so the card can show it before anyone spends anything. */
      grounding: ground.grounding,
      notReady: notReadyReason(ground),
      roadmaps: byTarget,
    });
  });

  /*
   * Build one. A new row every time — see the table comment: comparing runs is
   * the feature, so nothing is overwritten.
   */
  app.post("/api/projects/:id/what-would-it-take/:target", isAuthenticated, rateLimit("ai"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;

    const target = wwitTarget(req.params.target);
    if (!target || !isWwitTargetId(req.params.target)) {
      return res.status(400).json({ message: "Pick one of the four targets." });
    }

    const ground = await groundOf(project);
    const notReady = notReadyReason(ground);
    /*
     * Refused before the credit check, not after. A company with nothing filed
     * would otherwise pay for a roadmap built on nothing — and the roadmap
     * would be generic advice wearing its name, which is the one thing this
     * feature is not for.
     */
    if (notReady || !ground.revenue) {
      return res.status(409).json({ message: notReady ?? "There are no numbers to build this from yet.", code: "no_numbers_yet" });
    }
    if (!openAiConfigured()) {
      return res.status(503).json({ message: "Nova isn't available right now, so this can't be built. Nothing was charged." });
    }

    const revenue = ground.revenue;
    const gap = gapTo(target, revenue, ground.units, project.subcategory);
    const ladder = stageLadder(revenue.annual, target.revenue);
    const implies = whatItImplies(project.subcategory, target, gap);
    /*
     * The verdict takes what the business keeps into account, not only what it
     * turns over. A thin *net* margin makes a build that trading can't fund
     * harder than the revenue gap alone suggests, and the call records what the
     * revenue said on its own so the roadmap can show its working.
     */
    const call = verdictWithMargin(gap.multiple, ground.margin);

    const ent = await requireCredits(res, userId, CREDIT_COSTS.whatWouldItTake, `the "${target.label}" roadmap`);
    if (!ent) return;

    try {
      const { system, user } = buildPrompt({
        project, target, gap, revenue, units: ground.units, margin: ground.margin, ladder,
        grounding: ground.grounding, implies, call,
      });
      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      });
      const parsed = parseModelJson<any>(completion.choices[0]?.message?.content, "roadmap");

      /*
       * Nova's stages are zipped onto the computed ladder rather than trusted
       * as a list. A model that returns four stages for a five-stage ladder
       * would otherwise shift every multiple and length by one, and the
       * roadmap would quietly claim a stage takes three years when the
       * arithmetic says eight.
       */
      const written: any[] = Array.isArray(parsed.stages) ? parsed.stages : [];
      const stages: WwitStage[] = ladder.map((s, i) => ({
        ...s,
        title: str(written[i]?.title, 120) || `Stage ${s.number}`,
        mustBeTrue: strList(written[i]?.mustBeTrue, 300, 6),
        breaksFirst: str(written[i]?.breaksFirst, 500),
        costToFix: str(written[i]?.costToFix, 500),
      }));
      const first90: WwitStep[] = (Array.isArray(parsed.first90) ? parsed.first90 : [])
        .map((s: any) => ({ title: str(s?.title, 200), why: str(s?.why, 400) }))
        .filter((s: WwitStep) => s.title)
        .slice(0, 8);
      if (!stages.length || !first90.length) {
        return res.status(502).json({ message: "Nova couldn't work that out just now. Nothing was charged — please try again.", code: "model_unreadable" });
      }

      const body: WwitRoadmapBody = {
        headline: str(parsed.headline, 400) || implies.split(". ")[0],
        arithmetic: arithmeticLines(target, revenue, gap, ground.units, ground.margin),
        stages,
        first90,
        // The computed verdict, never the model's. See this module's header.
        verdict: call.verdict,
        verdictOnRevenueAlone: call.onRevenueAlone,
        tightenedByMargin: call.tightenedByMargin,
        marginNote: call.note,
        /*
         * The margin note goes last and always. Whether it says what the
         * business keeps or that nobody has filed it, an owner reading a
         * roadmap about revenue needs to be told which of the two they are
         * looking at before they act on it.
         */
        verdictText: [str(parsed.verdictText, 2000), implies, call.note].filter(Boolean).join("\n\n"),
        whatItIs: target.whatItIs,
        worth: worthLine(target),
      };

      const [row] = await db.insert(whatWouldItTakeRoadmaps).values({
        projectId: project.id,
        target: target.id as WwitTargetId,
        grounding: ground.grounding as any,
        roadmap: { gap, body } as any,
        annualRevenue: Math.round(revenue.annual),
        generatedBy: userId,
        // Zoneless timestamps hold UTC and are written from JS, never from the database's clock.
        generatedAt: new Date(),
      }).returning();

      await storage.deductCredits(userId, CREDIT_COSTS.whatWouldItTake);
      /*
       * Asking where the company is going is the work RUN.S4.5 describes, so
       * doing it closes that step. Never fails the request: the roadmap exists
       * whether or not the path noticed.
       */
      await completeRunMilestone(project.id, "RUN.S4.5", userId).catch((e) => console.error("[wwit] path advance failed:", e));

      res.json({ roadmap: rowForClient(row), creditsCharged: CREDIT_COSTS.whatWouldItTake });
    } catch (err) {
      console.error("[wwit] couldn't build the roadmap:", err);
      respondToAiError(res, err, "Nova couldn't build that roadmap. Nothing was charged — please try again.");
    }
  });

  /*
   * The hand-off: the first ninety days onto the board as real tasks.
   *
   * Without this the roadmap is something read once and closed. The tasks land
   * in the Run section (the `track:` tag) so they sit beside the recurring
   * jobs rather than in whichever section happens to be primary, and each one
   * carries the target it came from, so in three months it is still obvious
   * why "hire a second chef" is on the board.
   */
  app.post("/api/projects/:id/what-would-it-take/:roadmapId/to-board", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;

    const [row] = await db.select().from(whatWouldItTakeRoadmaps)
      .where(and(eq(whatWouldItTakeRoadmaps.id, req.params.roadmapId), eq(whatWouldItTakeRoadmaps.projectId, project.id)));
    if (!row) return res.status(404).json({ message: "No such roadmap." });

    const body = (row.roadmap as any)?.body as WwitRoadmapBody | undefined;
    const steps = body?.first90 ?? [];
    if (!steps.length) return res.status(400).json({ message: "That roadmap has no first steps to send." });

    /*
     * Which steps, by index. Sending all of them is the default because that is
     * what the button says; a client that lets the owner untick two sends the
     * rest. An index that isn't there is ignored rather than refused — the
     * roadmap on their screen may be a run old.
     */
    const wanted: number[] = Array.isArray(req.body?.steps)
      ? [...new Set(req.body.steps.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < steps.length))] as number[]
      : steps.map((_, i) => i);
    if (!wanted.length) return res.status(400).json({ message: "Pick at least one step to send." });

    const target = wwitTarget(row.target);
    const operations = wanted.sort((a, b) => a - b).map((i) => ({
      op: "create_task",
      title: steps[i].title.slice(0, 200),
      description: [steps[i].why, `From the "${target?.label ?? row.target}" roadmap, generated ${row.generatedAt.toISOString().slice(0, 10)}.`].filter(Boolean).join("\n\n"),
      status: "todo",
      priority: "high",
      // `track:` is what puts a task in the Run section of the board (server/phase-trees.ts trackOfTask).
      tags: ["track:run_company", `wwit:${row.target}`],
    }));

    /*
     * Applied once. "Send to the board" is a single button on a long page, and
     * a double click or a retry after a slow response used to add every step
     * twice — which turns the one part of this feature that ends in work into
     * a mess somebody has to tidy up. The key is scoped to this roadmap and
     * this selection, so sending a different set of steps still works, and so
     * does sending the same ones again in a later sitting once the replay
     * window has passed (server/operation-idempotency.ts).
     */
    const key = idempotencyKeyFor(req, [`wwit:${row.id}`, ...operations]);
    const applied = await applyOperationsOnce({
      projectId: project.id, userId, operations, key, source: "wwit",
      apply: { maxOperations: 8 },
    });
    if (applied.replayed) {
      return res.status(409).json({
        message: "Those steps are already on your board.",
        created: 0, replayed: true, changes: applied.changes,
      });
    }

    const ids = applied.changes.map((c) => c.entityId).filter((id): id is string => !!id);
    const tasks = ids.length
      ? await db.select().from(projectKanbanTasks).where(inArray(projectKanbanTasks.id, ids))
      : [];
    res.json({ created: tasks.length, tasks, skipped: applied.skipped });
  });
}
