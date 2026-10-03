/**
 * Can this market be played at all?
 *
 * ## Why this is a module and not only a test
 *
 * `test/unit/every-market-winnable.test.ts` has asked this of the seven
 * catalogue markets, and of a handful of generated shapes it builds itself, since
 * three separate faults produced markets nobody could play: rivals seated holding
 * more of a segment than it contained, the same thing arriving through the
 * economy, and an opening plant whose idle cost bankrupted a founder in the
 * thinnest markets. Each was found by sweeping markets against seeds and noticing
 * a column of zeros.
 *
 * None of that protected the markets players actually get. A market Nova writes
 * at runtime is checked for *shape* — `buildCustomMarket` clamps every number to
 * a range the engine survives and normalises the shares — and never for whether a
 * business can be built in it. A season that cannot be won is not a bug anybody
 * reports; it is a fortnight somebody spends losing and concludes they are bad at
 * it. That is the failure this exists to stop, and it has to run where the market
 * is written rather than where the catalogue is tested.
 *
 * So the harness moved here out of that test, which now imports it. One
 * definition, because two would disagree: a guard that was more forgiving than
 * the test would let through exactly the markets the test exists to catch, and
 * nobody would notice until a player did.
 *
 * ## What it costs
 *
 * One seed and a full season: 57ms a market, measured across the seven, beside a
 * model call that takes several seconds. The test sweeps three seeds, two event
 * modes and both cadences, as it should; this is the cheapest check that would
 * have caught any of the three faults.
 *
 * **A full season, and not a shorter one.** The first draft of this stopped at
 * eight periods on the reasoning that the faults show up early — which is true of
 * the zeros and the bankruptcy, and false of the third property. Measured at eight
 * periods, *six of the seven catalogue markets fail*: a company does not reach a
 * profitable quarter in its first two years, which is the game working rather than
 * the market being unplayable. A guard calibrated that way would have rejected
 * almost everything Nova wrote and quietly handed every player a catalogue market
 * instead. Sixteen costs the same and the seven pass, which is the only
 * calibration available — a guard that rejects a shipped market is wrong about the
 * market.
 */
import { buildWorld, economyFor } from "./season";
import { resolveYear } from "./resolve";
import { defaultDraft } from "./levers";
import { ROLES, type Niche, type Role, type World } from "./types";
import type { TeamDecisions } from "./decisions";

/** Everybody one company holds, across every segment. */
export const heldBy = (c: { customers?: Record<string, number> } | undefined): number =>
  Object.values(c?.customers ?? {}).reduce((sum: number, n) => sum + (Number(n) || 0), 0);

export interface SeasonPlayed {
  /** How many of the periods turned a profit. */
  profitable: number;
  /** What the business was worth at the end. */
  worth: number;
  customers: number;
  bankrupt: boolean;
}

/**
 * A season played the way somebody sensible would play it: quality first while
 * the company is small, growth once it has something to grow, capacity kept
 * ahead of what is served, and a steady share of the money spent each period.
 *
 * `rate` is that share. Nothing here is tuned to any particular market — the
 * point is that an ordinary competent plan works everywhere, not that a
 * market-specific one does.
 */
export function playCompetently(
  niche: Niche,
  seasonId: string,
  rate: number,
  withEvents = false,
  cadence: "quarterly" | "monthly" = "quarterly",
  periods?: number,
): SeasonPlayed {
  let world: World = buildWorld({
    seasonId, niche, cadence,
    teams: [{ id: "me", name: "Mine", seats: [...ROLES] as Role[], officers: 1 }],
  });
  let previous: any;
  let last: any;
  let profitable = 0;
  const spans = periods ?? (cadence === "monthly" ? 24 : 16);
  const perYear = cadence === "monthly" ? 12 : 4;
  for (let period = 1; period <= spans; period++) {
    const me: any = world.companies.find((c) => c.id === "me")!;
    /*
     * A share of the bank each *year*, not each decision.
     *
     * `RATES` is written per quarter, and a monthly season decides three times as
     * often — so spending the same fraction every period spends three times as
     * much a year, which made a monthly season look like the engine was broken
     * when it was this line.
     */
    const spend = Math.max(0, Number(me.cash) * rate * (4 / perYear));
    const want: Record<string, any> = {
      ceo: { focus: period <= 6 ? "quality" : "growth" },
      cmo: { brandSpend: Math.round(spend * 0.25), performanceSpend: Math.round(spend * 0.15) },
      cto: { featureSpend: Math.round(spend * 0.2), reliabilitySpend: Math.round(spend * 0.2), researchSpend: Math.round(spend * 0.1) },
      coo: { capacityTarget: Math.max(Number(me.capacity) || 0, Math.round(heldBy(me) * 2)), supportSpend: Math.round(spend * 0.1) },
    };
    const filed: any = { companyId: "me" };
    for (const role of ROLES) filed[role] = { ...defaultDraft(role, me, previous?.[role]), ...(want[role] ?? {}) };
    /*
     * The period's economy, which is what the server passes (`tickSeason`). Left
     * out, `resolveYear` holds the opening economy for the whole season and demand
     * never moves.
     */
    const out = resolveYear(
      { ...world, year: period },
      [filed as TeamDecisions],
      economyFor(seasonId, period, perYear),
      withEvents ? {} : { withoutEvent: true },
    );
    last = out.reports.find((r: any) => r.companyId === "me");
    if (last.profit > 0) profitable++;
    previous = filed;
    world = out.world;
  }
  return {
    profitable,
    worth: last.value ?? last.founderValue ?? 0,
    customers: heldBy(world.companies.find((c: any) => c.id === "me") as any),
    bankrupt: !!last.bankrupt,
  };
}

/** Three seeds spanning the economy's range: below trend, near it, and a boom. */
export const WINNABLE_SEEDS = ["w", "a", "h"];

/**
 * Four honest rates, and the low ones matter most.
 *
 * These were 0.06 and 0.12 of the bank *per quarter* — a quarter to a half of
 * everything the company has, every year. That is not "playing competently", it
 * is spending hard, and once the score grew a term for earnings the engine
 * started punishing it correctly. A founder has the option of spending a little,
 * and in a thin market it is usually the right one. The best of these is what
 * "played competently" means.
 */
export const WINNABLE_RATES = [0.01, 0.03, 0.06, 0.12];

/**
 * Whether a season's economy ends below where it started.
 *
 * It decides what "playing well" even means. The economy is a cycle and a season
 * opening at the top of it falls all the way down — seed "h" runs 1.118 to 0.908
 * over sixteen quarters. Spending into that is a mistake the desk warns about a
 * period ahead, so on a falling season the claim is only that there is still a
 * business at the end of it.
 */
export const economyFalls = (seed: string, periods = 4, spans = 16): boolean =>
  economyFor(seed, spans, periods).demand < economyFor(seed, 1, periods).demand - 0.02;

export interface Winnability {
  ok: boolean;
  /** Why not, in sentences meant for a log rather than a player. */
  problems: string[];
  /** What was actually run, so a verdict can be read back later. */
  checked: { seeds: string[]; periods: number; rates: number[] };
}

/**
 * Is a business buildable here?
 *
 * The three weakest interesting properties, which are the ones the test asserts:
 * a competent founder wins somebody, is not bankrupted for trying, and has at
 * least one period that paid. Whether a market is *fun* is not something code can
 * hold; whether it can be played at all is.
 *
 * "Competent" is the best of `WINNABLE_RATES`, not a fixed rate, for the reason
 * written on that constant: a market where spending a little is the only sensible
 * plan is a real market, and judging it on a hard-spending plan would condemn it
 * for a mistake a player would not make.
 *
 * Events are left off by default. They add variance rather than reachability, and
 * a market rejected because one seed happened to draw a recall is a market
 * rejected for the weather.
 */
export function winnabilityOf(niche: Niche | null | undefined, opts: {
  seeds?: string[];
  periods?: number;
  withEvents?: boolean;
} = {}): Winnability {
  const seeds = opts.seeds ?? [WINNABLE_SEEDS[1]];
  /*
   * A full quarterly season. Shorter rejects the catalogue — see the note at the
   * top of this file.
   */
  const periods = opts.periods ?? 16;
  const checked = { seeds, periods, rates: WINNABLE_RATES };

  if (!niche) return { ok: false, problems: ["there is no market to check"], checked };
  if (!niche.segments?.length) return { ok: false, problems: ["the market has no segments"], checked };

  const problems: string[] = [];
  for (const seed of seeds) {
    let best: SeasonPlayed | null = null;
    for (const rate of WINNABLE_RATES) {
      let run: SeasonPlayed;
      try {
        run = playCompetently(niche, seed, rate, opts.withEvents ?? false, "quarterly", periods);
      } catch (err) {
        /*
         * A market that makes the engine throw is the least winnable kind there
         * is, and this is a guard rather than a crash site: the caller wants a
         * verdict, not an exception thrown at somebody who pressed a button.
         */
        problems.push(`the engine could not run a season on seed "${seed}": ${(err as Error)?.message ?? err}`);
        continue;
      }
      if (!best || run.worth > best.worth) best = run;
    }
    if (!best) continue;

    if (best.customers <= 0) {
      problems.push(`on seed "${seed}" the best plan won nobody at all in ${periods} periods`);
    }
    if (best.bankrupt) {
      problems.push(`on seed "${seed}" the best plan still ended bankrupt`);
    }
    if (best.profitable <= 0) {
      /*
       * The property that two generated markets lost and the two above did not
       * catch: a founder can hold customers, stay solvent, and never once have a
       * period that paid for itself.
       */
      problems.push(`on seed "${seed}" no period ever turned a profit`);
    }
  }

  return { ok: problems.length === 0, problems, checked };
}
