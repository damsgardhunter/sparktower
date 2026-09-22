/**
 * A season: how it starts, what the world does on its own, and what happens at
 * a desk nobody is sitting at.
 *
 * Pure, like the rest of the engine — no clock and no database, so a whole
 * fourteen-year season can be run in a test in milliseconds and a complaint
 * about year nine can be reproduced exactly.
 *
 * ## The part that matters most here
 *
 * Most of this file is about people who did not show up. That is not an edge
 * case, it is the normal state of a five-person team playing a fourteen-day
 * game: somebody will be on a plane, somebody will forget, somebody will join
 * on day one and lose interest by day four. What the simulation does with an
 * empty chair decides whether the other four keep playing.
 *
 * Three ways to handle it, and only one of them is right:
 *
 *   - **Treat a missing decision as zeros.** No marketing, no production, no
 *     support. The company collapses, and it takes four other people's season
 *     with it. The one who vanished is not punished — they are not there — so
 *     this only punishes the people who did show up.
 *   - **Carry last year forward exactly.** Nobody is punished, and nobody has
 *     any reason to open the app: an absent CFO does as well as a present one.
 *     A game that plays itself is a game people stop playing.
 *   - **Keep the desk running, worse than a person would.** Steady-state
 *     levers carry at a caretaker's pace; one-off and aggressive moves do not
 *     repeat themselves. The team loses ground rather than the season, and the
 *     report says whose chair was empty.
 *
 * The third one. The cost of not turning up is real, recoverable, and visible
 * to your teammates — which is the pressure that actually gets someone back
 * tomorrow. The engine's job is to leave them a company worth coming back to.
 */
import { defaultDraft } from "./levers";
import type { Company, Niche, Role, World } from "./types";
import type { TeamDecisions } from "./decisions";
import { seedIncumbents } from "./incumbents";

/** Fourteen days, fourteen years. One tick a day. */
export const SEASON_YEARS = 14;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What a caretaker year spends, against what a person spent last year.
 *
 * Not 1.0: an empty chair must not keep pace with a filled one, or there is no
 * reason to sit down. Not 0: a company that stops spending for one day a
 * player was on a train is a company they do not come back to. Sixty per cent
 * loses ground at about the rate attributes decay, so one missed year is a
 * setback a team can play their way out of and four in a row is not.
 */
export const CARETAKER_RATE = 0.6;

/** Small deterministic hash, so a season's weather is fixed the moment it is created. */
function seedOf(text: string): number {
  let hash = 2166136261;
  for (const ch of text) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

/**
 * The macro climate for a given year.
 *
 * Deterministic from the season's id, so every team in a season lives through
 * the same weather and nobody can claim they got a worse world. It moves in a
 * slow cycle rather than randomly per year, because a CFO who cannot see a
 * pattern cannot make a decision — they can only guess, and guessing is not a
 * thing anyone enjoys losing to.
 *
 * `outlook` describes the year *after* this one. That is the whole point of
 * including it: borrowing in front of a tightening, or building capacity in
 * front of an expansion, is the difference between a finance seat that matters
 * and one that just presses repay.
 */
export function economyFor(seasonId: string, year: number): {
  demand: number;
  interestRate: number;
  costIndex: number;
  outlook: "expansion" | "steady" | "tightening";
} {
  const seed = seedOf(seasonId);
  // A cycle a little longer than a season, offset per season, so no two
  // seasons sit at the same point in it and year one is not always a boom.
  const phase = (year + (seed % 7)) * ((Math.PI * 2) / 9);
  const wave = Math.sin(phase);
  const nextWave = Math.sin(phase + (Math.PI * 2) / 9);

  return {
    demand: Number((1 + wave * 0.12).toFixed(4)),
    // Rates lag the cycle: money gets dear after the boom, not during it.
    interestRate: Number((0.07 + Math.max(0, wave) * 0.05).toFixed(4)),
    // Costs drift up over a season and never come back down, which is what
    // stops year one's price holding for fourteen years.
    costIndex: Number((1 + year * 0.012 + Math.max(0, wave) * 0.02).toFixed(4)),
    outlook: nextWave - wave > 0.04 ? "expansion" : nextWave - wave < -0.04 ? "tightening" : "steady",
  };
}

/**
 * A company on day one.
 *
 * Zero debt, by the brief, and deliberately: a team that starts owing money
 * spends its first three years digging out instead of learning how the market
 * works, and the finance seat becomes damage control before it has ever been a
 * choice. Cash is enough to be interesting and not enough to be safe.
 *
 * Quality, brand and service start low but not at zero — the product exists,
 * nobody has heard of it. Price starts at the middle segment's reference,
 * which is a defensible opening nobody has to think about on their first day.
 */
export function startingCompany(input: {
  id: string;
  name: string;
  niche: Niche;
  seats: Role[];
}): Company {
  const { id, name, niche, seats } = input;
  /*
   * Priced where most of the customers are.
   *
   * This used to take the middle segment by price, which is arbitrary and
   * falls apart the moment a market has a wide spread: in construction, where
   * jobs run from 900 to 14,000, it opened every company at 3,800 — more than
   * four times what the segment holding six customers in seven expects to pay.
   * Those companies won almost nobody, and a team that never touched the app
   * bled to death by year five through no decision of their own.
   *
   * The largest segment's reference is a defensible opening that needs no
   * thought on day one, which is exactly what a default is for.
   */
  const opening = [...niche.segments].sort((a, b) => b.size - a.size)[0];

  const market = niche.segments.reduce((sum, s) => sum + s.size, 0);

  return {
    id,
    name,
    kind: "player",
    teamId: id,
    /*
     * Enough to lose money for three years while becoming known.
     *
     * This is not generosity, it is the shape of the business being simulated.
     * Fixed costs are about £1.1m a year before anyone spends on anything, and
     * moving brand at all costs a few hundred thousand — so a company funded
     * for one year is a company that is dead before its first customer hears
     * of it, and every season ends in five identical bankruptcies. Runway is
     * what makes the early decisions decisions rather than a countdown.
     */
    cash: 6_000_000,
    debt: 0,
    creditLimit: 2_000_000,
    reputation: 50,
    quality: 38,
    brand: 8,
    service: 40,
    /*
     * Room to grow into, and a ceiling worth raising. Capacity is the COO's
     * lever and it binds early: a team that wins more customers than it can
     * serve turns them away, which costs reputation — so the seat matters from
     * year one rather than becoming interesting in year six.
     */
    /*
     * Enough capacity to earn a living, measured in money rather than heads.
     *
     * A share of the customer count looked even and was not: these markets
     * differ by seventy times in what one customer pays, so three per cent of a
     * podcast audience is a rounding error while three per cent of a
     * construction market is a real business. A drone company could fill every
     * slot it had and still not cover its salary bill. Sized against what it
     * could earn, every market starts a company that can pay for itself if it
     * wins — and winning is still the hard part. Capped as a share of the
     * market so it never reads as absurd.
     */
    /*
     * And now that capacity costs money when it sits idle, small.
     *
     * The old ceiling was sized when headroom was free, and it was many times
     * what a newcomer wins in its first year — a dating app opened with room
     * for 225,000 people and served two thousand of them. Free, that was
     * harmless. Charged for, it put every new company a million pounds down
     * before anyone had made a decision, and it made the operations seat's
     * first job undoing a mistake it did not make.
     *
     * A percent and a half of the market is room to be surprised by a good
     * year without paying for a fantasy. Building more is the operations
     * seat's call, and the forecast on the desk is there to make it.
     */
    capacity: Math.min(
      Math.round(market * 0.015),
      Math.round(9_000_000 / Math.max(1, opening.referencePrice)),
    ),
    unitCost: niche.baseUnitCost,
    price: opening.referencePrice,
    customers: {},
    assets: [],
    seats,
    /*
     * One region to begin with: the cheapest that is still somewhere.
     *
     * Starting everywhere would remove the most interesting early decision in
     * the game — go deep somewhere small, or spend what little you have buying
     * reach you cannot yet serve. Starting nowhere would be a puzzle rather
     * than a company.
     *
     * "Cheapest" alone was that home while every market had six regions and
     * the cheapest held a tenth of it. With a long tail of small, cheap places
     * it became a region worth a fiftieth of the market: a company nobody
     * could find, in a game where being found is the first problem. So the
     * home is the cheapest region that is still a real place to sell.
     */
    cities: [(
      [...niche.cities].sort((a, b) => a.entryCost - b.entryCost).find((c) => c.weight >= 0.08)
      ?? [...niche.cities].sort((a, b) => b.weight - a.weight)[0]
    )?.id].filter(Boolean) as string[],
    founderShare: 1,
  };
}

/** The world at the start of year one: the incumbents holding the market, and everyone who turned up. */
export function buildWorld(input: {
  seasonId: string;
  niche: Niche;
  teams: { id: string; name: string; seats: Role[] }[];
}): World {
  const { seasonId, niche, teams } = input;
  return {
    seasonId,
    niche,
    year: 1,
    companies: [
      ...seedIncumbents(niche),
      ...teams.map((t) => startingCompany({ id: t.id, name: t.name, niche, seats: t.seats })),
    ],
    economy: economyFor(seasonId, 1),
  };
}

/**
 * An opening year for a team where nobody submitted anything.
 *
 * Someone has to run the company on day one even if all five of them opened
 * the app, saw a lobby, and closed it. This is a plausible, unambitious first
 * year: hold the opening price, keep the capacity they were given, spend a
 * little on being heard of and on not falling over. A team that actually plays
 * will beat it comfortably, which is the point — it is a floor, not a
 * benchmark.
 */
export function openingDecisions(company: Company, niche: Niche): TeamDecisions {
  /*
   * Genuinely modest, which it was not.
   *
   * Eight per cent per lever is nearly half the company in a single year —
   * spent on behalf of five people who have not arrived, in the year a company
   * is least able to convert it, when nobody has heard of it and brand is
   * eight. It cost an untouched team two and a half million to earn a hundred
   * thousand, and killed them by year eight wherever customers are cheap. A
   * default nobody chose should be cautious; a team that turns up can spend
   * properly.
   */
  const modest = Math.round(company.cash * 0.04);
  return {
    companyId: company.id,
    cmo: {
      price: company.price,
      brandSpend: modest,
      performanceSpend: modest,
      celebritySpend: 0,
      targetCities: [],
    },
    cto: {
      featureSpend: modest,
      reliabilitySpend: Math.round(modest * 0.6),
      techDebtPaydown: 0,
    },
    coo: {
      capacityTarget: company.capacity,
      supportSpend: Math.round(modest * 0.5),
      efficiencySpend: 0,
      headcount: Math.max(1, company.seats.length),
    },
    cfo: { borrow: 0, repay: 0, cashBuffer: Math.round(company.cash * 0.2) },
    ceo: { focus: niche.innovationPace > 1 ? "growth" : "quality" },
  };
}

/**
 * Last year's decision, run by nobody.
 *
 * Steady-state levers carry, scaled down: price, capacity and headcount stay
 * where they were, and discretionary spend runs at a caretaker's pace.
 *
 * What does *not* carry is anything that was a one-off when a person chose it.
 * A loan taken once becomes a loan taken every year for the rest of the season
 * if it repeats itself, and a team comes back on day nine to a company buried
 * in debt that none of them agreed to. The same is true of an equity raise, a
 * celebrity campaign, an offer for a rival, and firing a seat. Those are
 * decisions, and a decision needs somebody to make it.
 *
 * Repayment does carry: continuing to pay down what you already owe is the
 * conservative reading of silence, and it is the one that leaves a returning
 * player better off rather than worse.
 */
export function caretakerDecisions(previous: TeamDecisions, company: Company): TeamDecisions {
  /*
   * Sixty per cent of last year's plan, and never more than the company can
   * stand.
   *
   * The rate alone was not enough, because the plan a caretaker scales down is
   * the last one a person actually filed — which for a team that never arrived
   * is their opening year, for ever. They spent the same fraction of a
   * six-million-pound opening every year for fourteen years while earning
   * under a million, and bled to death by year nine in the markets where
   * customers are cheap. Nobody made that decision; it was made on their
   * behalf, repeatedly, by a function meant to keep the lights on.
   *
   * A caretaker holding a company with four hundred thousand in the bank does
   * not spend seven hundred. The cap is a quarter of what is actually there.
   */
  const ceiling = Math.max(0, company.cash) * 0.25;
  const raw =
    (previous.cmo?.brandSpend ?? 0) + (previous.cmo?.performanceSpend ?? 0) +
    (previous.cto?.featureSpend ?? 0) + (previous.cto?.reliabilitySpend ?? 0) + (previous.cto?.techDebtPaydown ?? 0) +
    (previous.cto?.researchSpend ?? 0) +
    (previous.coo?.supportSpend ?? 0) + (previous.coo?.efficiencySpend ?? 0);
  const scaled = raw * CARETAKER_RATE;
  const withinMeans = scaled > ceiling && scaled > 0 ? ceiling / scaled : 1;

  const slow = (n: number | undefined) => Math.round(Math.max(0, n ?? 0) * CARETAKER_RATE * withinMeans);

  return {
    companyId: company.id,
    cmo: previous.cmo && {
      ...previous.cmo,
      brandSpend: slow(previous.cmo.brandSpend),
      performanceSpend: slow(previous.cmo.performanceSpend),
      // A campaign that ran once does not book itself again.
      celebritySpend: 0,
    },
    cto: previous.cto && {
      featureSpend: slow(previous.cto.featureSpend),
      reliabilitySpend: slow(previous.cto.reliabilitySpend),
      techDebtPaydown: slow(previous.cto.techDebtPaydown),
    },
    coo: previous.coo && {
      ...previous.coo,
      supportSpend: slow(previous.coo.supportSpend),
      efficiencySpend: slow(previous.coo.efficiencySpend),
    },
    cfo: previous.cfo && {
      borrow: 0,
      repay: Math.max(0, previous.cfo.repay ?? 0),
      cashBuffer: previous.cfo.cashBuffer,
      // No new equity sold while the chair is empty.
    },
    ceo: previous.ceo && {
      focus: previous.ceo.focus,
      // No offers, no seats dissolved, by anyone who isn't there.
    },
  };
}

/** Which lever belongs to which chair, so an absence can be named precisely. */
const LEVER_OF: Record<Role, keyof TeamDecisions> = {
  ceo: "ceo",
  cmo: "cmo",
  cfo: "cfo",
  cto: "cto",
  coo: "coo",
};

export interface YearDecisions {
  decisions: TeamDecisions;
  /** Roles that submitted nothing this year and were run by the caretaker rules. */
  absent: Role[];
  /**
   * The seat the chief executive overruled, and what it had filed — kept so
   * the year can be run the other way afterwards to see who was right.
   */
  overruled?: { role: Role; filed: TeamDecisions[keyof TeamDecisions] };
}

/**
 * What a team actually does this year: what they submitted, with the empty
 * chairs filled in.
 *
 * Per role rather than per team, because the common case is not five people
 * missing — it is one. A team whose CFO is away should keep the marketing its
 * CMO chose an hour ago, and lose only the finance decisions nobody made.
 */
export function decisionsForYear(input: {
  company: Company;
  niche: Niche;
  /** What each role submitted this year. Roles with no entry did not submit. */
  submitted: Partial<Record<Role, TeamDecisions[keyof TeamDecisions]>>;
  /** What the team actually ran last year, caretaker fills included. Absent in year one. */
  previous?: TeamDecisions;
}): YearDecisions {
  const { company, niche, submitted, previous } = input;
  const fallback = previous ? caretakerDecisions(previous, company) : openingDecisions(company, niche);

  const decisions: TeamDecisions = { companyId: company.id };
  const absent: Role[] = [];

  for (const role of company.seats) {
    const key = LEVER_OF[role];
    const theirs = submitted[role];
    if (theirs) {
      (decisions as any)[key] = theirs;
    } else {
      absent.push(role);
      (decisions as any)[key] = (fallback as any)[key];
    }
  }

  /*
   * The chief executive's overrule: one seat's filing reversed to what it ran
   * last year. Only a seat that actually filed something different can be
   * overruled — there is nothing to reverse in an empty chair — and never the
   * chief executive's own. The seat's one-off moves do not come back with
   * last year's plan: a loan taken last year is not taken again because the
   * seat was overruled this year.
   */
  const target = (decisions.ceo as any)?.overrule as Role | "" | undefined;
  if (target && target !== "ceo" && company.seats.includes(target) && submitted[target] && previous?.[LEVER_OF[target]]) {
    const filed = (decisions as any)[LEVER_OF[target]];
    (decisions as any)[LEVER_OF[target]] = defaultDraft(target, company, (previous as any)[LEVER_OF[target]]);
    return { decisions, absent, overruled: { role: target, filed } };
  }
  // An overrule that could not happen is not recorded as one.
  if (target && decisions.ceo) (decisions.ceo as any) = { ...decisions.ceo, overrule: "" };

  return { decisions, absent };
}

/**
 * What the team is told about the chairs nobody sat in.
 *
 * Said plainly and without scolding. The person reading it is usually not the
 * person who missed it — they are a teammate who did show up, and what they
 * need is an explanation for a disappointing year rather than a told-off
 * feeling on someone else's behalf.
 */
export function absenceNote(absent: Role[], titles: Record<Role, string>, seats: number): string | null {
  if (absent.length === 0) return null;
  const names = absent.map((r) => titles[r] ?? r);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  /*
   * "Nobody" has to mean nobody, which is why the seat count is passed in.
   *
   * This used to trigger at four absences and the table was five, so the one
   * person who did turn up — who had picked a price, argued about it, and
   * filed — opened the results to be told that nobody had filed anything. Of
   * every reader this note can have, that is the one it most needs to keep,
   * and it was the one it called a liar.
   */
  if (absent.length >= Math.max(1, seats)) {
    return `Nobody filed decisions this year. The company ran on last year's plan at a caretaker's pace — it is still standing, and one good year puts it back in the race.`;
  }
  return `No decisions came in from ${list}. Those parts of the year ran on last year's plan at about ${Math.round(CARETAKER_RATE * 100)}% — held together, but not steered.`;
}

/** When the year'th tick is due, counting from when the season started. */
export const tickDueAt = (startsAt: Date, year: number, dayMs = DAY_MS): Date =>
  new Date(startsAt.getTime() + year * dayMs);

/** A season is over once its last year has resolved. */
export const seasonOver = (year: number, totalYears = SEASON_YEARS): boolean => year > totalYears;
