/**
 * Balance problems measured over whole seasons: the ones still open, and the
 * guards left behind by the ones that closed.
 *
 * A problem still open is written with `it.fails`, which asserts that the test
 * does *not* pass. It states the property the game ought to have and carries
 * the measurement that showed it does not, so this file is the executable half
 * of `docs/simulation-backlog.md` — the prose says what is owed and these say
 * it in a way that cannot quietly stop being true.
 *
 *  - Fix one and its test starts failing, because a `.fails` test that passes
 *    is a failure. That is the alarm. Drop the `.fails` and the assertion
 *    becomes an ordinary guard against the bug coming back.
 *  - Nothing here is skipped. A skipped test is one nobody reads again.
 *
 * Five have been through that cycle. Four were fixed — bots opening where no
 * company could survive, bots unable to pay for a region out of a period's
 * marketing budget, an annual discount that was best at its cap in every
 * market, and a bot in a thin-margin market that borrowed to spend and never
 * stopped, which turned out to be drone delivery's biggest segment being
 * priced below what a business there costs to run (see `niches.ts`). That last
 * one is now guarded by `bot-play.test.ts` across every market, so it does not
 * need a second home here. The fourth, price tiers, was **withdrawn**: the measurement behind it
 * compared one tier setting, the best one, against no tiers at all, which asks
 * whether a well-set lever beats not using it. That is true of every lever in
 * the game and is not the standard. Swept properly the lever was fine, and the
 * guards below are what is left of it.
 *
 * Two of the four turned out to be the test being wrong rather than the game,
 * which is worth knowing before writing the next one.
 */
import { describe, it, expect } from "vitest";
import { buildWorld } from "@shared/simulation/season";
import { resolveYear } from "@shared/simulation/resolve";
import { NICHES, nicheById } from "@shared/simulation/niches";
import { defaultDraft } from "@shared/simulation/levers";
import { OPENING_BUDGET } from "@shared/simulation/season";
import { BOUGHT_REACH_FLOOR } from "@shared/simulation/world";
import { ROLES, type Role, type TeamDecisions, type World } from "@shared/simulation/types";
import { seedIncumbents } from "@shared/simulation/incumbents";
import { startingCompany } from "@shared/simulation/season";
import { botDecision } from "@shared/simulation/bots";

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


describe("the two doors into a new region", () => {
  /**
   * Fixed, and kept here as the guard it turned into.
   *
   * `expand` — the announced region, put to the table, opened a year later at
   * 70% — reaches only as far as the brand does in its first year, and the
   * player guide teaches that as a rule of the game. Buying a region through
   * the marketing seat's `targetCities` set no ramp at all, so the company had
   * the whole region from the day it paid, and the rule was untrue for anybody
   * who had found the other lever. That left the designed mechanic worse on
   * five axes out of six — year four against period one, one announced region
   * against any, a majority of the table against nobody's agreement, a year's
   * delay against none, and a ramp against none — for 30% off.
   *
   * Both doors charge for reach now. They do not charge the same, which is the
   * difference worth keeping: a company that paid full price to walk in chose
   * its moment, so it starts from a floor rather than from its brand alone.
   * See `BOUGHT_REACH_FLOOR`, which is set by what the catalogue bears.
   */
  it("charges a company for reach it has not earned, whichever door it used", () => {
    const niche = nicheById("dating_apps")!;
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
    const bought = [...niche.cities]
      .filter((c) => !home.me.cities.includes(c.id) && c.entryCost <= OPENING_BUDGET)
      .sort((a, b) => b.weight - a.weight)[0];
    const wider = firstPeriod([bought.id]);

    const times = bought.weight / homeWeight;
    const actual = wider.held / Math.max(1, home.held);
    /* Reaching it in full would be `1 + times`. The floor is what it actually gets. */
    expect(actual, `a bought region ${times.toFixed(1)}x the size of home multiplied customers by ${actual.toFixed(2)}, against ${(1 + times).toFixed(2)} for reaching it in full`)
      .toBeLessThan(1 + times * (BOUGHT_REACH_FLOOR + 0.1));
    /* And it is worth buying: paying full price gets you further in than announcing would. */
    expect(actual, "a bought region is not worth the money").toBeGreaterThan(1 + times * 0.2);
  });
});

describe("an annual discount", () => {
  /*
   * Fixed, and kept here as the guard it turned into.
   *
   * It used to be the right call in every market at every depth, all the way
   * to its cap: worth 20% to 40% of the company and monotonically better the
   * deeper it went. Coming off the plan is charged now — a year at 30% under
   * list makes the list price a 43% rise, and a rise on people already paying
   * is what this market has always said they leave over. That cost is
   * `d / (1 - d)`, so it grows faster than the discount and the lever has an
   * interior best. See `ANNUAL_UNWIND`.
   *
   * Sixteen quarters rather than twenty-four, which is the length a custom
   * season is actually sold at. Past about twenty the do-nothing baseline dies
   * in most economies, and a measurement of a dead company says nothing about
   * the lever.
   */
  const DEPTHS = [0, 10, 20, 30];
  const worthAt = (nicheId: string) => DEPTHS.map((d) => play(nicheId, 16, () => ({ cfo: { annualDiscount: d } })).worth);

  it("does not reward going to the cap", () => {
    for (const n of NICHES) {
      const worth = worthAt(n.id);
      const best = DEPTHS[worth.indexOf(Math.max(...worth))];
      expect(best, `${n.id}: the deepest discount is the best one, at ${worth.map(Math.round).join(" / ")}`)
        .toBeLessThan(30);
    }
  });

  it("is still worth taking", () => {
    // The other half of the standard: a lever that never helps is decoration.
    const helps = NICHES.filter((n) => {
      const worth = worthAt(n.id);
      return Math.max(...worth) > worth[0];
    });
    expect(helps.length, `a plan is worth offering in only ${helps.length} of ${NICHES.length} markets`)
      .toBeGreaterThanOrEqual(5);
  });
});

/**
 * Not an imbalance, and this is the correction.
 *
 * Price tiers were written up as "never the wrong call" on a measurement that
 * compared *one* tier setting — each segment at its own reference price, which
 * is the best setting there is — against a single list price. That asks
 * whether a well-set lever beats not using it, which is true of every lever in
 * the game and is not the standard.
 *
 * Swept properly, tiers behave like the price they are: every market has an
 * interior best, and both ends are punished. Undercutting every segment is
 * worse than one list price in four of the seven markets, and pricing every
 * segment at twice what it expects takes several of them to nothing.
 */
describe("price tiers", () => {
  const MULTS = [0.6, 1.0, 2.2];
  const worthAt = (nicheId: string) => {
    const niche = nicheById(nicheId)!;
    return MULTS.map((m) => play(nicheId, 16, () => ({
      cmo: { tiers: Object.fromEntries(niche.segments.map((s) => [s.id, Math.round(s.referencePrice * m)])) },
    })).worth);
  };

  it("has a best setting that is not at either end", () => {
    for (const n of NICHES) {
      const [low, middle, high] = worthAt(n.id);
      expect(middle, `${n.id}: undercutting every segment beats pricing at what they expect`).toBeGreaterThan(low);
      expect(middle, `${n.id}: doubling every segment's price beats pricing at what they expect`).toBeGreaterThan(high);
    }
  });

  it("can be set badly enough to be worse than one price for everybody", () => {
    const worse = NICHES.filter((n) => worthAt(n.id)[0] < play(n.id, 16, () => ({})).worth);
    expect(worse.length, "no market where a single list price beats badly-set tiers").toBeGreaterThan(0);
  });
});

/**
 * Owning something for a whole year makes the year worse.
 *
 * The effects reach the market — `assets-recovery.test.ts` asserts that, and a
 * company holding a patent and a distribution deal wins 25,118 customers at
 * the allocation against 15,338 without them. Run the same two companies
 * through a whole year and it inverts, and not monotonically:
 *
 *     plain    23,050 customers · revenue 507,100
 *     patent   13,166 customers · revenue 289,652
 *     deal     11,929 customers · revenue 262,438
 *     both     15,129 customers · revenue 332,838
 *
 * **The cause is known, and it is not what it looks like.** Not the incumbents
 * reacting: holding their capacity response flat changes none of these four
 * numbers, and blinding them to the player entirely changes none of them
 * either. Not capacity, not unit cost, and not appeal — merit wins are
 * correctly monotonic in quality, 7,189 plain against 8,324 with the patent.
 * The whole inversion is in the overflow, of which plain receives 15,861 and
 * the patent company 4,842.
 *
 * Customers a full rival turns away are shared among the companies with room,
 * in proportion to `appeal² × reach × fit` — **with no regard to how much room
 * each of them actually has**. Instrumented on the run above:
 *
 *     plain:   takers = [player]                           player share 1.0000
 *     patent:  takers = [inc_pairwise (room 105), player]  pairwise share 0.9692
 *
 * A rival with room for 105 people takes 96.9% of the claim on 45,695 turned
 * away, keeps its 105, and the other ~44,000 evaporate instead of passing to
 * the newcomer that had room for 27,373. What put that rival among the takers
 * at all was the *stronger* player winning enough on merit to leave it 105
 * short of its own capacity — so a 105-customer difference cost the player
 * about 11,000 customers, and owning two good things made the year worse.
 *
 * A fix was written and measured: share the overflow in passes, so a company
 * that fills up drops out and its remainder goes to the others. It makes the
 * four numbers monotonic — 31,084 / 32,842 / 42,827 / 50,642. It is not landed
 * here because the constants around it were tuned against the leak, and with
 * it in there is no setting of `SPILL_TOPUP_MAX` that satisfies everything at
 * once: at 3 a passive company stops turning a profit and a bought region is
 * worth its price again, but the premium team in the crowded season finishes
 * at 13.9m against a 16.1m bar; at 5 and above that reverses. That bar was
 * only 8% clear before any of this, so the crowded-market test has little room
 * to absorb a change this size.
 *
 * What is left is re-deriving the spill economy around the fix, not finding
 * the bug.
 */
describe("owning something for a whole year", () => {
  it("beats owning nothing", () => {
    const niche = nicheById("dating_apps")!;
    const base = () => ({
      ...startingCompany({ id: "t", name: "T", niche, seats: [...ROLES] as Role[] }),
      cash: 12_000_000, price: 22,
    });
    const patent = { id: "a1", kind: "patent" as const, name: "P", effect: { quality: 9, unitCost: 0.93 }, bookValue: 2_000_000 };
    const deal = { id: "a2", kind: "distribution" as const, name: "D", effect: { capacity: 500_000, brand: 6 }, bookValue: 2_400_000, expiresIn: 3 };
    const decisions = [{
      companyId: "t",
      cmo: { price: 22, brandSpend: 500_000, performanceSpend: 500_000, celebritySpend: 0, targetCities: [] },
      coo: { capacityTarget: 400_000, supportSpend: 200_000, efficiencySpend: 0, headcount: 5 },
    }] as unknown as TeamDecisions[];
    const year = (assets: any[]) => {
      const world = {
        seasonId: "s", niche, year: 1,
        economy: { demand: 1, interestRate: 0.08, costIndex: 1, outlook: "steady" as const },
        companies: [...seedIncumbents(niche), { ...base(), assets }],
      } as unknown as World;
      return resolveYear(world, decisions).reports.find((r) => r.companyId === "t")!.customers;
    };
    expect(year([patent, deal]), "owning two good things made the year worse").toBeGreaterThan(year([]));
  });
});
