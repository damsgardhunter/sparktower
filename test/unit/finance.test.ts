/**
 * Money with strings attached: the rating, and the investors' board.
 *
 * The emergency loan is tested where running out of money is
 * (`simulation.test.ts`). These pin the other two — each once as a rule and
 * once through the engine, because a rule the engine never applies is a
 * promise with nobody keeping it.
 */
import { describe, it, expect } from "vitest";
import {
  RATING_START, STRIKES_TO_REMOVE, creditMultiplier, justifiedRating, nextRating,
  ratingGrade, reviewInvestors, spreadFor, termsFor, type Investors,
} from "@shared/simulation/finance";
import { resolveYear } from "@shared/simulation/resolve";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type World } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const team = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  ...over,
});
const world = (c: Company, year = 1): World => ({
  seasonId: "s", niche, year,
  economy: { demand: 1, interestRate: 0.06, costIndex: 1, outlook: "steady" },
  companies: [...seedIncumbents(niche), c],
});
const plain = (over: any = {}) => ({
  companyId: "t",
  cmo: { price: 40, brandSpend: 0, performanceSpend: 0, celebritySpend: 0, targetCities: [], ...over.cmo },
  cto: { featureSpend: 0, reliabilitySpend: 0, techDebtPaydown: 0, ...over.cto },
  coo: { capacityTarget: 90_000, supportSpend: 0, efficiencySpend: 0, headcount: 0, ...over.coo },
  cfo: { borrow: 0, repay: 0, cashBuffer: 0, ...over.cfo },
  ceo: { focus: "growth", ...over.ceo },
});
const t = (r: any) => r.reports.find((x: any) => x.companyId === "t");
const after = (r: any) => r.world.companies.find((x: any) => x.id === "t") as Company;

describe("the credit rating", () => {
  it("speaks in the letters a bank would use", () => {
    expect(ratingGrade(90)).toBe("AAA");
    expect(ratingGrade(RATING_START)).toBe("BB");
    expect(ratingGrade(10)).toBe("D");
  });

  it("makes borrowing dearer the worse the rating, and never free", () => {
    expect(spreadFor(100)).toBeGreaterThan(0);
    expect(spreadFor(20)).toBeGreaterThan(spreadFor(50));
    expect(spreadFor(50)).toBeGreaterThan(spreadFor(80));
  });

  it("lets a well-rated company borrow more", () => {
    expect(creditMultiplier(90)).toBeGreaterThan(creditMultiplier(30));
  });

  it("rewards profit and punishes debt", () => {
    const base = { revenue: 10_000_000, debt: 1_000_000, cash: 2_000_000, fixedCosts: 1_000_000, rescued: false };
    expect(justifiedRating({ ...base, profit: 2_000_000 })).toBeGreaterThan(justifiedRating({ ...base, profit: -2_000_000 }));
    expect(justifiedRating({ ...base, profit: 0, debt: 0 })).toBeGreaterThan(justifiedRating({ ...base, profit: 0, debt: 20_000_000 }));
  });

  it("marks a company down hard for needing to be rescued", () => {
    const base = { revenue: 5_000_000, profit: 0, debt: 1_000_000, cash: 0, fixedCosts: 1_000_000 };
    expect(justifiedRating({ ...base, rescued: true })).toBeLessThan(justifiedRating({ ...base, rescued: false }) - 20);
  });

  /*
   * A lender that re-rated on one year's figures would be panicking. The
   * rating moves towards what the numbers justify, a share of the way a year.
   */
  it("moves with profit, but does not lurch", () => {
    const next = nextRating(50, 100);
    expect(next).toBeGreaterThan(50);
    expect(next).toBeLessThan(100);
  });

  it("drifts up through the engine for a company that makes money", () => {
    const rich = resolveYear(world(team({ cash: 20_000_000, creditScore: 50, customers: { swipers: 60_000, recently_single: 20_000, long_haulers: 8_000 } })), [plain()]);
    const poor = resolveYear(world(team({ cash: 20_000_000, creditScore: 50 })), [plain({ cmo: { brandSpend: 6_000_000 } })]);
    expect(after(rich).creditScore!).toBeGreaterThan(after(poor).creditScore!);
    expect(t(rich).credit.grade).toBeTruthy();
  });

  it("charges interest at the company's own rate, not one rate for everybody", () => {
    const good = resolveYear(world(team({ debt: 2_000_000, creditScore: 90, cash: 5_000_000 })), [plain()]);
    const bad = resolveYear(world(team({ debt: 2_000_000, creditScore: 15, cash: 5_000_000 })), [plain()]);
    expect(t(bad).pnl.interest, "the same debt costs a poorly-rated company more").toBeGreaterThan(t(good).pnl.interest);
  });
});

describe("the investors' board", () => {
  const terms = (over: Partial<Investors> = {}): Investors => ({
    since: 1, raised: 2_000_000, target: 1_000_000, targetYear: 2, strikes: 0, inCharge: false, ...over,
  });

  it("sets a revenue target when a stake is sold", () => {
    const t = termsFor({ raised: 4_000_000, revenue: 2_000_000, year: 3 });
    expect(t.targetYear).toBe(4);
    expect(t.target, "growth plus a return on what they put in").toBeGreaterThan(2_000_000 * 1.25);
  });

  it("does not let new money buy a clean slate", () => {
    const existing = terms({ target: 9_000_000, targetYear: 4, strikes: 1 });
    const again = termsFor({ existing, raised: 1_000_000, revenue: 2_000_000, year: 3 });
    expect(again.target).toBeGreaterThanOrEqual(9_000_000);
    expect(again.strikes, "a strike survives a fresh raise").toBe(1);
  });

  it("says nothing in a year no target falls due", () => {
    const r = reviewInvestors(terms({ targetYear: 5 }), 100, 3);
    expect(r.note).toBeNull();
  });

  it("clears the strikes when a target is met", () => {
    const r = reviewInvestors(terms({ strikes: 1 }), 1_200_000, 2);
    expect(r.investors.strikes).toBe(0);
    expect(r.removed).toBe(false);
  });

  it("warns on the first miss and removes the chief executive on the second", () => {
    const first = reviewInvestors(terms(), 500_000, 2);
    expect(first.removed).toBe(false);
    expect(first.note).toMatch(/one more miss/i);

    const second = reviewInvestors(first.investors, 500_000, 3);
    expect(STRIKES_TO_REMOVE).toBe(2);
    expect(second.removed).toBe(true);
    expect(second.investors.inCharge).toBe(true);
  });

  /*
   * The removed chief executive is a real person with days of the season left.
   * Removal is a consequence they can recover from, not the end of their game.
   */
  it("gives the chair back the first year a target is met again", () => {
    const r = reviewInvestors(terms({ inCharge: true, strikes: 2 }), 2_000_000, 2);
    expect(r.reinstated).toBe(true);
    expect(r.investors.inCharge).toBe(false);
  });

  it("runs the chief executive's chair itself while it holds it", () => {
    const board = team({ investors: terms({ inCharge: true, targetYear: 9 }), positioning: "long_haulers" });
    // The removed chief executive files a margin focus; the board's growth focus stands instead.
    const r = resolveYear(world(board), [plain({ ceo: { focus: "margin" } })]);
    const notes = t(r).notes.join(" ");
    expect(notes, "the board's focus is the one applied").toMatch(/run for growth/i);
    expect(notes, "the removed chief executive's is not").not.toMatch(/run for margin/i);
  });

  it("records the terms through the engine when a stake is sold", () => {
    const r = resolveYear(world(team({ cash: 5_000_000 })), [plain({ cfo: { raiseAmount: 3_000_000 } })]);
    expect(after(r).investors?.targetYear).toBe(2);
    expect(t(r).notes.join(" ")).toMatch(/investors expect revenue/i);
  });
});
