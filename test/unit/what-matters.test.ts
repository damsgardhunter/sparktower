/**
 * Which number decides a plan — and the discipline not to invent one.
 *
 * The simulator could say what happens. It could not say which part of the
 * plan was worth arguing about, so a projection with nine numbers under it was
 * nine things to worry about equally. This ranks them by how far the answer
 * moves when each is nudged on its own.
 *
 * The tests that matter most here are the ones about restraint: a ranking is
 * only worth reading if it refuses to crown a winner when there isn't one.
 */
import { describe, it, expect } from "vitest";
import { whatMatters, explainWhatMatters, headlineWhatMatters, worthSaying } from "../../shared/simulation/what-matters";
import { cleanLevers, emptyBaseline, type Baseline, type Lever } from "../../shared/simulation/decision-sim";

const money = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

const base: Baseline = { ...emptyBaseline(), monthlyCosts: 120, grossMargin: 0.85, ownerHours: 12, taxRate: 0.15 };
const plan = (over: Record<string, unknown> = {}): Lever[] => cleanLevers([
  { kind: "job", label: "Wage", startMonth: 1, monthlyTakeHome: 500, months: 36, intoBusiness: 1 },
  {
    kind: "subscription", label: "Getting customers", startMonth: 1, monthlyAmount: 380, months: 0,
    newCustomersAtFull: 10, halfSpend: 380, pricePerMonth: 29, monthlyChurn: 0.03, lagMonths: 1,
    marketSize: 180_000, rivalShare: 0.2, priceErosion: 0.03, wordOfMouth: 0.02, reinvestShare: 0.3,
    ...over,
  },
]);

describe("ranking what decides a plan", () => {
  const rows = whatMatters({ baseline: base, levers: plan(), months: 36, top: 6 });

  it("returns something to argue with", () => {
    expect(rows.length).toBeGreaterThan(2);
    for (const r of rows) {
      expect(r.swing).toBeGreaterThan(0);
      expect(Number.isFinite(r.better)).toBe(true);
      expect(Number.isFinite(r.worse)).toBe(true);
    }
  });

  it("puts them in order within each scope, decision first", () => {
    /* Ordered inside a scope, not across them — see the note on `scope`. */
    const seen = rows.map((r) => r.scope);
    expect(seen.indexOf("business")).toBeGreaterThan(-1);
    expect(seen.lastIndexOf("decision")).toBeLessThan(seen.indexOf("business"));
    for (const scope of ["decision", "business"] as const) {
      const only = rows.filter((r) => r.scope === scope);
      for (let i = 1; i < only.length; i += 1) expect(only[i - 1].swing).toBeGreaterThanOrEqual(only[i].swing);
    }
  });

  it("knows which direction is the good one", () => {
    /* More churn is worse; a higher price is better. Both must come out that way. */
    const churn = rows.find((r) => r.field === "monthlyChurn");
    const price = rows.find((r) => r.field === "pricePerMonth");
    if (churn) expect(churn.better).toBeGreaterThan(churn.worse);
    if (price) expect(price.better).toBeGreaterThan(price.worse);
  });

  it("leaves out the numbers nobody can decide", () => {
    /*
     * `startMonth` moves the answer a long way and "start it sooner" is a wish
     * rather than a lever. A ranking cluttered with those buries the real ones.
     */
    expect(rows.some((r) => r.field === "startMonth")).toBe(false);
    expect(rows.some((r) => r.field === "lagMonths")).toBe(false);
  });

  it("skips a field the plan left at zero", () => {
    const none = whatMatters({ baseline: base, levers: plan({ wordOfMouth: 0 }), months: 36, top: 10 });
    expect(none.some((r) => r.field === "wordOfMouth")).toBe(false);
  });

  it("finds the baseline's own figures, not only the levers", () => {
    expect(rows.some((r) => r.leverIndex === -1)).toBe(true);
  });
});

describe("refusing to invent a driver", () => {
  it("does not crown a winner when the top two are level", () => {
    /*
     * On this plan price and volume are within a fraction of a per cent of
     * each other, because both scale the same revenue line. Saying "price is
     * the number that decides this" would be confident noise.
     */
    const rows = whatMatters({ baseline: base, levers: plan(), months: 36, top: 6 });
    expect(worthSaying(rows)).toBe(false);
    const said = explainWhatMatters(rows, money);
    expect(said[0].line).not.toMatch(/the number that decides this/);
  });

  it("says so out loud rather than going quiet", () => {
    const rows = explainWhatMatters(whatMatters({ baseline: base, levers: plan(), months: 36, top: 6 }), money);
    const headline = headlineWhatMatters(rows, money);
    expect(headline).toBeTruthy();
    expect(headline).toMatch(/about equally|on its own/);
  });

  it("does crown one when a plan really does turn on a single number", () => {
    /*
     * Strip the plan back to a hire whose only interesting figure is what the
     * person brings in, and the ranking should be willing to say so.
     */
    const hire: Lever[] = cleanLevers([{
      kind: "hire", label: "A salesperson", startMonth: 1,
      people: 1, monthlyCostEach: 3_000, monthlyRevenueEach: 9_000, rampMonths: 2,
    }]);
    const trading: Baseline = { ...emptyBaseline(), monthlyRevenue: 20_000, monthlyCosts: 15_000, grossMargin: 0.5, cash: 20_000 };
    const rows = whatMatters({ baseline: trading, levers: hire, months: 36, top: 6 });
    const own = rows.filter((r) => r.scope === "decision");
    expect(own[0].field).toBe("monthlyRevenueEach");
    expect(worthSaying(rows)).toBe(true);
    expect(explainWhatMatters(rows, money).find((r) => r.scope === "decision")!.line)
      .toMatch(/the number that decides this/);
  });

  it("does not let the business's own size answer a question about a decision", () => {
    /*
     * The bug a test found: ranked together, a fifth of a £15,000 monthly cost
     * base beats anything a single hire can do, so "should I take this person
     * on?" came back "your running costs are the thing". True, and not the
     * question. The decision's own numbers lead; the business follows as
     * context.
     */
    const hire: Lever[] = cleanLevers([{
      kind: "hire", label: "A salesperson", startMonth: 1,
      people: 1, monthlyCostEach: 3_000, monthlyRevenueEach: 9_000, rampMonths: 2,
    }]);
    const trading: Baseline = { ...emptyBaseline(), monthlyRevenue: 20_000, monthlyCosts: 15_000, grossMargin: 0.5, cash: 20_000 };
    const rows = whatMatters({ baseline: trading, levers: hire, months: 36, top: 6 });
    expect(rows[0].scope).toBe("decision");
    // The cost base is still the single biggest mover, and is still reported —
    // just not as the answer to this question.
    const biggest = [...rows].sort((a, b) => b.swing - a.swing)[0];
    expect(biggest.scope).toBe("business");
    expect(rows.some((r) => r.field === "monthlyCosts")).toBe(true);
  });

  it("says nothing at all about a plan with nothing in it", () => {
    expect(whatMatters({ baseline: base, levers: [], months: 36 }).length).toBeLessThanOrEqual(4);
    expect(headlineWhatMatters([], money)).toBeNull();
  });
});

describe("what it says", () => {
  it("writes every line in the business's own money", () => {
    const pounds = (n: number) => `£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`;
    const rows = explainWhatMatters(whatMatters({ baseline: base, levers: plan(), months: 36, top: 3 }), pounds);
    for (const r of rows) expect(r.line).toContain("£");
  });

  it("names a figure the owner can check against the boxes below", () => {
    const rows = explainWhatMatters(whatMatters({ baseline: base, levers: plan(), months: 36, top: 3 }), money);
    for (const r of rows) expect(r.line).toMatch(/20% either way/);
  });
});
