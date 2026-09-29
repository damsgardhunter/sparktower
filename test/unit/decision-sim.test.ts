/**
 * The decision simulator's arithmetic, with no database and no model in sight.
 *
 * What is worth guarding here is not that it produces numbers — it is the
 * handful of rules that stop those numbers flattering the owner. A hire costs
 * from day one and earns from month three. New revenue is margined and
 * existing revenue is not, or a profitable business would show a loss. The
 * cautious run is cheaper to be wrong about than the bold one. Borrowing at
 * 6% is charged at 6%, not at whatever the company already pays. And running
 * out of money outranks every other verdict, however profitable month
 * twenty-four looks.
 */
import { describe, it, expect } from "vitest";
import {
  answer, cleanBaseline, cleanLever, cleanLevers, cleanMonths, emptyBaseline,
  missingFrom, runMonths, type Baseline, type Lever,
} from "@shared/simulation/decision-sim";

/** A small business that covers its costs: $20k in, $16k out, $30k in the bank. */
const company = (over: Partial<Baseline> = {}): Baseline => cleanBaseline({
  ...emptyBaseline(),
  monthlyRevenue: 20_000,
  monthlyCosts: 16_000,
  cash: 30_000,
  grossMargin: 0.5,
  staff: 3,
  ...over,
});

const hire = (over: Partial<any> = {}): Lever => cleanLever({
  kind: "hire", label: "Twelve people", startMonth: 1,
  people: 12, monthlyCostEach: 4_000, monthlyRevenueEach: 0, rampMonths: 3,
  ...over,
})!;

describe("doing nothing", () => {
  it("is a flat line, and the line the decision is measured against", () => {
    const run = runMonths({ baseline: company(), levers: [], months: 6 });
    expect(run.months).toHaveLength(6);
    // $4,000 a month clear, six months, on top of the $30,000 that was there.
    expect(run.endCash).toBe(54_000);
    expect(run.runsOutIn).toBeNull();
  });

  it("grows, when the business says it is growing", () => {
    const flat = runMonths({ baseline: company(), levers: [], months: 12 });
    const growing = runMonths({ baseline: company({ growth: 0.02 }), levers: [], months: 12 });
    expect(growing.endMonthlyRevenue).toBeGreaterThan(flat.endMonthlyRevenue);
  });
});

describe("hiring", () => {
  it("charges the wages from month one and credits nothing until they are up to speed", () => {
    const run = runMonths({
      baseline: company({ cash: 500_000 }),
      levers: [hire({ people: 1, monthlyRevenueEach: 8_000, rampMonths: 3 })],
      months: 6,
    });
    const [first] = run.months;
    // The whole wage, none of the revenue it will eventually bring.
    expect(first.costs).toBeGreaterThan(20_000);
    expect(first.revenue).toBeLessThan(20_000 + 8_000);
    expect(run.months[5].revenue).toBeGreaterThan(run.months[0].revenue);
  });

  it("runs a business out of money when the wage bill is larger than the business", () => {
    const result = answer({ baseline: company(), levers: [hire()], months: 12 });
    expect(result.with.likely.runsOutIn).not.toBeNull();
    expect(result.verdict).toBe("it runs you out of money");
  });

  it("does not let a profitable month twenty-four talk its way past an empty bank in March", () => {
    // Twelve people who each bring in a fortune — eventually.
    const result = answer({
      baseline: company(),
      levers: [hire({ monthlyRevenueEach: 30_000, rampMonths: 12 })],
      months: 36,
    });
    expect(result.with.likely.endCash).toBeGreaterThan(0);
    expect(result.verdict).toBe("it runs you out of money");
  });

  it("charges the cost of delivering what the new people sell", () => {
    const levers = [hire({ people: 1, monthlyCostEach: 1_000, monthlyRevenueEach: 10_000, rampMonths: 0 })];
    const fat = runMonths({ baseline: company({ cash: 100_000, grossMargin: 1 }), levers, months: 3 });
    const thin = runMonths({ baseline: company({ cash: 100_000, grossMargin: 0.2 }), levers, months: 3 });
    expect(fat.endCash).toBeGreaterThan(thin.endCash);
  });
});

describe("the three runs", () => {
  const levers = [hire({ people: 1, monthlyCostEach: 3_000, monthlyRevenueEach: 12_000, rampMonths: 1 })];

  it("cost the same in all three and only differ in what comes back", () => {
    const result = answer({ baseline: company({ cash: 200_000 }), levers, months: 12 });
    expect(result.with.cautious.endCash).toBeLessThan(result.with.likely.endCash);
    expect(result.with.likely.endCash).toBeLessThan(result.with.bold.endCash);
  });

  it("decides how tight it is on the cautious run, not the expected one", () => {
    /*
     * Tuned so the expected case never dips at all and the slow case spends
     * three months under a month's costs. The verdict has to come from the one
     * the owner would actually have to live through.
     */
    const result = answer({
      baseline: company({ cash: 10_000 }),
      levers: [hire({ people: 2, monthlyCostEach: 3_000, monthlyRevenueEach: 9_000, rampMonths: 2 })],
      months: 12,
    });
    expect(result.with.likely.lowestCash).toBeGreaterThanOrEqual(10_000);
    expect(result.with.cautious.lowestCash).toBeLessThan(10_000);
    expect(result.verdict).toBe("it works, but it is tight");
  });
});

describe("spending to bring money back", () => {
  it("saturates rather than multiplying, so ten times the budget is not ten times the return", () => {
    const at = (monthlyAmount: number) => runMonths({
      baseline: company({ cash: 1_000_000 }),
      levers: [cleanLever({
        kind: "spend", label: "Marketing", startMonth: 1, monthlyAmount,
        months: 0, monthlyReturnAtFull: 40_000, halfSpend: 2_000, lagMonths: 0,
      })!],
      months: 6,
    }).months[5].revenue;

    const small = at(1_000) - 20_000;
    const big = at(10_000) - 20_000;
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThan(small * 10);
  });

  it("stops earning when the money stops", () => {
    const run = runMonths({
      baseline: company({ cash: 200_000 }),
      levers: [cleanLever({
        kind: "spend", label: "Three months of ads", startMonth: 1, monthlyAmount: 1_000,
        months: 3, monthlyReturnAtFull: 20_000, halfSpend: 1_000, lagMonths: 0,
      })!],
      months: 6,
    });
    expect(run.months[2].revenue).toBeGreaterThan(20_000);
    expect(run.months[4].revenue).toBe(20_000);
  });
});

describe("putting prices up", () => {
  it("loses customers, and the loss is not scaled away by optimism", () => {
    const levers = [cleanLever({
      kind: "price", label: "Up 10%", startMonth: 1, changePct: 10, demandChangePct: -20, lagMonths: 0,
    })!];
    const bold = runMonths({ baseline: company(), levers, months: 3, confidence: "bold" });
    // 1.1 × 0.8 is less than 1 even in the good case: the customers still go.
    expect(bold.months[0].revenue).toBeLessThan(20_000);
  });
});

describe("borrowing", () => {
  it("is charged at its own rate, not at whatever the company already pays", () => {
    const loan = (apr: number) => runMonths({
      baseline: company({ debt: 0, interestRate: 0.5 }),
      levers: [cleanLever({ kind: "loan", label: "A loan", startMonth: 1, amount: 120_000, apr, termMonths: 60 })!],
      months: 12,
    });
    const cheap = loan(0.05);
    const dear = loan(0.2);
    expect(cheap.endCash).toBeGreaterThan(dear.endCash);
    // And nowhere near the company's own 50%: a year at 5% on ~$115k is single-digit thousands.
    expect(cheap.months[0].interest).toBeLessThan(600);
  });

  it("puts the money in the bank without calling it profit", () => {
    const run = runMonths({
      baseline: company(),
      levers: [cleanLever({ kind: "loan", label: "A loan", startMonth: 1, amount: 100_000, apr: 0.1, termMonths: 60 })!],
      months: 1,
    });
    expect(run.months[0].cash).toBeGreaterThan(100_000);
    expect(run.cumulativeProfit).toBeLessThan(5_000);
    expect(run.endDebt).toBeGreaterThan(90_000);
  });
});

describe("the verdict", () => {
  it("says a decision that costs more than it brings back does exactly that", () => {
    const result = answer({
      baseline: company({ cash: 500_000 }),
      levers: [cleanLever({ kind: "oneOff", label: "A van", startMonth: 1, amount: 60_000 })!],
      months: 12,
    });
    expect(result.verdict).toBe("it costs more than it brings back");
    expect(result.paybackMonth).toBeNull();
  });

  it("says so plainly when a decision pays for itself", () => {
    const result = answer({
      baseline: company({ cash: 200_000 }),
      levers: [cleanLever({ kind: "saving", label: "Drop the second unit", startMonth: 1, monthlyAmount: 2_000 })!],
      months: 12,
    });
    expect(result.verdict).toBe("it pays for itself");
    expect(result.paybackMonth).toBe(1);
    expect(result.cashDifference).toBe(24_000);
  });

  it("measures everything against doing nothing, never against zero", () => {
    const result = answer({ baseline: company(), levers: [hire({ people: 1, monthlyCostEach: 1_000 })], months: 6 });
    expect(result.cashDifference).toBe(result.with.likely.endCash - result.without.endCash);
    expect(result.facts.join(" ")).toContain("if you did nothing");
  });
});

describe("refusing nonsense", () => {
  it("makes every number a number, whatever it was handed", () => {
    const b = cleanBaseline({ monthlyRevenue: "lots", cash: NaN, grossMargin: 4, growth: 99, staff: -2 });
    expect(Number.isFinite(b.monthlyRevenue)).toBe(true);
    expect(b.cash).toBe(0);
    expect(b.grossMargin).toBe(1);
    expect(b.growth).toBe(0.5);
    expect(b.staff).toBe(0);
  });

  it("drops a lever of a kind it cannot run rather than guessing at one", () => {
    expect(cleanLever({ kind: "vibes", label: "Try harder" })).toBeNull();
    expect(cleanLevers([{ kind: "vibes" }, { kind: "oneOff", label: "A van", amount: 100 }])).toHaveLength(1);
  });

  it("never runs a horizon it wasn't offered", () => {
    /*
     * The promise in the name is unchanged: whatever comes out is one of the
     * horizons this can actually run. What changed is where an unoffered
     * number lands. It used to fall back to the *default*, so 600 became 12 —
     * not the longest horizon, the shortest ordinary one — and everything a
     * plan did after its first year silently never happened. Eight plans that
     * differed only in the month an owner quit her job came back byte for byte
     * identical, because none of them ever reached the month she quit.
     *
     * It now snaps to the nearest offered horizon, preferring the longer on a
     * tie, because being given less time than you asked for is the more
     * misleading of the two errors: plans break at the end.
     */
    for (const m of [3, 6, 12, 24, 36]) expect(cleanMonths(m)).toBe(m);
    expect(cleanMonths(7)).toBe(6);
    expect(cleanMonths(600)).toBe(36);
    expect(cleanMonths(18)).toBe(24);
    // And nonsense still falls back to the default rather than guessing.
    for (const junk of [0, -5, NaN, null, undefined, "soon"]) expect(cleanMonths(junk)).toBe(12);
  });

  it("refuses to project a company that has told it nothing", () => {
    expect(missingFrom(cleanBaseline(emptyBaseline()))).not.toBeNull();
    expect(missingFrom(company())).toBeNull();
  });

  it("does not turn one bad field into twelve months of NaN", () => {
    const run = runMonths({ baseline: { ...company(), monthlyCosts: NaN } as any, levers: [], months: 3 });
    expect(run.months.every((m) => Number.isFinite(m.cash))).toBe(true);
  });
});
