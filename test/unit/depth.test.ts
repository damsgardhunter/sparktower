/**
 * The depth: regions with a character and a split of the marketing between
 * them, a plant that can be automated, worked harder or stocked ahead, and a
 * balance sheet the finance seat can actually move.
 *
 * Same promise as every other responsibility — a setting where it helps and
 * one where it hurts — and the same rule at the top: a company that touches
 * none of it plays exactly as it did.
 */
import { describe, it, expect } from "vitest";
import { resolveYear as resolveWithNews } from "@shared/simulation/resolve";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { regionWeights, regionalFit, regionalReach, segmentPush } from "@shared/simulation/market";
import {
  AUTOMATION_RATE, SHIFT_MAX, automationEffect, automationNext, shiftCapacity, sourcingOf, stockCost,
} from "@shared/simulation/factory";
import {
  BUYBACK_PREMIUM, FACTOR_DISCOUNT, REFINANCE_TERM_YEARS, buyback, factoring, refinance, termsOf,
} from "@shared/simulation/treasury";
import { buildCostPerUnit } from "@shared/simulation/responsibilities";
import { ROLES, type Company, type World } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const held = { swipers: 200_000, recently_single: 120_000, long_haulers: 40_000 };
const everywhere = niche.cities.map((c) => c.id);
const team = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  cash: 30_000_000, customers: held, capacity: 900_000, cities: everywhere,
  ...over,
});
const world = (c: Company, year = 8): World => ({
  seasonId: "depth", niche, year,
  economy: { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" },
  companies: [...seedIncumbents(niche), c],
});
const plain = (over: any = {}) => ({
  companyId: "t",
  cmo: { price: 55, brandSpend: 400_000, performanceSpend: 300_000, celebritySpend: 0, targetCities: everywhere, ...over.cmo },
  cto: { featureSpend: 400_000, reliabilitySpend: 200_000, techDebtPaydown: 0, ...over.cto },
  coo: { capacityTarget: 900_000, supportSpend: 300_000, efficiencySpend: 0, headcount: 20, ...over.coo },
  cfo: { borrow: 0, repay: 0, cashBuffer: 0, ...over.cfo },
  ceo: { focus: "growth", ...over.ceo },
});
const resolveYear = (w: World, d: any[]) => resolveWithNews(w, d, undefined, { withoutEvent: true });
const report = (r: any) => r.reports.find((x: any) => x.companyId === "t");
const after = (r: any) => r.world.companies.find((x: any) => x.id === "t") as Company;

describe("a company that touches none of the depth", () => {
  it("reaches and is judged exactly as before", () => {
    const c = team();
    expect(regionalReach(c, niche)).toBeCloseTo(1, 6);
    for (const s of niche.segments) {
      expect(regionalFit(c, niche, s.id), s.id).toBeCloseTo(1, 6);
      expect(segmentPush(c, niche, s.id), s.id).toBe(1);
    }
    expect(termsOf(undefined)).toEqual({ days: 0, appeal: 1, deferred: 0 });
    expect(automationEffect(0)).toEqual({ unitCost: 1, buildCost: 1, product: 1 });
    expect(sourcingOf(undefined)).toEqual({ fixed: 1, unitCost: 1, quality: 0 });
  });
});

describe("regions", () => {
  it("gives every market ten, weighted to one, each with a character", () => {
    for (const n of NICHES) {
      expect(n.cities.length, n.id).toBe(10);
      expect(n.cities.reduce((sum, c) => sum + c.weight, 0), n.id).toBeCloseTo(1, 6);
      for (const c of n.cities) {
        expect(Object.keys(c.mix ?? {}).sort(), `${n.id}/${c.id}`).toEqual(n.segments.map((s) => s.id).sort());
      }
    }
  });

  it("makes the biggest region in each market the one with no character at all", () => {
    for (const n of NICHES) {
      const biggest = [...n.cities].sort((a, b) => b.weight - a.weight)[0];
      expect(Object.values(biggest.mix ?? {}), n.id).toEqual(n.segments.map(() => 1));
    }
  });

  /*
   * The trade: selling where your people are is worth something, and a
   * company that sells everywhere is worth exactly the market average — which
   * is what keeps the character a nudge rather than a tax on national play.
   */
  it("rewards selling where your customers actually are", () => {
    const loyal = [...niche.cities].sort((a, b) => (b.mix?.long_haulers ?? 1) - (a.mix?.long_haulers ?? 1))[0];
    const focused = team({ cities: [loyal.id] });
    expect(regionalFit(focused, niche, "long_haulers")).toBeGreaterThan(1);
    expect(regionalFit(focused, niche, "swipers")).toBeLessThan(1);
  });

  it("lets the marketing seat push into a region, at the cost of the others", () => {
    const c = team({ cities: ["london", "leeds"], regionFocus: { leeds: 80 } });
    const weights = regionWeights(c, niche);
    const even = regionWeights(team({ cities: ["london", "leeds"] }), niche);
    expect(weights.get("leeds")!).toBeGreaterThan(even.get("leeds")!);
    expect(weights.get("london")!).toBeLessThan(even.get("london")!);
    // Concentration, not free reach: what one region gains the other loses.
    expect(regionalReach(c, niche)).toBeLessThan(regionalReach(team({ cities: everywhere }), niche));
  });

  it("pushes at a segment the same way", () => {
    const aimed = team({ segmentFocus: { long_haulers: 70 } });
    expect(segmentPush(aimed, niche, "long_haulers")).toBeGreaterThan(1);
    expect(segmentPush(aimed, niche, "swipers")).toBeLessThan(1);
  });

  it("reaches the market through the engine: aiming at a segment wins more of it", () => {
    const c = team({ capacity: 2_000_000 });
    const spread = resolveYear(world(c), [plain({ coo: { capacityTarget: 2_000_000 } })]);
    const aimed = resolveYear(world(c), [plain({ coo: { capacityTarget: 2_000_000 }, cmo: { segmentFocus: { long_haulers: 80 } } })]);
    expect(after(aimed).customers.long_haulers).toBeGreaterThan(after(spread).customers.long_haulers);
    expect(after(aimed).customers.swipers).toBeLessThan(after(spread).customers.swipers);
  });
});

describe("the plant", () => {
  it("automates next year, not this one, and a cut is immediate", () => {
    expect(automationNext(0, 60)).toEqual({ now: 0, next: 60, building: 60 });
    expect(automationNext(60, 20)).toEqual({ now: 20, next: 20, building: 0 });
  });

  /*
   * The trade: cheaper to make, dearer to build, and slower to change what
   * you make.
   */
  it("makes every unit cheaper and the company harder to change", () => {
    const full = automationEffect(100);
    expect(full.unitCost).toBeLessThan(1);
    expect(full.buildCost).toBeGreaterThan(1);
    expect(full.product).toBeLessThan(1);
  });

  it("is charged when ordered and lands the year after, through the engine", () => {
    const c = team({ automation: 0 });
    const ordering = resolveYear(world(c), [plain({ coo: { automationTarget: 50 } })]);
    const not = resolveYear(world(c), [plain()]);
    /*
     * On the operations line, not the capacity line: `ops` is what carries
     * the plant, and the capacity line is room. It used to be counted in
     * both, which is why the accounts did not add up — see "the accounts".
     */
    expect(report(ordering).pnl.operations - report(not).pnl.operations)
      .toBeCloseTo(50 * c.capacity * buildCostPerUnit(niche) * AUTOMATION_RATE, 0);
    expect(after(ordering).automation).toBe(50);
    expect(after(ordering).unitCost, "not this year").toBeCloseTo(after(not).unitCost, 6);

    const later = resolveYear({ ...ordering.world, year: 9 }, [plain({ coo: { automationTarget: 50 } })]);
    const laterNot = resolveYear({ ...not.world, year: 9 }, [plain()]);
    expect(after(later).unitCost).toBeLessThan(after(laterNot).unitCost);
  });

  it("runs a second shift for room now, at a price and at the cost of service", () => {
    const full = team({ capacity: 250_000, customers: held });
    const shift = shiftCapacity({ capacity: 250_000, requested: 500_000, niche });
    expect(shift.units, "half as much again, at most").toBe(250_000 * SHIFT_MAX);
    expect(shift.service).toBeGreaterThan(0);

    const worked = resolveYear(world(full), [plain({ coo: { capacityTarget: 250_000, shiftCapacity: 100_000 } })]);
    const idle = resolveYear(world(full), [plain({ coo: { capacityTarget: 250_000 } })]);
    expect(report(worked).customers).toBeGreaterThan(report(idle).customers);
    expect(after(worked).service).toBeLessThan(after(idle).service);
  });

  it("holds stock that serves next year's overflow, and costs whether or not it is needed", () => {
    expect(stockCost(10_000, niche)).toBeGreaterThan(0);
    const c = team({ capacity: 250_000 });
    const stocked = resolveYear(world(c), [plain({ coo: { capacityTarget: 250_000, stockTarget: 50_000 } })]);
    expect(after(stocked).stock).toBe(50_000);
    const next = resolveYear({ ...stocked.world, year: 9 }, [plain({ coo: { capacityTarget: 250_000 } })]);
    const without = resolveYear({ ...resolveYear(world(c), [plain({ coo: { capacityTarget: 250_000 } })]).world, year: 9 }, [plain({ coo: { capacityTarget: 250_000 } })]);
    expect(report(next).customers).toBeGreaterThan(report(without).customers);
  });

  it("trades a fixed cost for a variable one when the work is bought in", () => {
    const c = team();
    const bought = resolveYear(world(c), [plain({ coo: { sourcing: "outsourced" } })]);
    const made = resolveYear(world(c), [plain({ coo: { sourcing: "in_house" } })]);
    expect(report(bought).pnl.salaries).toBeLessThan(report(made).pnl.salaries);
    expect(after(bought).unitCost).toBeGreaterThan(after(made).unitCost);
    expect(after(bought).quality).toBeLessThan(after(made).quality);
  });
});

describe("the balance sheet", () => {
  it("wins business with longer terms, and waits for the money", () => {
    expect(termsOf(90).appeal).toBeGreaterThan(termsOf(30).appeal);
    expect(termsOf(90).deferred).toBeCloseTo(90 / 365, 6);

    // Room to take the extra business, or terms buy customers there is nowhere to put.
    const c = team({ capacity: 2_000_000 });
    const roomy = { coo: { capacityTarget: 2_000_000 } };
    const patient = resolveYear(world(c), [plain({ ...roomy, cfo: { terms: 90 } })]);
    const cash = resolveYear(world(c), [plain({ ...roomy, cfo: { terms: 0 } })]);
    expect(report(patient).customers, "easier to buy from").toBeGreaterThan(report(cash).customers);
    expect(after(patient).receivables!).toBeGreaterThan(0);
    expect(after(patient).cash, "and the money has not arrived").toBeLessThan(after(cash).cash);

    // It arrives the year after, whether or not anything else happens.
    const collected = resolveYear({ ...patient.world, year: 9 }, [plain({ ...roomy, cfo: { terms: 0 } })]);
    expect(report(collected).cashBridge.lines.some((l: any) => /Collected from last year/.test(l.label))).toBe(true);
  });

  it("sells what it is owed for cash today, at a price", () => {
    expect(factoring({ receivables: 1_000_000, share: 50 })).toEqual({ sold: 500_000, cash: 500_000 * (1 - FACTOR_DISCOUNT), cost: 500_000 * FACTOR_DISCOUNT });
    const c = team();
    const sold = resolveYear(world(c), [plain({ cfo: { terms: 90, factorPct: 100 } })]);
    const kept = resolveYear(world(c), [plain({ cfo: { terms: 90 } })]);
    expect(after(sold).cash).toBeGreaterThan(after(kept).cash);
    expect(after(sold).receivables).toBe(0);
    expect(report(sold).notes.join(" ")).toMatch(/factor/i);
  });

  it("moves the credit line onto fixed terms for a fee", () => {
    const out = refinance({ onLine: 5_000_000, amount: 9_000_000, rate: 0.07, year: 8, term: REFINANCE_TERM_YEARS });
    expect(out.moved, "never more than is on the line").toBe(5_000_000);
    expect(out.bond).toMatchObject({ amount: 5_000_000, rate: 0.07, maturesYear: 11 });

    const c = team({ debt: 4_000_000 });
    const moved = resolveYear(world(c), [plain({ cfo: { refinance: 4_000_000 } })]);
    expect(after(moved).bonds!).toHaveLength(1);
    expect(report(moved).notes.join(" ")).toMatch(/off the credit line/i);
  });

  it("buys the company back at a premium, and never with money it does not have", () => {
    // A point of a ten-million company costs 115,000 at the premium, so 1.15m buys ten of them.
    const out = buyback({ spend: 1_150_000, worth: 10_000_000, founderShare: 0.5 });
    expect(out.bought).toBeCloseTo(0.1, 6);
    expect(out.paid).toBeCloseTo(1_150_000, 6);
    expect(buyback({ spend: 99_000_000, worth: 10_000_000, founderShare: 0.5 }).bought, "never more than they own").toBeCloseTo(0.5, 6);
    expect(buyback({ spend: 1_000_000, worth: 10_000_000, founderShare: 1 }).paid, "nothing to buy").toBe(0);

    const c = team({ founderShare: 0.6 });
    const back = resolveYear(world(c), [plain({ cfo: { buyback: 5_000_000 } })]);
    expect(after(back).founderShare).toBeGreaterThan(0.6);
    expect(report(back).notes.join(" ")).toMatch(/Bought back/);

    /*
     * And it is bounded by the money actually there when it is paid. A company
     * that asks to buy back fifty million with nothing in the bank buys what
     * the year left it and not a pound more — it does not go into the red to
     * buy its own shares, which is the one thing a board would never allow.
     */
    const thin = team({ founderShare: 0.6, cash: 0, creditLimit: 0, customers: {}, cities: ["leeds"] });
    const bounded = resolveYear(world(thin), [plain({ cfo: { buyback: 50_000_000 } })]);
    expect(after(bounded).cash).toBeGreaterThanOrEqual(0);
    expect(after(bounded).founderShare).toBeLessThanOrEqual(1);
  });
});

/**
 * The accounts have to add up.
 *
 * "The accounts" on the report screen is a column of cost lines under the
 * sales figure and a profit at the bottom. A person reading it will add the
 * column up — that is what a column of numbers is for — and if the total does
 * not reach the profit printed underneath it, the report is not a report, it
 * is a decoration. So the engine's own `pnl` has to be an identity, and every
 * line of it has to be on the screen.
 */
describe("the accounts", () => {
  const lines = [
    "costToServe", "salaries", "marketing", "product", "operations",
    "capacity", "incidents", "partners", "insurance", "idleCapacity", "interest",
  ] as const;

  it("reconcile: sales, less every cost line, plus planning, is the profit", () => {
    // A year that touches everything the accounts have a line for.
    // Debt from the start, because interest is paid from the year after it is drawn.
    const r = resolveYear(world(team({ automation: 0, debt: 5_000_000 })), [plain({
      coo: { capacityTarget: 1_100_000, supportSpend: 300_000, efficiencySpend: 120_000, headcount: 20,
             automationTarget: 20, shiftCapacity: 50_000, stockTarget: 40_000 },
      cmo: { forecast: 250_000 },
      cfo: { borrow: 0, repay: 0, cashBuffer: 0, insurance: "breach" },
    })]);
    const p = report(r).pnl;

    const costs = lines.reduce((sum, k) => sum + (p[k] ?? 0), 0);
    expect(p.revenue - costs + p.planning).toBeCloseTo(p.operatingProfit, 2);

    // And every one of them was actually exercised, or the identity proves nothing.
    for (const k of ["costToServe", "salaries", "marketing", "product", "operations", "capacity", "insurance", "interest"]) {
      expect(p[k], `${k} should not be zero in a year that bought it`).toBeGreaterThan(0);
    }
  });

  it("counts the plant once: it is operations spending, not capacity", () => {
    /*
     * `ops` already includes the plant (automation, a second shift, stock), so
     * putting the plant into the capacity line as well charged the company for
     * it twice on the screen while the profit below counted it once.
     */
    const bare = resolveYear(world(team({ automation: 0 })), [plain()]);
    const withPlant = resolveYear(world(team({ automation: 0 })), [plain({
      coo: { capacityTarget: 900_000, supportSpend: 300_000, efficiencySpend: 0, headcount: 20,
             automationTarget: 30, shiftCapacity: 60_000, stockTarget: 50_000 },
    })]);

    expect(withPlant && report(withPlant).pnl.operations)
      .toBeGreaterThan(report(bare).pnl.operations);
    // Buying a plant does not move the capacity line: that line is room, not machines.
    expect(report(withPlant).pnl.capacity).toBeCloseTo(report(bare).pnl.capacity, 2);
  });
});
