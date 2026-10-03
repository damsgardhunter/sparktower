/**
 * The two readings of market share.
 *
 * A market is global and a young company is in one corner of it, so the number
 * everybody looked at first was the one least worth looking at: a company
 * trading well in one region holds a fraction of a per cent of its market, the
 * standings said so, and a team winning everywhere it sells read as a rounding
 * error. `sharesWhereSold` is the other reading, and the table now carries both
 * — one says how big the business is, the other says how well it is run.
 *
 * The property that makes it safe to show beside the old number is that it *is*
 * the old number for anyone selling everywhere. If that ever stops being true,
 * two columns on the same row disagree about the same company and neither can
 * be trusted; so it is the first thing asserted here, exactly rather than
 * approximately.
 */
import { describe, it, expect } from "vitest";
import { marketShares, sharesWhereSold } from "@shared/simulation/market";
import { nicheById } from "@shared/simulation/niches";
import { buildWorld } from "@shared/simulation/season";
import { ROLES, type Company, type Role } from "@shared/simulation/types";

const niche = nicheById("construction")!;
const everywhere = niche.cities.map((c) => c.id);
const town = [...niche.cities].sort((a, b) => b.weight - a.weight)[0];

/** A world's worth of companies, so `reachOf` has real regions and weights to read. */
const world = buildWorld({ seasonId: "share", niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] as Role[] }] });

/** `held` has the shape `allocate` returns: customers per company, per segment. */
const held = (us: number, them: number) => ({
  us: { homeowners: us },
  them: { homeowners: them },
});

const company = (id: string, cities: string[]): Company =>
  ({ ...world.companies.find((c) => c.kind === "player")!, id, cities, ramp: Object.fromEntries(cities.map((c) => [c, 1])) }) as Company;

describe("share of the regions you sell in", () => {
  it("is exactly the share of the whole market, for a company selling everywhere", () => {
    /*
     * Not "about the same". The two numbers sit next to each other on one row of
     * the standings, and a company that has finished expanding must see them
     * agree to the last decimal or the table is arguing with itself.
     */
    const companies = [company("us", everywhere), company("them", everywhere)];
    const h = held(30_000, 70_000);
    const world$ = sharesWhereSold(h, companies, niche);
    const whole = marketShares(h);
    expect(world$.us).toBe(whole.us);
    expect(world$.them).toBe(whole.them);
    expect(world$.us).toBeCloseTo(0.3, 10);
  });

  it("reads a one-region company against its own region, not against the world", () => {
    /*
     * The case the change exists for. A company holding 2,000 customers out of
     * 100,000 worldwide is at two per cent of the market — and if it only sells
     * in a region holding a quarter of that market, it holds something nearer a
     * tenth of the market it is actually in.
     */
    const companies = [company("us", [town.id]), company("them", everywhere)];
    const h = held(2_000, 98_000);
    const out = sharesWhereSold(h, companies, niche);
    const whole = marketShares(h);
    expect(whole.us).toBeCloseTo(0.02, 10);
    expect(out.us).toBeGreaterThan(whole.us);
    /* The denominator is everyone's customers scaled by this company's footprint. */
    expect(out.us).toBeCloseTo(0.02 / town.weight, 6);
    /* And the rival selling everywhere is unmoved, which is the point of the floor at one. */
    expect(out.them).toBe(whole.them);
  });

  it("never reads above the whole of the market it sells in", () => {
    /*
     * A company part-way through opening its first region has a `ramp` well
     * under one, so the market it reaches can be a sliver — and a sliver in a
     * denominator is how a share becomes four hundred per cent. Capped, and the
     * cap is asserted on the case that would breach it rather than in general.
     */
    const opening = { ...company("us", [town.id]), ramp: { [town.id]: 0.02 } } as Company;
    const out = sharesWhereSold(held(60_000, 40_000), [opening, company("them", everywhere)], niche);
    expect(out.us).toBeLessThanOrEqual(1);
    expect(out.us).toBeGreaterThan(0);
  });

  it("gives an empty market nought rather than a division by zero", () => {
    const out = sharesWhereSold(held(0, 0), [company("us", [town.id]), company("them", everywhere)], niche);
    expect(out.us).toBe(0);
    expect(out.them).toBe(0);
  });

  it("treats a company it was handed no record of as selling everywhere", () => {
    /*
     * `held` and the company list come from the same resolve, so they agree —
     * but the fallback has to be the conservative one. Assuming a missing
     * company sells nowhere would divide by nearly nothing and award it the
     * market.
     */
    const out = sharesWhereSold(held(30_000, 70_000), [company("us", everywhere)], niche);
    expect(out.them).toBeCloseTo(0.7, 10);
  });
});
