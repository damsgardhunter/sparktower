/**
 * Marketing schemes: write the plan, have it read, then test it.
 *
 * For a product that already exists. The decision simulator can already answer
 * "what if I spend a thousand a month on marketing" — this answers the
 * question a marketer actually has, which is whether the plan behind that
 * thousand is any good, and then lets a plan worth testing be run for a year
 * against the business's own figures.
 *
 * ## What is charged, and once
 *
 * $6 for the project, like the simulator's $3: the first scheme is the
 * purchase and every scheme after it is free, because the second one — "fine,
 * but what if we led with the offer instead" — is the one anybody learns from.
 * Charging per scheme would be charging somebody to revise, and revising is
 * the entire activity.
 *
 * Testing is free always. The arithmetic is not the expensive part, and a
 * scheme that cannot be tested without paying again is a scheme nobody tests.
 *
 * Developers: `AI_STUB=1` answers Nova without calling anybody, and
 * `POST /api/dev/credit-wallet` puts money on the account without Stripe — see
 * docs/env-contract.md. Both are refused in production.
 */
import type { Express } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { marketingSchemes, projectMembers, projects, type Project } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { requireCredits, getUserEntitlements, modelFor } from "./entitlements";
import { CHARGEABLE, NO_CHARGE } from "@shared/plans";
import { getOpenAI, openAiConfigured } from "./openai-client";
import { parseModelJson } from "./ai-json";
import { storage } from "./storage";
import {
  MARKETING_DIMENSIONS, WORTH_TESTING_AT, cleanEvaluation, scoreOf, schemeArithmetic, schemeAsLever, economicsScore, isRecurring,
} from "@shared/simulation/marketing";
import { answer } from "@shared/simulation/decision-sim";
import { readBaseline } from "@shared/simulation/company-baseline";
import { businessMoneyExact, currencyOf } from "@shared/currency";
import { isSoftwareCategory } from "@shared/categories";
import { projectCheckins, simulationBaselines } from "@shared/schema";
import { cleanBaseline } from "@shared/simulation/decision-sim";

const str = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

/** The project, if this person is on it. Mirrors the decision simulator's own check. */
async function projectFor(res: any, projectId: string, userId: string): Promise<Project | null> {
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

/** The business's own numbers, the same way the simulator reads them. */
async function baselineFor(project: Project) {
  const checkins = await db.select().from(projectCheckins).where(eq(projectCheckins.projectId, project.id));
  const [saved] = await db.select().from(simulationBaselines)
    .where(eq(simulationBaselines.projectId, project.id));
  return readBaseline({
    subcategory: project.subcategory,
    checkins: checkins as any,
    saved: saved ? cleanBaseline(saved.numbers as any) : null,
    overridden: Array.isArray(saved?.overridden) ? (saved!.overridden as string[]) : [],
    weeks: 12,
  }).baseline;
}

/** Bought once for the project: the first scheme pays, the rest are free. */
async function alreadyBought(projectId: string): Promise<boolean> {
  const [row] = await db.select({ id: marketingSchemes.id }).from(marketingSchemes)
    .where(eq(marketingSchemes.projectId, projectId)).limit(1);
  return !!row;
}

export function registerMarketingRoutes(app: Express): void {
  /** Every scheme on this project, newest first. Free. */
  app.get("/api/projects/:id/marketing-schemes", isAuthenticated, async (req: any, res) => {
    try {
      const project = await projectFor(res, req.params.id, req.user.id);
      if (!project) return;
      const rows = await db.select().from(marketingSchemes)
        .where(eq(marketingSchemes.projectId, project.id))
        .orderBy(desc(marketingSchemes.createdAt));
      res.json({
        dimensions: MARKETING_DIMENSIONS,
        worthTestingAt: WORTH_TESTING_AT,
        currency: currencyOf(project.currency),
        /** A web app has no street to post cards through — see the placeholder. */
        software: isSoftwareCategory(project.category),
        unlocked: rows.length > 0,
        aiAvailable: openAiConfigured(),
        schemes: rows,
      });
    } catch (error) {
      console.error("Marketing schemes list error:", error);
      res.status(500).json({ message: "Couldn't read the schemes." });
    }
  });

  /**
   * Write a scheme and have it read.
   *
   * The arithmetic is done here and handed to Nova as fact, the same way the
   * decision simulator hands it a verdict: a model asked to judge a plan *and*
   * work out whether it can pay will flatter the plan, because the flattering
   * answer is the fluent one.
   */
  app.post("/api/projects/:id/marketing-schemes", isAuthenticated, rateLimit("ai"), async (req: any, res) => {
    const userId = req.user.id;
    const project = await projectFor(res, req.params.id, userId);
    if (!project) return;

    const scheme = str(req.body?.scheme, 4000);
    if (scheme.length < 40) {
      return res.status(400).json({
        message: "Write the plan out — who it is for, where it runs, what it offers and how you would know it worked. A line or two isn't a scheme.",
      });
    }
    const monthlyBudget = Math.max(0, Math.round(Number(req.body?.monthlyBudget) || 0));
    const months = Math.min(60, Math.max(1, Math.round(Number(req.body?.months) || 12)));
    const expectedMonthlyReturn = Math.max(0, Math.round(Number(req.body?.expectedMonthlyReturn) || 0));
    /* A scheme selling a subscription says so with these three; churn arrives as a percentage. */
    const pricePerMonth = Math.max(0, Math.round(Number(req.body?.pricePerMonth) || 0));
    const churnPerMille = Math.min(1000, Math.max(0, Math.round((Number(req.body?.monthlyChurnPct) || 0) * 10)));
    const statedNewCustomers = Math.max(0, Math.round(Number(req.body?.newCustomersAtFull) || 0));
    /*
     * How many a month, worked back from the money when nobody said.
     *
     * A scheme is recurring only if it comes with a price, a churn rate *and*
     * a number of customers a month (`isRecurring`), and the form has never
     * asked for the third — so a marketer who filled in "$299 a month, 3%
     * churn" had their scheme judged as a one-off campaign: no lifetime value,
     * no cost per customer, no payback month, and a subscription's whole
     * economics missing from the score. The third number was there all along,
     * in the two they did give: a return of $2,700 a month at $299 each is
     * nine customers. Derived rather than demanded, and only where the price
     * makes it meaningful.
     */
    const newCustomersAtFull = statedNewCustomers > 0 || pricePerMonth <= 0
      ? statedNewCustomers
      : Math.round(expectedMonthlyReturn / pricePerMonth);
    const marketSize = Math.max(0, Math.round(Number(req.body?.marketSize) || 0));
    const recurring = { pricePerMonth, monthlyChurn: churnPerMille / 1000, newCustomersAtFull, marketSize };
    if (monthlyBudget <= 0) {
      return res.status(400).json({ message: "Put a monthly budget on it, even a small one. A scheme with no cost cannot be judged." });
    }
    if (!openAiConfigured()) {
      return res.status(503).json({ message: "Nova isn't available right now, so this can't be read. Nothing was charged." });
    }

    const baseline = await baselineFor(project);
    const sums = schemeArithmetic(
      { monthlyBudget, months, expectedMonthlyReturn, ...recurring },
      baseline.monthlyRevenue, baseline.grossMargin,
    );

    const bought = await alreadyBought(project.id);
    const ent = bought
/*
       * Bought already, so nothing is charged — but it still goes through
       * `requireCredits`.
       *
       * `getUserEntitlements` alone skips `enforceRateLimit`, which is the
       * first thing requireCredits does. So a project that had paid once got
       * unlimited model calls with no burst limit on them at all: the free
       * part is the design, and the *uncapped* part was an accident of how
       * the free part was written. `NO_CHARGE` returns the entitlement
       * without taking anything and keeps the limiter in front of it.
       */
      ? await requireCredits(res, userId, NO_CHARGE, "reading your marketing", { projectId: project.id })
      : await requireCredits(res, userId, CHARGEABLE, "reading a marketing scheme", { outcome: "marketing", projectId: project.id });
    if (!ent) return;

    const money = (n: number) => businessMoneyExact(n, project.currency);
    const system = `You are a blunt, experienced marketer reading somebody else's plan for a product that already exists.

Judge the plan in front of you, not the idea behind it. Score each dimension 0-100, and use the range: a plan that names a real audience, a real offer and a way to tell whether it worked is 70+; "post on social media and see" is 20. Most plans are between 30 and 60, and saying so is the useful part.

THE DIMENSIONS
${MARKETING_DIMENSIONS.map((d) => `- ${d.id} (${d.label}): ${d.blurb}`).join("\n")}

THE ARITHMETIC, ALREADY DONE — treat these as facts and do not recompute them:
- Budget: ${money(sums.budget)} a month for ${months} months.
- Claimed return: ${money(sums.claimed)} a month once it is working, of which ${money(sums.kept)} is kept after the cost of delivering it.
- Net a month at those figures: ${money(sums.monthlyNet)}.
${sums.paybackMonths ? `- Pays back the month's spend in about ${sums.paybackMonths} month(s).` : "- It does not pay back the spend at these figures."}
${sums.shareOfRevenue != null ? `- That budget is ${Math.round(sums.shareOfRevenue * 100)}% of this business's monthly takings.` : "- The business has no revenue yet, so the budget cannot be judged as a share of it."}
${sums.recurring ? `- People keep paying: ${money(recurring.pricePerMonth)} a month each, ${(recurring.monthlyChurn * 100).toFixed(1)}% of them leaving a month, so the average one stays about ${Math.round(sums.monthsKept ?? 0)} months.
- Winning one costs about ${money(sums.cac ?? 0)} and they are worth about ${money(sums.ltv ?? 0)} — ${sums.ltvToCac?.toFixed(1)}× — with the money back after about ${sums.cacPaybackMonths} months of their payments.
- Do NOT score "economics" yourself: it is worked out from those figures and your number for it is replaced.` : ""}
${sums.warnings.length ? sums.warnings.map((w) => `- ${w}`).join("\n") : ""}

Score "economics" against those numbers, not against your own estimate of them.

Respond ONLY with valid JSON of exactly this shape, no markdown fences:
{"scores":{${MARKETING_DIMENSIONS.map((d) => `"${d.id}":0`).join(",")}},
 "notes":{${MARKETING_DIMENSIONS.map((d) => `"${d.id}":"one line on why that score"`).join(",")}},
 "restated":"the scheme in one plain sentence, as you understood it",
 "fix":"the single change that would raise this most",
 "assumptions":["something the plan takes for granted without saying so"]}`;

    const user = `THE BUSINESS
${project.title}${project.description ? ` — ${project.description.slice(0, 600)}` : ""}
Money in: ${money(baseline.monthlyRevenue)} a month. Kept per unit of revenue: ${Math.round(baseline.grossMargin * 100)}%.

THE SCHEME
${scheme}`;

    try {
      const completion = await getOpenAI().chat.completions.create({
        model: modelFor(ent),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      });
      const evaluation = cleanEvaluation(parseModelJson(completion.choices[0]?.message?.content, "scheme"));
      /*
       * The one dimension that is arithmetic is taken back off the model. See
       * `economicsScore`: where the scheme says enough to work out what a
       * customer costs and what they are worth, that is not a judgement.
       */
      const computed = economicsScore(sums);
      if (computed != null) evaluation.scores.economics = computed;
      const score = scoreOf(evaluation);

      const [row] = await db.insert(marketingSchemes).values({
        projectId: project.id,
        authorId: userId,
        scheme,
        monthlyBudget,
        months,
        expectedMonthlyReturn,
        pricePerMonth,
        churnPerMille,
        newCustomersAtFull,
        marketSize,
        evaluation: { ...evaluation, arithmetic: sums } as any,
        score,
        worthTesting: score >= WORTH_TESTING_AT,
      }).returning();

      if (!bought) await storage.deductCredits(userId, CHARGEABLE);
      res.status(201).json({ scheme: row, paidCents: bought ? 0 : undefined });
    } catch (error: any) {
      if (error?.status === 502 || error?.code === "model_unreadable") {
        return res.status(502).json({ message: "Nova couldn't read that scheme. Try again.", code: "model_unreadable" });
      }
      console.error("Marketing scheme error:", error);
      res.status(500).json({ message: "Couldn't read that scheme." });
    }
  });

  /**
   * Run a scheme through the decision engine for its year. Free, always.
   *
   * Refused for a scheme Nova did not rate worth testing: a projection built
   * on a plan with no audience and no way of telling whether it worked is a
   * curve that lends false weight to the thing that needed fixing first.
   */
  app.post("/api/projects/:id/marketing-schemes/:schemeId/test", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const project = await projectFor(res, req.params.id, req.user.id);
      if (!project) return;
      const [row] = await db.select().from(marketingSchemes)
        .where(and(eq(marketingSchemes.id, req.params.schemeId), eq(marketingSchemes.projectId, project.id)));
      if (!row) return res.status(404).json({ message: "No such scheme." });
      if (!row.worthTesting) {
        return res.status(409).json({
          code: "not_worth_testing",
          message: `Nova scored this ${row.score}/100, below the ${WORTH_TESTING_AT} worth simulating. Fix what it named and run it again — re-reading a scheme is free once the project is unlocked.`,
        });
      }

      /*
       * What is going into the business while the scheme runs.
       *
       * A scheme is tested against the business as it stands, and for anybody
       * who has not started that means no cash — so every scheme, however
       * good, came back "it runs you out of money". True, and the wrong
       * answer: the scheme was fine and the funding was the gap, and the two
       * were being reported as one failure. A marketer can now say what is
       * paying for it — savings, a wage, a partner's money — and see the
       * scheme judged on its own merits with the funding in place.
       */
      const monthlySupport = Math.max(0, Math.round(Number(req.body?.monthlySupport) || 0));
      const supportMonths = Math.min(60, Math.max(0, Math.round(Number(req.body?.supportMonths) || 0)));

      const baseline = await baselineFor(project);
      const result = answer({
        baseline,
        levers: [
          ...(monthlySupport > 0
            ? [{
                kind: "job" as const, label: "What is paying for it", startMonth: 1, ownerHoursAMonth: 0,
                monthlyTakeHome: monthlySupport, months: supportMonths, intoBusiness: 1,
              }]
            : []),
          schemeAsLever(
          {
            monthlyBudget: row.monthlyBudget, months: row.months, expectedMonthlyReturn: row.expectedMonthlyReturn,
            pricePerMonth: row.pricePerMonth, monthlyChurn: row.churnPerMille / 1000,
            newCustomersAtFull: row.newCustomersAtFull, marketSize: row.marketSize,
          },
          (row.evaluation as any)?.restated || "The marketing scheme",
        ),
        ],
        months: Math.max(12, row.months),
        currency: currencyOf(project.currency),
      });

      const [updated] = await db.update(marketingSchemes)
        .set({ test: {
          verdict: result.verdict, facts: result.facts, ranAt: new Date().toISOString(),
          monthlySupport, supportMonths,
        } as any })
        .where(eq(marketingSchemes.id, row.id))
        .returning();
      res.json({ scheme: updated, result });
    } catch (error) {
      console.error("Marketing scheme test error:", error);
      res.status(500).json({ message: "Couldn't run that." });
    }
  });
}
