/**
 * Where the AI money went.
 *
 * Built because "are we making money on this" was answerable only by opening
 * the OpenAI dashboard, which knows what was spent and nothing about who spent
 * it, on what, or whether they had paid. `ai_spend` has all three, so these
 * routes are mostly arithmetic over one table.
 *
 * Four questions, which are the four a launch day actually asks:
 *
 *  - What is today costing, and how does that sit against the brake?
 *  - Which parts of the product are dear? Not which are popular — a chat turn
 *    is one credit and a codebase audit is eight, and the interesting column
 *    is the product of the two.
 *  - Who is spending it, and had they paid?
 *  - Is the caching actually working? The prompt ordering only pays off if the
 *    provider is serving a prefix from cache, and that is a number, not a
 *    belief.
 */
import type { Express, Response } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { aiSpend, users, userProfiles } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireOwner } from "./platform-roles";
import { ENTITLEMENTS, normalizeTier, FREE_TIER_SPEND_SHARE } from "@shared/plans";
import { platformSpendToday } from "./ai-spend";
import {
  aiSettingsNow, saveAiSettings, ladderFor, COST_MICROS_MIN, COST_MICROS_MAX, CAP_USD_MAX,
} from "./ai-settings";

/**
 * The shape of the ladder: who each tier is for, at what price. The prices
 * are a starting point that the console re-costs live; what makes them a
 * ladder rather than three numbers is that each one is aimed at a kind of
 * builder whose monthly use is known.
 */
const LADDER_SHAPE = [
  { name: "Starter", price: 12, serves: "Dipping in" as const },
  { name: "Builder", price: 25, serves: "Building properly" as const },
  { name: "Business", price: 59, serves: "Leaning on it" as const },
];

/** How far back a view looks. Capped, because this reads a table that only grows. */
const windowOf = (raw: unknown): number => {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 1 && n <= 90 ? n : 7;
};
const since = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
/** Credits at whatever a credit currently costs, which is a setting, not a constant. */
const usd = (credits: number, rate: number) => Math.round(credits * rate * 100) / 100;

export function registerAiSpendRoutes(app: Express): void {
  /**
   * The day, against the brake. The one number to have on a screen during a
   * launch, and the only one of these that is memoised — it is read by every
   * AI request as well.
   */
  app.get("/api/admin/ai-spend/today", isAuthenticated, requireOwner, async (_req, res: Response) => {
    try {
      const [spent, settings] = await Promise.all([platformSpendToday(), aiSettingsNow()]);
      const ceiling = settings.dailySpendCapUsd;
      res.json({
        spentUsd: Math.round(spent * 100) / 100,
        ceilingUsd: ceiling,
        freeCutoffUsd: Math.round(ceiling * FREE_TIER_SPEND_SHARE * 100) / 100,
        /** Where free accounts and everyone else stand against their line. */
        freeStopped: ceiling > 0 && spent >= ceiling * FREE_TIER_SPEND_SHARE,
        allStopped: ceiling > 0 && spent >= ceiling,
        costPerCredit: settings.costPerCreditUsd,
      });
    } catch (error) {
      console.error("[ai-spend] today failed:", error);
      res.status(500).json({ message: "Couldn't read today's spend." });
    }
  });

  /**
   * The two numbers everything else derives from, and the ladder they imply.
   *
   * Prices are not editable here on purpose: what a customer is charged is a
   * deliberate act involving Stripe, not a slider. This says what a given
   * price can *afford* at the current cost, which is the part that moves.
   */
  app.get("/api/admin/ai-spend/settings", isAuthenticated, requireOwner, async (_req, res: Response) => {
    try {
      const settings = await aiSettingsNow();
      res.json({
        ...settings,
        freeTierShare: FREE_TIER_SPEND_SHARE,
        ladder: ladderFor(settings.costPerCreditUsd, LADDER_SHAPE),
        bounds: { costMin: COST_MICROS_MIN / 1e6, costMax: COST_MICROS_MAX / 1e6, capMax: CAP_USD_MAX },
      });
    } catch (error) {
      console.error("[ai-spend] settings read failed:", error);
      res.status(500).json({ message: "Couldn't read the settings." });
    }
  });

  /** Change what a credit costs, or what a day may cost. */
  app.put("/api/admin/ai-spend/settings", isAuthenticated, requireOwner, async (req: any, res: Response) => {
    try {
      const saved = await saveAiSettings({
        costPerCreditUsd: req.body?.costPerCreditUsd,
        dailySpendCapUsd: req.body?.dailySpendCapUsd,
        userId: req.user.id,
      });
      if (!saved.ok) {
        return res.status(400).json({ code: "invalid_input", field: saved.problem.field, message: saved.problem.message });
      }
      res.json({
        ...saved.settings,
        freeTierShare: FREE_TIER_SPEND_SHARE,
        ladder: ladderFor(saved.settings.costPerCreditUsd, LADDER_SHAPE),
        bounds: { costMin: COST_MICROS_MIN / 1e6, costMax: COST_MICROS_MAX / 1e6, capMax: CAP_USD_MAX },
      });
    } catch (error) {
      console.error("[ai-spend] settings write failed:", error);
      res.status(500).json({ message: "Couldn't save that." });
    }
  });

  /** A day per row: what it cost, how many calls, and how much of it was cached. */
  app.get("/api/admin/ai-spend/daily", isAuthenticated, requireOwner, async (req, res: Response) => {
    try {
      const days = windowOf(req.query.days);
      const { costPerCreditUsd: rate } = await aiSettingsNow();
      const rows = await db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${aiSpend.createdAt}), 'YYYY-MM-DD')`,
          credits: sql<number>`coalesce(sum(${aiSpend.credits}), 0)::int`,
          calls: sql<number>`count(*)::int`,
          people: sql<number>`count(distinct ${aiSpend.userId})::int`,
          promptTokens: sql<number>`coalesce(sum(${aiSpend.promptTokens}), 0)::bigint`,
          cachedTokens: sql<number>`coalesce(sum(${aiSpend.cachedTokens}), 0)::bigint`,
          completionTokens: sql<number>`coalesce(sum(${aiSpend.completionTokens}), 0)::bigint`,
        })
        .from(aiSpend)
        .where(gte(aiSpend.createdAt, since(days)))
        .groupBy(sql`date_trunc('day', ${aiSpend.createdAt})`)
        .orderBy(sql`date_trunc('day', ${aiSpend.createdAt}) desc`);

      res.json({
        days,
        rows: rows.map((r) => ({
          ...r,
          promptTokens: Number(r.promptTokens),
          cachedTokens: Number(r.cachedTokens),
          completionTokens: Number(r.completionTokens),
          costUsd: usd(r.credits, rate),
          /** Of the prompt tokens that day, the share the provider served from cache. */
          cacheRate: Number(r.promptTokens) > 0
            ? Math.round((Number(r.cachedTokens) / Number(r.promptTokens)) * 100)
            : null,
        })),
      });
    } catch (error) {
      console.error("[ai-spend] daily failed:", error);
      res.status(500).json({ message: "Couldn't read the daily spend." });
    }
  });

  /**
   * Which parts of the product cost the most.
   *
   * Sorted by what they cost rather than how often they run, because those are
   * different lists and only one of them is a bill. `tokensPerCall` is the
   * column that says whether an action's credit price is honest: two actions
   * priced the same that differ tenfold here are mispriced, whichever way.
   */
  app.get("/api/admin/ai-spend/sections", isAuthenticated, requireOwner, async (req, res: Response) => {
    try {
      const days = windowOf(req.query.days);
      const { costPerCreditUsd: rate } = await aiSettingsNow();
      const rows = await db
        .select({
          action: aiSpend.action,
          calls: sql<number>`count(*)::int`,
          credits: sql<number>`coalesce(sum(${aiSpend.credits}), 0)::int`,
          people: sql<number>`count(distinct ${aiSpend.userId})::int`,
          promptTokens: sql<number>`coalesce(sum(${aiSpend.promptTokens}), 0)::bigint`,
          cachedTokens: sql<number>`coalesce(sum(${aiSpend.cachedTokens}), 0)::bigint`,
          completionTokens: sql<number>`coalesce(sum(${aiSpend.completionTokens}), 0)::bigint`,
          /** Calls that were charged and never came back with usage: paid for, produced nothing. */
          unanswered: sql<number>`count(*) filter (where ${aiSpend.promptTokens} is null)::int`,
        })
        .from(aiSpend)
        .where(gte(aiSpend.createdAt, since(days)))
        .groupBy(aiSpend.action)
        .orderBy(sql`coalesce(sum(${aiSpend.credits}), 0) desc`);

      res.json({
        days,
        rows: rows.map((r) => {
          const prompt = Number(r.promptTokens), cached = Number(r.cachedTokens);
          const answered = r.calls - r.unanswered;
          return {
            action: r.action,
            calls: r.calls,
            people: r.people,
            credits: r.credits,
            costUsd: usd(r.credits, rate),
            unanswered: r.unanswered,
            promptTokens: prompt,
            completionTokens: Number(r.completionTokens),
            /** The context each call carries. The number to look at when an action feels dear. */
            tokensPerCall: answered > 0 ? Math.round(prompt / answered) : null,
            cacheRate: prompt > 0 ? Math.round((cached / prompt) * 100) : null,
          };
        }),
      });
    } catch (error) {
      console.error("[ai-spend] sections failed:", error);
      res.status(500).json({ message: "Couldn't read the spend by section." });
    }
  });

  /**
   * Who is spending it, and whether they have paid.
   *
   * `allowanceUsed` is the question underneath: a free account that has used
   * all twenty of its credits is somebody the product reached, and eighty
   * pence. A hundred of them is a marketing number. A thousand is a bill.
   */
  app.get("/api/admin/ai-spend/people", isAuthenticated, requireOwner, async (req, res: Response) => {
    try {
      const days = windowOf(req.query.days);
      const limit = Math.min(200, Math.max(1, Math.round(Number(req.query.limit)) || 50));
      const { costPerCreditUsd: rate } = await aiSettingsNow();
      const rows = await db
        .select({
          userId: aiSpend.userId,
          email: users.email,
          name: userProfiles.displayName,
          firstName: users.firstName,
          tier: users.subscriptionTier,
          credits: sql<number>`coalesce(sum(${aiSpend.credits}), 0)::int`,
          calls: sql<number>`count(*)::int`,
          promptTokens: sql<number>`coalesce(sum(${aiSpend.promptTokens}), 0)::bigint`,
          lastAt: sql<string>`max(${aiSpend.createdAt})`,
        })
        .from(aiSpend)
        .leftJoin(users, eq(users.id, aiSpend.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, aiSpend.userId))
        .where(gte(aiSpend.createdAt, since(days)))
        .groupBy(aiSpend.userId, users.email, userProfiles.displayName, users.firstName, users.subscriptionTier)
        .orderBy(sql`coalesce(sum(${aiSpend.credits}), 0) desc`)
        .limit(limit);

      res.json({
        days,
        rows: rows.map((r) => {
          const tier = normalizeTier(r.tier);
          const allowance = ENTITLEMENTS[tier].credits;
          return {
            userId: r.userId,
            name: r.name || r.firstName || r.email || "Someone",
            email: r.email ?? null,
            tier,
            paying: tier !== "free",
            credits: r.credits,
            calls: r.calls,
            costUsd: usd(r.credits, rate),
            promptTokens: Number(r.promptTokens),
            monthlyAllowance: allowance === Infinity ? null : allowance,
            /** How much of their month they have got through, where there is a month to get through. */
            allowanceUsed: allowance === Infinity ? null : Math.round((r.credits / allowance) * 100),
            lastAt: r.lastAt,
          };
        }),
      });
    } catch (error) {
      console.error("[ai-spend] people failed:", error);
      res.status(500).json({ message: "Couldn't read the spend by person." });
    }
  });

  /**
   * The free tier, as a block.
   *
   * The launch-day question: how many people arrived, how many of them used
   * Nova at all, how many used it up, and what the lot cost. `exhausted` is
   * the one to watch — it is both the product working and the bill arriving.
   */
  app.get("/api/admin/ai-spend/free-tier", isAuthenticated, requireOwner, async (req, res: Response) => {
    try {
      const days = windowOf(req.query.days);
      const allowance = ENTITLEMENTS.free.credits;
      const { costPerCreditUsd: rate } = await aiSettingsNow();
      const [row] = await db
        .select({
          people: sql<number>`count(distinct ${aiSpend.userId})::int`,
          credits: sql<number>`coalesce(sum(${aiSpend.credits}), 0)::int`,
          calls: sql<number>`count(*)::int`,
        })
        .from(aiSpend)
        .leftJoin(users, eq(users.id, aiSpend.userId))
        .where(and(
          gte(aiSpend.createdAt, since(days)),
          sql`coalesce(${users.subscriptionTier}, 'free') = 'free'`,
        ));

      // Of those people, how many have got through the whole allowance.
      const spent = await db
        .select({ userId: aiSpend.userId, credits: sql<number>`coalesce(sum(${aiSpend.credits}), 0)::int` })
        .from(aiSpend)
        .leftJoin(users, eq(users.id, aiSpend.userId))
        .where(and(
          gte(aiSpend.createdAt, since(days)),
          sql`coalesce(${users.subscriptionTier}, 'free') = 'free'`,
        ))
        .groupBy(aiSpend.userId);

      const exhausted = spent.filter((s) => s.credits >= allowance).length;
      res.json({
        days,
        allowance,
        people: row?.people ?? 0,
        calls: row?.calls ?? 0,
        credits: row?.credits ?? 0,
        costUsd: usd(row?.credits ?? 0, rate),
        exhausted,
        /** What it would cost if every one of them used the lot. */
        ifAllExhaustedUsd: usd((row?.people ?? 0) * allowance, rate),
        perPersonUsd: Math.round(allowance * rate * 100) / 100,
      });
    } catch (error) {
      console.error("[ai-spend] free tier failed:", error);
      res.status(500).json({ message: "Couldn't read the free tier's spend." });
    }
  });
}
