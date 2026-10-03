/**
 * Every market can be won by somebody playing competently.
 *
 * The other balance tests ask whether a lever is worth pulling or whether five
 * teams in one market end up somewhere reasonable. This asks the flatter
 * question underneath all of them, for every market in the catalogue and
 * across several season seeds: can a founder who plays sensibly build a
 * business here at all, or is this a market that cannot be played?
 *
 * It exists because three separate faults have now produced markets that could
 * not be, and none of them were visible from inside a single season:
 *
 *  - rivals seated holding more of a segment than it contained, so the unowned
 *    pool opened negative, clamped to zero, and a founder won **nothing** for
 *    sixteen quarters at every level of spending;
 *  - the same thing arriving through the economy, because rivals were seated
 *    against the size a market is written with while a segment only holds
 *    `size * demand` people;
 *  - an opening plant sized against the whole unowned pool of a region, whose
 *    idle cost was the largest line in a founder's accounts and bankrupted
 *    them in the markets with the thinnest margin per customer.
 *
 * Each was found by sweeping markets against seeds and noticing a column of
 * zeros. This is that sweep, kept.
 *
 * The three things asserted are deliberately the weakest interesting ones.
 * Whether a market is *fun* is not something a test can hold; whether it can be
 * played at all is.
 */
import { describe, it, expect } from "vitest";
import { buildWorld, economyFor } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { defaultDraft } from "@shared/simulation/levers";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { buildCustomMarket } from "@shared/simulation/custom-market";
import {
  economyFalls, heldBy, playCompetently, winnabilityOf, WINNABLE_RATES, WINNABLE_SEEDS,
} from "@shared/simulation/winnable";
import { ROLES, type Role, type TeamDecisions, type World } from "@shared/simulation/types";

/*
 * The harness moved to `shared/simulation/winnable.ts`.
 *
 * It had to: a market Nova writes at runtime now gets the same check before
 * players are given it (`parseMarket`), and a guard more forgiving than this test
 * would let through exactly the markets this test exists to catch. One definition,
 * so they cannot disagree — the comments explaining the plan, the rates and the
 * falling-economy rule went with it.
 */
const held = heldBy;
const play = (
  niche: any, seasonId: string, rate: number, withEvents = false,
  cadence: "quarterly" | "monthly" = "quarterly",
) => playCompetently(niche, seasonId, rate, withEvents, cadence);
const SEEDS = WINNABLE_SEEDS;
const RATES = WINNABLE_RATES;
const falls = economyFalls;

describe("every market can be won", () => {
  for (const niche of NICHES) {
    describe(niche.id, () => {
      /*
       * Run twice, because the year's events were never part of this.
       *
       * Everything measured about balance in this file, and every sweep behind
       * it, passed `withoutEvent: true` — so a season's recalls, shortages,
       * shocks and windfalls had never been exercised against the claim that a
       * market can be played. The first thing running it with them on found
       * was a recall costing a flat GBP 450,000 in markets whose founders open
       * with GBP 15,485, which is 29x everything they have.
       */
      /*
       * Three ways round, because balance had only ever been measured one of
       * them. Every sweep behind this file ran quarterly with events off, so
       * neither a season's events nor the rhythm a founder actually decides on
       * — `project-simulation-routes.ts` calls monthly "closest to your actual
       * week" — had been held to the claim that a market can be played.
       */
      const seasons = [
        ...[false, true].flatMap((withEvents) => SEEDS.map((seed) => {
          const nothing = play(niche, seed, 0, withEvents);
          const best = RATES.map((rate) => play(niche, seed, rate, withEvents))
            .reduce((a, b) => (b.worth > a.worth ? b : a));
          return { seed: withEvents ? `${seed} (with the year's events)` : seed, nothing, best };
        })),
        ...SEEDS.map((seed) => {
          const nothing = play(niche, seed, 0, true, "monthly");
          const best = RATES.map((rate) => play(niche, seed, rate, true, "monthly"))
            .reduce((a, b) => (b.worth > a.worth ? b : a));
          return { seed: `${seed} (deciding monthly)`, nothing, best };
        }),
      ];

      it("gives a competent founder customers to win", () => {
        for (const { seed, best } of seasons) {
          expect(best.customers, `${niche.id} on seed "${seed}": won nobody in sixteen quarters`).toBeGreaterThan(0);
        }
      });

      it("does not bankrupt one for playing it", () => {
        for (const { seed, best } of seasons) {
          expect(best.bankrupt, `${niche.id} on seed "${seed}": the best plan tried still ended bankrupt`).toBe(false);
        }
      });

      it("pays better than filing nothing in most seasons, and leaves a business in all of them", () => {
        /*
         * Most, not all, and the exceptions are the point.
         *
         * Sitting on the money is a real strategy and the score now knows it —
         * there is a term for earnings, so a company that holds a small profit
         * is worth more than one that buys customers it cannot serve
         * profitably. Two shapes of season make holding the better play:
         *
         *   - one that opens at the top of the cycle and falls all the way
         *     down (the economy is a nine-year wave; a season is four years of
         *     it), which the desk warns about a period ahead — `outlook` reads
         *     "tightening" and is on the screen; and
         *   - a flat season in a market with a thin margin. Drone delivery on
         *     the flattest rising seed: holding ends on 8,690 customers and
         *     £3,435 of profit, spending a eighth of the bank a quarter ends on
         *     18,118 customers and £57,788 of *loss*, and the first is worth
         *     more. Growth pays when demand is growing.
         *
         * So the claim is that building the business wins in most seasons and
         * never leaves nothing at all. Demanding it win in every one would be
         * asserting that the game should reward growth it has just finished
         * telling the player not to buy.
         */
        /*
         * Not asked of a monthly season, and this is the measurement why.
         *
         * `DEFAULT_YEARS` gives monthly two years, on the reasoning that "every
         * lag in this game is a year long ... two years is the shortest span in
         * which a monthly table sees its own work arrive". The direction is
         * right and the number is not. Building the business, against doing
         * nothing at all, by season length:
         *
         *     podcasts          2yr 1.00x   3yr 1.00x   4yr 1.49x
         *     project_saas      2yr 1.00x   3yr 1.00x   4yr 1.41x
         *     restaurant_chain  2yr 1.01x   3yr 1.02x   4yr 1.25x
         *     dating_apps       2yr 1.01x   3yr 1.01x   4yr 1.58x
         *     mmos              2yr 1.08x   3yr 1.08x   4yr 1.72x
         *
         * It is not the rhythm: a *quarterly* season cut to two years is just
         * as flat (3,057,729 doing nothing against 3,051,750 spending), and a
         * monthly season given four years pays better than a quarterly one
         * (12,768,910 against 11,072,392). It is the length. Monthly is the
         * option the product calls "closest to your actual week", and it is the
         * one where nothing a founder decides pays for itself.
         *
         * Lengthening it is not obviously right either — four years of monthly
         * is 48 decisions, and a season resolves about one a day — so it is
         * written up in `docs/simulation-backlog.md` as a product question
         * rather than changed here. What monthly *is* held to is everything
         * else below: customers, solvency, and a season that can be run at a
         * profit.
         */
        const paid = seasons.filter(({ best, nothing }) => best.worth > nothing.worth);
        for (const { seed, best } of seasons) {
          expect(best.worth, `${niche.id} on seed "${seed}": left nothing worth having at all`).toBeGreaterThan(0);
        }
        expect(paid.length / seasons.length, `${niche.id}: building the business beat sitting on the money in only ${paid.length} of ${seasons.length} seasons`)
          .toBeGreaterThanOrEqual(0.7);
      });
    });
  }
}, 600_000);

/**
 * And the markets nobody wrote by hand.
 *
 * Everything above walks `NICHES`, which is the seven hand-written markets. It
 * is most of the balance contract in this repo and it had never once touched a
 * market Nova produced — so a change to the overflow that cost two generated
 * markets a quarter of their playable seeds went through CI green, and was
 * only visible because a scratch harness happened to be pointed at them.
 *
 * These are the shapes Nova actually returns, run through the same
 * `buildCustomMarket` the server uses, so the rules that make a generated
 * market playable — `openShareFor` and `pricedForABusiness` — are exercised
 * rather than assumed. They are small on purpose: every market generated from
 * a real project brief came back under £33m a year and most under £700,000,
 * which is the case the hand-written seven cannot stand in for.
 */
const GENERATED: Array<{ id: string; raw: Record<string, unknown> }> = [
  {
    /* A marketplace of a few thousand people whose biggest segment is its cheapest. */
    id: "kiln-hire",
    raw: {
      name: "Kiln hire", premise: "Studios rent out spare firings by the shelf.", baseUnitCost: 5,
      segments: [
        { id: "solo", name: "Solo hobbyists", size: 3000, referencePrice: 15, growth: 0.04, priceSensitivity: 0.6, qualityFocus: 0.4, brandFocus: 0.3, serviceFocus: 0.4, loyalty: 0.3 },
        { id: "groups", name: "Collectives", size: 2000, referencePrice: 25, growth: 0.03, priceSensitivity: 0.5, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.5, loyalty: 0.4 },
        { id: "trainers", name: "Workshop trainers", size: 2000, referencePrice: 50, growth: 0.05, priceSensitivity: 0.3, qualityFocus: 0.7, brandFocus: 0.3, serviceFocus: 0.6, loyalty: 0.6 },
      ],
      regions: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, name: `R${i}`, weight: i === 1 ? 0.3 : 0.175, entryCost: 500, note: "" })),
      incumbents: [0.3, 0.2, 0.15].map((startingShare, i) => ({ id: `riv${i}`, name: `Rival ${i}`, posture: "coaster", startingShare, quality: 50, brand: 50, service: 50, priceIndex: 1 })),
    },
  },
  {
    /* A consumer app whose biggest segment pays about what it costs to serve. */
    id: "sea-swimming",
    raw: {
      name: "Sea swimming", premise: "Tides, temperature and who else is going.", baseUnitCost: 1,
      segments: [
        { id: "casual", name: "Casual", size: 20000, referencePrice: 1, growth: 0.05, priceSensitivity: 0.8, qualityFocus: 0.3, brandFocus: 0.4, serviceFocus: 0.3, loyalty: 0.2 },
        { id: "keen", name: "Enthusiasts", size: 15000, referencePrice: 3, growth: 0.06, priceSensitivity: 0.5, qualityFocus: 0.6, brandFocus: 0.3, serviceFocus: 0.5, loyalty: 0.5 },
        { id: "leaders", name: "Community leaders", size: 5000, referencePrice: 5, growth: 0.04, priceSensitivity: 0.4, qualityFocus: 0.6, brandFocus: 0.5, serviceFocus: 0.6, loyalty: 0.6 },
      ],
      regions: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, name: `R${i}`, weight: i === 1 ? 0.3 : 0.175, entryCost: 400, note: "" })),
      incumbents: [0.28, 0.22, 0.14].map((startingShare, i) => ({ id: `riv${i}`, name: `Rival ${i}`, posture: "coaster", startingShare, quality: 50, brand: 50, service: 50, priceIndex: 1 })),
    },
  },
  {
    /* Public-sector B2B: few buyers, six places, and the one that regressed. */
    id: "council-minutes",
    raw: {
      name: "Council minutes", premise: "Minutes and motions for parish and town councils.", baseUnitCost: 5,
      segments: [
        { id: "small", name: "Small parish clerks", size: 2000, referencePrice: 30, growth: 0.03, priceSensitivity: 0.7, qualityFocus: 0.4, brandFocus: 0.2, serviceFocus: 0.6, loyalty: 0.7 },
        { id: "town", name: "Town clerks", size: 2000, referencePrice: 50, growth: 0.04, priceSensitivity: 0.5, qualityFocus: 0.5, brandFocus: 0.3, serviceFocus: 0.6, loyalty: 0.7 },
        { id: "networks", name: "Council networks", size: 2000, referencePrice: 75, growth: 0.05, priceSensitivity: 0.4, qualityFocus: 0.6, brandFocus: 0.3, serviceFocus: 0.7, loyalty: 0.8 },
        { id: "innovators", name: "Niche innovators", size: 2000, referencePrice: 90, growth: 0.06, priceSensitivity: 0.3, qualityFocus: 0.7, brandFocus: 0.4, serviceFocus: 0.6, loyalty: 0.6 },
      ],
      regions: [1, 2, 3, 4, 5, 6].map((i) => ({ id: `r${i}`, name: `R${i}`, weight: i === 1 ? 0.3 : 0.14, entryCost: 600, note: "" })),
      incumbents: [0.3, 0.22, 0.16].map((startingShare, i) => ({ id: `riv${i}`, name: `Rival ${i}`, posture: "coaster", startingShare, quality: 55, brand: 55, service: 50, priceIndex: 1 })),
    },
  },
  {
    /* And one with real money in it, so the range is covered at both ends. */
    id: "scrap-yards",
    raw: {
      name: "Scrap yards", premise: "Routing and weighbridge software for independent yards.", baseUnitCost: 60,
      segments: [
        { id: "single", name: "Single-site yards", size: 4000, referencePrice: 600, growth: 0.03, priceSensitivity: 0.6, qualityFocus: 0.5, brandFocus: 0.2, serviceFocus: 0.6, loyalty: 0.6 },
        { id: "multi", name: "Multi-site", size: 2500, referencePrice: 1000, growth: 0.05, priceSensitivity: 0.4, qualityFocus: 0.6, brandFocus: 0.3, serviceFocus: 0.7, loyalty: 0.7 },
        { id: "groups", name: "Groups", size: 2000, referencePrice: 1200, growth: 0.06, priceSensitivity: 0.3, qualityFocus: 0.7, brandFocus: 0.4, serviceFocus: 0.7, loyalty: 0.8 },
      ],
      regions: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, name: `R${i}`, weight: i === 1 ? 0.32 : 0.17, entryCost: 20_000, note: "" })),
      incumbents: [0.32, 0.2, 0.15].map((startingShare, i) => ({ id: `riv${i}`, name: `Rival ${i}`, posture: "coaster", startingShare, quality: 55, brand: 50, service: 50, priceIndex: 1 })),
    },
  },
];

describe("a market Nova wrote can be won too", () => {
  for (const { id, raw } of GENERATED) {
    describe(id, () => {
      const niche = buildCustomMarket(raw, id, { fresh: true });
      const seasons = niche
        ? [false, true].flatMap((withEvents) => SEEDS.map((seed) => {
            const nothing = play(niche, seed, 0, withEvents);
            const best = RATES.map((rate) => play(niche, seed, rate, withEvents)).reduce((a, b) => (b.worth > a.worth ? b : a));
            return { seed: withEvents ? `${seed} (with the year's events)` : seed, nothing, best };
          }))
        : [];

      it("is a market at all", () => {
        expect(niche, `${id}: the cleaner refused it outright`).toBeTruthy();
      });

      it("gives a competent founder customers to win", () => {
        for (const { seed, best } of seasons) {
          expect(best.customers, `${id} on seed "${seed}": won nobody in sixteen quarters`).toBeGreaterThan(0);
        }
      });

      it("does not bankrupt one for playing it", () => {
        for (const { seed, best } of seasons) {
          expect(best.bankrupt, `${id} on seed "${seed}": the best plan tried still ended bankrupt`).toBe(false);
        }
      });

      it("pays better than filing nothing, where the economy is not falling away", () => {
        const paid = seasons.filter(({ best, nothing }) => best.worth > nothing.worth);
        for (const { seed, best } of seasons) {
          expect(best.worth, `${id} on seed "${seed}": left nothing worth having at all`).toBeGreaterThan(0);
        }
        expect(paid.length / seasons.length, `${id}: building the business beat sitting on the money in only ${paid.length} of ${seasons.length} seasons`)
          .toBeGreaterThanOrEqual(0.7);
      });

      it("can be run at a profit", () => {
        /*
         * The property the overflow change cost two generated markets, and the
         * reason the three above were not enough: a founder can hold customers,
         * stay solvent and still never once have a quarter that paid for
         * itself. In a market small enough that one salary is most of the cost
         * base, that is the difference between a business and an expensive
         * hobby.
         */
        for (const { seed } of seasons) {
          const raw2 = seasons.find((x) => x.seed === seed)!;
          expect(raw2.best.profitable, `${id} on seed "${seed}": not one profitable quarter in sixteen`).toBeGreaterThan(0);
        }
      });
    });
  }
}, 600_000);

/*
 * The guard that runs where markets are written, against the markets that ship.
 *
 * `winnabilityOf` is the cheap version of everything above, and it runs inside
 * `parseMarket` so a market Nova writes at runtime is checked before anybody is
 * given it. A guard has exactly one calibration available: the seven markets that
 * are known to be playable have to pass it. If it ever rejects one of those, the
 * guard is wrong about the market and not the other way round — and the cost of
 * being wrong that way is invisible, because the route falls back to the catalogue
 * and nobody is told the market they asked for was thrown away.
 *
 * This caught a real mistake. The first version checked eight periods on the
 * reasoning that the faults show early; six of the seven failed, because a company
 * does not turn a profitable quarter in its first two years.
 */
describe("the runtime winnability guard", () => {
  for (const niche of NICHES) {
    it(`passes ${niche.id}, which is known to be playable`, () => {
      const verdict = winnabilityOf(niche);
      expect(verdict.ok, `${niche.id} was rejected: ${verdict.problems.join("; ")}`).toBe(true);
    }, 30_000);
  }

  it("refuses a market with nothing in it, rather than throwing at whoever asked", () => {
    for (const nothing of [null, undefined, { ...nicheById("podcasts")!, segments: [] }]) {
      const verdict = winnabilityOf(nothing as any);
      expect(verdict.ok).toBe(false);
      expect(verdict.problems.length).toBeGreaterThan(0);
    }
  });

  it("catches a market whose segments are already fully owned", () => {
    /*
     * The first of the three faults, in its simplest form: rivals seated across
     * the whole of every segment leave a founder nobody to win. This is the shape
     * the sweeps found by noticing a column of zeros.
     */
    const base = nicheById("podcasts")!;
    const taken = {
      ...base,
      incumbents: base.incumbents.map((i) => ({
        ...i,
        startingShare: Object.fromEntries(base.segments.map((sg) => [sg.id, 1])),
      })),
    } as any;
    const verdict = winnabilityOf(taken);
    expect(verdict.ok, "a market with no unowned customers passed the guard").toBe(false);
  }, 30_000);

  it("says what was checked, so a verdict can be read back later", () => {
    /*
     * It is logged and then thrown away — the route falls back and carries on — so
     * the verdict has to carry enough to tell later whether the guard was being
     * strict or the market was being bad.
     */
    const verdict = winnabilityOf(nicheById("podcasts")!);
    expect(verdict.checked.periods).toBe(16);
    expect(verdict.checked.seeds.length).toBeGreaterThan(0);
    expect(verdict.checked.rates.length).toBeGreaterThan(1);
  }, 30_000);
});
