/**
 * The two places the simulator stopped taking the model's word for things.
 *
 * `valueTenYears` exists because the ten-year outlook asked a language model
 * what a business would be worth in a decade and printed the answer beside a
 * cash curve computed to the pound. `markProjection` exists because nothing
 * here ever checked a projection against what happened next.
 */
import { describe, it, expect } from "vitest";
import { valueTenYears } from "../../shared/simulation/ten-year";
import { markProjection } from "../../shared/simulation/hindsight";
import { runMonths, emptyBaseline, type Baseline } from "../../shared/simulation/decision-sim";
import type { BudgetSummary } from "../../shared/sprints/budget";

const budget = (funded: { id: string; amount: number; underfunded?: boolean }[]): BudgetSummary => ({
  funded: funded.map((f) => ({
    option: { id: f.id, label: f.id, group: "g", detail: "", consequence: "", step: 1000, minimumUseful: 0 },
    amount: f.amount,
    underfunded: f.underfunded ?? false,
  })),
  deployed: funded.filter((f) => f.id !== "runway").reduce((n, f) => n + f.amount, 0),
  unallocated: 0,
  total: funded.reduce((n, f) => n + f.amount, 0),
} as unknown as BudgetSummary);

const shop: Baseline = {
  ...emptyBaseline(),
  monthlyRevenue: 40_000, monthlyCosts: 30_000, grossMargin: 0.6, growth: 0.005, staff: 4, taxRate: 0.2,
};

describe("valuing a business ten years out", () => {
  it("is a range, because a single figure for a decade is a fiction", () => {
    const v = valueTenYears(shop, budget([{ id: "systems", amount: 20_000 }]));
    expect(v.low).toBeLessThan(v.mid);
    expect(v.mid).toBeLessThan(v.high);
  });

  it("shows its workings, so an owner can argue with the number", () => {
    const v = valueTenYears(shop, budget([{ id: "systems", amount: 20_000 }]));
    expect(v.workings.length).toBeGreaterThanOrEqual(3);
    expect(v.workings.join(" ")).toMatch(/carried forward/);
    expect(v.workings.join(" ")).toMatch(/multiple/);
  });

  it("does not let growth run for a decade", () => {
    /*
     * 2% a month compounded for ten years is eleven-fold. Almost nothing does
     * that, and a valuation built on it is the fantasy this replaced.
     */
    const fast = valueTenYears({ ...shop, growth: 0.02 }, budget([{ id: "systems", amount: 20_000 }]));
    expect(fast.revenueThen).toBeLessThan(shop.monthlyRevenue * 11);
  });

  it("pays for the things that let a business run without its owner", () => {
    const sellable = valueTenYears(shop, budget([{ id: "manager", amount: 30_000 }, { id: "systems", amount: 20_000 }]));
    const capacity = valueTenYears(shop, budget([{ id: "kit", amount: 50_000 }]));
    expect(sellable.multipleLow).toBeGreaterThan(capacity.multipleLow);
    expect(sellable.mid).toBeGreaterThan(capacity.mid);
  });

  it("discounts a one-person business that is still one person in ten years", () => {
    const solo: Baseline = { ...shop, staff: 1 };
    const stuck = valueTenYears(solo, budget([{ id: "kit", amount: 50_000 }]));
    const freed = valueTenYears(solo, budget([{ id: "manager", amount: 50_000 }]));
    expect(stuck.multipleHigh).toBeLessThan(freed.multipleHigh);
  });

  it("is worth more when the revenue recurs", () => {
    const plain = valueTenYears(shop, budget([{ id: "systems", amount: 20_000 }]));
    const recurring = valueTenYears(shop, budget([{ id: "systems", amount: 20_000 }]), { recurring: true });
    expect(recurring.mid).toBeGreaterThan(plain.mid);
  });

  it("says a business earning nothing is worth nothing, rather than rounding it up", () => {
    const idea: Baseline = { ...emptyBaseline(), monthlyCosts: 1_000 };
    const v = valueTenYears(idea, budget([{ id: "runway", amount: 50_000 }]));
    expect(v.profitThen).toBe(0);
    expect(v.mid).toBe(0);
  });

  it("never puts the peak outside the ten years it is talking about", () => {
    const v = valueTenYears(shop, budget([{ id: "systems", amount: 20_000 }]));
    expect(v.peakYear).toBeGreaterThanOrEqual(1);
    expect(v.peakYear).toBeLessThanOrEqual(10);
    expect(v.peak).toBeGreaterThanOrEqual(v.mid * 0.999);
  });
});

describe("marking a projection against what happened", () => {
  const run = runMonths({
    baseline: { ...emptyBaseline(), monthlyRevenue: 10_000, monthlyCosts: 6_000, grossMargin: 0.5 },
    levers: [], months: 6,
  });

  it("says nothing at all until there is something to check", () => {
    expect(markProjection(run, [null, null, null])).toBeNull();
    expect(markProjection(run, [])).toBeNull();
  });

  it("calls a projection that ran high, high", () => {
    const marked = markProjection(run, [7_000, 6_500, 7_000, null, null, null]);
    expect(marked?.lean).toBe("over");
    expect(marked?.line).toMatch(/ran about \d+% high/);
    expect(marked?.checked).toBe(3);
  });

  it("calls one that ran low, low — and does not scold for it", () => {
    const marked = markProjection(run, [14_000, 15_000, 14_000, null, null, null]);
    expect(marked?.lean).toBe("under");
    expect(marked?.line).toMatch(/better than you told it you would/);
  });

  it("calls a near miss close, because 8% is not a lesson", () => {
    const marked = markProjection(run, [10_800, 9_400, 10_200, null, null, null]);
    expect(marked?.lean).toBe("close");
  });

  it("skips a month nobody filed instead of scoring it as zero", () => {
    /*
     * A week nobody filed is not a week with no trade. Counting it as one
     * would tell every owner who went on holiday that they missed badly.
     */
    const marked = markProjection(run, [10_000, null, 10_000, null, null, null]);
    expect(marked?.checked).toBe(2);
    expect(marked?.lean).toBe("close");
  });

  it("takes the middle month rather than letting one disaster speak for the year", () => {
    const marked = markProjection(run, [10_000, 10_000, 10_000, 0.01, 10_000, null]);
    expect(marked?.lean).toBe("close");
  });
});
