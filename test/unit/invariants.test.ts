/**
 * Things that must be true after any year, however the year was played.
 *
 * Every other test here checks a claim about one mechanic. This one throws
 * thousands of deliberately awful decisions at the engine — negative spends,
 * absurd prices, missing seats, numbers as strings, whole seats left out — and
 * checks only that the world it hands back still makes sense.
 *
 * That is worth having because the bugs this catches are the ones nobody
 * writes a test for. A `NaN` from one bad input propagates silently through
 * every number on a company until a screen shows "£NaN" a week later; a
 * percentage that drifts past a hundred or below zero makes every comparison
 * against it meaningless. Neither shows up as a crash, and neither is anybody's
 * feature.
 */
import { describe, it, expect } from "vitest";
import { resolveYear } from "@shared/simulation/resolve";
import { buildWorld, economyFor, decisionsForYear, SEASON_YEARS } from "@shared/simulation/season";
import { NICHES } from "@shared/simulation/niches";
import { rng } from "@shared/simulation/random";
import { ROLES, type Company, type Role, type World } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";

/** Deliberately hostile decisions, drawn from a seed so a failure can be re-run. */
function nastyDecisions(seed: string, company: Company, niche: (typeof NICHES)[number]): TeamDecisions {
  const next = rng(seed);
  const pick = <T,>(options: T[]): T => options[Math.floor(next() * options.length) % options.length];

  /*
   * The values include the ones a client should never send and might: a
   * negative spend, a price of zero, a string where a number belongs, a
   * missing field. The route validates before any of this reaches the engine,
   * but a validator is one deployment away from being bypassed and the engine
   * should not be the thing that falls over.
   */
  const money = () => pick([0, -50_000, 1, 250_000, 5_000_000, 900_000_000, NaN, undefined, "600000" as any]);
  const count = () => pick([0, -10, 1, 100_000, 50_000_000, NaN, undefined]);

  const seats = company.seats.length > 0 ? company.seats : ROLES;
  const filed: TeamDecisions = { companyId: company.id };

  // Any subset of the seats files, because the common case is not five.
  for (const role of seats) {
    if (next() < 0.25) continue;
    if (role === "cmo") {
      filed.cmo = {
        price: pick([0, -5, 1, niche.segments[0].referencePrice, 999_999, NaN, undefined]) as any,
        brandSpend: money() as any,
        performanceSpend: money() as any,
        celebritySpend: money() as any,
        targetCities: pick([[], niche.cities.map((c) => c.id), ["nowhere"], undefined as any]),
      };
    }
    if (role === "cto") {
      filed.cto = {
        featureSpend: money() as any, reliabilitySpend: money() as any,
        techDebtPaydown: money() as any, researchSpend: money() as any,
      };
    }
    if (role === "coo") {
      filed.coo = {
        capacityTarget: count() as any, supportSpend: money() as any,
        efficiencySpend: money() as any, headcount: count() as any,
      };
    }
    if (role === "cfo") {
      filed.cfo = {
        borrow: money() as any, repay: money() as any,
        cashBuffer: money() as any, raiseAmount: money() as any,
      } as any;
    }
    if (role === "ceo") {
      filed.ceo = {
        focus: pick(["growth", "margin", "quality", "survival", "nonsense", undefined]) as any,
        positioning: pick([undefined, "", niche.segments[0].id, "not_a_segment"]) as any,
      };
    }
  }
  return filed;
}

const finite = (n: unknown, what: string) => {
  expect(typeof n, `${what} is not a number`).toBe("number");
  expect(Number.isFinite(n as number), `${what} is ${n}`).toBe(true);
};

/** Everything that must hold about one company, whatever was done to it. */
function checkCompany(c: Company, where: string) {
  for (const [field, value] of Object.entries({
    cash: c.cash, debt: c.debt, creditLimit: c.creditLimit, price: c.price,
    unitCost: c.unitCost, capacity: c.capacity, reputation: c.reputation,
    quality: c.quality, brand: c.brand, service: c.service,
  })) {
    finite(value, `${where} ${field}`);
  }

  // The bounded ones are bounded. A reputation of 140 makes every comparison
  // against it meaningless and nothing would ever throw.
  for (const [field, value] of Object.entries({
    reputation: c.reputation, quality: c.quality, brand: c.brand, service: c.service,
  })) {
    expect(value, `${where} ${field} out of range`).toBeGreaterThanOrEqual(0);
    expect(value, `${where} ${field} out of range`).toBeLessThanOrEqual(100);
  }

  expect(c.debt, `${where} owes a negative amount`).toBeGreaterThanOrEqual(0);
  expect(c.capacity, `${where} has negative capacity`).toBeGreaterThanOrEqual(0);
  expect(c.price, `${where} sells at or below nothing`).toBeGreaterThan(0);
  expect(c.unitCost, `${where} has a negative unit cost`).toBeGreaterThanOrEqual(0);

  if (c.kind === "player") {
    finite(c.founderShare ?? 1, `${where} founderShare`);
    expect(c.founderShare ?? 1, `${where} founders own nothing or more than everything`).toBeGreaterThan(0);
    expect(c.founderShare ?? 1).toBeLessThanOrEqual(1);
    finite(c.techDebt ?? 0, `${where} techDebt`);
    expect(c.techDebt ?? 0).toBeGreaterThanOrEqual(0);
    expect(c.techDebt ?? 0).toBeLessThanOrEqual(100);
  }

  for (const [segment, held] of Object.entries(c.customers)) {
    finite(held, `${where} customers in ${segment}`);
    expect(held, `${where} holds negative customers in ${segment}`).toBeGreaterThanOrEqual(0);
  }
}

describe("a year survives anything anybody files", () => {
  for (const niche of NICHES) {
    it(`holds together in ${niche.id}`, () => {
      let world: World = buildWorld({
        seasonId: `fuzz-${niche.id}`,
        niche,
        teams: [0, 1, 2].map((i) => ({ id: `t${i}`, name: `Team ${i}`, seats: [...ROLES] as Role[] })),
      });

      for (let year = 1; year <= SEASON_YEARS; year++) {
        const decisions = world.companies
          .filter((c) => c.kind === "player")
          .map((c) => nastyDecisions(`${niche.id}:${c.id}:${year}`, c, niche));

        const out = resolveYear({ ...world, year }, decisions, economyFor(`fuzz-${niche.id}`, year));
        world = out.world;

        for (const company of world.companies) checkCompany(company, `${niche.id} y${year} ${company.name}`);

        for (const report of out.reports) {
          for (const [field, value] of Object.entries({
            customers: report.customers, marketShare: report.marketShare,
            revenue: report.revenue, costs: report.costs, profit: report.profit,
            value: report.value, founderValue: report.founderValue,
          })) {
            finite(value, `${niche.id} y${year} ${report.name} report.${field}`);
          }
          expect(report.marketShare, `${report.name} holds a negative share`).toBeGreaterThanOrEqual(0);
          expect(report.marketShare, `${report.name} holds more than the whole market`).toBeLessThanOrEqual(1);
          expect(report.rank, `${report.name} has no rank`).toBeGreaterThan(0);
        }

        // Shares are a division of one market, however badly it went.
        const total = out.reports.reduce((sum, r) => sum + r.marketShare, 0);
        expect(total, `${niche.id} y${year} shares add to ${total}`).toBeLessThanOrEqual(1.001);
      }
    });
  }
});

describe("a caretaker year survives it too", () => {
  it("fills empty seats without inventing numbers", () => {
    /*
     * The same fuzzing, but through `decisionsForYear` — which is what the
     * tick actually calls, and which fills the seats nobody filed for. A team
     * where three people file nonsense and two file nothing is an ordinary
     * Tuesday.
     */
    const niche = NICHES[0];
    let world: World = buildWorld({
      seasonId: "fuzz-caretaker",
      niche,
      teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }],
    });
    let previous: TeamDecisions | undefined;

    for (let year = 1; year <= SEASON_YEARS; year++) {
      const company = world.companies.find((c) => c.id === "t")!;
      const nasty = nastyDecisions(`caretaker:${year}`, company, niche);
      const submitted: Partial<Record<Role, any>> = {};
      for (const role of ROLES) if ((nasty as any)[role]) submitted[role] = (nasty as any)[role];

      const { decisions } = decisionsForYear({ company, niche, submitted, previous });
      const out = resolveYear({ ...world, year }, [decisions], economyFor("fuzz-caretaker", year));
      world = out.world;
      previous = nasty;

      checkCompany(world.companies.find((c) => c.id === "t")!, `caretaker y${year}`);
    }
  });
});

describe("the same year, twice", () => {
  it("resolves identically however many times it is run", () => {
    /*
     * The tick is built to be safely re-runnable, and everything about that
     * rests on the engine being a pure function of its inputs. If a year
     * resolved differently the second time, a retry after a half-written tick
     * would hand players a different world than the one already reported.
     */
    for (const niche of NICHES.slice(0, 3)) {
      const world = buildWorld({
        seasonId: `twice-${niche.id}`,
        niche,
        teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }],
      });
      const decisions = [nastyDecisions(`twice:${niche.id}`, world.companies.find((c) => c.id === "t")!, niche)];

      const first = resolveYear({ ...world, year: 3 }, decisions, economyFor("x", 3));
      const second = resolveYear({ ...world, year: 3 }, decisions, economyFor("x", 3));
      expect(JSON.stringify(second.world)).toBe(JSON.stringify(first.world));
      expect(JSON.stringify(second.reports)).toBe(JSON.stringify(first.reports));
    }
  });
});
