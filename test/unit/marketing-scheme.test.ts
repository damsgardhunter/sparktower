/**
 * Scoring a marketing scheme, and what the numbers say before anybody reads it.
 *
 * The split this file guards is the same one the decision engine keeps: what a
 * plan *costs* and what it would have to bring back is arithmetic and is done
 * here; whether the plan is any good is a judgement Nova makes against fixed
 * dimensions, and the score is averaged from those rather than asked for — a
 * model asked for one overall number says 80.
 */
import { describe, it, expect } from "vitest";
import {
  MARKETING_DIMENSIONS, WORTH_TESTING_AT, cleanEvaluation, scoreOf, schemeArithmetic, schemeAsLever,
  economicsScore, isRecurring,
} from "../../shared/simulation/marketing";

const full = (n: number) => Object.fromEntries(MARKETING_DIMENSIONS.map((d) => [d.id, n]));

describe("reading a marketing scheme", () => {
  it("fills in every dimension, whatever the model left out", () => {
    const e = cleanEvaluation({ scores: { audience: 70 }, notes: { audience: "Names a street." } });
    for (const d of MARKETING_DIMENSIONS) expect(e.scores[d.id], d.id).toEqual(expect.any(Number));
    expect(e.scores.audience).toBe(70);
    expect(e.scores.offer, "a dimension the model skipped scores nothing, not nothing-at-all").toBe(0);
  });

  it("keeps scores inside 0–100 however they arrive", () => {
    const e = cleanEvaluation({ scores: { audience: 900, offer: -40, channel: "70" } });
    expect(e.scores.audience).toBe(100);
    expect(e.scores.offer).toBe(0);
    expect(e.scores.channel).toBe(70);
  });

  it("averages the score here rather than taking the model's word for it", () => {
    expect(scoreOf(cleanEvaluation({ scores: full(60) }))).toBe(60);
    // Four good dimensions and one hopeless one is not a good plan.
    const lopsided = cleanEvaluation({ scores: { ...full(90), measurement: 0 } });
    expect(scoreOf(lopsided)).toBe(72);
  });

  it("puts a fixed bar on what is worth simulating", () => {
    expect(scoreOf(cleanEvaluation({ scores: full(WORTH_TESTING_AT) }))).toBeGreaterThanOrEqual(WORTH_TESTING_AT);
    expect(scoreOf(cleanEvaluation({ scores: full(WORTH_TESTING_AT - 10) }))).toBeLessThan(WORTH_TESTING_AT);
  });
});

describe("what the numbers say about a scheme", () => {
  const scheme = { monthlyBudget: 1_000, months: 12, expectedMonthlyReturn: 3_000 };

  it("works out what is kept, not what is claimed", () => {
    const sums = schemeArithmetic(scheme, 20_000, 0.5);
    expect(sums.kept, "gross profit on the claim, not the claim").toBe(1_500);
    expect(sums.monthlyNet).toBe(500);
    expect(sums.paybackMonths).toBe(2);
    expect(sums.shareOfRevenue).toBeCloseTo(0.05);
    expect(sums.multiple).toBe(3);
  });

  it("says so when the claim is the kind nobody checked", () => {
    const sums = schemeArithmetic({ ...scheme, expectedMonthlyReturn: 20_000 }, 20_000, 0.5);
    expect(sums.warnings.join(" ")).toMatch(/20\.0× back/);
  });

  it("says so when it cannot pay for itself at those figures", () => {
    const sums = schemeArithmetic({ ...scheme, expectedMonthlyReturn: 1_000 }, 20_000, 0.3);
    expect(sums.monthlyNet).toBeLessThan(0);
    expect(sums.warnings.join(" ")).toMatch(/does not cover what it costs/);
    expect(sums.paybackMonths).toBeNull();
  });

  it("says so when the budget is a bet rather than a budget", () => {
    const sums = schemeArithmetic({ ...scheme, monthlyBudget: 6_000 }, 20_000, 0.5);
    expect(sums.warnings.join(" ")).toMatch(/30% of a month's takings/);
  });

  it("asks for a number when no return is claimed, rather than guessing one", () => {
    const sums = schemeArithmetic({ ...scheme, expectedMonthlyReturn: 0 }, 20_000, 0.5);
    expect(sums.warnings.join(" ")).toMatch(/Put a number on what you expect back/);
    expect(sums.multiple).toBe(0);
  });

  it("judges a business with no revenue on cost alone, without dividing by zero", () => {
    const sums = schemeArithmetic(scheme, 0, 0.5);
    expect(sums.shareOfRevenue, "no takings to be a share of").toBeNull();
    expect(Number.isFinite(sums.monthlyNet)).toBe(true);
  });
});

describe("turning a scheme into something the simulator can run", () => {
  it("keeps the marketer's own claim rather than substituting a guess", () => {
    const lever = schemeAsLever({ monthlyBudget: 800, months: 6, expectedMonthlyReturn: 2_400 }, "Door cards on Kirkgate");
    expect(lever.kind).toBe("spend");
    expect(lever.monthlyAmount).toBe(800);
    expect(lever.monthlyReturnAtFull, "their claim, tested — not ours").toBe(2_400);
    expect(lever.months).toBe(6);
    expect(lever.label).toBe("Door cards on Kirkgate");
  });

  it("sets the half-point at the stated spend, so doubling it would not double the return", () => {
    const lever = schemeAsLever({ monthlyBudget: 800, months: 12, expectedMonthlyReturn: 2_400 }, "");
    expect(lever.halfSpend).toBe(800);
    expect(lever.lagMonths, "nothing in marketing works the month it starts").toBeGreaterThan(0);
  });
});

/**
 * A scheme selling something people keep paying for.
 *
 * Two numbers decide it and neither can be got at from a budget and a claim:
 * what a customer costs to win, and what they are worth before they leave.
 * They are arithmetic, so this is the one dimension taken off the model —
 * which is the point, because a plan whose customers cost more than they are
 * worth could otherwise be talked into a good score by describing them warmly.
 */
describe("customers who keep paying", () => {
  const recurring = {
    monthlyBudget: 1_000, months: 12, expectedMonthlyReturn: 760,
    pricePerMonth: 19, monthlyChurn: 0.04, newCustomersAtFull: 40, marketSize: 640_000,
  };

  it("needs all three numbers before it counts as recurring at all", () => {
    expect(isRecurring(recurring)).toBe(true);
    expect(isRecurring({ ...recurring, pricePerMonth: 0 })).toBe(false);
    expect(isRecurring({ ...recurring, monthlyChurn: 0 })).toBe(false);
    expect(isRecurring({ monthlyBudget: 500, months: 6, expectedMonthlyReturn: 1_500 })).toBe(false);
  });

  it("works out what a customer costs and what they are worth", () => {
    const sums = schemeArithmetic(recurring, 0, 0.85);
    expect(sums.cac, "$1,000 winning forty of them").toBe(25);
    expect(Math.round(sums.monthsKept!), "4% a month leaving is about 25 months each").toBe(25);
    expect(Math.round(sums.ltv!), "$19 at 85% for 25 months").toBe(404);
    expect(sums.ltvToCac!).toBeCloseTo(16.1, 1);
    expect(sums.cacPaybackMonths, "two months of payments to earn back winning them").toBe(2);
  });

  it("does not ask a subscription the campaign's question", () => {
    /*
     * A month of signups can never cover the spend that won them, and is not
     * supposed to — that warning fired on every subscription ever entered.
     */
    const sums = schemeArithmetic(recurring, 0, 0.85);
    expect(sums.monthlyNet, "the campaign arithmetic still says it is negative").toBeLessThan(0);
    expect(sums.warnings.join(" "), "and the campaign's warning is not raised").not.toMatch(/does not cover what it costs/);
  });

  it("scores the economics on a curve that keeps discriminating", () => {
    const at = (over: Partial<typeof recurring>) => economicsScore(schemeArithmetic({ ...recurring, ...over }, 0, 0.85))!;
    // Paying more for them than they are worth.
    expect(at({ pricePerMonth: 5, monthlyChurn: 0.1, newCustomersAtFull: 10 })).toBeLessThan(20);
    // An ordinary 8:1 is good and is not full marks.
    const ordinary = at({ monthlyChurn: 0.05, newCustomersAtFull: 25 });
    expect(ordinary).toBeGreaterThan(80);
    expect(ordinary).toBeLessThan(95);
    // And a strong, credible one beats it.
    expect(at({})).toBeGreaterThan(ordinary);
  });

  it("turns the curve down where the ratio stops being believable", () => {
    const believable = economicsScore(schemeArithmetic(recurring, 0, 0.85))!;
    const absurd = economicsScore(schemeArithmetic({ ...recurring, monthlyChurn: 0.02, newCustomersAtFull: 60, pricePerMonth: 29 }, 0, 0.85))!;
    expect(absurd, "a 74:1 is a churn figure nobody measured, not a better business").toBeLessThan(believable);
  });

  it("says so when the ratio rests on a churn nobody measured", () => {
    const sums = schemeArithmetic({ ...recurring, monthlyChurn: 0.02, newCustomersAtFull: 60, pricePerMonth: 29 }, 0, 0.85);
    expect(sums.warnings.join(" ")).toMatch(/Ratios that high nearly always mean the churn is a guess/);
  });

  it("says so when winning somebody takes years to earn back", () => {
    const sums = schemeArithmetic({ ...recurring, newCustomersAtFull: 2, pricePerMonth: 9 }, 0, 0.85);
    expect(sums.cacPaybackMonths!).toBeGreaterThan(18);
    expect(sums.warnings.join(" ")).toMatch(/months of a customer's payments to earn back/);
  });

  it("says so when the plan would sign up the whole market in a year", () => {
    const sums = schemeArithmetic({ ...recurring, marketSize: 200 }, 0, 0.85);
    expect(sums.warnings.join(" ")).toMatch(/sign up everybody in the market inside a year/);
  });

  it("wins customers at the rate the marketer actually typed", () => {
    /*
     * The field says "new ones a month, at this budget". The lever wants the
     * ceiling an unlimited budget approaches, and `lift` is
     * spend/(spend+half) × ceiling with half set to the budget — so passing
     * the stated rate straight through delivered half of it. Somebody who
     * wrote "40 a month at $1,000" got twenty, and the cost per customer the
     * score rested on was half what it would really be.
     */
    const lever = schemeAsLever(recurring, "x") as any;
    const delivered = (lever.monthlyAmount / (lever.monthlyAmount + lever.halfSpend)) * lever.newCustomersAtFull;
    expect(Math.round(delivered), "forty typed, forty delivered").toBe(40);
    expect(Math.round(lever.newCustomersAtFull), "which needs a ceiling of twice that").toBe(80);
  });

  it("and the cost per customer is worked out on that same rate", () => {
    const sums = schemeArithmetic(recurring, 0, 0.85);
    const lever = schemeAsLever(recurring, "x") as any;
    const delivered = (lever.monthlyAmount / (lever.monthlyAmount + lever.halfSpend)) * lever.newCustomersAtFull;
    expect(sums.cac, "$1,000 over the customers it really wins").toBeCloseTo(1000 / delivered, 5);
  });

  it("treats no month count as the whole horizon, not as a year", () => {
    // `|| 12` turned an explicit zero into a twelve-month campaign, so a
    // business that should have kept compounding peaked in its first year and
    // shrank for the next two.
    expect((schemeAsLever({ ...recurring, months: 0 }, "x") as any).months).toBe(0);
    expect((schemeAsLever({ ...recurring, months: 6 }, "x") as any).months).toBe(6);
    expect((schemeAsLever({ monthlyBudget: 500, months: 0, expectedMonthlyReturn: 900 }, "x") as any).months).toBe(0);
  });

  it("becomes a subscriber base rather than a campaign", () => {
    const lever = schemeAsLever(recurring, "Translators signing up") as any;
    expect(lever.kind).toBe("subscription");
    expect(lever.pricePerMonth).toBe(19);
    expect(lever.monthlyChurn).toBe(0.04);
    expect(lever.marketSize).toBe(640_000);

    const campaign = schemeAsLever({ monthlyBudget: 500, months: 6, expectedMonthlyReturn: 1_500 }, "Leaflets") as any;
    expect(campaign.kind, "and a scheme with no subscription stays a campaign").toBe("spend");
  });

  it("leaves the model's reading alone where nothing can be computed", () => {
    expect(economicsScore(schemeArithmetic({ monthlyBudget: 500, months: 6, expectedMonthlyReturn: 1_500 }, 10_000, 0.5))).toBeNull();
  });
});
