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
 *
 * ## Three grains
 *
 * A season that decides four or twelve times a year should not simply meet the
 * same one event more often — that was the first version and it gave a monthly
 * season twelve scandals a year, which read as the game losing its mind.
 *
 * Instead each grain has its own catalogue, sized to it:
 *
 *   - **Yearly** — the structural ones. Regulation arrives, the money goes
 *     cold, a product gets recalled. Every season gets these, one a year, and
 *     the catalogue is untouched from when a year was all there was.
 *   - **Quarterly** — the ones a quarter is the right unit for: a rival's
 *     price move, a seasonal rush, a bad review cycle. Only a season that
 *     decides quarterly or monthly ever sees them.
 *   - **Monthly** — texture. A delayed shipment, a week of bad weather, one
 *     good post. Small enough that meeting twelve of them in a year is a
 *     season with things going on rather than a season under siege.
 *
 * So the finer the cadence the more *happens*, which is the honest version of
 * what the extra seat price buys. A yearly season is bit-for-bit what it was.
 */
import type { Company, Economy, Niche, World } from "./types";
import { rng, pick } from "./random";
import { servingCapacity } from "./assets";

export type EventScope = "market" | "company";

export interface MarketEvent {
  id: string;
  year: number;
  /** Which grain drew it, so a screen can say "this month" rather than "this year". */
  grain?: EventGrain;
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

/**
 * How fine a thing this is: the shortest period over which it makes sense.
 *
 * A recall is not a monthly event — it would be absurd to have one every
 * month — and a delayed shipment is not a yearly one, because a year in which
 * the only thing that happened was a late lorry is a year in which nothing
 * happened.
 */
export type EventGrain = "year" | "quarter" | "month";

/** How many periods one of each grain lasts, at a given cadence. */
export function periodsOfGrain(grain: EventGrain, periods: number): number {
  if (grain === "year") return periods;
  if (grain === "quarter") return Math.max(1, Math.round(periods / 4));
  return 1;
}

/**
 * Whether a grain has a boundary starting at this period, and which one.
 *
 * `period` counts periods from one. A grain only exists if the cadence is at
 * least that fine: a yearly season has no quarter boundaries to speak of,
 * because it never stops in the middle of a year to look.
 */
export function grainDueAt(grain: EventGrain, period: number, periods: number): number | null {
  if (grain === "quarter" && periods < 4) return null;
  if (grain === "month" && periods < 12) return null;
  const every = periodsOfGrain(grain, periods);
  if ((period - 1) % every !== 0) return null;
  return Math.floor((period - 1) / every) + 1;
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

/*
 * The quarterly catalogue. Deliberately its own list rather than a filter over
 * the yearly one: `pick` chooses by index, so adding to the arrays above would
 * quietly change which event every existing yearly season meets. These are
 * also smaller on purpose — a quarter is long enough for a price move and a
 * bad review cycle, and too short for a regulator.
 */
const QUARTER_MARKET: Array<(niche: Niche, economy: Economy) => Omit<MarketEvent, "id" | "year" | "scope">> = [
  () => ({
    headline: "Somebody blinked on price",
    body: "One of the bigger names has cut its list price for the quarter and the rest of the market is deciding whether to follow.",
    advice: "Following costs margin and holds share; not following costs share and holds margin. There is no answer that costs nothing.",
    effect: { demand: 1.04, costIndex: 0.99 },
  }),
  () => ({
    headline: "A seasonal rush",
    body: "The quarter everybody in this market waits for. More people are buying than at any other point in the year.",
    advice: "Room, not marketing. Whoever can serve the quarter takes it; whoever cannot spends it apologising.",
    effect: { demand: 1.15 },
  }),
  () => ({
    headline: "A quiet quarter",
    body: "The rush went somewhere else. Everybody is discounting into a market that is simply not shopping.",
    advice: "A quarter to fix things in. Spending into a flat quarter buys less than the same money will buy in the next one.",
    effect: { demand: 0.9 },
  }),
  () => ({
    headline: "Freight has got expensive",
    body: "Shipping rates have jumped on the routes this market depends on. It will settle, but not this quarter.",
    advice: "It lands hardest on whoever holds the most stock and moves it the furthest.",
    effect: { costIndex: 1.05 },
  }),
];

const QUARTER_COMPANY: CompanyEvent[] = [
  {
    when: (c) => c.service < 42,
    build: (c) => ({
      headline: `${c.name} is having a bad review cycle`,
      body: "A quarter of slow answers has shown up where people look before they buy. Nothing dramatic, just steadily worse.",
      advice: "Support spending fixes this faster than anything else, and the review scores follow about a quarter behind.",
      effect: { reputation: -3, service: -2 },
    }),
  },
  {
    when: (c) => c.brand > 58 && c.quality > 55,
    build: (c) => ({
      headline: `${c.name} had a good quarter in the press`,
      body: "Two or three people with audiences mentioned it without being asked. It is not a moment, but it adds up.",
      advice: "Cheap awareness while it lasts. It compounds if the product holds up and evaporates if it does not.",
      effect: { brand: 3, reputation: 1 },
    }),
  },
  {
    when: (c) => c.cash < 0,
    build: (c) => ({
      headline: `${c.name} is paying its suppliers late`,
      body: "The quarter closed with the bank overdrawn, and the people it buys from have noticed before anybody else did.",
      advice: "Terms get worse before they get better. Raising or repaying now is cheaper than being put on prepayment.",
      effect: { reputation: -2, costIndex: 1.02 },
    }),
  },
  {
    // Earned: somebody in this market is genuinely cheaper than you are.
    when: (c, world) => world.companies.some((x) => x.id !== c.id && x.price > 0 && x.price < c.price * 0.9),
    build: (c) => ({
      headline: `${c.name} is being undercut`,
      body: "A rival has gone in under this company's price in the segments it cares most about.",
      advice: "Matching is the expensive answer. Being worth the difference is the cheap one, and slower.",
      effect: { brand: -2 },
    }),
  },
];

/*
 * The monthly catalogue: texture. Twelve of these a year should read as a
 * business having things happen to it, not as a business under siege — so the
 * effects are small enough that a run of bad luck is survivable and a run of
 * good luck is not a strategy.
 */
const MONTH_MARKET: Array<(niche: Niche, economy: Economy) => Omit<MarketEvent, "id" | "year" | "scope">> = [
  () => ({
    headline: "A shipment is late",
    body: "Something upstream slipped by a fortnight. Everybody in the market is a little short this month.",
    advice: "It comes back next month. The only real cost is what you turn away in the meantime.",
    effect: { demand: 0.97 },
  }),
  () => ({
    headline: "A good month for the category",
    body: "Nothing dramatic — a few more people than usual went looking this month.",
    advice: "Small, but it is free. Whoever is visible this month keeps some of them.",
    effect: { demand: 1.05 },
  }),
  () => ({
    headline: "Input prices ticked up",
    body: "The underlying cost of making this moved against everybody by a couple of points.",
    advice: "Too small to change a plan over. Worth noticing if it happens three months running.",
    effect: { costIndex: 1.02 },
  }),
  () => ({
    headline: "The trade show",
    body: "The month the whole market is in one hall. Everybody comes back with leads and a bar bill.",
    advice: "Brand spending goes further this month than any other, for everyone equally.",
    effect: { demand: 1.03, costIndex: 1.01 },
  }),
  () => ({
    headline: "A quiet month",
    body: "Holidays, weather, whatever it is. The phones did not ring much.",
    advice: "Nothing to fix. A month like this in a good quarter is normal; three in a row is a trend.",
    effect: { demand: 0.95 },
  }),
];

const MONTH_COMPANY: CompanyEvent[] = [
  {
    when: (c) => c.brand > 45,
    build: (c) => ({
      headline: `${c.name} had a post do numbers`,
      body: "One thing the marketing team put out went further than anything else they did this month.",
      advice: "A month of free attention. It is worth what the product does with the people it brings.",
      effect: { brand: 2 },
    }),
  },
  {
    when: (c) => c.service > 55,
    build: (c) => ({
      headline: `${c.name} answered the phone`,
      body: "A month with no queue worth mentioning. The people who got through said so.",
      advice: "The least dramatic good news there is, and the one that shows up in renewals.",
      effect: { reputation: 2 },
    }),
  },
  {
    when: (c) => c.quality < 45,
    build: (c) => ({
      headline: `${c.name} shipped a bug`,
      body: "Something went out that should not have. It was fixed inside the month, but people saw it.",
      advice: "One of these is a month. A pattern of them is the recall that arrives at the end of the year.",
      effect: { quality: -1, reputation: -2 },
    }),
  },
  {
    when: (c) => c.debt > c.creditLimit * 0.5,
    build: (c) => ({
      headline: `${c.name} drew on the facility again`,
      body: "The month closed on borrowed money for the third time. The bank has not said anything yet.",
      advice: "Nothing has happened. That is the point at which it is still cheap to do something.",
      effect: { reputation: -1 },
    }),
  },
  {
    when: (c) => {
      const held = Object.values(c.customers).reduce((sum, n) => sum + n, 0);
      return held > servingCapacity(c) * 0.85 && held > 0;
    },
    build: (c) => ({
      headline: `${c.name} had a busy month`,
      body: "The operation ran hot. Nothing broke, but there was no slack in it either.",
      advice: "A warning rather than a cost. Room ordered now opens before the quarter that needs it.",
      effect: { service: -1 },
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

/**
 * Everything due at this period, at every grain the cadence supports.
 *
 * At most one per grain, so a monthly season can meet a month event, a quarter
 * event and a year event in the same period — which is exactly the month a
 * quarter and a year both end in, and reads as the busy month it is.
 *
 * A yearly season (`periods === 1`) asks only for the year grain, against the
 * same catalogue and the same seed it always used, so it meets the same news
 * it has always met.
 */
export function eventsDue(input: { world: World; period: number; periods: number; economy: Economy }): MarketEvent[] {
  const { world, period, periods, economy } = input;
  const out: MarketEvent[] = [];
  for (const grain of ["year", "quarter", "month"] as const) {
    const at = grainDueAt(grain, period, periods);
    if (at === null) continue;
    const event = drawEvent({ world, grain, at, periods, economy });
    if (event) out.push(event);
  }
  return out;
}

/** One grain's draw. `at` is which year, quarter or month of the season this is. */
function drawEvent(input: { world: World; grain: EventGrain; at: number; periods: number; economy: Economy }): MarketEvent | null {
  const { world, grain, at, periods, economy } = input;
  // The first year is the team's own, at every grain. Nothing has been earned
  // yet, and news arriving on day one reads as arbitrary however small it is.
  const yearOf = grain === "year" ? at : Math.floor(((at - 1) * periodsOfGrain(grain, periods)) / periods) + 1;
  if (yearOf <= 1) return null;

  // Kept exactly as it was for the year grain: same seed, same catalogue,
  // same order, so an existing season's news does not move.
  const seed = grain === "year" ? `${world.seasonId}:${at}:event` : `${world.seasonId}:${at}:${grain}`;
  const markets = grain === "year" ? MARKET_EVENTS : grain === "quarter" ? QUARTER_MARKET : MONTH_MARKET;
  const companies = grain === "year" ? COMPANY_EVENTS : grain === "quarter" ? QUARTER_COMPANY : MONTH_COMPANY;

  const players = world.companies.filter((c) => c.kind === "player");
  const candidates: { company: Company; event: CompanyEvent }[] = [];
  for (const company of players) {
    for (const event of companies) {
      if (event.when(company, world)) candidates.push({ company, event });
    }
  }

  const roll = rng(seed)();
  if (candidates.length > 0 && roll < 0.65) {
    const chosen = pick(`${seed}:who`, candidates);
    const built = chosen.event.build(chosen.company);
    return { id: `evt_${seed}`, year: at, grain, scope: "company", companyId: chosen.company.id, ...built };
  }
  const build = pick(`${seed}:market`, markets);
  return { id: `evt_${seed}`, year: at, grain, scope: "market", ...build(world.niche, economy) };
}

/**
 * Weather: a market event's multipliers, still in force.
 *
 * A yearly event drawn in a quarterly season has to last the year, or a
 * funding winter would be one cold quarter and three normal ones. So a market
 * event writes its multipliers onto the world with the period they run out,
 * and every period reads whatever is still standing.
 *
 * At yearly cadence a year event expires the period it was drawn, which is
 * what "applied to this year only" already meant.
 */
export interface Weather {
  demand: number;
  costIndex: number;
  /** The last period this still applies to. */
  until: number;
  headline: string;
}

export function nextWeather(
  carried: Weather[] | undefined,
  drawn: MarketEvent[],
  period: number,
  periods: number,
): Weather[] {
  const alive = (carried ?? []).filter((w) => w.until >= period);
  const fresh = drawn
    .filter((e) => e.scope === "market" && (e.effect.demand !== undefined || e.effect.costIndex !== undefined))
    .map((e) => ({
      demand: e.effect.demand ?? 1,
      costIndex: e.effect.costIndex ?? 1,
      until: period + periodsOfGrain(e.grain ?? "year", periods) - 1,
      headline: e.headline,
    }));
  return [...alive, ...fresh];
}

/** The economy as everything still in force leaves it. */
export function economyWithWeather(economy: Economy, weather: Weather[]): Economy {
  let demand = economy.demand;
  let costIndex = economy.costIndex;
  for (const w of weather) {
    demand *= w.demand;
    costIndex *= w.costIndex;
  }
  return { ...economy, demand, costIndex };
}

/** A company as every event drawn this period leaves it. */
export function companyWithEvents(company: Company, events: MarketEvent[]): Company {
  return events.reduce((c, e) => companyWithEvent(c, e), company);
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
