/**
 * The companies that turn up because you made it look easy.
 *
 * The cast used to be fixed: the incumbents a market was written with, the
 * tables that joined, and nobody else for fourteen years. In a real market the
 * thing that punishes a company for getting comfortable is usually not an
 * existing rival moving — it is somebody new arriving because the margins
 * looked good from outside.
 *
 * The claim worth testing is the causal one. Not "entrants exist" but
 * "entrants are a consequence": a market nobody is doing well in should stay
 * quiet, and one where somebody has just proved it can be done should not.
 */
import { describe, it, expect } from "vitest";
import { attractivenessOf, entrantsFor, roomFor } from "@shared/simulation/entrants";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { startingCompany } from "@shared/simulation/season";
import { nicheById, NICHES } from "@shared/simulation/niches";
import { ROLES, type Company } from "@shared/simulation/types";

const niche = nicheById("dating_apps")!;
const incumbents = () => seedIncumbents(niche);
const player = (over: Partial<Company> = {}): Company => ({
  ...startingCompany({ id: "p", name: "P", niche, seats: [...ROLES] }),
  ...over,
});

describe("what a market looks like from outside", () => {
  it("is more attractive when somebody has just proved it can be done", () => {
    const quiet = attractivenessOf({ niche, companies: [...incumbents(), player()] });
    const winning = attractivenessOf({
      niche,
      companies: [...incumbents(), player({ customers: { [niche.segments[0].id]: 900_000 } })],
    });
    expect(winning.proof).toBeGreaterThan(quiet.proof);
    expect(winning.score).toBeGreaterThan(quiet.score);
  });

  it("is more attractive when people wanted to buy and could not", () => {
    const companies = [...incumbents(), player()];
    const served = attractivenessOf({ niche, companies });
    const queueing = attractivenessOf({ niche, companies, turnedAway: { p: 400_000 } });
    expect(queueing.unserved).toBeGreaterThan(served.unserved);
    expect(queueing.score).toBeGreaterThan(served.score);
  });

  it("aims a newcomer at whatever just worked", () => {
    const winner = player({ customers: { [niche.segments[2].id]: 40_000 } });
    const look = attractivenessOf({ niche, companies: [...incumbents(), winner] });
    expect(look.aimAt?.id, "they copy the thing that is working").toBe(niche.segments[2].id);
  });
});

describe("who turns up", () => {
  const busy = { customers: { [niche.segments[0].id]: 1_200_000 } };

  it("nobody, in the first two years", () => {
    for (const year of [1, 2]) {
      expect(entrantsFor({ seasonId: "s", year, niche, companies: [...incumbents(), player(busy)] })).toHaveLength(0);
    }
  });

  it("nobody, into a market nobody is doing anything in", () => {
    /*
     * Every company tiny, nobody turned away, margins ordinary. There is no
     * story here worth anybody's money.
     */
    const flat = incumbents().map((c) => ({ ...c, customers: {}, price: c.unitCost * 1.2 }));
    let arrivals = 0;
    for (let year = 3; year <= 14; year++) {
      arrivals += entrantsFor({ seasonId: "quiet", year, niche, companies: [...flat, player()] }).length;
    }
    expect(arrivals).toBe(0);
  });

  it("somebody, into a market where a newcomer is running away with it", () => {
    let arrivals = 0;
    for (let year = 3; year <= 14; year++) {
      arrivals += entrantsFor({ seasonId: "loud", year, niche, companies: [...incumbents(), player(busy)] }).length;
    }
    expect(arrivals).toBeGreaterThan(0);
  });

  it("and never more than one in a year", () => {
    for (let year = 3; year <= 14; year++) {
      expect(entrantsFor({ seasonId: "loud", year, niche, companies: [...incumbents(), player(busy)] }).length)
        .toBeLessThanOrEqual(1);
    }
  });

  it("stops once the market is crowded", () => {
    const crowd = Array.from({ length: roomFor(niche) }, (_, i) => player({ id: `c${i}` }));
    expect(entrantsFor({ seasonId: "full", year: 8, niche, companies: crowd })).toHaveLength(0);
  });

  it("arrives with nothing, so nobody's customers are taken to make room", () => {
    let made: Company[] = [];
    for (let year = 3; year <= 14 && !made.length; year++) {
      made = entrantsFor({ seasonId: "loud", year, niche, companies: [...incumbents(), player(busy)] });
    }
    expect(made.length).toBeGreaterThan(0);
    const e = made[0];
    expect(Object.values(e.customers ?? {}).reduce((a, b) => a + b, 0), "they win them or they do not").toBe(0);
    expect(e.kind).toBe("incumbent");
    expect(e.enteredInYear).toBeGreaterThanOrEqual(3);
    expect(e.cities.length, "they know where they are selling").toBeGreaterThan(0);
  });

  it("is the same company on a replay", () => {
    const once = entrantsFor({ seasonId: "same", year: 6, niche, companies: [...incumbents(), player(busy)] });
    const twice = entrantsFor({ seasonId: "same", year: 6, niche, companies: [...incumbents(), player(busy)] });
    expect(once.map((c) => c.id)).toEqual(twice.map((c) => c.id));
  });
});

describe("how many a market can hold", () => {
  it("is more for a big market than a small one", () => {
    const small = { ...niche, segments: niche.segments.map((s) => ({ ...s, size: 400 })) };
    expect(roomFor(small)).toBeLessThan(roomFor(niche));
    expect(roomFor(small)).toBeGreaterThanOrEqual(4);
  });

  it("leaves room in every market written by hand", () => {
    for (const n of NICHES) {
      expect(roomFor(n), n.name).toBeGreaterThan(n.incumbents.length);
    }
  });
});
