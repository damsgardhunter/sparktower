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
import { applyAcquisition } from "@shared/simulation/mergers";

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

describe("the money adds up", () => {
  /*
   * Cash is not a score, it is an account: what a company has at the end of a
   * year should be what it had, plus what it earned, less what it spent, plus
   * what it borrowed or raised, less what it repaid. If those do not
   * reconcile, money is being created or destroyed somewhere — and a leak in
   * either direction is invisible until somebody with a spreadsheet finds it
   * and stops trusting every other number on the page.
   */
  const niche = NICHES[0];

  const cases = [
    { name: "a quiet year", cfo: { borrow: 0, repay: 0, cashBuffer: 0 } },
    { name: "borrowing", cfo: { borrow: 3_000_000, repay: 0, cashBuffer: 0 } },
    { name: "repaying", cfo: { borrow: 0, repay: 400_000, cashBuffer: 0 } },
    { name: "raising from investors", cfo: { borrow: 0, repay: 0, cashBuffer: 0, raiseAmount: 5_000_000 } },
    { name: "borrowing and raising at once", cfo: { borrow: 1_000_000, repay: 0, cashBuffer: 0, raiseAmount: 2_000_000 } },
  ];

  for (const testCase of cases) {
    it(`reconciles when ${testCase.name}`, () => {
      const world = buildWorld({
        seasonId: "money",
        niche,
        teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }],
      });
      const before = world.companies.find((c) => c.id === "t")!;

      const decisions: TeamDecisions[] = [{
        companyId: "t",
        cmo: { price: 40, brandSpend: 600_000, performanceSpend: 300_000, celebritySpend: 0, targetCities: [] },
        cto: { featureSpend: 400_000, reliabilitySpend: 200_000, techDebtPaydown: 100_000, researchSpend: 250_000 },
        coo: { capacityTarget: before.capacity, supportSpend: 300_000, efficiencySpend: 150_000, headcount: 4 },
        cfo: testCase.cfo as any,
        ceo: { focus: "growth" },
      }];

      const out = resolveYear({ ...world, year: 2 }, decisions, economyFor("money", 2));
      const after = out.world.companies.find((c) => c.id === "t")!;
      const report = out.reports.find((r) => r.companyId === "t")!;

      const borrowed = testCase.cfo.borrow ?? 0;
      const repaid = testCase.cfo.repay ?? 0;
      const raised = (testCase.cfo as any).raiseAmount ?? 0;

      /*
       * Nothing was bought or sold this year, so the only movements are the
       * trading result and the finance seat's own decisions. Anything left
       * over is money the engine invented or lost.
       */
      const expected = before.cash + report.profit + borrowed + raised - repaid;
      expect(after.cash, `${testCase.name}: cash does not reconcile`).toBeCloseTo(expected, 0);

      // And what is owed moves by exactly what was borrowed and repaid.
      expect(after.debt, `${testCase.name}: debt does not reconcile`)
        .toBeCloseTo(Math.max(0, before.debt + borrowed - repaid), 0);
    });
  }

  it("moves money between two companies without creating any", () => {
    /*
     * An acquisition is the one place cash crosses between companies. What one
     * pays the other must receive — a mismatch is either a team paying for
     * something nobody sold or being paid for something nobody bought.
     */
    const world = buildWorld({
      seasonId: "transfer",
      niche,
      teams: [
        { id: "buyer", name: "Buyer", seats: [...ROLES] as Role[] },
        { id: "seller", name: "Seller", seats: [...ROLES] as Role[] },
      ],
    });
    const buyer = world.companies.find((c) => c.id === "buyer")!;
    const seller = world.companies.find((c) => c.id === "seller")!;
    const before = buyer.cash + seller.cash;

    const out = applyAcquisition({ buyer, seller, amount: 2_500_000, year: 4 });
    expect(out.buyer.cash + out.seller.cash, "money appeared or vanished in the handover").toBeCloseTo(before, 0);
    expect(out.buyer.cash).toBe(buyer.cash - 2_500_000);
    expect(out.seller.cash).toBe(seller.cash + 2_500_000);
  });
});

describe("what the report says and what was saved", () => {
  /*
   * A player reads the report; the next year is resolved from the world. If
   * those two disagree, the game a team thinks they are playing is not the one
   * being played — and the disagreement would only ever show up as a number
   * that made no sense a day later.
   */
  const niche = NICHES[0];

  it("describes the company that was actually stored", () => {
    let world = buildWorld({
      seasonId: "mirror",
      niche,
      teams: [0, 1].map((i) => ({ id: `t${i}`, name: `Team ${i}`, seats: [...ROLES] as Role[] })),
    });

    for (let year = 1; year <= SEASON_YEARS; year++) {
      const decisions = world.companies
        .filter((c) => c.kind === "player")
        .map((c) => nastyDecisions(`mirror:${c.id}:${year}`, c, niche));

      const out = resolveYear({ ...world, year }, decisions, economyFor("mirror", year));
      world = out.world;

      for (const report of out.reports) {
        const company = world.companies.find((c) => c.id === report.companyId)!;
        const held = Object.values(company.customers).reduce((sum, n) => sum + n, 0);

        expect(report.cash, `${report.name} y${year}: cash`).toBeCloseTo(company.cash, 4);
        expect(report.debt, `${report.name} y${year}: debt`).toBeCloseTo(company.debt, 4);
        expect(report.customers, `${report.name} y${year}: customers`).toBe(held);
        expect(report.reputation, `${report.name} y${year}: reputation`).toBeCloseTo(company.reputation, 4);
        expect(report.quality, `${report.name} y${year}: quality`).toBeCloseTo(company.quality, 4);
        expect(report.brand, `${report.name} y${year}: brand`).toBeCloseTo(company.brand, 4);
        expect(report.service, `${report.name} y${year}: service`).toBeCloseTo(company.service, 4);
      }
    }
  });

  it("reconciles the cash even in a year something happened", () => {
    /*
     * Events land after the market resolves and some of them move money — a
     * recall costs the company that had it. If the report's trading figures
     * cannot be reconciled against the cash that was saved, a finance seat
     * checking the arithmetic finds a hole and has no way to know it is the
     * event rather than an error.
     */
    for (let year = 2; year <= 12; year++) {
      const world = buildWorld({
        seasonId: "eventful",
        niche,
        teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }],
      });
      // A company with a poor reputation and a poor product has things coming.
      world.companies = world.companies.map((c) =>
        c.id === "t" ? { ...c, reputation: 20, quality: 25, customers: { swipers: 40_000 } } : c);

      const before = world.companies.find((c) => c.id === "t")!;
      const out = resolveYear({ ...world, year }, [{
        companyId: "t",
        cmo: { price: 40, brandSpend: 200_000, performanceSpend: 0, celebritySpend: 0, targetCities: [] },
        cfo: { borrow: 0, repay: 0, cashBuffer: 0 },
      }], economyFor("eventful", year));

      const after = out.world.companies.find((c) => c.id === "t")!;
      const report = out.reports.find((r) => r.companyId === "t")!;

      const unexplained = after.cash - (before.cash + report.profit);
      if (Math.abs(unexplained) > 1) {
        /*
         * A gap is allowed only when something happened that moved money, and
         * then the team has to be able to see it. Anything else is a leak.
         */
        expect(report.event, `y${year}: ${Math.round(unexplained)} moved with nothing to explain it`).toBeTruthy();
        expect(report.event!.mine, `y${year}: the money moved but the event was not theirs`).toBe(true);
      }
    }
  });
});

describe("customers are not invented", () => {
  it("never allocates more of a segment than the segment has", () => {
    /*
     * Every company's customers come out of the same finite pool. If the
     * allocation can hand out more than exists, market share stops meaning
     * anything and two teams can both be told they have most of the market.
     */
    for (const niche of NICHES) {
      let world: World = buildWorld({
        seasonId: `pool-${niche.id}`,
        niche,
        teams: [0, 1, 2, 3].map((i) => ({ id: `t${i}`, name: `Team ${i}`, seats: [...ROLES] as Role[] })),
      });

      for (let year = 1; year <= SEASON_YEARS; year++) {
        const decisions = world.companies
          .filter((c) => c.kind === "player")
          .map((c) => nastyDecisions(`pool:${niche.id}:${c.id}:${year}`, c, niche));
        world = resolveYear({ ...world, year }, decisions, economyFor(`pool-${niche.id}`, year)).world;

        for (const segment of niche.segments) {
          const held = world.companies.reduce((sum, c) => sum + (c.customers[segment.id] ?? 0), 0);
          /*
           * The pool grows each year by the segment's growth and the economy's
           * demand, so the ceiling is generous — this is checking that it is
           * bounded at all, not that the growth curve is exact.
           */
          const ceiling = segment.size * Math.pow(1 + segment.growth, year) * 1.5;
          expect(held, `${niche.id} y${year} ${segment.name}: ${Math.round(held)} held of ${Math.round(ceiling)}`)
            .toBeLessThanOrEqual(ceiling);
        }
      }
    }
  });

  it("serves nobody it cannot serve", () => {
    // Capacity is a hard ceiling; anything above it is turned away, and a
    // company reported as serving more than it can is a company whose
    // operations seat has no decision to make.
    const niche = NICHES[0];
    const world = buildWorld({
      seasonId: "capacity",
      niche,
      teams: [{ id: "t", name: "T", seats: [...ROLES] as Role[] }],
    });

    const out = resolveYear({ ...world, year: 2 }, [{
      companyId: "t",
      cmo: { price: 20, brandSpend: 4_000_000, performanceSpend: 4_000_000, celebritySpend: 0, targetCities: niche.cities.map((c) => c.id) },
      coo: { capacityTarget: 5_000, supportSpend: 0, efficiencySpend: 0, headcount: 1 },
    }], economyFor("capacity", 2));

    const report = out.reports.find((r) => r.companyId === "t")!;
    expect(report.customers, "served more than it could").toBeLessThanOrEqual(5_000);
  });
});
