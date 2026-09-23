/**
 * Borrowing is bounded by the credit line.
 *
 * The lever's help has always said so, and until this was fixed nothing
 * enforced it: validation only checked that `borrow` was a non-negative
 * number, and the engine added the whole of it to cash and to debt. A finance
 * seat filing fifty million against a two-million line funded forty million of
 * spending the bank never agreed to. These pin the three places that have to
 * agree — what a seat may file, what the desk previews, and what the year
 * actually does.
 */
import { describe, it, expect } from "vitest";
import { resolveYear } from "@shared/simulation/resolve";
import { validateDecision, commitment } from "@shared/simulation/levers";
import { startingCompany } from "@shared/simulation/season";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type Company, type World } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";

const niche = nicheById("dating_apps")!;
const economy = { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" as const };
const team = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] }),
  creditLimit: 2_000_000,
  debt: 500_000,
  ...over,
});
const world = (c: Company): World => ({ seasonId: "s", niche, year: 1, economy, companies: [...seedIncumbents(niche), c] });
const year = (borrow: number): TeamDecisions => ({
  companyId: "t",
  cmo: { price: 22, brandSpend: 600_000, performanceSpend: 600_000, celebritySpend: 0, targetCities: [] },
  cto: { featureSpend: 400_000, reliabilitySpend: 400_000, techDebtPaydown: 0 },
  coo: { capacityTarget: 2_000_000, supportSpend: 300_000, efficiencySpend: 0, headcount: 5 },
  cfo: { borrow, repay: 0, cashBuffer: 0 },
  ceo: { focus: "growth" },
} as any);

describe("what a finance seat may file", () => {
  it("allows borrowing up to the last pound of the line", () => {
    expect(validateDecision("cfo", { borrow: 1_500_000, repay: 0, cashBuffer: 0 }, team()).ok).toBe(true);
  });

  it("refuses a drawdown beyond what the bank will lend, and says how much is left", () => {
    const check = validateDecision("cfo", { borrow: 50_000_000, repay: 0, cashBuffer: 0 }, team());
    expect(check.ok).toBe(false);
    expect(check.errors.borrow).toMatch(/1,500,000/);
  });

  it("says so plainly when the line is used up", () => {
    const check = validateDecision("cfo", { borrow: 1, repay: 0, cashBuffer: 0 }, team({ debt: 2_000_000 }));
    expect(check.errors.borrow).toMatch(/fully drawn/i);
  });
});

describe("what the desk previews", () => {
  it("counts no more borrowing than the line allows", () => {
    const within = commitment(team(), year(1_500_000), economy, niche);
    const over = commitment(team(), year(50_000_000), economy, niche);
    expect(over.available).toBe(within.available);
  });
});

describe("what the year does", () => {
  it("lends only what the line allows, however much was asked for", () => {
    const within = resolveYear(world(team()), [year(1_500_000)]);
    const over = resolveYear(world(team()), [year(50_000_000)]);
    const a = within.world.companies.find((c) => c.id === "t")!;
    const b = over.world.companies.find((c) => c.id === "t")!;
    expect(b.debt).toBe(a.debt);
    expect(b.cash).toBe(a.cash);
    expect(b.debt).toBeLessThan(10_000_000);
  });
});
