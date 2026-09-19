/**
 * The market simulation's domain: what a world is made of, before anything
 * decides what happens to it.
 *
 * ## What this is
 *
 * Five people run a company between them — CEO, CMO, CFO, CTO, COO — against
 * other teams and against incumbents who already own the market. A day is a
 * year. A season is fourteen of them.
 *
 * ## The two design commitments everything here serves
 *
 * **Taking share has to be hard, and possible only together.** A market where
 * one good decision wins is a market where four of the five people are
 * spectators. So the levers multiply rather than add: marketing spend on a
 * product nobody can deliver buys churn, quality nobody has heard of buys
 * nothing, and a price cut with no cost advantage buys a year of losses. A
 * team that coordinates beats a team with a bigger budget, and that is the
 * whole game.
 *
 * **Customers are not a number.** They are segments with memory. Loyalty is a
 * stock that builds slowly and empties fast, and the incumbents' hold on 90%
 * of the market is made of it. What a new entrant can take, at first, is the
 * segment already unhappy — the "on the rope" customers — and taking the loyal
 * ones costs years of consistency. That asymmetry is what makes the first
 * year humbling and the fourth year winnable.
 *
 * Nothing here reaches for a database, a clock, or a random number generator.
 * A year is a pure function of a world and the decisions made in it, which is
 * what lets fourteen years be replayed, tested, and explained to the people
 * who lived them.
 */

/** The five seats. One person each; the game refuses a sixth and refuses a duplicate. */
export const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_TITLES: Record<Role, string> = {
  ceo: "Chief Executive",
  cmo: "Chief Marketing Officer",
  cfo: "Chief Financial Officer",
  cto: "Chief Technology Officer",
  coo: "Chief Operating Officer",
};

/**
 * What each seat actually controls, in the words a player would use.
 *
 * Written down because a role whose powers aren't legible is a role nobody
 * argues over in the lobby — and arguing over the seats is the first thing
 * that makes a team a team.
 */
/*
 * What each seat can do — and only what it can actually do.
 *
 * This list is read out to five people while they are choosing which chair to
 * fight over, so everything in it is a promise. It previously promised the
 * chief executive mergers, acquisitions and the power to dissolve a seat,
 * none of which the engine reads, which made the most contested chair in the
 * lobby the one with the least to do. Those come back to this list when they
 * come back to `resolveYear`, and not before.
 */
export const ROLE_LEVERS: Record<Role, string[]> = {
  ceo: ["Where the company's effort goes, and what everyone else gives up for it", "The final word when the table deadlocks"],
  cmo: ["Price", "Brand and performance marketing", "Celebrity and sponsorship deals"],
  cfo: ["Drawing and repaying debt", "Raising from investors", "How much cash to hold", "What the company reports"],
  cto: ["Product quality and reliability", "Research into next year's product", "Paying down or taking on technical debt"],
  coo: ["How much the company can actually deliver", "Support quality", "Cost of goods and headcount", "Supply agreements"],
};

/**
 * A slice of customers who want the same thing and behave the same way.
 *
 * `loyalty` is the one to read twice: it is how much a customer forgives. A
 * segment at 0.9 barely notices a better offer elsewhere; at 0.2 it is already
 * halfway out of the door. Incumbents start holding mostly the former, which
 * is why they look unassailable and aren't.
 */
export interface Segment {
  id: string;
  name: string;
  /** What they're for, in one line, so a player knows who they're chasing. */
  description: string;
  /** Customers at the start of year one. */
  size: number;
  /** Compound yearly growth, before anything anyone does. */
  growth: number;
  /** 0–1. How much a higher price puts them off. */
  priceSensitivity: number;
  /** 0–1. How much they notice quality. */
  qualityFocus: number;
  /** 0–1. How much they need to have heard of you. */
  brandFocus: number;
  /** 0–1. How much support and reliability matter after the sale. */
  serviceFocus: number;
  /** 0–1. How hard they are to move once they've chosen. The incumbents' moat. */
  loyalty: number;
  /** What this segment considers a normal price, in whole currency units. */
  referencePrice: number;
}

/** A market a team can choose to enter. The niche decides who the customers are and who already serves them. */
/**
 * A place the market exists in.
 *
 * Where a company sells is a decision separate from what it sells and how good
 * it is. A team can go deep in one city — cheap, and capped — or spread across
 * the country, which costs money to enter and to keep. The incumbents are
 * everywhere already, which is most of what makes them incumbents.
 */
export interface City {
  id: string;
  name: string;
  /** Share of the niche's customers who live here. The weights sum to 1. */
  weight: number;
  /** One-off cost of opening here. */
  entryCost: number;
  /** What it is like to sell here, in one line. */
  note: string;
}

export interface Niche {
  id: string;
  name: string;
  /** What the business actually is, so choosing a niche is choosing a world rather than a label. */
  premise: string;
  segments: Segment[];
  /** The companies already here, holding the share a team has to take. */
  incumbents: IncumbentSeed[];
  /** Where this market exists. A company only sells where it has opened. */
  cities: City[];
  /** What it costs to make one unit, before anyone improves anything. */
  baseUnitCost: number;
  /** Multiplies how fast quality can be moved in this market — software moves faster than hardware. */
  innovationPace: number;
  /** The words this market uses for the things every market has. */
  voice: NicheVoice;
}

/**
 * What this market calls things.
 *
 * The engine has one set of nouns — customers, capacity, quality, price — and
 * it has to, because the maths is the same everywhere. What players read does
 * not have to be, and it should not be: a restaurant does not have "units of
 * capacity", it has covers, and a podcast does not have "customers", it has
 * listeners who never pay you and advertisers who do.
 *
 * Running seven markets through one generic vocabulary makes them feel like
 * seven reskins of a spreadsheet, which is exactly what they are underneath
 * and exactly what nobody should be able to tell. A player who picks drone
 * delivery should spend a fortnight thinking about weather windows and
 * regulators, not about "units".
 *
 * Every field is a noun phrase that drops into a sentence without ceremony —
 * lower case, no full stop — because the screens build sentences out of these.
 */
export interface NicheVoice {
  /** One buyer. "subscriber", "diner", "player". */
  customer: string;
  /** Many of them. Used constantly; worth getting right. */
  customers: string;
  /** What one of them pays for, once. "a month of premium", "a cover", "a delivery". */
  unit: string;
  /** What the price is per, as a phrase. "a month", "a head", "a drop". */
  per: string;
  /** What being able to serve more people means here, in one line. */
  capacity: string;
  /**
   * The same thing as a label on a number — and the number is always a count
   * of customers served in a year. "Diners you can seat", not "covers a week";
   * "listeners you can serve", not "shows in production". The first versions
   * named the physical thing instead of the unit, and the screen read "186,600
   * shows in production" for a podcast network that makes eight.
   */
  capacityShort: string;
  /** What a place is. "city", "region", "territory". */
  place: string;
  /** Plural of the above. */
  places: string;
  /** What "quality" is on the ground here. */
  quality: string;
  /** What "brand" is. Usually the thing money can buy fastest and hold worst. */
  brand: string;
  /** What "service" is — what happens after somebody has already said yes. */
  service: string;
  /** What it looks like when demand arrives and cannot be served. */
  turnedAway: string;
  /** The market itself, named as somebody inside it would name it. */
  market: string;
  /** What the competition is called collectively, in this trade's own idiom. */
  rivals: string;
}

/** An incumbent as the niche defines it, before a season starts. */
export interface IncumbentSeed {
  id: string;
  name: string;
  /** How it behaves under pressure — see `shared/simulation/incumbents.ts`. */
  posture: IncumbentPosture;
  /** Share of the whole market at year zero, 0–1. Across a niche these sum to about 0.9. */
  startingShare: number;
  quality: number;
  brand: number;
  service: number;
  /** Multiplier on the segment's reference price. */
  priceIndex: number;
  /** Who they are, as against what they score. */
  persona: Persona;
}

/**
 * A company with a personality, rather than four numbers and a name.
 *
 * The posture already decides what an incumbent *does* — a fortress spends on
 * service, a brawler follows you down in price. What it did not decide was
 * whether anybody cared. Four rows on a league table reading "Ember 39%,
 * Pairwise 24%" give a player nothing to feel about taking a point off Ember,
 * and taking a point off Ember is the entire fortnight.
 *
 * So each one gets a character, and the character has to be *the posture, made
 * human* — not decoration laid over it. A fortress that reads as arrogant and
 * slow explains, before any number moves, why it will out-spend you on service
 * and never cut its price. A player who reads this should be able to predict
 * the behaviour, and then watch it happen.
 *
 * The other rule: every one of them has to be beatable in a way you can name.
 * `knock` is not a joke at their expense, it is the door.
 */
export interface Persona {
  /** How they describe themselves. Their words, and usually a little too pleased with them. */
  tagline: string;
  /** Who runs it, and what that is like to be near. */
  boss: string;
  /** Two or three sentences: what they believe, and what that belief costs them. */
  character: string;
  /** What they are genuinely good at. Short enough to sit on a chip. */
  known: string;
  /** What everybody says about them behind their backs. This is the way in. */
  knock: string;
  /** How they talk about a newcomer taking share — used when they answer you. */
  voice: string;
}

/**
 * How an incumbent defends itself.
 *
 * Not difficulty settings — postures. A `fortress` would rather lose the
 * fringe than cheapen itself; a `brawler` will follow a newcomer down in price
 * and burn its own margin doing it. A team that reads the incumbent it is up
 * against does better than one that plays the same opening every season.
 */
export type IncumbentPosture = "fortress" | "brawler" | "coaster" | "innovator";

/** Everything a company is, at the end of a year. */
export interface Company {
  id: string;
  name: string;
  /** Absent for the AI-run incumbents. */
  teamId?: string;
  kind: "player" | "incumbent";
  /** How it behaves, for incumbents only. */
  posture?: IncumbentPosture;

  cash: number;
  debt: number;
  /** What the bank will lend, given reputation and what the company owns. */
  creditLimit: number;

  /** 0–100. Slow to build, quick to lose, and the thing that makes everything else cheaper. */
  reputation: number;
  /** 0–100. What the product is actually like. */
  quality: number;
  /** 0–100. How many people have heard of it and think well of it. */
  brand: number;
  /** 0–100. What happens after someone buys. */
  service: number;
  /** How much the company can deliver this year, in units. */
  capacity: number;
  /** Cost to make one unit. */
  unitCost: number;
  price: number;

  /** Customers held at the end of the year, by segment id. This is the moat, and it is per-segment for a reason. */
  customers: Record<string, number>;

  /** Set when a company has run out of money and credit. It does not end the game — see the recovery rules. */
  bankruptSince?: number;
  /**
   * The year this company sold its business to somebody else.
   *
   * Kept because a company that has sold everything and one that has not
   * started yet are indistinguishable on paper — no customers, nothing owned —
   * and the boardroom needs to tell them apart. See `alreadySold`.
   */
  soldBusinessIn?: number;
  /**
   * Trading losses not yet set against a profit. A company that loses money
   * in its first three years pays no tax on its fourth until those losses are
   * used up — the way tax actually works, and the difference between tax
   * being a tax on success and a tax on recovering.
   */
  taxLosses?: number;
  /**
   * Terms agreed with a creditor after a restructuring: a cap on spending, and
   * the count of consecutive years it has been met. See `recovery.ts` — it
   * lifts itself after two clear years, which is what makes distress an arc
   * rather than a hole.
   */
  covenant?: { since: number; spendCap: number; met: number; rateRelief: number };
  /** Assets that can be sold, pledged, or bought by a rival. */
  assets: CompanyAsset[];
  /** Seats currently filled. A team that fires its CMO pays one fewer salary and loses the lever. */
  seats: Role[];
  /**
   * Cities the company sells in. Incumbents are in all of them.
   *
   * Reach is the fraction of the market that can even consider you: a company
   * in one city out of six is invisible to five sixths of the people it would
   * otherwise win, however good it is.
   */
  cities: string[];
  /** The segment this company has declared itself for, if any. See `positioningFor`. */
  positioning?: string;
  /**
   * What shipping fast has cost you, 0–100.
   *
   * Every year of building features adds a little; paying it down removes it.
   * High debt makes every pound of product work buy less and every unit cost
   * more, which is the whole argument the technology seat has with the other
   * four: the bill arrives years after the decision that ran it up.
   */
  techDebt?: number;
  /**
   * Research finished but not yet shipped, in quality points.
   *
   * Lands in full next year. It is why a team can look flat for a year and
   * then move further in one than anybody could have bought.
   */
  pipeline?: number;
  /**
   * What the founders still own, 0–1.
   *
   * Starts whole and only ever goes down. Raising money is not free and this
   * is where the cost lives — a team can buy its way through a bad year and
   * find on day fourteen that it won a market it owns a third of.
   */
  founderShare: number;
}

/** Something a company owns that another company might want. */
export interface CompanyAsset {
  id: string;
  kind: "celebrity" | "distribution" | "patent" | "facility" | "brand_licence";
  name: string;
  /** What it does while you hold it. */
  effect: { brand?: number; quality?: number; service?: number; capacity?: number; unitCost?: number };
  /** What it cost, and the floor under what it's worth in a sale. */
  bookValue: number;
  /** Years remaining before it lapses. Undefined means it doesn't. */
  expiresIn?: number;
}

/** The whole world at a moment in time. */
/**
 * A company with every number made a number again.
 *
 * The engine now refuses to spread a `NaN` that arrives in a decision, but a
 * world saved while it still could is stored in the database and would carry
 * it forever: every tick reads the broken figure, produces another, and writes
 * it back. Nothing recovers on its own, and the team sees "£NaN" until
 * somebody edits the row by hand.
 *
 * So a stored world is repaired on the way in. A company whose cash cannot be
 * read is treated as having none, which is wrong but recoverable — and far
 * better than a season that can never be resolved again.
 */
export function repairCompany(c: Company): Company {
  const num = (value: unknown, fallback: number): number => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const bounded = (value: unknown, fallback: number): number =>
    Math.max(0, Math.min(100, num(value, fallback)));

  const customers: Record<string, number> = {};
  for (const [segment, held] of Object.entries(c.customers ?? {})) {
    customers[segment] = Math.max(0, num(held, 0));
  }

  return {
    ...c,
    cash: num(c.cash, 0),
    debt: Math.max(0, num(c.debt, 0)),
    creditLimit: Math.max(0, num(c.creditLimit, 0)),
    price: Math.max(0.01, num(c.price, 1)),
    unitCost: Math.max(0, num(c.unitCost, 1)),
    capacity: Math.max(0, Math.round(num(c.capacity, 0))),
    reputation: bounded(c.reputation, 50),
    quality: bounded(c.quality, 40),
    brand: bounded(c.brand, 10),
    service: bounded(c.service, 40),
    customers,
    assets: Array.isArray(c.assets) ? c.assets : [],
    seats: Array.isArray(c.seats) ? c.seats : [],
    cities: Array.isArray(c.cities) ? c.cities : undefined as any,
    founderShare: Math.max(0.01, Math.min(1, num(c.founderShare, 1))),
    techDebt: bounded(c.techDebt, 0),
    pipeline: Math.max(0, num(c.pipeline, 0)),
  };
}

export interface World {
  seasonId: string;
  niche: Niche;
  /** 1-based. Year 1 is the first day of the season. */
  year: number;
  companies: Company[];
  /** The macro climate — it moves on its own and nobody controls it. */
  economy: Economy;
}

/**
 * Conditions nobody at the table chose.
 *
 * A simulation where every outcome traces to a decision teaches that business
 * is fair. It isn't. The cycle here is gentle and public — visible a year
 * ahead, so it rewards preparation rather than punishing luck.
 */
export interface Economy {
  /** Multiplier on total demand this year. */
  demand: number;
  /** What debt costs, as a yearly rate. */
  interestRate: number;
  /** How much input costs have moved since year one. */
  costIndex: number;
  /** What the coming year looks like, so a CFO can act before it arrives. */
  outlook: "expansion" | "steady" | "tightening";
}
