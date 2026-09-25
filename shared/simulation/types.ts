import type { ContinentId } from "./geography";
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
  /**
   * Who went and found these people, for a segment that was not in the market
   * to begin with. See `niche-openings.ts`.
   *
   * Absent on every segment a market was written with. Present on one a
   * company carved out, and it is what gives that company a run at them
   * before anybody else is even describing them as a group.
   *
   * A list, because two tables can go looking in the same place and come back
   * with the same people. When that happens neither of them has found a
   * corner nobody else knows about — they have found each other — so the run
   * at those people is against everybody except the companies who found them.
   */
  foundBy?: string[];
  foundInYear?: number;
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
  /**
   * Who lives here, by segment, as a multiplier on how many of them there are
   * relative to the market as a whole: 1.3 means this region over-indexes on
   * that segment by a third, 0.8 means it under-indexes. A company selling
   * everywhere gets exactly the market average, whatever these say (see
   * `regionalFit`), so this is about *where* you sell, never about the size of
   * the market.
   */
  mix?: Record<string, number>;
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
  /**
   * Where those regions are, on the world map (see `geography.ts`).
   *
   * Four of these markets are a country's worth of regions — Leeds, Manchester,
   * the North West — and they sit inside one region of the map. Naming it is
   * what lets a season widen from "the UK in ten pieces" to "the world in
   * thirty-five, one piece of which is the UK in ten". A market whose regions
   * are already continental leaves it unset and widens straight onto the map.
   */
  worldHome?: string;
  /**
   * How much of this market lives on each continent, relative to how much
   * money lives there.
   *
   * One means "as you would expect from the population and the money". Drone
   * delivery in Central Africa is not a fifth of a market the way its people
   * and money suggest, because there is nowhere to land; a mobile game in
   * Southeast Asia is more than its money suggests, because that is where the
   * players are. Anything unlisted is one.
   */
  penetration?: Partial<Record<ContinentId, number>>;
  /** What it costs to make one unit, before anyone improves anything. */
  baseUnitCost: number;
  /** Multiplies how fast quality can be moved in this market — software moves faster than hardware. */
  innovationPace: number;
  /** The words this market uses for the things every market has. */
  voice: NicheVoice;
  /**
   * The kinds of people a business in this market employs.
   *
   * A kitchen hires chefs and a studio hires engineers, and what the two of
   * them cost and buy is not the same. Optional: a market that arrives
   * without one is given a generic mix rather than refused. See
   * `workforce.ts`.
   */
  workforce?: import("./workforce").WorkKind[];
  /**
   * What this market's version of each buyable asset is called.
   *
   * The nine slots in `assets.ts` are the shapes — a distribution deal, a
   * patent, somewhere to serve people from — and every market expresses them
   * differently. The seven catalogue markets name theirs in `catalogues.ts`;
   * a market Nova wrote for somebody's project gets to name its own, so a
   * SaaS founder is offered "another region of cloud capacity" rather than a
   * retail shelf agreement they have no shelves for.
   *
   * Ordered and matched by kind against `ASSET_SLOTS`, exactly as a catalogue
   * is. An entry whose kind does not line up is ignored rather than
   * misapplied — a patent's economics on a thing called a warehouse is worse
   * than the generic name it replaced.
   */
  assets?: { kind: string; name: string; blurb: string }[];
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
  kind: "player" | "incumbent";
  /**
   * The year this company arrived, for one that was not here at the start.
   *
   * Absent for everybody who opened the season. Present on a company that
   * turned up because the market looked worth entering — which is a thing a
   * table should be told rather than left to notice.
   */
  enteredInYear?: number;
  /** And the segment that attracted them, which is usually the one somebody just proved. */
  enteredAfter?: string;
  /** How it behaves, for incumbents only. */
  posture?: IncumbentPosture;

  cash: number;
  /**
   * How big a business this is, against a market of the reference size.
   *
   * One for every market written by hand; a fraction of one for a market Nova
   * wrote for a single business. Everything absolute about the company —
   * salaries, the bank, what a bad year costs — is multiplied by it, so a
   * small market gets a small business rather than an absurd one. See
   * `marketScale`.
   */
  scale?: number;
  /**
   * How many periods in a row nobody has filed anything for this company.
   *
   * A business nobody runs does not sit still, it winds down: the people
   * leave, the room goes, and the customers find somebody who answers. See
   * `windDown` in `resolve.ts`.
   */
  unsteered?: number;
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
  /**
   * What this company charged before this period's decision.
   *
   * A high price and a rising price are different events. The first is judged
   * by appeal — it decides who chooses you. The second is the one your own
   * customers notice, and nothing modelled it: a company could double its
   * price and lose nobody it already had. Absent on a world written before
   * this existed, which reads as "no change" and is the safe answer.
   */
  priceWas?: number;
  /** Seats currently filled. A team that fires its CMO pays one fewer salary and loses the lever. */
  seats: Role[];
  /**
   * How many executive salaries this company actually pays.
   *
   * Normally one per filled seat, and left undefined to say so. A solo
   * founder's company is the exception it exists for: one person holds all
   * five desks, so every lever is theirs to pull and the absence penalty never
   * applies — but there is one of them, and charging a startup $700,000 a year
   * for four officers it does not employ is the difference between a hard
   * simulation and a dishonest one.
   *
   * Deliberately not "seats.length minus the empty ones": an empty seat is a
   * lever nobody pulls, which is a real and different cost, and conflating
   * the two is how a solo season would quietly start losing decisions.
   */
  officers?: number;
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
   * Quality on its way, in points, that lands next year.
   *
   * What was shipped this year, plus research that has been in the pipeline
   * for a year already. Quality is felt a year after it is built: a feature
   * shipped in March is not what people are talking about until the next
   * season. It is why a team can look flat for a year and then move further
   * in one than anybody could have bought.
   */
  pipeline?: number;
  /**
   * Research still two years out, in quality points. Moves into `pipeline`
   * next year and lands the year after. The slowest money in the game, and
   * the most it buys per pound.
   */
  pipelineLater?: number;
  /**
   * Brand that this year's campaigns have bought and that has not landed
   * yet. A brand campaign is felt half in the year it runs and half the year
   * after — awareness builds, it does not switch on.
   */
  brandPipeline?: number;
  /**
   * Staff at the start of the year beyond the five seats.
   *
   * The difference between this and this year's headcount is new hires, who
   * are paid from day one and are not much use until their second year.
   */
  staff?: number;
  /**
   * The company's credit score, 0–100, drifting each year towards what its
   * profit, debt and cash justify. Sets its interest rate and how much the
   * bank will lend. See `finance.ts`.
   */
  creditScore?: number;
  /**
   * The part of `debt` that is an emergency loan — money lent because cash ran
   * out, at a punitive rate. Always a portion of `debt`, never extra to it, so
   * everything that reads `debt` as the total still gets it right.
   */
  emergencyDebt?: number;
  /** Who bought a stake, what they expect, and whether they have taken the chair. */
  investors?: import("./finance").Investors;
  /**
   * A price per segment, set by the marketing seat once tiers unlock. A segment
   * with no tier pays `price`. See `responsibilities.ts` for how tiers leak.
   */
  tiers?: Record<string, number>;
  /**
   * Long-term loans: fixed rate, repaid in full when they mature, with a
   * covenant. Always a portion of `debt`, like the emergency loan.
   */
  bonds?: import("./responsibilities").Bond[];
  /**
   * Cash collected this year from annual plans for service owed next year. It
   * was received early, so next year it is revenue that brings no cash in.
   */
  prepaid?: number;
  /**
   * How much less likely this company's customers are to leave this year, 0–1.
   * Set on the way into the market from the annual plans on offer; never stored.
   */
  retention?: number;
  /** Room leased for this year only. Set on the way into the market; never stored. */
  leased?: number;
  /** The five chairs as people: how loyal, how good, how hard pushed. See `people.ts`. */
  people?: Partial<Record<Role, import("./people").Person>>;
  /** How good the staff are, 0–100; what their support is worth. Set a year ahead by recruiting and training. */
  staffQuality?: number;
  /** How automated the plant is, 0–100: cheaper units, a dearer and slower plant to change. See `factory.ts`. */
  automation?: number;
  /** Stock bought last year, waiting to serve customers this year's room cannot. */
  stock?: number;
  /** Whether the work is done in house or bought in. */
  sourcing?: "in_house" | "outsourced";
  /** Days customers get to pay. Longer wins business and delays the money. See `treasury.ts`. */
  terms?: number;
  /** Money earned but not yet collected, arriving next year. */
  receivables?: number;
  /** Last year's cost review, as a percentage: felt this year in service and morale. */
  reviewScar?: number;
  /** Features built or copied, and whether they worked. See `product.ts`. */
  features?: import("./product").Feature[];
  /** Security built up, 0–100: lowers the chance and the damage of a breach. */
  security?: number;
  /** Analytics built up, 0–100: a narrower forecast and better-aimed spending. */
  data?: number;
  /** This year's PR backfire, as reputation lost. Set on the way into the market; never stored. */
  prReputation?: number;
  /** A shock the chief executive has yet to answer. See `world.ts`. */
  shock?: import("./world").Shock;
  /** Dividends the founders have taken out: theirs for good, counted in what they own. */
  banked?: number;
  /** Improvement programmes started, each paying out over three years. */
  programmes?: import("./world").Programme[];
  /** A region operations has committed to open, and the year it opens. */
  expanding?: { cityId: string; opensYear: number };
  /** How much of a newly opened region is reached this year, by city. Set on the way into the market; never stored. */
  ramp?: Record<string, number>;
  /** Customers won by last year's promotion, by segment: deal-chasers, who leave faster. */
  dealChasers?: Record<string, number>;
  /** Customers lost to rivals last year, by segment, for win-back. */
  leftLastYear?: Record<string, number>;
  /** Where the company stood when those customers left, to judge whether it fixed anything. */
  lastStats?: { quality: number; service: number; price: number };
  /** Revenue shares owed to distribution partners, and the last year each runs. */
  revenueShares?: { rate: number; until: number; from: string }[];
  /** This year's promotion. Set on the way into the market; never stored. */
  promo?: string;
  /** How the marketing seat split its attention across regions this year. Set on the way in; never stored. */
  regionFocus?: Record<string, number>;
  /** And across segments. Set on the way in; never stored. */
  segmentFocus?: Record<string, number>;
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
    pipelineLater: Math.max(0, num(c.pipelineLater, 0)),
    brandPipeline: Math.max(0, num(c.brandPipeline, 0)),
    staff: Math.max(0, Math.round(num(c.staff, 0))),
    creditScore: Math.max(0, Math.min(100, num(c.creditScore, 50))),
    emergencyDebt: Math.max(0, num(c.emergencyDebt, 0)),
    tiers: c.tiers && typeof c.tiers === "object"
      ? Object.fromEntries(Object.entries(c.tiers).filter(([, v]) => Number.isFinite(Number(v)) && Number(v) >= 0).map(([k, v]) => [k, Number(v)]))
      : undefined,
    bonds: Array.isArray(c.bonds)
      ? c.bonds.filter((b) => Number.isFinite(Number(b?.amount)) && Number(b.amount) > 0)
          .map((b) => ({ amount: Number(b.amount), rate: num(b.rate, 0.08), maturesYear: Math.round(num(b.maturesYear, 1)) }))
      : undefined,
    prepaid: Math.max(0, num(c.prepaid, 0)),
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
  /**
   * Niches companies have gone and found during this season.
   *
   * Stored on the world rather than on the market, because the market is
   * rebuilt from code every year so that balance edits reach seasons already
   * running — which would wipe anything a season invented. Composed back onto
   * the market in the one place the engine reads it. See `niche-openings.ts`.
   */
  openedNiches?: import("./niche-openings").OpenedNiche[];
  /**
   * How many decisions make a year: 1, 4 or 12.
   *
   * The engine resolves one *period*, and a period is a year divided by this.
   * Absent means one, which is what a season has always been and what every
   * existing world replays as.
   *
   * Everything that is a flow — salaries, interest, revenue, the money a
   * lever costs, what a segment grows by, what a brand loses by standing
   * still — is divided by it. Everything that is a stock is not. See
   * `cadence.ts`, which is where that distinction is written down properly.
   */
  periodsPerYear?: number;
  /**
   * Market events still in force, each with the period it runs out.
   *
   * A yearly event drawn in a quarterly season has to last the year, so it is
   * written down here rather than applied once and forgotten.
   */
  weather?: import("./events").Weather[];
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
