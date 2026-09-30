/**
 * Turning a company's own check-ins into a starting position for the simulator.
 *
 * This is the join between the two halves of the product — the weekly numbers a
 * real business files, and the season it then plays with them — and it had no
 * tests at all while `decision-sim-routes.ts`, `marketing-routes.ts` and the
 * desk in the client all read it.
 *
 * The contract it documents for itself is narrow and worth holding to. It reads
 * what it honestly can, says where each figure came from, and leaves the rest
 * at zero for the owner rather than deriving a cost base from a margin from a
 * revenue. A baseline that looks complete and is mostly invention is worse than
 * an obviously empty one, because the first projection run off it is wrong in a
 * way nobody can trace.
 */
import { describe, it, expect } from "vitest";
import { readBaseline, WEEKS_PER_MONTH, FIELD_ORDER } from "@shared/simulation/company-baseline";
import type { CheckinLike } from "@shared/company-rhythm";

const week = (weekOf: string, numbers: Record<string, unknown>): CheckinLike => ({ weekOf, numbers });

/** A restaurant files covers and average spend; the two together are the week's takings. */
const restaurantWeeks: CheckinLike[] = [
  week("2026-09-21", { covers: 400, avg_spend: 25, cash: 12_000 }),
  week("2026-09-14", { covers: 380, avg_spend: 25, cash: 9_000 }),
  week("2026-09-07", { covers: 420, avg_spend: 25, cash: 15_000 }),
];

describe("reading a baseline off the check-ins", () => {
  it("turns a week's takings into a month's revenue", () => {
    const { baseline, sources } = readBaseline({ subcategory: "restaurant", checkins: restaurantWeeks });
    /* 400 x 25 = 10,000 a week, averaged with the others, then four and a third weeks to the month. */
    expect(baseline.monthlyRevenue).toBeGreaterThan(10_000 * 4);
    expect(baseline.monthlyRevenue).toBeLessThan(10_500 * WEEKS_PER_MONTH + 1);
    expect(sources.find((s) => s.field === "monthlyRevenue")?.from, "it does not say where revenue came from").toBeTruthy();
  });

  it("takes the cash that was last filed, not an average of the bank balance", () => {
    /*
     * The one balance a check-in holds, rather than a flow. An average of the
     * last eight weeks' bank balance is not a number that means anything, and
     * the weeks here are deliberately out of order to prove it sorts them.
     */
    const jumbled = [restaurantWeeks[1], restaurantWeeks[2], restaurantWeeks[0]];
    const { baseline, sources } = readBaseline({ subcategory: "restaurant", checkins: jumbled });
    expect(baseline.cash, "cash was averaged instead of taken from the latest week").toBe(12_000);
    expect(sources.find((s) => s.field === "cash")?.from).toContain("2026-09-21");
  });

  it("leaves a field alone once the owner has typed it", () => {
    /*
     * The whole reason `overridden` exists. Someone who corrects their revenue
     * and comes back next week to find the check-ins have quietly put it back
     * will not correct it twice.
     */
    const { baseline, sources } = readBaseline({
      subcategory: "restaurant",
      checkins: restaurantWeeks,
      saved: { ...emptyish(), monthlyRevenue: 250_000, cash: 1 },
      overridden: ["monthlyRevenue", "cash"],
    });
    expect(baseline.monthlyRevenue, "the check-ins overwrote the owner's revenue").toBe(250_000);
    expect(baseline.cash, "the check-ins overwrote the owner's cash").toBe(1);
    expect(sources.some((s) => s.field === "monthlyRevenue" || s.field === "cash"),
      "it claimed to have sourced a number the owner typed").toBe(false);
  });

  it("says what it could not answer, rather than inventing it", () => {
    const { baseline, missing } = readBaseline({ subcategory: "restaurant", checkins: restaurantWeeks });
    /* Nothing a restaurant files is its cost base, its debt or its payroll. */
    expect(missing).toContain("monthlyCosts");
    expect(missing).toContain("staff");
    expect(baseline.monthlyCosts, "a cost base was derived from a margin from a revenue").toBe(0);
    /* And what it did answer is not listed as missing. */
    expect(missing).not.toContain("monthlyRevenue");
    expect(missing).not.toContain("cash");
  });

  it("does not ask for the three figures that have a defensible default", () => {
    /* A rate, a margin and a growth figure can be defaulted; a revenue cannot. */
    const { missing } = readBaseline({ subcategory: "restaurant", checkins: [] });
    for (const field of ["interestRate", "grossMargin", "growth"] as const) {
      expect(missing, `${field} was demanded of the owner`).not.toContain(field);
    }
    expect(missing, "an empty company was asked for nothing").toContain("monthlyRevenue");
  });

  it("asks nothing of a field the owner has already answered", () => {
    const { missing } = readBaseline({
      subcategory: "restaurant", checkins: [],
      saved: { ...emptyish(), monthlyCosts: 8_000 }, overridden: ["monthlyCosts"],
    });
    expect(missing).not.toContain("monthlyCosts");
  });

  it("reads nothing at all from a company that has filed nothing at all", () => {
    const { baseline, sources, missing } = readBaseline({ subcategory: "service", checkins: [] });
    expect(sources, "it sourced a figure from no check-ins").toHaveLength(0);
    expect(baseline.monthlyRevenue).toBe(0);
    expect(missing.length).toBeGreaterThan(0);
  });

  it("does not pretend a software company has filed its revenue", () => {
    /*
     * None of the five numbers a software company watches is total revenue —
     * they all measure change. A new-revenue figure is not a total, and reading
     * it as one would be the exact invention this module refuses to make.
     */
    const { baseline, missing } = readBaseline({
      subcategory: "software",
      checkins: [week("2026-09-21", { new_revenue: 4_000, churn: 2, cash: 60_000 })],
    });
    expect(baseline.monthlyRevenue, "new revenue was read as total revenue").toBe(0);
    expect(missing).toContain("monthlyRevenue");
    /* Cash is still a balance anybody can file, so that much is read. */
    expect(baseline.cash).toBe(60_000);
  });

  it("ignores a number that is not one", () => {
    const { baseline } = readBaseline({
      subcategory: "retail",
      checkins: [week("2026-09-21", { sales: "quite a lot", cash: null })],
    });
    expect(Number.isFinite(baseline.monthlyRevenue)).toBe(true);
    expect(baseline.monthlyRevenue).toBe(0);
    expect(baseline.cash).toBe(0);
  });

  it("only claims a source for a figure it actually filled", () => {
    const { baseline, sources } = readBaseline({ subcategory: "retail", checkins: [week("2026-09-21", { sales: 5_000 })] });
    for (const { field } of sources) {
      expect(baseline[field], `${field} is sourced but empty`).toBeTruthy();
    }
    expect(FIELD_ORDER, "a sourced field is not one the form shows").toEqual(
      expect.arrayContaining(sources.map((s) => s.field)),
    );
  });
});

/** A zeroed baseline, without importing the whole shape into every case. */
function emptyish() {
  return Object.fromEntries(FIELD_ORDER.map((f) => [f, 0])) as any;
}
