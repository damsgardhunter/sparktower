/**
 * The arithmetic behind "What would it take?".
 *
 * This is the half of the feature that has to be right whatever the model
 * says. The verdict, the multiple and the ladder are all computed here and
 * handed to Nova as facts — so if any of this is wrong, the roadmap is wrong
 * in a way no amount of good prose can rescue, and an owner makes a real
 * decision on it. The case that matters most is the last one: a café is told
 * $50bn is a different business, in those words, and no rounding or averaging
 * is allowed to turn that into encouragement.
 */
import { describe, it, expect } from "vitest";
import {
  WWIT_TARGETS, arithmeticLines, describeYears, gapTo, isWwitTargetId, movementBetween, readMargin, readUnits,
  readWeeklyRevenue, stageLadder, verdictFor, verdictWithMargin, whatItImplies, worthLine, wwitTarget,
} from "@shared/what-would-it-take";
import type { CheckinLike } from "@shared/company-rhythm";

const week = (n: number) => {
  const d = new Date(Date.UTC(2026, 0, 5) + n * 7 * 86_400_000);
  return d.toISOString().slice(0, 10);
};
const checkin = (n: number, numbers: Record<string, number | null>): CheckinLike => ({ weekOf: week(n), numbers });

const target = (id: string) => wwitTarget(id)!;

describe("the four targets", () => {
  it("are the four sizes, in order, each with what it is and what it is worth", () => {
    expect(WWIT_TARGETS.map((t) => t.revenue)).toEqual([1_000_000, 100_000_000, 1_000_000_000, 50_000_000_000]);
    expect(WWIT_TARGETS.map((t) => t.id)).toEqual(["m1", "m100", "b1", "b50"]);
    for (const t of WWIT_TARGETS) {
      expect(t.whatItIs.length, t.id).toBeGreaterThan(40);
      // Worth is a range with a stated basis, never a single confident number.
      expect(t.worth.high).toBeGreaterThan(t.worth.low);
      expect(worthLine(t)).toMatch(/Worth roughly/);
      expect(t.worth.basis.length).toBeGreaterThan(40);
    }
    expect(isWwitTargetId("b50")).toBe(true);
    expect(isWwitTargetId("trillion")).toBe(false);
    expect(wwitTarget("nope")).toBeNull();
  });
});

describe("reading revenue out of a company's own check-ins", () => {
  it("multiplies a restaurant's covers by its average spend, averaged over the weeks it filed", () => {
    const read = readWeeklyRevenue("restaurant", [
      checkin(2, { covers: 500, avg_spend: 30 }),
      checkin(1, { covers: 400, avg_spend: 30 }),
      checkin(0, { covers: 300, avg_spend: 30 }),
    ])!;
    expect(read.weekly).toBe(12_000); // (15,000 + 12,000 + 9,000) / 3
    expect(read.annual).toBe(624_000);
    expect(read.weeksUsed).toBe(3);
    expect(read.latestWeek).toBe(week(2));
    expect(read.metricIds).toEqual(["covers", "avg_spend"]);
    expect(read.from).toMatch(/averaged over the last 3 weeks/);
  });

  it("takes a shop's sales directly, and says so when there is only one week", () => {
    const read = readWeeklyRevenue("retail", [checkin(0, { sales: 8000, cash: 2000 })])!;
    expect(read.weekly).toBe(8000);
    expect(read.from).toMatch(/the one week you have filed/);
  });

  /*
   * The one an average would get wrong. A quiet week is not a smaller company,
   * and taking the latest week alone would have halved this business's
   * apparent size — which at the $1bn target is the difference between 1,900
   * copies of it and 3,800.
   */
  it("is not thrown by one quiet week", () => {
    const busy = readWeeklyRevenue("retail", Array.from({ length: 6 }, (_, i) => checkin(i, { sales: 10_000 })))!;
    const withDip = readWeeklyRevenue("retail", [
      checkin(6, { sales: 2_000 }),
      ...Array.from({ length: 6 }, (_, i) => checkin(i, { sales: 10_000 })),
    ])!;
    expect(busy.weekly).toBe(10_000);
    expect(withDip.weekly).toBeCloseTo(8_857, 0);
  });

  it("skips weeks with the number missing rather than counting them as zero", () => {
    const read = readWeeklyRevenue("service", [
      checkin(2, { invoiced: 6000 }),
      checkin(1, { invoiced: null }),
      checkin(0, { invoiced: 4000 }),
    ])!;
    expect(read.weekly).toBe(5000);
    expect(read.weeksUsed).toBe(2);
  });

  it("finds a company's own money number when its kind of business tracks none", () => {
    // Software's five default numbers are all about change; none of them is total revenue.
    expect(readWeeklyRevenue("software", [checkin(0, { new_revenue: 4000, active_customers: 100, churn: 500 })])).toBeNull();
    const read = readWeeklyRevenue("software", [checkin(0, { new_revenue: 4000, "custom:Revenue": 20_000 })])!;
    expect(read.weekly).toBe(20_000);
    expect(read.metricIds).toEqual(["custom:Revenue"]);
  });

  it("gives nothing when there is nothing to read", () => {
    expect(readWeeklyRevenue("restaurant", [])).toBeNull();
    expect(readWeeklyRevenue("restaurant", [checkin(0, { cash: 5000 })])).toBeNull();
    // A company that took nothing is not a company with a revenue of zero to divide by.
    expect(readWeeklyRevenue("retail", [checkin(0, { sales: 0 })])).toBeNull();
  });

  it("reads what the business sells, one of, where the numbers contain it", () => {
    expect(readUnits("restaurant", [checkin(0, { covers: 400, avg_spend: 25 })])).toMatchObject({ unit: "covers", perWeek: 400, price: 25 });
    expect(readUnits("retail", [checkin(0, { sales: 9000, avg_basket: 30 })])).toMatchObject({ unit: "sales", perWeek: 300, price: 30 });
    expect(readUnits("service", [checkin(0, { jobs_done: 20, invoiced: 8000 })])).toMatchObject({ unit: "jobs", price: 400 });
    // An agency tracks fees and not jobs, so it gets no unit line rather than an invented one.
    expect(readUnits("agency", [checkin(0, { fees_invoiced: 20_000 })])).toBeNull();
  });
});

describe("the gap", () => {
  const read = readWeeklyRevenue("restaurant", [checkin(0, { covers: 400, avg_spend: 25 })])!; // $10k/wk, $520k/yr
  const units = readUnits("restaurant", [checkin(0, { covers: 400, avg_spend: 25 })]);

  it("is the plain arithmetic, in copies of the business and in what it sells", () => {
    const gap = gapTo(target("m100"), read, units, "restaurant");
    expect(gap.todayAnnual).toBe(520_000);
    expect(gap.multiple).toBeCloseTo(192.31, 2);
    expect(gap.extraAnnual).toBe(99_480_000);
    expect(gap.inCopies).toBe("About 192 restaurants the size of yours");
    expect(gap.inUnits).toMatch(/76,923 covers a week/);
  });

  it("counts software in revenue rather than in copies of a shop", () => {
    const sw = readWeeklyRevenue("software", [checkin(0, { "custom:Revenue": 10_000 })])!;
    expect(gapTo(target("m100"), sw, null, "software").inCopies).toBe("192× the revenue you have now");
  });

  it("writes the arithmetic lines the roadmap is shown with", () => {
    const lines = arithmeticLines(target("m1"), read, gapTo(target("m1"), read, units, "restaurant"), units);
    expect(lines[0]).toMatch(/Today: about \$520k a year/);
    expect(lines[1]).toMatch(/Target: \$1\.00m a year — 1\.92×/);
    expect(lines.some((l) => /400 covers a week at \$25 each/.test(l))).toBe(true);
  });
});

describe("the ladder", () => {
  it("is geometric, lands exactly on the target, and keeps its rungs near 6×", () => {
    const stages = stageLadder(520_000, 1_000_000_000);
    expect(stages.length).toBeGreaterThan(1);
    expect(stages.length).toBeLessThanOrEqual(6);
    expect(stages[stages.length - 1].endsAt).toBe(1_000_000_000);
    for (const s of stages) {
      expect(s.multiple).toBeGreaterThan(2);
      expect(s.multiple).toBeLessThan(20);
      expect(s.years).toBeGreaterThan(0);
    }
    // Every rung is the same multiple: growth is multiplicative, not additive.
    expect(new Set(stages.map((s) => s.multiple)).size).toBe(1);
  });

  it("is one stage for a small gap and never more than the cap for an absurd one", () => {
    expect(stageLadder(500_000, 1_000_000)).toHaveLength(1);
    expect(stageLadder(100_000, 50_000_000_000).length).toBe(6);
  });

  it("is empty when there is nowhere to go", () => {
    expect(stageLadder(0, 1_000_000)).toEqual([]);
    expect(stageLadder(2_000_000, 1_000_000)).toEqual([]);
  });

  it("says how long in words a person would use", () => {
    expect(describeYears(0.4)).toBe("Under a year");
    expect(describeYears(1.1)).toBe("About a year");
    expect(describeYears(3.4)).toBe("About 3 years");
    expect(describeYears(16)).toBe("15 years or so");
    expect(describeYears(40)).toBe("A generation");
  });
});

describe("the verdict, which is the point of the feature", () => {
  it("draws the three lines by multiple alone", () => {
    expect(verdictFor(1)).toBe("reachable");
    expect(verdictFor(30)).toBe("reachable");
    expect(verdictFor(31)).toBe("a stretch");
    expect(verdictFor(1000)).toBe("a stretch");
    expect(verdictFor(1001)).toBe("a different business");
  });

  /*
   * The whole reason this feature exists. A café taking $10k a week is not a
   * $50bn company, and the sentence it gets has to say that in words, not
   * imply it in a number somebody skims past.
   */
  it("tells a café that $50bn is a different business, and says what that size actually is", () => {
    const read = readWeeklyRevenue("restaurant", [checkin(0, { covers: 400, avg_spend: 25 })])!;
    const gap = gapTo(target("b50"), read, null, "restaurant");
    expect(verdictFor(gap.multiple)).toBe("a different business");
    const said = whatItImplies("restaurant", target("b50"), gap);
    expect(said).toMatch(/^Not from here, not as this business\./);
    expect(said).toMatch(/96,154×/);
    expect(said).toMatch(/restaurant group/);
    expect(said).not.toMatch(/achievable|ambitious|focus/i);
  });

  it("does not manufacture drama when the target really is the same business, bigger", () => {
    const read = readWeeklyRevenue("retail", [checkin(0, { sales: 10_000 })])!; // $520k a year
    const gap = gapTo(target("m1"), read, null, "retail");
    const said = whatItImplies("retail", target("m1"), gap);
    expect(verdictFor(gap.multiple)).toBe("reachable");
    expect(said).toMatch(/The shape does not have to change/);
  });
});

describe("running it again", () => {
  it("says which way the gap moved, and by how much revenue changed", () => {
    const m = movementBetween(target("m100"), { annualRevenue: 520_000 }, { annualRevenue: 1_040_000 })!;
    expect(m.previousMultiple).toBeCloseTo(192.31, 2);
    expect(m.currentMultiple).toBeCloseTo(96.15, 2);
    expect(m.changeFraction).toBe(1);
    expect(m.text).toBe("The gap closed from 192× to 96×, on revenue up 100%.");
  });

  it("says so when it widened, and refuses to compare against a run with no numbers", () => {
    expect(movementBetween(target("m1"), { annualRevenue: 800_000 }, { annualRevenue: 400_000 })!.text)
      .toMatch(/widened from 1\.25× to 2\.5×, on revenue down 50%/);
    expect(movementBetween(target("m1"), { annualRevenue: null }, { annualRevenue: 400_000 })).toBeNull();
    expect(movementBetween(target("m1"), { annualRevenue: 400_000 }, { annualRevenue: 0 })).toBeNull();
  });
});

describe("what the business keeps", () => {
  it("reads a margin the company records itself, and says whether it is gross or net", () => {
    const net = readMargin("retail", [
      checkin(1, { sales: 10_000, "custom:Net margin": 12 }),
      checkin(0, { sales: 10_000, "custom:Net margin": 8 }),
    ])!;
    expect(net.fraction).toBeCloseTo(0.1, 5);
    expect(net.kind).toBe("net");
    expect(net.from).toMatch(/averaged over 2 weeks — read as a net margin/);

    const gross = readMargin("retail", [checkin(0, { sales: 10_000, "custom:Gross margin": 40 })])!;
    expect(gross.kind).toBe("gross");
  });

  it("reads a profit figure against the revenue of the same weeks", () => {
    const m = readMargin("retail", [
      checkin(1, { sales: 10_000, "custom:Profit": 500 }),
      checkin(0, { sales: 10_000, "custom:Profit": 700 }),
    ])!;
    expect(m.fraction).toBeCloseTo(0.06, 5);
    expect(m.kind).toBe("net");
    expect(m.metricIds).toContain("custom:Profit");
  });

  /*
   * A restaurant's prime cost is the one default metric anywhere in the Run
   * path that implies a margin, and what is left after it is gross — rent,
   * rates, everything else and the owner's own wage still come out. A café
   * reading "68% margin" and believing it keeps 68c in the dollar is the
   * misreading this has to prevent, so the read says gross and says why.
   */
  it("reads a restaurant's prime cost as a gross margin, and says what is still to come out", () => {
    const m = readMargin("restaurant", [checkin(0, { covers: 400, avg_spend: 25, prime_cost_pct: 62 })])!;
    expect(m.fraction).toBeCloseTo(0.38, 5);
    expect(m.kind).toBe("gross");
    expect(m.from).toMatch(/before rent and everything else/);
  });

  it("gives nothing rather than a plausible figure when nobody has filed one", () => {
    expect(readMargin("retail", [checkin(0, { sales: 10_000, cash: 3000 })])).toBeNull();
    expect(readMargin("retail", [])).toBeNull();
    // Prime cost is a restaurant metric; a shop that somehow files one is not read as a margin.
    expect(readMargin("retail", [checkin(0, { sales: 10_000, prime_cost_pct: 60 })])).toBeNull();
  });
});

describe("the verdict, once margin is taken into account", () => {
  it("says plainly that the verdict is about revenue only when no margin is filed, and asks for one", () => {
    const call = verdictWithMargin(5, null);
    expect(call.verdict).toBe("reachable");
    expect(call.tightenedByMargin).toBe(false);
    expect(call.note).toMatch(/no profit number in your check-ins/i);
    expect(call.note).toMatch(/3c in the dollar and one keeping 40c/);
    expect(call.note).toMatch(/Add a number of your own called "Profit"/);
  });

  /*
   * A gross margin is not what the business keeps. Letting one tighten the
   * verdict would refuse ordinary targets to ordinary businesses — a
   * restaurant at 38% gross is perfectly normal — so it is said out loud and
   * then set aside.
   */
  it("never lets a gross margin change the verdict, and says why it can't", () => {
    const gross = readMargin("restaurant", [checkin(0, { covers: 400, avg_spend: 25, prime_cost_pct: 97 })])!;
    expect(gross.fraction).toBeCloseTo(0.03, 5); // thin, but gross
    const call = verdictWithMargin(200, gross);
    expect(call.verdict).toBe("a stretch");
    expect(call.verdict).toBe(call.onRevenueAlone);
    expect(call.tightenedByMargin).toBe(false);
    expect(call.note).toMatch(/that is a gross margin/);
    expect(call.note).toMatch(/not what the business keeps/);
  });

  it("makes a target harder when the business keeps too little to fund a build that size, and says that is why", () => {
    const thin = readMargin("retail", [checkin(0, { sales: 10_000, "custom:Profit": 200 })])!; // 2% net
    const call = verdictWithMargin(200, thin);
    expect(call.onRevenueAlone).toBe("a stretch");
    expect(call.verdict).toBe("a different business");
    expect(call.tightenedByMargin).toBe(true);
    expect(call.note).toMatch(/You keep about 2% of what comes in/);
    expect(call.note).toMatch(/needs outside money or a different margin/);
    expect(call.note).toMatch(/rather than "a stretch" on the revenue gap alone/);
  });

  /*
   * Doubling on a thin margin is hard; it is not "a different business", and
   * saying so would be its own dishonesty. Only a build past what trading
   * could plausibly fund is tightened.
   */
  it("leaves a small target alone even on a thin margin", () => {
    const thin = readMargin("retail", [checkin(0, { sales: 10_000, "custom:Profit": 200 })])!;
    const call = verdictWithMargin(2, thin);
    expect(call.verdict).toBe("reachable");
    expect(call.tightenedByMargin).toBe(false);
  });

  it("says a healthy margin can fund some of it from the business itself", () => {
    const healthy = readMargin("retail", [checkin(0, { sales: 10_000, "custom:Profit": 2000 })])!;
    const call = verdictWithMargin(20, healthy);
    expect(call.verdict).toBe("reachable");
    expect(call.note).toMatch(/You keep about 20% of what comes in/);
    expect(call.note).toMatch(/funded out of the business itself/);
  });
});

describe("the arithmetic carries the margin, or says it is missing", () => {
  const read = readWeeklyRevenue("retail", [checkin(0, { sales: 10_000 })])!; // $520k a year
  const gap = gapTo(target("m100"), read, null, "retail");

  it("shows both ends of the range when nobody has filed one, so the owner sees what it rests on", () => {
    const line = arithmeticLines(target("m100"), read, gap, null, null).find((l) => l.startsWith("Margin:"))!;
    expect(line).toMatch(/not in your check-ins, so this is revenue, not money kept/);
    expect(line).toMatch(/At a 10% margin, \$100\.00m a year is about \$10\.00m of profit; at 40%, about \$40\.00m/);
    expect(line).toMatch(/Add a number of your own called "Profit"/);
  });

  it("is specific when one is filed, and never calls a gross margin profit", () => {
    const net = readMargin("retail", [checkin(0, { sales: 10_000, "custom:Profit": 1500 })])!;
    const netLine = arithmeticLines(target("m100"), read, gap, null, net).find((l) => l.startsWith("Margin:"))!;
    expect(netLine).toMatch(/about 15% net/);
    expect(netLine).toMatch(/\$100\.00m of revenue is about \$15\.00m of profit a year/);

    const gross = readMargin("restaurant", [checkin(0, { covers: 400, avg_spend: 25, prime_cost_pct: 62 })])!;
    const grossLine = arithmeticLines(target("m100"), read, gap, null, gross).find((l) => l.startsWith("Margin:"))!;
    expect(grossLine).toMatch(/about 38% gross/);
    expect(grossLine).toMatch(/gross profit \(before rent, wages outside the line and everything else\)/);
  });
});
