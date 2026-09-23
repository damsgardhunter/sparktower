/**
 * The ceilings under the monthly allowance, and the arithmetic that sets them.
 *
 * A credit is a price; it is not a cost. Measured, a credit costs about four
 * cents to serve — so the allowances the plans promise are worth far more
 * than the plans charge, and the ceilings exist to bound how fast that can be
 * spent. These tests fix the arithmetic in place so a change to the price, the
 * cost or an allowance shows up here rather than on a card statement.
 */
import { describe, it, expect } from "vitest";
import {
  COST_PER_CREDIT_USD, DAILY_CREDIT_CAP, HEAVY_ACTION_LIMITS, ENTITLEMENTS,
  TIER_IDS, PLAN_PRESENTATION, creditsAtMargin, netOf, FAIR_USE_MONTHLY_CAP,
} from "@shared/plans";

describe("what a day is allowed to cost", () => {
  it("bounds every tier's daily spend to something a plan can carry", () => {
    // The ceiling exists so a month cannot be emptied in a weekend.
    for (const tier of TIER_IDS) {
      const cap = DAILY_CREDIT_CAP[tier];
      expect(cap, `${tier} has a daily cap`).toBeGreaterThan(0);
      expect(cap * COST_PER_CREDIT_USD, `${tier}'s day costs at most a few dollars`).toBeLessThanOrEqual(5);
    }
  });

  it("rises with the tier, so paying more buys more in a day", () => {
    const caps = TIER_IDS.map((t) => DAILY_CREDIT_CAP[t]);
    expect(caps).toEqual([...caps].sort((a, b) => a - b));
  });

  it("never exceeds the month it is drawn from, for the tiers that have one", () => {
    for (const tier of TIER_IDS) {
      const monthly = ENTITLEMENTS[tier].credits;
      if (monthly === Infinity) continue;
      expect(DAILY_CREDIT_CAP[tier], `${tier}: a day cannot be worth more than its month`)
        .toBeLessThanOrEqual(monthly);
    }
  });
});

describe("the actions whose cost is nothing like their price", () => {
  it("caps each by the day and by the month, rising with the tier", () => {
    for (const [action, byTier] of Object.entries(HEAVY_ACTION_LIMITS)) {
      for (const tier of TIER_IDS) {
        const c = byTier[tier];
        expect(c, `${action}/${tier} has a ceiling`).toBeTruthy();
        expect(c.month, `${action}/${tier}: a month is at least a day`).toBeGreaterThanOrEqual(c.day);
      }
      const days = TIER_IDS.map((t) => byTier[t].day);
      expect(days, `${action} rises with the tier`).toEqual([...days].sort((a, b) => a - b));
    }
  });

  it("keeps a month of the dearest action inside the dearest plan's revenue", () => {
    /*
     * A codebase audit reads up to ten files across eleven areas. Whatever it
     * costs, running the monthly allowance of them must not cost more than
     * the plan takes — this is the check that catches a ceiling raised
     * without doing the sum.
     */
    const pro = PLAN_PRESENTATION.pro;
    const audits = HEAVY_ACTION_LIMITS.codeAudit.pro.month;
    const asCredits = audits * 8; // CREDIT_COSTS.codeAudit
    expect(asCredits * COST_PER_CREDIT_USD).toBeLessThan(netOf(pro.priceMonthly));
  });
});

describe("what a price can afford", () => {
  it("prices a plan's credits from the measured cost and a margin", () => {
    // Twenty dollars at a 70% gross margin buys about 143 credits, thirty about 216.
    expect(creditsAtMargin(20)).toBe(143);
    expect(creditsAtMargin(30)).toBe(216);
    // A fatter margin buys fewer.
    expect(creditsAtMargin(30, 0.8)).toBeLessThan(creditsAtMargin(30, 0.7));
  });

  it("records that today's allowances are sold below what they cost", () => {
    /*
     * Not a bug to fix in code, and not a thing to discover twice. Every paid
     * tier's allowance costs more to serve than the tier takes, so this asserts
     * the gap exists rather than pretending it does not. When the allowances
     * are reset, this test should start failing and be rewritten as the
     * opposite claim.
     */
    for (const tier of TIER_IDS) {
      const plan = PLAN_PRESENTATION[tier];
      if (plan.priceMonthly <= 0) continue;
      const allowance = ENTITLEMENTS[tier].credits === Infinity
        ? FAIR_USE_MONTHLY_CAP
        : ENTITLEMENTS[tier].credits;
      expect(
        allowance * COST_PER_CREDIT_USD,
        `${tier}: costs more fully used than it sells for — see docs/ai-margins.md`,
      ).toBeGreaterThan(netOf(plan.priceMonthly));
    }
  });
});
