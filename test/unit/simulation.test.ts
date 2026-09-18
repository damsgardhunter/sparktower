/**
 * Whether the simulation is a game worth playing.
 *
 * These are not arithmetic tests. The arithmetic is easy and uninteresting;
 * what is hard is that the numbers add up to a market that behaves like one —
 * where five people have to cooperate, where the incumbents' 90% is a real
 * wall with a real door in it, and where money alone doesn't win.
 *
 * Each test below is a design commitment from the brief, written so that
 * breaking it fails here rather than being discovered by a team eight days
 * into a season.
 */
import { describe, it, expect } from "vitest";
import { NICHES } from "@shared/simulation/niches";
import { seedIncumbents, threatLevel } from "@shared/simulation/incumbents";
import { allocate, appealFor, marketShares } from "@shared/simulation/market";
import { resolveYear } from "@shared/simulation/resolve";
import type { Company, World } from "@shared/simulation/types";
import type { TeamDecisions } from "@shared/simulation/decisions";

const niche = NICHES[0];

/** A team's company on day one: no customers, no debt, no reputation to speak of. */
function newTeam(id: string, name: string): Company {
  return {
    id, name, kind: "player", teamId: `team_${id}`,
    cash: 2_000_000, debt: 0, creditLimit: 500_000,
    reputation: 50, quality: 45, brand: 10, service: 45,
    capacity: 40_000, unitCost: niche.baseUnitCost, price: 18,
    customers: {}, assets: [], seats: ["ceo", "cmo", "cfo", "cto", "coo"],
  };
}

function worldWith(teams: Company[]): World {
  return {
    seasonId: "s1", niche, year: 1,
    companies: [...seedIncumbents(niche), ...teams],
    economy: { demand: 1, interestRate: 0.09, costIndex: 1, outlook: "steady" },
  };
}

/** Everything a seat can do, at a chosen level of spend. */
const fullYear = (companyId: string, spend: number, price = 18): TeamDecisions => ({
  companyId,
  cmo: { price, brandSpend: spend * 0.25, performanceSpend: spend * 0.15, celebritySpend: 0, targetCities: ["Leeds"] },
  cto: { featureSpend: spend * 0.2, reliabilitySpend: spend * 0.15, techDebtPaydown: 0 },
  coo: { capacityTarget: 90_000, supportSpend: spend * 0.15, efficiencySpend: spend * 0.1, headcount: 12 },
  cfo: { borrow: 0, repay: 0, cashBuffer: 200_000 },
  ceo: { focus: "growth" },
});

describe("the incumbents' 90%", () => {
  it("is a wall: a good first year barely dents it", () => {
    const world = worldWith([newTeam("t1", "Newcomer")]);
    const { reports } = resolveYear(world, [fullYear("t1", 1_200_000)]);
    const mine = reports.find((r) => r.companyId === "t1")!;

    // A real foothold, and nothing like a market position. If this ever
    // climbs past a few percent, year one stops being humbling and the
    // fourteen-day arc collapses into a week.
    expect(mine.marketShare).toBeGreaterThan(0);
    expect(mine.marketShare).toBeLessThan(0.08);
  });

  it("has a door: loyalty, not size, decides how fast a segment can be taken", () => {
    /*
     * The mechanism the brief calls "on the rope" customers, tested directly
     * rather than through a whole season — because how much a team actually
     * wins depends on whether it aimed at that segment, and this is about what
     * the market does when it is aimed at.
     *
     * Two identical challengers, two identical incumbents, the same appeal
     * advantage in both segments. The only difference is loyalty: 0.18 against
     * 0.86. What moves is the difference loyalty makes, and nothing else.
     */
    const flighty = niche.segments.find((s) => s.id === "resolvers")!;
    const devoted = niche.segments.find((s) => s.id === "coached")!;

    const holder = (segmentId: string, size: number): Company => ({
      ...newTeam(`holder_${segmentId}`, "Holder"), kind: "incumbent", posture: "coaster",
      brand: 60, quality: 55, service: 55, price: 20,
      customers: { [segmentId]: Math.round(size * 0.9) }, capacity: size,
    });
    // Plainly better on every axis, so the offer is not what differs.
    const challenger = (segmentId: string, size: number): Company => ({
      ...newTeam(`challenger_${segmentId}`, "Challenger"),
      brand: 85, quality: 85, service: 85, price: 15, capacity: size,
    });

    const taken = (segment: typeof flighty): number => {
      const world = { ...worldWith([]), niche: { ...niche, segments: [segment] } };
      const companies = [holder(segment.id, segment.size), challenger(segment.id, segment.size)];
      const { held } = allocate(companies, world.niche, 1, world.economy);
      return held[`challenger_${segment.id}`][segment.id] ?? 0;
    };

    const fromFlighty = taken(flighty) / flighty.size;
    const fromDevoted = taken(devoted) / devoted.size;

    expect(fromFlighty, "a flighty segment should give way faster than a devoted one")
      .toBeGreaterThan(fromDevoted);
    // And the devoted segment should still be losing something — a moat that
    // never leaks is a wall, and a wall makes the game unwinnable.
    expect(fromDevoted).toBeGreaterThan(0);
  });
});

describe("five seats, not one", () => {
  it("rewards a team that covers every seat over one that spends the same through two", () => {
    /*
     * The central design claim: the same money, spread across coordinated
     * decisions, beats it concentrated. If this fails the game is an
     * arithmetic exercise and four players are watching one play.
     */
    const total = 1_600_000;
    const world = worldWith([newTeam("balanced", "Balanced"), newTeam("lopsided", "Lopsided")]);

    const lopsided: TeamDecisions = {
      companyId: "lopsided",
      // Everything into marketing, nothing behind it.
      cmo: { price: 18, brandSpend: total * 0.7, performanceSpend: total * 0.3, celebritySpend: 0, targetCities: [] },
      coo: { capacityTarget: 40_000, supportSpend: 0, efficiencySpend: 0, headcount: 12 },
    };

    const { reports } = resolveYear(world, [fullYear("balanced", total), lopsided]);
    const balanced = reports.find((r) => r.companyId === "balanced")!;
    const lop = reports.find((r) => r.companyId === "lopsided")!;

    expect(balanced.marketShare).toBeGreaterThan(lop.marketShare);
    expect(lop.notes.join(" ")).toMatch(/more people than operations could serve/i);
  });

  it("tells a team when its product got better and nobody noticed", () => {
    const world = worldWith([newTeam("quiet", "Quiet Excellence")]);
    const { reports } = resolveYear(world, [{
      companyId: "quiet",
      cto: { featureSpend: 600_000, reliabilitySpend: 400_000, techDebtPaydown: 0 },
      coo: { capacityTarget: 60_000, supportSpend: 100_000, efficiencySpend: 0, headcount: 10 },
    }]);
    expect(reports.find((r) => r.companyId === "quiet")!.notes.join(" ")).toMatch(/almost nobody found out/i);
  });

  it("names the seats nobody filled, rather than silently doing nothing", () => {
    const world = worldWith([newTeam("empty", "Absent")]);
    const { reports } = resolveYear(world, [{ companyId: "empty" }]);
    const notes = reports.find((r) => r.companyId === "empty")!.notes.join(" ");
    for (const seat of ["marketing", "operations", "product", "finance"]) {
      expect(notes, `a missing ${seat} decision should be reported`).toMatch(new RegExp(seat, "i"));
    }
  });
});

describe("money alone doesn't win", () => {
  it("gives the second million less than the first", () => {
    const world = worldWith([newTeam("lean", "Lean"), newTeam("rich", "Rich")]);
    const { reports } = resolveYear(world, [fullYear("lean", 1_000_000), fullYear("rich", 4_000_000)]);
    const lean = reports.find((r) => r.companyId === "lean")!;
    const rich = reports.find((r) => r.companyId === "rich")!;

    expect(rich.marketShare).toBeGreaterThan(lean.marketShare);
    // Four times the spend for less than twice the share.
    expect(rich.marketShare).toBeLessThan(lean.marketShare * 2);
  });

  it("punishes selling below cost, and says so in words", () => {
    const world = worldWith([newTeam("dumping", "Dumping")]);
    const { reports } = resolveYear(world, [fullYear("dumping", 800_000, 2)]);
    const r = reports.find((r) => r.companyId === "dumping")!;
    expect(r.profit).toBeLessThan(0);
    expect(r.notes.join(" ")).toMatch(/costs .* to make/i);
  });
});

describe("the incumbents defend like incumbents", () => {
  it("ignores a rival too small to matter, and reacts when one isn't", () => {
    const world = worldWith([newTeam("t1", "Newcomer")]);
    const fortress = world.companies.find((c) => c.id === "inc_peak")!;
    const tiny = { ...newTeam("tiny", "Tiny"), brand: 2, quality: 20 };
    const serious = { ...newTeam("serious", "Serious"), brand: 85, quality: 92, service: 88, price: 14 };

    expect(threatLevel(fortress, [tiny], niche)).toBeLessThan(threatLevel(fortress, [serious], niche));
  });

  it("concedes the fringe rather than fighting everywhere", () => {
    // A strong newcomer aimed at the flighty segment: a coaster should let it
    // go and keep its money for what it can still hold.
    let world = worldWith([{ ...newTeam("t1", "Sharp"), brand: 70, quality: 78, service: 72, price: 11 }]);
    world = resolveYear(world, [fullYear("t1", 2_000_000, 11)]).world;
    const { reports } = resolveYear(world, [fullYear("t1", 2_000_000, 11)]);

    const coaster = reports.find((r) => r.companyId === "inc_still")!;
    expect(coaster.notes.join(" ")).toMatch(/stopped defending|pressure/i);
  });
});

describe("running out of money", () => {
  it("does not end the season", () => {
    const broke: Company = { ...newTeam("broke", "Broke"), cash: 10_000, creditLimit: 20_000 };
    const world = worldWith([broke]);
    const { world: after, reports } = resolveYear(world, [fullYear("broke", 3_000_000)]);

    const report = reports.find((r) => r.companyId === "broke")!;
    expect(report.bankrupt).toBe(true);
    // Still in the world, still holding customers, still able to act next year.
    expect(after.companies.find((c) => c.id === "broke")).toBeTruthy();
    expect(report.notes.join(" ")).toMatch(/not out of the season/i);
  });
});

describe("the same board always produces the same year", () => {
  it("is deterministic, so a season can be replayed and explained", () => {
    const build = () => resolveYear(worldWith([newTeam("t1", "A"), newTeam("t2", "B")]), [fullYear("t1", 900_000), fullYear("t2", 1_500_000)]);
    const a = build();
    const b = build();
    expect(JSON.stringify(a.reports)).toBe(JSON.stringify(b.reports));
  });
});

describe("the market adds up", () => {
  it("never hands out more customers than exist, or loses them into the gaps", () => {
    const world = worldWith([newTeam("t1", "A"), newTeam("t2", "B")]);
    const { held } = allocate(world.companies, niche, 1, world.economy);
    const shares = marketShares(held);
    const total = Object.values(shares).reduce((sum, s) => sum + s, 0);
    expect(total).toBeCloseTo(1, 5);

    for (const segment of niche.segments) {
      const allocated = Object.values(held).reduce((sum, bySegment) => sum + (bySegment[segment.id] ?? 0), 0);
      const demand = Math.round(segment.size * world.economy.demand);
      expect(allocated, `${segment.name} over-allocated`).toBeLessThanOrEqual(demand * 1.02);
    }
  });

  it("charges a company that oversells: what it cannot deliver, it loses", () => {
    const small = { ...newTeam("small", "Small"), capacity: 500, brand: 90, quality: 90, service: 90, price: 8 };
    const world = worldWith([small]);
    // Deliberately keeping capacity tiny while spending hard on demand — the
    // decision `fullYear` would otherwise overwrite.
    const { reports } = resolveYear(world, [{
      ...fullYear("small", 1_000_000, 8),
      coo: { capacityTarget: 500, supportSpend: 150_000, efficiencySpend: 0, headcount: 4 },
    }]);
    const r = reports.find((r) => r.companyId === "small")!;

    expect(r.turnedAway).toBeGreaterThan(0);
    expect(r.customers).toBeLessThanOrEqual(500);
    // And it costs them standing, not just revenue.
    expect(r.reputationChange).toBeLessThan(0);
  });
});
