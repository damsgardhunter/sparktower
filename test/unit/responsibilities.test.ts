/**
 * The money-and-pricing responsibilities, held to the promise in
 * `responsibilities.ts`: each one has a setting where it helps and a setting
 * where it hurts. A lever that only ever helps is a tax on not noticing it;
 * one that never helps is decoration.
 *
 * Every check runs through `resolveYear`, the same function the tick calls,
 * so a rule that is right on paper and never applied fails here.
 */
import { describe, it, expect } from "vitest";
import { resolveYear as resolveWithNews } from "@shared/simulation/resolve";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { cleanDecision, defaultDraft, validateDecision, LEVER_FIELDS } from "@shared/simulation/levers";
import {
  BOND_DISCOUNT, BOND_TERM, UNLOCKS, annualPlans, buildCostPerUnit, forecastOutcome, isUnlocked, leaseCostPerUnit,
  paidBy, seatAllowances, takings,
} from "@shared/simulation/responsibilities";
import { ROLES, type Company, type World } from "@shared/simulation/types";
import { interestOn } from "@shared/simulation/finance";

const niche = nicheById("dating_apps")!;
const team = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  cash: 20_000_000,
  ...over,
});
const world = (c: Company, year = 5): World => ({
  seasonId: "resp", niche, year,
  economy: { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" },
  companies: [...seedIncumbents(niche), c],
});
const plain = (over: any = {}) => ({
  companyId: "t",
  cmo: { price: 55, brandSpend: 400_000, performanceSpend: 300_000, celebritySpend: 0, targetCities: [], ...over.cmo },
  cto: { featureSpend: 300_000, reliabilitySpend: 200_000, techDebtPaydown: 0, ...over.cto },
  coo: { capacityTarget: 400_000, supportSpend: 300_000, efficiencySpend: 0, headcount: 4, ...over.coo },
  cfo: { borrow: 0, repay: 0, cashBuffer: 0, ...over.cfo },
  ceo: { focus: "growth", ...over.ceo },
});
const held = { swipers: 200_000, recently_single: 120_000, long_haulers: 40_000 };
/** The year without its news: an event landing on one variant and not another would decide these comparisons. */
const resolveYear = (w: World, d: any[]) => resolveWithNews(w, d, undefined, { withoutEvent: true });
/** Room for everyone, so a comparison is about the lever and not about who was turned away. */
const roomy = { coo: { capacityTarget: 900_000 } };
const report = (r: any) => r.reports.find((x: any) => x.companyId === "t");
const after = (r: any) => r.world.companies.find((x: any) => x.id === "t") as Company;

describe("the schedule", () => {
  it("gives every seat something new, and never more than two things in one year", () => {
    const byYearSeat = new Map<string, number>();
    for (const u of UNLOCKS) {
      const key = `${u.year}:${u.role}`;
      byYearSeat.set(key, (byYearSeat.get(key) ?? 0) + 1);
    }
    // holdBack and holdBackSeat are one decision drawn as two controls.
    for (const [key, n] of byYearSeat) expect(n, key).toBeLessThanOrEqual(key.endsWith("cfo") ? 3 : 2);
    for (const role of ["ceo", "cmo", "cfo", "coo"] as const) {
      expect(UNLOCKS.some((u) => u.role === role), role).toBe(true);
    }
  });

  it("names only levers that exist", () => {
    for (const u of UNLOCKS) {
      expect(LEVER_FIELDS[u.role].some((f) => f.id === u.field), `${u.role}.${u.field}`).toBe(true);
    }
  });

  it("will not take a lever before it arrives", () => {
    expect(isUnlocked("cmo", "tiers", 2)).toBe(false);
    expect(isUnlocked("cmo", "tiers", 3)).toBe(true);
    const early = cleanDecision("cmo", { price: 40, tiers: { swipers: 0 } }, [], { year: 2, segmentIds: ["swipers"] });
    expect(early.tiers, "filed a year early, and dropped").toBeUndefined();
    const onTime = cleanDecision("cmo", { price: 40, tiers: { swipers: 0, made_up: 5 } }, [], { year: 3, segmentIds: ["swipers"] });
    expect(onTime.tiers, "and only for segments that exist").toEqual({ swipers: 0 });
  });
});

describe("capacity: build, lease, sell", () => {
  it("prices leasing 40% above building, in this market's money", () => {
    for (const n of NICHES) expect(leaseCostPerUnit(n) / buildCostPerUnit(n)).toBeCloseTo(1.4, 6);
  });

  it("charges for building in the year it is ordered, and opens it next year", () => {
    const c = team({ capacity: 300_000, customers: held });
    const r = resolveYear(world(c), [plain({ coo: { capacityTarget: 400_000 } })]);
    expect(report(r).pnl.capacity).toBeCloseTo(100_000 * buildCostPerUnit(niche), 0);
    expect(after(r).capacity).toBe(400_000);
  });

  /*
   * The trade: leased room serves customers this year that built room could
   * not reach until next — worth it when the company is full, and pure cost
   * when it is not.
   */
  it("pays for itself when the company is turning people away, and not when it has room", () => {
    const full = team({ capacity: 250_000, customers: held });
    const base = resolveYear(world(full), [plain({ coo: { capacityTarget: 250_000 } })]);
    const leased = resolveYear(world(full), [plain({ coo: { capacityTarget: 250_000, leaseCapacity: 150_000 } })]);
    expect(report(base).turnedAway, "the full company is turning people away").toBeGreaterThan(0);
    expect(report(leased).customers).toBeGreaterThan(report(base).customers);
    expect(report(leased).profit, "the lease earned more than it cost").toBeGreaterThan(report(base).profit);

    const roomy = team({ capacity: 900_000, customers: held });
    const idle = resolveYear(world(roomy), [plain({ coo: { capacityTarget: 900_000 } })]);
    const wasted = resolveYear(world(roomy), [plain({ coo: { capacityTarget: 900_000, leaseCapacity: 150_000 } })]);
    expect(report(wasted).profit, "leasing room nobody needs is a cost").toBeLessThan(report(idle).profit);
  });

  it("gives some money back for room given up, never all of it", () => {
    const c = team({ capacity: 800_000, customers: held });
    const r = resolveYear(world(c), [plain({ coo: { capacityTarget: 500_000 } })]);
    const sold = report(r).cashBridge.lines.find((l: any) => /sold back/i.test(l.label))?.amount ?? 0;
    expect(sold).toBeGreaterThan(0);
    expect(sold).toBeLessThan(300_000 * buildCostPerUnit(niche));
  });

  it("builds less when the money is not there, rather than building on credit it cannot have", () => {
    const poor = team({ cash: 200_000, creditLimit: 0, capacity: 300_000, customers: held });
    const r = resolveYear(world(poor), [plain({ coo: { capacityTarget: 3_000_000 } })]);
    expect(after(r).capacity).toBeLessThan(3_000_000);
  });
});

describe("price tiers", () => {
  it("bill exactly as before for a company that never touches them", () => {
    const c = team({ price: 55 });
    const t = takings(c, held, niche.segments);
    expect(t.revenue).toBeCloseTo(55 * 360_000, 6);
    expect(t.leaked).toBe(0);
  });

  it("leak: the further a tier sits above the cheapest, the more of it pays less", () => {
    const narrow = paidBy({ price: 60, tiers: { long_haulers: 80 } }, { id: "long_haulers" }, 60);
    const wide = paidBy({ price: 40, tiers: { long_haulers: 200 } }, { id: "long_haulers" }, 40);
    expect(narrow / 80).toBeGreaterThan(wide / 200);
  });

  /*
   * The trade: segments pay very different amounts, so a sensible set of
   * tiers earns more than one price; but a premium pushed far above the rest
   * mostly leaks, and a free tier drags every paying tier towards nothing.
   */
  it("earn more when set near what each segment pays, and less when pushed to extremes", () => {
    const c = team({ customers: held, capacity: 900_000 });
    const one = resolveYear(world(c), [plain({ ...roomy, cmo: { price: 60 } })]);
    const sensible = resolveYear(world(c), [plain({ ...roomy, cmo: { price: 60, tiers: { recently_single: 75, long_haulers: 150 } } })]);
    const greedy = resolveYear(world(c), [plain({ ...roomy, cmo: { price: 60, tiers: { recently_single: 75, long_haulers: 900 } } })]);
    const free = resolveYear(world(c), [plain({ ...roomy, cmo: { price: 60, tiers: { swipers: 0, recently_single: 75, long_haulers: 150 } } })]);
    expect(report(sensible).revenue, "tiers near what each pays beat one price").toBeGreaterThan(report(one).revenue);
    expect(report(greedy).revenue, "a premium nobody will pay loses the segment").toBeLessThan(report(sensible).revenue);
    expect(report(free).revenue, "a free tier costs the paying ones").toBeLessThan(report(sensible).revenue);
    expect(report(free).customers, "and buys a crowd").toBeGreaterThan(report(sensible).customers);
  });

  it("are what each segment judges the company on", () => {
    const c = team({ customers: held, capacity: 900_000 });
    const cheap = resolveYear(world(c), [plain({ cmo: { price: 60, tiers: { swipers: 25 } } })]);
    const dear = resolveYear(world(c), [plain({ cmo: { price: 60, tiers: { swipers: 90 } } })]);
    const swipers = (r: any) => after(r).customers.swipers ?? 0;
    expect(swipers(cheap)).toBeGreaterThan(swipers(dear));
  });
});

describe("the forecast", () => {
  it("saves money when it is right, costs it when it is badly wrong, and is neutral in between", () => {
    expect(forecastOutcome(100_000, 105_000, 1_000_000)!.effect).toBeGreaterThan(0);
    expect(forecastOutcome(100_000, 115_000, 1_000_000)!.effect).toBe(0);
    expect(forecastOutcome(100_000, 60_000, 1_000_000)!.effect).toBeLessThan(0);
    expect(forecastOutcome(100_000, 160_000, 1_000_000)!.effect).toBeLessThan(0);
    expect(forecastOutcome(undefined, 160_000, 1_000_000)).toBeNull();
  });

  it("caps what a wild guess can cost, so it stings rather than ends a season", () => {
    expect(forecastOutcome(1, 10_000_000, 1_000_000)!.effect).toBeGreaterThanOrEqual(-80_000);
  });

  it("reaches the year's profit and says whose number it was", () => {
    const c = team({ customers: held, capacity: 900_000 });
    const base = resolveYear(world(c), [plain()]);
    const actual = report(base).customers;
    const good = resolveYear(world(c), [plain({ cmo: { forecast: actual } })]);
    const bad = resolveYear(world(c), [plain({ cmo: { forecast: actual * 3 } })]);
    expect(report(good).profit).toBeGreaterThan(report(base).profit);
    expect(report(bad).profit).toBeLessThan(report(base).profit);
    expect(report(bad).notes.join(" ")).toMatch(/marketing seat forecast/i);
  });
});

describe("the budget split and the hold-back", () => {
  it("cuts a seat to its share, leaves a seat under it alone, and moves nothing between them", () => {
    const out = seatAllowances({
      wanted: { cmo: 6_000_000, cto: 1_000_000, coo: 1_000_000 },
      budget: { cmo: 30, cto: 30, coo: 30 },
      spendable: 10_000_000,
    });
    expect(out.factor.cmo).toBeCloseTo(0.5, 6);
    expect(out.factor.cto).toBe(1);
    expect(out.capped).toEqual(["cmo"]);
  });

  it("caps nobody when no split is filed", () => {
    const out = seatAllowances({ wanted: { cmo: 9e9, cto: 9e9, coo: 9e9 }, budget: {}, spendable: 1 });
    expect(out.factor).toEqual({ cmo: 1, cto: 1, coo: 1 });
  });

  it("cuts what a capped seat buys, not only what it is charged", () => {
    const c = team({ customers: held, capacity: 900_000, brand: 30 });
    const free = resolveYear(world(c), [plain({ cmo: { brandSpend: 4_000_000 } })]);
    const capped = resolveYear(world(c), [plain({ cmo: { brandSpend: 4_000_000 }, ceo: { budget: { cmo: 2, cto: 40, coo: 40 } } })]);
    expect(report(capped).pnl.marketing).toBeLessThan(report(free).pnl.marketing);
    expect(after(capped).brand, "less marketing bought less brand").toBeLessThan(after(free).brand);
    expect(report(capped).notes.join(" ")).toMatch(/chief executive's split/i);
  });

  it("holds back only up to a fifth, from whoever finance names, and says it was finance", () => {
    const out = seatAllowances({ wanted: { cmo: 100, cto: 100, coo: 100 }, spendable: 1e9, holdBack: 50, holdBackSeat: "cto" });
    expect(out.factor.cto).toBeCloseTo(0.8, 6);
    expect(out.factor.cmo).toBe(1);
    const c = team({ customers: held, capacity: 900_000 });
    const r = resolveYear(world(c), [plain({ cfo: { holdBack: 10, holdBackSeat: "all" } })]);
    expect(report(r).notes.join(" ")).toMatch(/chief financial officer held back 10%/i);
  });

  it("refuses a split that adds up to more than everything", () => {
    const check = validateDecision("ceo", { focus: "growth", budget: { cmo: 60, cto: 60 } }, team());
    expect(check.ok).toBe(false);
    expect(check.errors.budget).toMatch(/120%/);
  });
});

describe("annual plans", () => {
  it("cost revenue on everyone who takes them, and buy customers who stay", () => {
    const none = annualPlans(0);
    const some = annualPlans(15);
    expect(none).toEqual({ uptake: 0, revenueFactor: 1, retention: 0 });
    expect(some.revenueFactor).toBeLessThan(1);
    expect(some.retention).toBeGreaterThan(0);
  });

  /*
   * The trade: worth most where people leave most. Against a strong rival,
   * the plans hold customers the company would otherwise have lost; the
   * discount is the price of that.
   */
  it("keep more customers when a rival is pulling them away", () => {
    const weak = team({ customers: held, capacity: 900_000, quality: 20, brand: 15, service: 20 });
    const without = resolveYear(world(weak), [plain(roomy)]);
    const withPlans = resolveYear(world(weak), [plain({ ...roomy, cfo: { annualDiscount: 20 } })]);
    expect(report(withPlans).customers).toBeGreaterThan(report(without).customers);
  });

  it("bring cash in early, and give it back as revenue next year that brings none", () => {
    const c = team({ customers: held, capacity: 900_000 });
    const y1 = resolveYear(world(c), [plain({ cfo: { annualDiscount: 20 } })]);
    const early = report(y1).cashBridge.lines.find((l: any) => /paid up front$/i.test(l.label))?.amount ?? 0;
    expect(early).toBeGreaterThan(0);
    const y2 = resolveYear({ ...y1.world, year: 6 }, [plain()]);
    const owed = report(y2).cashBridge.lines.find((l: any) => /paid up front last year/i.test(l.label))?.amount ?? 0;
    expect(owed).toBeCloseTo(-early, 0);
  });
});

describe("borrowing on terms", () => {
  it("is cheaper than the line on the day it is taken, and fixed for three years", () => {
    const c = team({ customers: held, capacity: 900_000, creditLimit: 50_000_000 });
    const long = resolveYear(world(c), [plain({ cfo: { borrow: 5_000_000, borrowTerm: "long" } })]);
    const bonds = after(long).bonds ?? [];
    expect(bonds).toHaveLength(1);
    expect(bonds[0].maturesYear).toBe(5 + BOND_TERM);
    const lineThatDay = interestOn(c, 0.06).rate;
    expect(bonds[0].rate).toBeCloseTo(lineThatDay - BOND_DISCOUNT, 6);
  });

  /*
   * The trade, both ways: fixed is a bet on the rating. A company whose
   * rating falls is glad it locked in; one whose rating climbs would have
   * borrowed cheaper on the line by next year.
   */
  it("holds its rate while the line moves with the rating", () => {
    const bonded = team({ debt: 5_000_000, creditScore: 20, bonds: [{ amount: 5_000_000, rate: 0.08, maturesYear: 9 }] });
    const onLine = team({ debt: 5_000_000, creditScore: 20 });
    expect(interestOn(bonded, 0.06).interest, "rating fell: the fixed loan is the cheap one").toBeLessThan(interestOn(onLine, 0.06).interest);
    const bondedHigh = { ...bonded, creditScore: 95 };
    const onLineHigh = { ...onLine, creditScore: 95 };
    expect(interestOn(bondedHigh, 0.06).interest, "rating rose: the line would have been cheaper").toBeGreaterThan(interestOn(onLineHigh, 0.06).interest);
  });

  it("cannot be repaid early, and is repaid from cash when it matures", () => {
    const c = team({ customers: held, capacity: 900_000, debt: 3_000_000, bonds: [{ amount: 3_000_000, rate: 0.06, maturesYear: 7 }] });
    const early = resolveYear(world(c, 5), [plain({ cfo: { repay: 3_000_000 } })]);
    expect(after(early).debt, "the repayment could not touch it").toBeCloseTo(3_000_000, 0);
    const due = resolveYear(world(c, 7), [plain()]);
    expect(after(due).debt).toBeCloseTo(0, 0);
    expect(after(due).bonds ?? []).toHaveLength(0);
  });

  it("marks the company down when profit stops covering the interest", () => {
    const c = team({ customers: {}, capacity: 900_000, debt: 30_000_000, creditScore: 60, bonds: [{ amount: 30_000_000, rate: 0.08, maturesYear: 9 }] });
    // Selling at almost nothing: a year that cannot cover 2.4m of interest.
    const r = resolveYear(world(c), [plain({ cmo: { price: 2 } })]);
    expect(report(r).notes.join(" ")).toMatch(/covenant was broken/i);
    expect(after(r).bonds![0].rate).toBeGreaterThan(0.08);
  });
});

describe("borrowing is bounded by the line", () => {
  it("draws no more than the bank will lend, and counts the draw once", () => {
    const c = team({ creditLimit: 2_000_000, debt: 0, customers: held, capacity: 900_000 });
    const r = resolveYear(world(c), [plain({ ...roomy, cfo: { borrow: 50_000_000 } })]);
    expect(after(r).debt).toBeCloseTo(2_000_000, 0);
    expect(validateDecision("cfo", { borrow: 50_000_000, repay: 0, cashBuffer: 0 }, c).errors.borrow).toMatch(/at most 2,000,000/);
    expect(validateDecision("cfo", { borrow: 2_000_000, repay: 0, cashBuffer: 0 }, c).ok).toBe(true);
  });

  it("does not carry last year's raise into this year's draft", () => {
    expect(defaultDraft("cfo", team(), { borrow: 1, repay: 1, cashBuffer: 5, raiseAmount: 3_000_000 }).raiseAmount).toBe(0);
  });
});
