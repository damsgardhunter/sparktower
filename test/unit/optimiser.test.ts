/**
 * The optimiser: one budget, five seats, one objective.
 *
 * These are the properties that make it a benchmark rather than another bot —
 * that it coordinates, that it respects what the company can actually pay,
 * and that it files the same plan twice for the same company. What it is
 * *worth* against the other tiers is measured in the backlog, not asserted
 * here, because that number is supposed to move when the engine changes.
 */
import { describe, it, expect } from "vitest";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { nicheById } from "@shared/simulation/niches";
import { ROLES, type World } from "@shared/simulation/types";
import { optimise, OPTIMISER_COMMITS, OPTIMISER_RESERVE_YEARS } from "@shared/simulation/optimiser";

const niche = nicheById("dating_apps")!;
const worldFor = (seasonId = "opt") =>
  buildWorld({ seasonId, niche, teams: [{ id: "us", name: "Us", seats: [...ROLES] }] });

const planFor = (world: World, year = 1) =>
  optimise({ world, companyId: "us", year, economy: economyFor("opt", year, 1) });

describe("the optimiser", () => {
  it("fills every seat, because it is deciding the whole company at once", () => {
    const plan = planFor(worldFor())!;
    expect(plan).not.toBeNull();
    for (const role of ROLES) {
      expect(plan.decisions[role], `nothing filed for ${role}`).toBeDefined();
    }
  });

  it("files the same plan twice for the same company", () => {
    // No jitter anywhere in it. A benchmark that moves on its own cannot tell
    // you whether a change to the engine moved it.
    const a = planFor(worldFor())!;
    const b = planFor(worldFor())!;
    expect(JSON.stringify(a.decisions)).toBe(JSON.stringify(b.decisions));
  });

  it("commits only what the company could actually lay hands on, loan included", () => {
    /*
     * The bound is a share of cash and credit, *plus* whatever it decided to
     * draw down — because borrowing to fund a plan is one of the things it
     * is allowed to do, and the engine bounds the draw itself (`drawdown`).
     */
    const world = worldFor();
    const me = world.companies.find((c) => c.id === "us")!;
    const couldRaise = Math.max(0, me.cash) + Math.max(0, (me.creditLimit ?? 0) - (me.debt ?? 0));
    const plan = planFor(world)!;
    const drawn = plan.decisions.cfo?.borrow ?? 0;
    expect(plan.spends).toBeLessThanOrEqual(couldRaise * OPTIMISER_COMMITS + drawn + 1);
  });

  it("opens a second region, which no seat deciding on its own ever could", () => {
    /*
     * Expansion takes a majority of the five seats, so it is the one decision
     * an optimiser can express and independent per-role bots structurally
     * cannot. Before this, no bot in the codebase had ever opened one, and a
     * company spent fourteen years selling into a tenth of its market.
     *
     * It also needs the objective to see a year further than the forecast
     * does: a region committed now opens *next* year, so at the moment the
     * next-year forecast is taken it is an entry cost and nothing else.
     */
    let world = worldFor("expand");
    let opened = false;
    for (let year = 1; year <= 5 && !opened; year++) {
      const plan = optimise({ world, companyId: "us", year, economy: economyFor("expand", year, 1) });
      if (!plan) break;
      if (plan.decisions.coo?.expand) opened = true;
      world = resolveYear({ ...world, year }, [plan.decisions as never]).world;
    }
    expect(opened).toBe(true);
  }, 60_000);

  it("prices against the market, not against what it charged last year", () => {
    /*
     * The trap this avoids: a search allowed to raise the price by half a
     * year, run fourteen years running, reaches two hundred and ninety times
     * where it started one locally-optimal step at a time. Anchoring to the
     * segment's own reference price makes that impossible to express.
     */
    const cheapest = [...niche.segments].sort((a, b) => a.referencePrice - b.referencePrice)[0];
    let world = worldFor();
    for (let year = 1; year <= 6; year++) {
      const plan = planFor(world, year);
      if (!plan) break;
      expect(plan.decisions.cmo!.price).toBeLessThanOrEqual(cheapest.referencePrice * 2);
      world = resolveYear({ ...world, year }, [plan.decisions as never]).world;
    }
  });

  it("keeps a year of running costs back rather than spending to the line", () => {
    /*
     * With solvency as the only constraint the search spends to exactly that
     * constraint — every year ending on nothing, and one ordinary bad year
     * from gone. The reserve is why it does not.
     */
    expect(OPTIMISER_RESERVE_YEARS).toBeGreaterThanOrEqual(1);
    let world = worldFor();
    for (let year = 1; year <= 4; year++) {
      const plan = planFor(world, year);
      if (!plan) break;
      world = resolveYear({ ...world, year }, [plan.decisions as never]).world;
      const me = world.companies.find((c) => c.id === "us");
      expect(me?.bankruptSince, `went under in year ${year}`).toBeFalsy();
    }
  });

  it("puts money into the product, which a one-year objective never would", () => {
    /*
     * The reason the lookahead exists. `projected` in `forecast.ts` leaves
     * this year's shipping out on purpose, because it lands next year — so an
     * optimiser scoring this year's forecast puts nothing into the product
     * and is right to. Scoring the year *after* the plan has been played is
     * what makes a pipeline worth paying for.
     */
    const plan = planFor(worldFor())!;
    const product = (plan.decisions.cto!.featureSpend ?? 0) + (plan.decisions.cto!.reliabilitySpend ?? 0);
    expect(product).toBeGreaterThan(0);
  });

  it("beats filing nothing at all", () => {
    const played = (use: boolean) => {
      let world = worldFor("bench");
      for (let year = 1; year <= 6; year++) {
        const plan = use ? optimise({ world, companyId: "us", year, economy: economyFor("bench", year, 1) }) : null;
        world = resolveYear({ ...world, year }, plan ? [plan.decisions as never] : []).world;
      }
      const me = world.companies.find((c) => c.id === "us");
      return Object.values(me?.customers ?? {}).reduce((a, b) => a + b, 0);
    };
    expect(played(true)).toBeGreaterThan(played(false));
  }, 60_000);
});
