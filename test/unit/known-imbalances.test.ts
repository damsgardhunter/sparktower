/**
 * The balance problems that are measured, understood, and still here.
 *
 * Everything in this file is written with `it.fails`, which asserts that the
 * test does *not* pass. Each one states the property the game ought to have,
 * with the measurement that showed it does not. That makes this the executable
 * half of `docs/simulation-backlog.md`: the prose says what is owed, and these
 * say it in a way that cannot quietly stop being true.
 *
 * Two things follow from that, and both are the point:
 *
 *  - Fix one of these and its test starts failing, because a `.fails` test
 *    that passes is a failure. That is the alarm. Delete the `.fails` and the
 *    assertion becomes an ordinary guard against the bug coming back.
 *  - Nothing here is skipped. A skipped test is one nobody reads again.
 *
 * Why none of these were simply fixed: each is a tuning judgement against
 * markets balanced over years of play, not an arithmetic defect. Where this
 * sitting found arithmetic — a year's rate charged for a period, absolute
 * money in a scaled market, copy describing a cost no code applied — it was
 * fixed and guarded by an ordinary test. These are the ones where the
 * arithmetic is honest and the *design* is the question, so the measurement is
 * recorded and the call left to somebody who can make it.
 */
import { describe, it, expect } from "vitest";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { defaultDraft } from "@shared/simulation/levers";
import { botDecision } from "@shared/simulation/bots";
import { OPENING_BUDGET } from "@shared/simulation/season";
import { ROLES, type Role, type TeamDecisions, type World } from "@shared/simulation/types";

const held = (c: any): number =>
  Object.values(c?.customers ?? {}).reduce((sum: number, n: any) => sum + (Number(n) || 0), 0);

/** A season played by one company, filing what the desk would file. */
function play(nicheId: string, periods: number, strategy: (p: number, me: any) => any) {
  const niche = nicheById(nicheId)!;
  let world: World = buildWorld({
    seasonId: "known", niche, cadence: "quarterly",
    teams: [{ id: "me", name: "Mine", seats: [...ROLES], officers: 1 }],
  });
  let previous: any;
  let last: any;
  for (let p = 1; p <= periods; p++) {
    const me = world.companies.find((c) => c.id === "me")!;
    const filed: any = { companyId: "me" };
    const want = strategy(p, me) ?? {};
    for (const r of ROLES) filed[r] = { ...defaultDraft(r, me as any, previous?.[r]), ...(want[r] ?? {}) };
    const out = resolveYear({ ...world, year: p }, [filed as TeamDecisions], undefined, { withoutEvent: true });
    last = out.reports.find((x: any) => x.companyId === "me");
    previous = filed;
    world = out.world;
  }
  return { worth: last.value ?? 0, customers: held(world.companies.find((c) => c.id === "me")) };
}

describe("levers that are always the right answer", () => {
  /**
   * `responsibilities.ts` sets the standard these fail:
   *
   *   "Each one was built to have a real trade-off … a range where it helps,
   *    and a setting where it hurts. A lever that only ever helps is a tax on
   *    not noticing it; a lever that never helps is decoration."
   */
  it.fails("annual plans should cost more than they buy somewhere", () => {
    /*
     * Measured over twenty-four quarters, worth at the cap against worth with
     * no plan: dating apps +152,448, restaurant chain +134,971, project
     * management +128,766 — 20% to 40% of the company, in every market, and
     * monotonically better all the way to `ANNUAL_DISCOUNT_MAX`. Only MMOs has
     * a peak below the cap.
     *
     * The arithmetic is honest: about 13% of revenue buys about 21% less
     * churn. In markets whose segments are this flighty (loyalty 0.24 to 0.38)
     * reduced churn compounds over a season while the discount is charged once
     * a period, so it wins. What is missing is a market or a setting where the
     * discount costs more than the retention is worth.
     */
    const hurts = NICHES.filter((n) => {
      const none = play(n.id, 16, () => ({ cfo: { annualDiscount: 0 } }));
      const deep = play(n.id, 16, () => ({ cfo: { annualDiscount: 30 } }));
      return deep.worth < none.worth;
    });
    expect(hurts.length, "no market where an annual discount is the wrong call").toBeGreaterThan(0);
  });

  it.fails("price tiers should be the wrong call somewhere", () => {
    /*
     * A tier at each segment's own reference price beats a single list price
     * in every market. Drone delivery 197,010 → 601,380; podcasts 262,399 →
     * 483,481. The gain tracks the spread in what segments will pay — drone
     * delivery's dearest segment pays 28 times its cheapest — so this is price
     * discrimination behaving correctly, and a business with that spread
     * genuinely must segment.
     *
     * The level of each tier is a real decision. *Whether* to set tiers at all
     * is not, and a table that has not found the lever is playing at a
     * two-thirds handicap without being told.
     */
    const hurts = NICHES.filter((n) => {
      const niche = nicheById(n.id)!;
      const list = play(n.id, 16, () => ({}));
      const tiered = play(n.id, 16, () => ({
        cmo: { tiers: Object.fromEntries(niche.segments.map((s) => [s.id, Math.round(s.referencePrice)])) },
      }));
      return tiered.worth < list.worth;
    });
    expect(hurts.length, "no market where a single list price beats tiers").toBeGreaterThan(0);
  });
});

describe("bots, once they have opened", () => {
  const niche = nicheById("dating_apps")!;

  it.fails("should put a region up for the table at some point in a season", () => {
    /*
     * `bots.ts` files an empty `expand` every period and deletes `expandVote`,
     * so a bot never proposes a region and never votes on a person's. Bot-run
     * companies grow only through the marketing seat's `targetCities`.
     *
     * Measured: a bot that opened in a region holding 2.0% of its market sat
     * on that one region for twenty-four quarters and finished worth nothing,
     * with £1.7m in the bank at period four and a region announced at £35,000.
     * It was not that it could not leave. Nothing ever tried.
     */
    const world = buildWorld({
      seasonId: "known-bots", niche, cadence: "quarterly",
      teams: [{ id: "b", name: "b", seats: [...ROLES] as Role[], botRun: true }],
    });
    const bot = world.companies.find((c) => c.id === "b")!;
    const proposals = Array.from({ length: 24 }, (_, i) =>
      botDecision({ ventureId: "b", year: i + 1, role: "coo", company: bot as any, niche, rivals: [], skill: "survivor" }).expand);
    expect(proposals.filter(Boolean).length, "a bot never proposes a region, in a whole season").toBeGreaterThan(0);
  });

});

describe("the two doors into a new region", () => {
  it.fails("should both charge a company for reach it has not earned", () => {
    /*
     * `expand` — the announced region, put to the table, opened next year at
     * 70% — reaches only as far as the brand does in its first year, and the
     * player guide teaches that as a rule of the game: "a region opened this
     * period is reached only as far as your brand carries". Buying one through
     * the marketing seat's `targetCities` sets no ramp, so `regionalReach`
     * reads `?? 1` and the company has the whole region from the day it pays.
     *
     * That leaves the designed mechanic worse on five axes out of six: year
     * four against period one, one announced region against any, a majority of
     * the table against nobody's agreement, a year's delay against none, and a
     * ramp against none — for 30% off.
     *
     * Applying the ramp to a bought region is four lines, and it was tried:
     * `balance.test.ts` went from two-plus teams finishing with a business to
     * one. Those markets are tuned against regions being fully reached the
     * period they are paid for, so making the rule consistent means re-tuning
     * expansion economics rather than adding a ramp.
     */
    const niche = nicheById("dating_apps")!;
    /*
     * Asserted on customers rather than on the `ramp` field, because `ramp` is
     * deliberately cleared at the end of the period it applies to — reading it
     * afterwards says nothing either way.
     */
    const firstPeriod = (cities?: string[]) => {
      const world = buildWorld({
        seasonId: "known-door", niche, cadence: "quarterly",
        teams: [{ id: "me", name: "Mine", seats: [...ROLES], officers: 1 }],
      });
      const me: any = world.companies.find((c) => c.id === "me")!;
      const filed: any = { companyId: "me" };
      for (const r of ROLES) filed[r] = { ...defaultDraft(r, me) };
      if (cities) filed.cmo = { ...filed.cmo, targetCities: [...me.cities, ...cities] };
      const out = resolveYear({ ...world, year: 1 }, [filed as TeamDecisions], undefined, { withoutEvent: true });
      return { me, held: held(out.world.companies.find((c: any) => c.id === "me")) };
    };

    const home = firstPeriod();
    const homeWeight = niche.cities.find((c) => c.id === home.me.cities[0])!.weight;
    /* The largest region the company could buy into on day one. */
    const bought = [...niche.cities]
      .filter((c) => !home.me.cities.includes(c.id) && c.entryCost <= OPENING_BUDGET)
      .sort((a, b) => b.weight - a.weight)[0];
    const wider = firstPeriod([bought.id]);

    /*
     * Brand opens at 8, so `firstYearReach` is its floor of 15%. A region
     * reached at 15% should add about a seventh of what reaching it in full
     * would add; the test allows half, which is generous and still nowhere
     * near what full reach gives.
     */
    const ifReachedInFull = 1 + bought.weight / homeWeight;
    const actual = wider.held / Math.max(1, home.held);
    expect(actual, `buying a region ${(bought.weight / homeWeight).toFixed(1)}x the size of home multiplied customers by ${actual.toFixed(2)}, against ${ifReachedInFull.toFixed(2)} for reaching it in full`)
      .toBeLessThan(1 + (bought.weight / homeWeight) * 0.5);
  });
});
