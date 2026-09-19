/**
 * Things that happen to you, rather than things you decide.
 *
 * Without these a season is fourteen copies of the same year: the numbers move
 * but nothing ever *happens*, and a game where nothing happens is one people
 * stop opening on about day five. An event is the thing a team messages each
 * other about — "a supplier went under, we're short" — and the reason a plan
 * made on day three has to survive contact with day seven.
 *
 * ## Why they are earned rather than random
 *
 * Every event here is drawn from the market's state, not out of the air. A
 * company with a bad reputation gets the scandal. A company that let its
 * quality slide gets the recall. A company that has been quietly excellent
 * gets the viral moment. The dice decide *which* of the things you had coming
 * arrives this year, never whether you deserved something you didn't.
 *
 * That distinction is the whole reason this is fair. A random punishment lands
 * as the game cheating; a consequence lands as the game paying attention. Both
 * are unpredictable, and only one of them is worth playing.
 *
 * ## Why one a year, and why everybody sees it
 *
 * One, because two is noise and nobody reads the third. Everybody sees it —
 * including events that only hit one company — because the most interesting
 * thing about a rival's supply failure is that you can see it happening and
 * decide what to do about it.
 */
import type { Company, Economy, Niche, World } from "./types";
import { rng, pick } from "./random";
import { servingCapacity } from "./assets";

export type EventScope = "market" | "company";

export interface MarketEvent {
  id: string;
  year: number;
  scope: EventScope;
  /** The company it happened to, for a company event. */
  companyId?: string;
  /** A headline, as a trade paper would put it. */
  headline: string;
  /** What it means for the people it happened to. */
  body: string;
  /** What a team can do about it, said plainly. There is always something. */
  advice: string;
  /** Applied by the engine when the year resolves. */
  effect: EventEffect;
}

export interface EventEffect {
  /** Multiplier on this year's total demand. */
  demand?: number;
  /** Multiplier on what a unit costs everyone to make. */
  costIndex?: number;
  /** Points added to the named company's stats. */
  reputation?: number;
  brand?: number;
  quality?: number;
  service?: number;
  /** Multiplier on the named company's capacity for the year. */
  capacity?: number;
  /** Cash the named company gains or loses. */
  cash?: number;
}

/** Things that happen to a market, whoever is in it. */
const MARKET_EVENTS: Array<(niche: Niche, economy: Economy) => Omit<MarketEvent, "id" | "year" | "scope">> = [
  () => ({
    headline: "A supplier fails",
    body: "One of the firms everybody in this market buys from has gone under. Input costs jump for the year while the industry finds somebody else.",
    advice: "Efficiency spending pays back faster than usual this year, and a company with cash can ride it out where a stretched one cannot.",
    effect: { costIndex: 1.12 },
  }),
  () => ({
    headline: "The category is suddenly fashionable",
    body: "A documentary, an influencer, something. Far more people are in the market this year than anybody forecast.",
    advice: "Capacity is the constraint, not demand. Whoever can serve the rush takes it; whoever cannot turns people away in public.",
    effect: { demand: 1.22 },
  }),
  () => ({
    headline: "A funding winter",
    body: "Money has got expensive across the sector. Nobody is buying what they were buying last year.",
    advice: "A thin year for everyone. Holding on to customers is worth more than chasing new ones.",
    effect: { demand: 0.85 },
  }),
  (niche) => ({
    headline: `Regulation lands on ${niche.name.toLowerCase()}`,
    body: "New rules on how this product may be sold and supported. Compliance is not optional and it is not cheap.",
    advice: "It costs everyone the same, which means it hurts the smallest most. Service spending counts double against the new rules.",
    effect: { costIndex: 1.07 },
  }),
  () => ({
    headline: "A cheap import wave",
    body: "Overseas manufacturing has made the underlying product cheaper to produce for everybody in the market.",
    advice: "Margins improve on their own. The question is whether you keep the difference or pass it on and take share.",
    effect: { costIndex: 0.92 },
  }),
];

/** Things that happen to one company, because of how that company has been behaving. */
interface CompanyEvent {
  /** Whether this company has it coming. */
  when: (c: Company, world: World) => boolean;
  build: (c: Company) => Omit<MarketEvent, "id" | "year" | "scope" | "companyId">;
}

const COMPANY_EVENTS: CompanyEvent[] = [
  {
    // Earned: you have been letting people down.
    when: (c) => c.reputation < 38,
    build: (c) => ({
      headline: `${c.name} is having a bad week in public`,
      body: "Enough people have had a poor experience that it has stopped being anecdotes and started being a story. It is being written about.",
      advice: "Reputation is repaired by service and by keeping promises, and there is no way to buy it back quickly. It will take more than one good year.",
      effect: { reputation: -7, brand: -4 },
    }),
  },
  {
    when: (c) => c.quality < 35,
    build: (c) => ({
      headline: `${c.name} has a recall`,
      body: "The product has been failing for long enough that it now has to be fixed at the company's expense, for everybody who bought it.",
      advice: "This is what deferred product work costs when it finally arrives. Reliability spending is the fix, and it is cheaper before this happens than after.",
      effect: { quality: -5, cash: -450_000, reputation: -4 },
    }),
  },
  {
    // Earned: you have been quietly excellent.
    when: (c) => c.quality > 68 && c.reputation > 62,
    build: (c) => ({
      headline: `${c.name} gets a write-up`,
      body: "Somebody with an audience tried it, liked it, and said so at length. A lot of people who had never heard of the company have now heard of it.",
      advice: "Free awareness, for one year. It is worth far more if operations can serve the people it brings than if they cannot.",
      effect: { brand: 9, reputation: 3 },
    }),
  },
  {
    when: (c) => c.service > 66,
    build: (c) => ({
      headline: `${c.name}'s customers are doing the selling`,
      body: "Support has been good enough for long enough that the people who use it are recommending it unprompted.",
      advice: "The cheapest growth there is, and it compounds. It stops the moment service slips.",
      effect: { brand: 6, reputation: 4 },
    }),
  },
  {
    when: (c) => c.debt > c.creditLimit * 0.75,
    build: (c) => ({
      headline: `${c.name}'s lender is asking questions`,
      body: "The borrowing has got close enough to the limit that the bank has started taking an interest in how the year is going.",
      advice: "Repaying some of it now costs less than being told to repay all of it later.",
      effect: { reputation: -3 },
    }),
  },
  {
    when: (c) => {
      const held = Object.values(c.customers).reduce((sum, n) => sum + n, 0);
      // All the room it serves from, not just what it built — otherwise a
      // company that bought its capacity is "at the limit" every year, and
      // loses 5% of what it built each time it is told so.
      return held > servingCapacity(c) * 0.92 && held > 0;
    },
    build: (c) => ({
      headline: `${c.name} is running at the limit`,
      body: "Demand has been sitting right up against what the company can actually deliver. Something in the operation is going to give.",
      advice: "Capacity built now is cheaper than the reputation lost by turning people away later.",
      effect: { capacity: 0.95, service: -3 },
    }),
  },
];

/**
 * What happens this year.
 *
 * Deterministic from the season and year, like everything else that looks
 * random here, so a re-run of the tick produces the same news and two players
 * reading the same screen see the same story.
 *
 * Company events are preferred when a company has genuinely earned one,
 * because a consequence is more interesting than weather — and the market
 * events are there so that a year in which everybody has behaved themselves
 * still has something in it.
 */
export function eventFor(input: { world: World; year: number; economy: Economy }): MarketEvent | null {
  const { world, year, economy } = input;
  const seed = `${world.seasonId}:${year}:event`;

  // Year one is the team's own; nothing has been earned yet and nothing
  // arriving on day one reads as anything but arbitrary.
  if (year <= 1) return null;

  const players = world.companies.filter((c) => c.kind === "player");
  const candidates: { company: Company; event: CompanyEvent }[] = [];
  for (const company of players) {
    for (const event of COMPANY_EVENTS) {
      if (event.when(company, world)) candidates.push({ company, event });
    }
  }

  /*
   * A company event about two years in three when one is deserved. Not always:
   * a market that only ever reacts to the players is a market with nothing of
   * its own going on, and the weather events are what stop every year being
   * about somebody's reputation.
   */
  const roll = rng(seed)();
  if (candidates.length > 0 && roll < 0.65) {
    const chosen = pick(`${seed}:who`, candidates);
    const built = chosen.event.build(chosen.company);
    return { id: `evt_${seed}`, year, scope: "company", companyId: chosen.company.id, ...built };
  }

  const build = pick(`${seed}:market`, MARKET_EVENTS);
  return { id: `evt_${seed}`, year, scope: "market", ...build(world.niche, economy) };
}

/** The economy as this year's event leaves it. */
export function economyWithEvent(economy: Economy, event: MarketEvent | null): Economy {
  if (!event || event.scope !== "market") return economy;
  return {
    ...economy,
    demand: economy.demand * (event.effect.demand ?? 1),
    costIndex: economy.costIndex * (event.effect.costIndex ?? 1),
  };
}

/** A company as this year's event leaves it. */
export function companyWithEvent(company: Company, event: MarketEvent | null): Company {
  if (!event || event.scope !== "company" || event.companyId !== company.id) return company;
  const e = event.effect;
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  return {
    ...company,
    reputation: clamp(company.reputation + (e.reputation ?? 0)),
    brand: clamp(company.brand + (e.brand ?? 0)),
    quality: clamp(company.quality + (e.quality ?? 0)),
    service: clamp(company.service + (e.service ?? 0)),
    capacity: Math.round(company.capacity * (e.capacity ?? 1)),
    cash: company.cash + (e.cash ?? 0),
  };
}
