/**
 * Simulating one real company: "what happens if I do this?", and "where does
 * this end up in ten years?"
 *
 * ## Why this is not the market season
 *
 * There is already a simulation here, and it is a good one: five people run a
 * company against incumbents in a market worth a few hundred million, a day is
 * a year, and a fortnight is a career. What it cannot do is answer a question
 * about *your* business, because none of the numbers in it are yours. An owner
 * taking $10,000 a month with a $100,000 loan cannot learn from it whether
 * they can afford a second van.
 *
 * So this is the other half. One company — the real one — month by month, on
 * its own figures. shared/simulation/decision-sim.ts does the arithmetic; this
 * module reads the company, asks Nova what the typed question means, and
 * stores what came out.
 *
 * ## What Nova is and is not allowed to decide
 *
 * The same division as the "what would it take?" roadmap, and for the same
 * reason. Nova's job is **translation**: turning "what if I hire 12 people
 * right now" into twelve hires at a monthly cost each, a ramp, and a guess at
 * what one of them brings in. Every one of those numbers is then shown to the
 * owner as an editable assumption, because they are guesses and presenting a
 * guess as a finding is how a projection becomes a lie.
 *
 * What Nova does **not** decide is what happens next. The cash curve, the
 * month it bottoms out, whether the business runs out of money and the verdict
 * are computed from the levers before the model is asked to write a word about
 * them — and the verdict is handed to it as a fact it is writing to. Asked to
 * judge a hiring plan, a model finds something encouraging to say. An owner
 * who hires twelve people on that basis loses their business.
 *
 * ## Bought once, asked as often as you like
 *
 * One price for the project, and every question after the first is free. A
 * price per scenario would be a price on comparing "hire two" with "hire
 * twelve" — which is the only way anybody learns anything from this. Nobody
 * has ever been helped by a single projection.
 */
import type { Express, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  projectCheckins, projectMembers, projects, quarterGoals, recurringJobs,
  simulationBaselines, simulationScenarios, tenYearOutlooks,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { storage } from "./storage";
import { getUserEntitlements, modelFor, requireCredits } from "./entitlements";
import { hasBuildPass } from "./wallet";
import { getOpenAI, openAiConfigured } from "./openai-client";
import { parseModelJson, respondToAiError } from "./ai-json";
import { CHARGEABLE, OUTCOME_PRICE_CENTS, formatMoney } from "@shared/plans";
import { asRunSubcategory, metricsForProject, todayYmd, type CheckinLike } from "@shared/company-rhythm";
import { readWeeklyRevenue, readUnits } from "@shared/what-would-it-take";
import {
  answer, cleanBaseline, cleanLevers, cleanMonths, CONFIDENCE_COPY, HORIZONS, MAX_LEVERS,
  missingFrom, type Answer, type Baseline, type Lever,
} from "@shared/simulation/decision-sim";
import {
  FIELD_COPY, FIELD_ORDER, FIELD_UNIT, readBaseline, type BaselineField,
} from "@shared/simulation/company-baseline";
import { BUDGET_TOTAL, cleanAllocation, summariseBudget, type Allocation } from "@shared/sprints/budget";
import { SPEND_OPTIONS } from "@shared/sprints/cards";
import { cleanVerdict, overallScore, scoreBand, DIMENSIONS, type Verdict } from "@shared/sprints/scoring";

type Project = typeof projects.$inferSelect;

/**
 * The project, if this person is on it; otherwise a 404 has been sent.
 *
 * The same silence as the rhythm and roadmap routes: what a company takes, what
 * it owes and how close it is to running out are the most private things it
 * keeps here, so a stranger is told the project doesn't exist rather than that
 * they may not look.
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

/** A quarter of a year of check-ins smooths a quiet week without going stale. */
const WEEKS_READ = 8;
const CHECKIN_LIMIT = 104;
/** Enough to compare a handful of decisions without the page becoming a filing cabinet. */
const SCENARIO_LIMIT = 30;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, max: number, count: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, count) : [];

/** What Nova writes around the computed numbers. Never the verdict, never a figure. */
interface Narrative {
  /** One sentence an owner would say out loud about this decision. */
  headline: string;
  /** What actually happens, in three to six sentences, written to the computed verdict. */
  body: string;
  /** What would have to be true for this to work. */
  watchFor: string[];
  /** Something else worth simulating next, in the owner's words, ready to be asked. */
  alsoAsk: string[];
}

const emptyNarrative = (): Narrative => ({ headline: "", body: "", watchFor: [], alsoAsk: [] });

// ─── Reading the company ─────────────────────────────────────────────────────

interface Ground {
  checkins: CheckinLike[];
  read: ReturnType<typeof readBaseline>;
  saved: typeof simulationBaselines.$inferSelect | null;
  metrics: { id: string; label: string; unit: string; latest: number | null }[];
  latestWeek: string | null;
  goals: string[];
  jobs: number;
}

async function groundOf(project: Project): Promise<Ground> {
  const [checkinRows, saved, goals, jobs] = await Promise.all([
    db.select().from(projectCheckins).where(eq(projectCheckins.projectId, project.id))
      .orderBy(desc(projectCheckins.weekOf)).limit(CHECKIN_LIMIT),
    db.select().from(simulationBaselines).where(eq(simulationBaselines.projectId, project.id)),
    db.select().from(quarterGoals).where(eq(quarterGoals.projectId, project.id)).orderBy(desc(quarterGoals.quarter)).limit(12),
    db.select({ id: recurringJobs.id }).from(recurringJobs)
      .where(and(eq(recurringJobs.projectId, project.id), eq(recurringJobs.active, true))),
  ]);
  const checkins = checkinRows as unknown as CheckinLike[];
  const row = saved[0] ?? null;
  const latest = checkinRows[0] ?? null;
  const latestNumbers = (latest?.numbers ?? {}) as Record<string, number | null>;

  return {
    checkins,
    saved: row,
    read: readBaseline({
      subcategory: project.subcategory,
      checkins,
      saved: row ? cleanBaseline(row.numbers) : null,
      overridden: Array.isArray(row?.overridden) ? (row!.overridden as string[]) : [],
      weeks: WEEKS_READ,
    }),
    metrics: metricsForProject(project.subcategory, latest).map((m) => ({
      id: m.id, label: m.label, unit: m.unit,
      latest: typeof latestNumbers[m.id] === "number" ? latestNumbers[m.id]! : null,
    })),
    latestWeek: latest?.weekOf ?? null,
    goals: goals.filter((g) => g.status === "active").map((g) => g.title).slice(0, 6),
    jobs: jobs.length,
  };
}

/**
 * The business in prose, for the model.
 *
 * Written out the way a person would describe it rather than handed over as a
 * row, on the same reasoning as the startup game's `describeCompany`: a model
 * given `{"subcategory":"restaurant","covers":480}` has to guess what that
 * means, where one given "a restaurant doing about 480 covers a week" is
 * reasoning about the same business the owner is.
 */
function describe(project: Project, ground: Ground, baseline: Baseline): string {
  const sub = asRunSubcategory(project.subcategory);
  const revenue = readWeeklyRevenue(project.subcategory, ground.checkins, WEEKS_READ);
  const units = readUnits(project.subcategory, ground.checkins, WEEKS_READ);
  const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-GB")}`;

  return [
    `THE BUSINESS\n${project.title} — a ${sub === "other" ? "small business" : sub} business.${project.description ? `\n${project.description.slice(0, 800)}` : ""}`,
    `WHERE IT STANDS (the figures every projection is worked out from)
- Money in: ${dollars(baseline.monthlyRevenue)} a month
- Money out: ${dollars(baseline.monthlyCosts)} a month
- In the bank: ${dollars(baseline.cash)}
- Owed: ${dollars(baseline.debt)} at ${Math.round(baseline.interestRate * 100)}% a year, repaying ${dollars(baseline.debtRepayment)} a month
- Kept out of every extra dollar of revenue: ${Math.round(baseline.grossMargin * 100)}c
- People on the payroll: ${baseline.staff}
- Growing on its own by ${(baseline.growth * 100).toFixed(1)}% a month`,
    units ? `WHAT IT SELLS\n${units.how}` : null,
    revenue ? `WHERE THE REVENUE FIGURE CAME FROM\n${revenue.from}` : null,
    ground.metrics.length
      ? `ITS OWN WEEKLY NUMBERS${ground.latestWeek ? ` (latest week ${ground.latestWeek})` : ""}\n${ground.metrics.map((m) => `- ${m.label}: ${m.latest ?? "not filled in"}`).join("\n")}`
      : null,
    ground.goals.length ? `ITS GOALS THIS QUARTER\n${ground.goals.map((g) => `- ${g}`).join("\n")}` : null,
  ].filter(Boolean).join("\n\n");
}

// ─── Turning a sentence into levers ──────────────────────────────────────────

const LEVER_SHAPES = `Each lever is one of these, and nothing else:
{"kind":"hire","label":"...","startMonth":1,"people":12,"monthlyCostEach":4000,"monthlyRevenueEach":0,"rampMonths":3}
{"kind":"spend","label":"...","startMonth":1,"monthlyAmount":1000,"months":0,"monthlyReturnAtFull":6000,"halfSpend":1500,"lagMonths":1}
{"kind":"price","label":"...","startMonth":1,"changePct":10,"demandChangePct":-6,"lagMonths":1}
{"kind":"loan","label":"...","startMonth":1,"amount":100000,"apr":0.11,"termMonths":60}
{"kind":"oneOff","label":"...","startMonth":1,"amount":25000}
{"kind":"saving","label":"...","startMonth":1,"monthlyAmount":800}
{"kind":"other","label":"...","startMonth":1,"monthlyRevenueDelta":3000,"monthlyCostDelta":1200,"rampMonths":2}`;

/**
 * The prompt that reads the question.
 *
 * Every instruction in it exists because the alternative is a number nobody
 * can check. `monthlyRevenueEach` on a hire is the single most consequential
 * guess in the whole feature — it is the difference between "twelve people is
 * suicide" and "twelve people pays for itself by August" — so the model is
 * told to put zero on any hire that does not itself sell, and every figure it
 * does choose comes back with a sentence saying what it assumed, which the
 * owner can edit and re-run for nothing.
 */
function leverPrompt(project: Project, ground: Ground, baseline: Baseline, months: number) {
  const system = `You are Nova, turning a business owner's question into numbers a simulator can run.

The owner has asked what happens to their business if they make a particular decision. Your job is ONLY to work out what that decision IS, in numbers. You do not say whether it is a good idea — the arithmetic decides that afterwards, and you will be asked to write about the result separately.

Rules, all of which matter:
- Use the business's own figures above. A hire's cost should be plausible for THIS business in ITS industry, not a generic salary.
- "monthlyRevenueEach" on a hire is ZERO unless the role plainly brings money in by itself (a salesperson, a second stylist, an extra crew that can take more jobs). A developer, an admin, a manager or a marketer does not — they may make the business better, and that is not the same thing, and pretending otherwise is how owners over-hire.
- Never inflate a return to make the decision look good. If a decision has no believable return, give it none.
- "halfSpend" is the monthly spend at which you would get half of "monthlyReturnAtFull". Returns saturate; they are not a multiple.
- A price rise loses customers. "demandChangePct" must be negative for a rise and positive for a cut, unless there is a specific reason otherwise.
- If the question is not about a decision with financial consequences — if it is a question about strategy, feelings, or something the numbers cannot settle — return an EMPTY levers list and say so in "cannotSimulate".
- At most ${MAX_LEVERS} levers. Most questions are one or two.

Every assumption you make must appear in "assumptions" as one plain sentence naming the number, because the owner is shown them and can change any of them. Do not assume anything you do not list.

${LEVER_SHAPES}

Respond ONLY with valid JSON of exactly this shape, no markdown fences:
{"levers":[],"assumptions":["one sentence naming a number you chose and why"],"cannotSimulate":"empty string, or one sentence on why the numbers cannot answer this","restated":"the decision in one plain sentence, as you understood it"}`;

  const user = `${describe(project, ground, baseline)}

THE HORIZON
${months} months.

THE QUESTION THE OWNER ASKED
`;
  return { system, user };
}

/**
 * The prompt that writes about the result.
 *
 * It is given the verdict rather than asked for one, and told not to restate
 * the arithmetic. Both are load-bearing. A model asked "is this a good idea?"
 * will hedge towards yes; a model that recomputes will get a figure slightly
 * different from the chart underneath it and the owner will believe whichever
 * is worse for them.
 */
function narrativePrompt(project: Project, ground: Ground, baseline: Baseline, result: Answer, question: string, assumptions: string[]) {
  const system = `You are Nova, telling a business owner what a decision they are considering will actually do to their business.

The arithmetic has been done. DO NOT recompute it, restate the figures differently, or soften it. Never invent a number.

The verdict for this one is: "${result.verdict}". Write to that verdict.
- "it runs you out of money" — say so in the first sentence. Name the month. Do not bury it after two sentences of context, and do not suggest that determination closes a cash gap.
- "it costs more than it brings back" — say plainly that on these numbers it does not pay for itself, and what would have to change for it to.
- "it works, but it is tight" — the decision is affordable and the margin for error is small. Say what the smallest thing is that would break it.
- "it pays for itself" — say that plainly. Do not manufacture drama, and do not add a warning that the numbers do not support.

The owner's own assumptions are listed below. Where the answer turns on one of them, say which one — that is the number they should go and check, and they can edit it and run this again for nothing.

Plain English. Short sentences. No jargon, no consulting words, no exclamation marks. Talk about staff, customers, stock, rent, wages and the bank balance.

Respond ONLY with valid JSON of exactly this shape, no markdown fences:
{"headline":"one sentence an owner would say out loud about this","body":"3-6 sentences on what happens and why","watchFor":["something that would have to be true for this to work"],"alsoAsk":["another question worth simulating, written as the owner would type it"]}`;

  const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-GB")}`;
  const user = [
    describe(project, ground, baseline),
    `THE QUESTION\n${question}`,
    `WHAT WAS ASSUMED (the owner can edit any of these)\n${assumptions.map((a) => `- ${a}`).join("\n") || "- nothing beyond the figures above"}`,
    `WHAT THE ARITHMETIC SAYS (worked out, do not change)\n${result.facts.map((f) => `- ${f}`).join("\n")}`,
    `THE CASH CURVE, IF IT GOES AS EXPECTED\n${result.with.likely.months.map((m) => `- month ${m.month}: in ${dollars(m.revenue)}, out ${dollars(m.costs)}, bank ${dollars(m.cash)}`).join("\n")}`,
    `THE SAME MONTHS IF IT GOES SLOWLY (half the return, two months late)\n${result.with.cautious.months.map((m) => `- month ${m.month}: bank ${dollars(m.cash)}`).join("\n")}`,
    `AND IF THEY DID NOTHING AT ALL\n${result.without.months.map((m) => `- month ${m.month}: bank ${dollars(m.cash)}`).join("\n")}`,
  ].join("\n\n");

  return { system, user };
}

// ─── What the client reads ───────────────────────────────────────────────────

const scenarioForClient = (row: typeof simulationScenarios.$inferSelect) => ({
  id: row.id,
  question: row.question,
  months: row.months,
  baseline: row.baseline as Baseline,
  levers: row.levers as Lever[],
  assumptions: row.assumptions as string[],
  result: row.result as Answer,
  narrative: row.narrative as Narrative,
  rerunOf: row.rerunOf,
  createdAt: row.createdAt,
});

const outlookForClient = (row: typeof tenYearOutlooks.$inferSelect) => {
  const verdict = row.verdict as Verdict;
  return {
    id: row.id,
    allocation: row.allocation as Allocation,
    profile: row.profile as Record<string, unknown>,
    verdict,
    overall: overallScore(verdict.scores),
    band: scoreBand(overallScore(verdict.scores)),
    fromModel: row.fromModel,
    createdAt: row.createdAt,
  };
};

/**
 * Whether this project has already bought the simulator.
 *
 * The receipt is the work itself: a scenario or an outlook on file means
 * somebody paid, so there is no second place to record it and no way for the
 * two to disagree.
 */
async function alreadyBought(projectId: string): Promise<boolean> {
  const [scenario] = await db.select({ id: simulationScenarios.id }).from(simulationScenarios)
    .where(eq(simulationScenarios.projectId, projectId)).limit(1);
  if (scenario) return true;
  const [outlook] = await db.select({ id: tenYearOutlooks.id }).from(tenYearOutlooks)
    .where(eq(tenYearOutlooks.projectId, projectId)).limit(1);
  return !!outlook;
}

export function registerDecisionSimRoutes(app: Express): void {
  /*
   * Everything the panel needs, free and instant. The baseline, what it was
   * read from, what is still missing, every scenario run so far, the ten-year
   * outlooks, and the price of the first one — quoted here so the button can
   * name it before anybody presses it.
   */
  app.get("/api/projects/:id/decision-sim", isAuthenticated, async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;

    const ground = await groundOf(project);
    const [scenarios, outlooks] = await Promise.all([
      db.select().from(simulationScenarios).where(eq(simulationScenarios.projectId, project.id))
        .orderBy(desc(simulationScenarios.createdAt)).limit(SCENARIO_LIMIT),
      db.select().from(tenYearOutlooks).where(eq(tenYearOutlooks.projectId, project.id))
        .orderBy(desc(tenYearOutlooks.createdAt)).limit(10),
    ]);

    const priceCents = scenarios.length || outlooks.length || (await hasBuildPass(req.user.id, project.id))
      ? 0
      : OUTCOME_PRICE_CENTS.simulations;

    res.json({
      today: todayYmd(),
      aiAvailable: openAiConfigured(),
      price: { cents: priceCents, display: formatMoney(priceCents), unlocked: priceCents === 0 },
      baseline: ground.read.baseline,
      /** Which fields the owner typed, so the form can show the rest as read from the check-ins. */
      overridden: Array.isArray(ground.saved?.overridden) ? ground.saved!.overridden : [],
      sources: ground.read.sources,
      missing: ground.read.missing,
      /** What every field is called and means, so the two clients cannot disagree about it. */
      fields: FIELD_ORDER.map((f) => ({ field: f, unit: FIELD_UNIT[f], ...FIELD_COPY[f] })),
      notReady: missingFrom(ground.read.baseline),
      horizons: HORIZONS,
      confidences: CONFIDENCE_COPY,
      scenarios: scenarios.map(scenarioForClient),
      tenYears: {
        budget: BUDGET_TOTAL,
        options: SPEND_OPTIONS,
        dimensions: DIMENSIONS,
        outlooks: outlooks.map(outlookForClient),
      },
    });
  });

  /*
   * The owner correcting the starting position.
   *
   * Every field they touch is recorded as theirs, and a later read of the
   * check-ins will not put it back. Nothing is charged: describing your own
   * business is not a Nova action.
   */
  app.put("/api/projects/:id/decision-sim/baseline", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    const project = await projectFor(res, req.params.id, req.user.id);
    if (!project) return;

    const numbers = cleanBaseline(req.body?.numbers);
    const overridden = (Array.isArray(req.body?.overridden) ? req.body.overridden : [])
      .filter((f: unknown): f is BaselineField => typeof f === "string" && (FIELD_ORDER as string[]).includes(f));

    const row = { projectId: project.id, numbers: numbers as any, overridden: overridden as any, updatedBy: req.user.id, updatedAt: new Date() };
    await db.insert(simulationBaselines).values(row)
      .onConflictDoUpdate({ target: simulationBaselines.projectId, set: { numbers: row.numbers, overridden: row.overridden, updatedBy: row.updatedBy, updatedAt: row.updatedAt } });

    const ground = await groundOf(project);
    res.json({
      baseline: ground.read.baseline,
      overridden,
      sources: ground.read.sources,
      missing: ground.read.missing,
      notReady: missingFrom(ground.read.baseline),
    });
  });

  /*
   * Ask a question.
   *
   * Two model calls, one price: the first reads the sentence into levers, the
   * second writes about what the arithmetic did with them. They are separate
   * because a single call that both chose the numbers and judged them would be
   * choosing numbers that flatter its own judgement.
   */
  app.post("/api/projects/:id/decision-sim/scenarios", isAuthenticated, rateLimit("ai"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;

    const question = str(req.body?.question, 600);
    if (question.length < 8) {
      return res.status(400).json({ message: "Ask it in a sentence — what are you thinking of doing, and when?" });
    }
    const months = cleanMonths(req.body?.months);

    const ground = await groundOf(project);
    const baseline = ground.read.baseline;
    /*
     * Refused before the money, never after. A baseline of zeros produces a
     * flat line at nothing, and somebody who paid for that would be entitled
     * to be annoyed about it.
     */
    const notReady = missingFrom(baseline);
    if (notReady) return res.status(409).json({ message: notReady, code: "no_numbers_yet" });
    if (!openAiConfigured()) {
      return res.status(503).json({ message: "Nova isn't available right now, so this can't be read. Nothing was charged." });
    }

    /*
     * Bought once per project, not per question. The first one is the
     * purchase; everything after it is free, because the second scenario —
     * "fine, but what if it were two people instead of twelve" — is the only
     * one anybody learns from.
     */
    const bought = await alreadyBought(project.id);
    const ent = bought
      ? await getUserEntitlements(userId)
      : await requireCredits(res, userId, CHARGEABLE, "simulating a decision", { outcome: "simulations", projectId: project.id });
    if (!ent) return;

    try {
      const read = leverPrompt(project, ground, baseline, months);
      const first = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [
          { role: "system", content: read.system },
          { role: "user", content: `${read.user}${question}` },
        ],
      });
      const parsed = parseModelJson<any>(first.choices[0]?.message?.content, "decision");
      const levers = cleanLevers(parsed?.levers);
      const assumptions = strList(parsed?.assumptions, 300, 12);

      /*
       * A question the numbers cannot settle is said so, and nothing is
       * stored. Charged, though — the reading happened, and a route that
       * refunded whenever the answer was "I can't" would be a route people
       * learn to game. It is the first purchase only, and it unlocks the
       * project, so the next question costs nothing.
       */
      if (!levers.length) {
        if (!bought) await storage.deductCredits(userId, CHARGEABLE);
        return res.status(422).json({
          code: "not_a_decision",
          message: str(parsed?.cannotSimulate, 500)
            || "That isn't something the numbers can settle. Try a decision with a cost or a return in it — hiring, spending, borrowing, or changing what you charge.",
          restated: str(parsed?.restated, 300),
        });
      }

      const result = answer({ baseline, levers, months });

      /*
       * The words, written to the computed verdict. A failure here is not
       * allowed to lose the answer: the arithmetic is the product and the
       * prose is the wrapper, so the scenario is stored either way and the
       * screen simply has no paragraph on it.
       */
      let narrative = emptyNarrative();
      try {
        const write = narrativePrompt(project, ground, baseline, result, question, assumptions);
        const second = await getOpenAI().chat.completions.create({
          model: modelFor(ent),
          messages: [{ role: "system", content: write.system }, { role: "user", content: write.user }],
        });
        const prose = parseModelJson<any>(second.choices[0]?.message?.content, "narrative");
        narrative = {
          headline: str(prose?.headline, 300),
          body: str(prose?.body, 2000),
          watchFor: strList(prose?.watchFor, 300, 5),
          alsoAsk: strList(prose?.alsoAsk, 200, 3),
        };
      } catch (err) {
        console.error("[decision-sim] the numbers are in, the words aren't:", err);
      }

      const [row] = await db.insert(simulationScenarios).values({
        projectId: project.id,
        question,
        months,
        baseline: baseline as any,
        levers: levers as any,
        assumptions: assumptions as any,
        result: result as any,
        narrative: narrative as any,
        rerunOf: null,
        createdBy: userId,
        // Zoneless timestamps hold UTC and are written from JS, never the database's clock.
        createdAt: new Date(),
      }).returning();

      if (!bought) await storage.deductCredits(userId, CHARGEABLE);
      res.json({ scenario: scenarioForClient(row), paidCents: bought ? 0 : OUTCOME_PRICE_CENTS.simulations });
    } catch (err) {
      console.error("[decision-sim] couldn't run that scenario:", err);
      respondToAiError(res, err, "Nova couldn't read that question. Nothing was charged — please try again.");
    }
  });

  /*
   * The same question with one number changed.
   *
   * The most valuable thing on the page and it costs nothing, because it is
   * where the owner stops reading a projection and starts arguing with it:
   * "fine, but a salesperson doesn't bring in eight thousand a month, they
   * bring in three". No model call reads the levers — they are the owner's
   * now — and the prose is rewritten around the new arithmetic.
   */
  app.post("/api/projects/:id/decision-sim/scenarios/:scenarioId/rerun", isAuthenticated, rateLimit("ai"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;

    const [original] = await db.select().from(simulationScenarios)
      .where(and(eq(simulationScenarios.id, req.params.scenarioId), eq(simulationScenarios.projectId, project.id)));
    if (!original) return res.status(404).json({ message: "No such scenario." });

    const levers = cleanLevers(req.body?.levers ?? original.levers);
    if (!levers.length) return res.status(400).json({ message: "Leave at least one thing in the decision." });
    const months = cleanMonths(req.body?.months ?? original.months);

    /*
     * Against today's baseline, not the one the original ran on. Re-running is
     * mostly done because something changed, and re-running against a stale
     * starting position would answer last month's question.
     */
    const ground = await groundOf(project);
    const baseline = ground.read.baseline;
    const notReady = missingFrom(baseline);
    if (notReady) return res.status(409).json({ message: notReady, code: "no_numbers_yet" });

    const result = answer({ baseline, levers, months });
    const assumptions = (original.assumptions as string[]) ?? [];

    // metering: free by design — this project already bought the simulator, and a
    // re-run is the owner correcting an assumption in an answer they have paid
    // for. Charging to change one number would be charging somebody to disagree
    // with a projection, which is the one thing this feature exists to invite.
    // The AI burst limit above still applies.
    let narrative = emptyNarrative();
    if (openAiConfigured()) {
      try {
        const ent = await getUserEntitlements(userId);
        const write = narrativePrompt(project, ground, baseline, result, original.question, assumptions);
        const completion = await getOpenAI().chat.completions.create({
          model: modelFor(ent),
          messages: [{ role: "system", content: write.system }, { role: "user", content: write.user }],
        });
        const prose = parseModelJson<any>(completion.choices[0]?.message?.content, "narrative");
        narrative = {
          headline: str(prose?.headline, 300),
          body: str(prose?.body, 2000),
          watchFor: strList(prose?.watchFor, 300, 5),
          alsoAsk: strList(prose?.alsoAsk, 200, 3),
        };
      } catch (err) {
        console.error("[decision-sim] re-run has numbers but no words:", err);
      }
    }

    const [row] = await db.insert(simulationScenarios).values({
      projectId: project.id,
      question: original.question,
      months,
      baseline: baseline as any,
      levers: levers as any,
      assumptions: assumptions as any,
      result: result as any,
      narrative: narrative as any,
      // What it was changed from, so the two can be put side by side.
      rerunOf: original.rerunOf ?? original.id,
      createdBy: userId,
      createdAt: new Date(),
    }).returning();

    res.json({ scenario: scenarioForClient(row) });
  });

  /*
   * Ten years from now, for a company that exists.
   *
   * The game asks two strangers to invent a startup over five rounds and then
   * values what they made up. Four of those rounds are already answered here —
   * the idea, the customer, the model and the product are the project — so the
   * only round left is the one nobody can read off a check-in: given a million
   * dollars and a year, where does it go? That is the question, and the
   * valuation is of this business rather than an imaginary one.
   *
   * The verdict is the game's shape, cleaned through the game's own wall
   * (`cleanVerdict`), so a company's 780 and a game's 780 mean the same thing.
   */
  app.post("/api/projects/:id/decision-sim/ten-years", isAuthenticated, rateLimit("ai"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;

    const allocation = cleanAllocation(req.body?.allocation);
    const budget = summariseBudget(allocation);
    if (budget.total <= 0) {
      return res.status(400).json({ message: "Put the million somewhere first — even leaving it in the bank is an answer." });
    }
    if (!openAiConfigured()) {
      return res.status(503).json({ message: "Nova isn't available right now, so this can't be valued. Nothing was charged." });
    }

    const ground = await groundOf(project);
    const baseline = ground.read.baseline;
    // The same purchase as the scenarios: one price for the project, then both.
    const bought = await alreadyBought(project.id);
    const ent = bought
      ? await getUserEntitlements(userId)
      : await requireCredits(res, userId, CHARGEABLE, "valuing this business ten years out", { outcome: "simulations", projectId: project.id });
    if (!ent) return;

    const money = (n: number) => `$${Math.round(n).toLocaleString("en-GB")}`;
    const system = `You are a blunt, experienced analyst valuing a real business ten years out.

This is not a startup somebody invented in half an hour — it is a company that exists, with the figures below, and the owner has said where they would put a million dollars over the next year. Judge what is actually in front of you. Most small businesses are worth a few hundred thousand dollars in ten years' time, and some are worth nothing because the owner is the business and the owner will be ten years older. Be willing to say a number is small.

Score five dimensions from 0 to 1000. USE THE FULL RANGE. A competent, unremarkable business is around 500; 800+ should be rare.
${DIMENSIONS.map((d) => `- ${d.id}: ${d.blurb}${d.betterIs === "lower" ? " (HIGHER NUMBER = MORE RISK)" : ""}`).join("\n")}

Then value it: what it is worth in ten years, the peak it reaches, and which year that peak falls in (1-10). The peak can never be lower than the ten-year figure.

Weigh the million heavily. It is the only thing here the owner has just decided, and a million dollars spent on the wrong things is how a good business stops being one. Lines funded below what they cost bought nothing — say so.

Respond ONLY with valid JSON of exactly this shape, no markdown fences:
{"scores":{"growth":0,"capital":0,"product":0,"acquisition":0,"risk":0},
 "tenYear":0,"peak":0,"peakYear":1,
 "summary":"three or four sentences on what this business becomes and what decides it",
 "notes":{"growth":"one line","capital":"one line","product":"one line","acquisition":"one line","risk":"one line"},
 "advice":["the single change that would most raise this number","a second one"]}`;

    const user = [
      describe(project, ground, baseline),
      `WHERE THE FIRST MILLION GOES (the owner's answer, for the coming year)\n${budget.funded.map((l) => `- ${money(l.amount)} — ${l.option.label}: ${l.option.detail}${l.underfunded ? "  [funded below what it costs; likely bought nothing]" : ""}`).join("\n") || "- nothing at all"}${budget.unallocated > 0 ? `\n- ${money(budget.unallocated)} left unallocated.` : ""}\nDeployed: ${money(budget.deployed)} of ${money(BUDGET_TOTAL)}.`,
      ground.jobs ? `HOW IT IS RUN\n${ground.jobs} recurring jobs on the board, ${ground.checkins.length} weekly check-ins filed.` : null,
    ].filter(Boolean).join("\n\n");

    try {
      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      });
      const verdict = cleanVerdict(parseModelJson<any>(completion.choices[0]?.message?.content, "valuation"));

      const [row] = await db.insert(tenYearOutlooks).values({
        projectId: project.id,
        allocation: allocation as any,
        profile: {
          subcategory: asRunSubcategory(project.subcategory),
          baseline,
          checkinsOnFile: ground.checkins.length,
          latestWeek: ground.latestWeek,
          goals: ground.goals,
        } as any,
        verdict: verdict as any,
        fromModel: true,
        createdBy: userId,
        createdAt: new Date(),
      }).returning();

      if (!bought) await storage.deductCredits(userId, CHARGEABLE);
      res.json({ outlook: outlookForClient(row), paidCents: bought ? 0 : OUTCOME_PRICE_CENTS.simulations });
    } catch (err) {
      console.error("[decision-sim] couldn't value the business:", err);
      respondToAiError(res, err, "Nova couldn't value that just now. Nothing was charged — please try again.");
    }
  });
}
