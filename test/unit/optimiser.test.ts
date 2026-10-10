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
     * where it started one locally-optimal step at a time. Every anchor the
     * ladder is built from is static market data, so nothing it can express
     * compounds.
     *
     * ## Why the bound is the dearest segment and not the cheapest
     *
     * It used to be twice the *cheapest* reference, which was the right
     * reading of a ladder anchored only on that segment. It is the wrong
     * reading of a market: dating apps has segments expecting £40, £70 and
     * £160, and £112 — the figure this caught — is a company pricing at the
     * long-haulers, who weigh quality at 0.75 and price at 0.25. That is a
     * strategy the game is supposed to contain, and in a market whose segments
     * are further apart still, refusing it left the price lever dead for a
     * whole season (see `priceTries` in optimiser.ts).
     *
     * So the bound is the thing actually worth guarding: the price stays
     * inside the range the market itself describes, however many years it
     * runs. Fourteen rather than six, because a spiral needs room to show —
     * compounding at half a year clears twice the dearest segment by year
     * four and this would have caught it at any length.
     */
    const dearest = Math.max(...niche.segments.map((s) => s.referencePrice));
    let world = worldFor();
    const prices: number[] = [];
    for (let year = 1; year <= 14; year++) {
      const plan = planFor(world, year);
      if (!plan) break;
      prices.push(plan.decisions.cmo!.price);
      expect(plan.decisions.cmo!.price, `year ${year} priced outside the market's own range`)
        .toBeLessThanOrEqual(dearest * 2);
      world = resolveYear({ ...world, year }, [plan.decisions as never]).world;
    }
    /*
     * A spread across the season is not evidence either way, and asserting one
     * was a mistake worth recording. It caught 2.48x and 2.48x is a company
     * that opened at the cheap segment and moved to the dear one as its
     * quality earned the right — which is a strategy this market is built to
     * contain, not a ratchet. Loosening that number until it passed would have
     * been re-setting a guard to make a red suite green.
     *
     * The invariant is tested directly below instead.
     */
    expect(prices.length, "no plan survived the season").toBeGreaterThan(1);
  }, 120_000);

  it("ignores the company's own price when deciding what to charge", () => {
    /*
     * The structural half of the test above, and the one that cannot be argued
     * with: the same company, in the same market, with its own price moved —
     * and the ladder is built from the market, so the answer should not follow
     * the company.
     *
     * This is what stops the 290x spiral. A search that anchors on what it
     * charged last year raises the price a little, finds that was locally
     * better, and anchors on *that* next year. A search anchored on the
     * segments cannot express the second step, however many years it runs.
     */
    const market = worldFor("anchor");
    const dear: World = {
      ...market,
      companies: market.companies.map((c) => (c.id === "us" ? { ...c, price: (c.price ?? 1) * 10 } : c)),
    };
    const normal = planFor(market, 1)!;
    const inflated = planFor(dear, 1)!;
    expect(normal).not.toBeNull();
    expect(inflated).not.toBeNull();
    const dearest = Math.max(...niche.segments.map((s) => s.referencePrice));
    expect(inflated.decisions.cmo!.price, "a tenfold opening price dragged the plan's price up with it")
      .toBeLessThanOrEqual(dearest * 2);
  }, 120_000);

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
    /*
     * Asserted across a season rather than in the first year, because
     * declining it in year one can be the right answer: dating apps opens
     * onto a segment that weighs brand at 0.62 and quality at 0.30, so a
     * company with nothing has better things to buy first. What the lookahead
     * has to make possible is buying it at all.
     */
    /*
     * ## What this actually proves, which is less than its name
     *
     * It sums `featureSpend` and `reliabilitySpend` and asks for either. They
     * are not the same purchase: reliability is bought on the technology desk
     * and lands as service, while *shipping* is `featureSpend`, which becomes
     * `pipeline` and lands as quality a year later. The comment above is about
     * shipping. The assertion is satisfied by reliability alone — and
     * reliability is what gets bought, so this has been passing for a reason
     * that has nothing to do with the lookahead it was written to defend.
     *
     * Split, so each half says what is true. The feature half is pinned below.
     */
    let world = worldFor("product");
    let features = 0;
    let reliability = 0;
    for (let year = 1; year <= 6; year++) {
      const plan = optimise({ world, companyId: "us", year, economy: economyFor("product", year, 1) });
      if (!plan) break;
      features += plan.decisions.cto!.featureSpend ?? 0;
      reliability += plan.decisions.cto!.reliabilitySpend ?? 0;
      world = resolveYear({ ...world, year }, [plan.decisions as never]).world;
    }
    expect(features + reliability, "nothing at all went into the technology desk").toBeGreaterThan(0);
    expect(reliability, "reliability is bought").toBeGreaterThan(0);
    /*
     * ## And shipping, by name
     *
     * This asked only for the pair for a long time, which meant it passed on
     * reliability alone while `featureSpend` sat at zero — the comment above is
     * about *shipping*, and shipping is this field. A companion test pinned the
     * zero so that fixing it would be noticed; it was, and it is deleted.
     *
     * What fixed it: `ascend` took the argmax of the levers and gave it the
     * whole slice. Features score above doing nothing and rank fourth of six
     * every round, and the ascent hands out two or three slices before no
     * single slice pays — so the fourth-best lever was never reached, in any
     * market. Funding every lever that pays on its own took it from 1 funded
     * year in 126 to five of seven markets, and quality with it: a coffee
     * roastery finished on 26 rather than 15.
     */
    expect(features, "the pipeline is still never funded — see `ascend` in optimiser.ts").toBeGreaterThan(0);
  }, 60_000);

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
