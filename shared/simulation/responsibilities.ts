/**
 * What each seat is responsible for, when it becomes theirs, and what the
 * money-and-pricing decisions actually do.
 *
 * ## Why decisions unlock over the season
 *
 * Each seat starts with the three or four levers it has always had. More
 * arrive as the season goes, a couple a year, until by year five every seat
 * is running its whole brief. Day one is a company with five people learning
 * each other; a desk of thirty-five controls on that day would be a desk
 * people scroll past, and the file that defines the levers says so. Arriving
 * a year at a time, each new decision lands on a team that already knows what
 * the old ones do — which is the only way a new one can be understood rather
 * than guessed at.
 *
 * `UNLOCKS` is the schedule. A lever not in it is there from year one.
 *
 * ## The money-and-pricing decisions
 *
 * Every number below is priced against what the market pays for one sale
 * (`marketPriceOf`), never in pounds, so a lease means the same thing to a
 * podcast network selling at £14 and a construction firm at £14,000.
 *
 * Each one was built to have a real trade-off, and the tests in
 * `responsibilities.test.ts` hold them to it: a range where it helps, and a
 * setting where it hurts. A lever that only ever helps is a tax on not
 * noticing it; a lever that never helps is decoration.
 */
import type { Company, Economy, Niche, Role, Segment } from "./types";
import { ROLE_TITLES } from "./types";
import { fixedCosts, focusEffects, marketPriceOf, type TeamDecisions } from "./decisions";
import { reachOf, saturate } from "./market";
import { featureCost } from "./product";
import { automationCost, shiftCapacity, stockCost } from "./factory";
import { programmeCost, researchCost, statementCost } from "./world";

// ─── The schedule ────────────────────────────────────────────────────────────

export interface Unlock {
  role: Role;
  /** The lever's id in `LEVER_FIELDS`. */
  field: string;
  /** The season year it first appears in. */
  year: number;
}

/**
 * When each new responsibility arrives.
 *
 * A season is fourteen years and a table that has to wait until year eight for
 * the decisions it was promised is a table playing the old game for half of
 * it. So the ramp is short: year one is the on-ramp, by year two every seat is
 * running most of its job, and by year five it has all of it. What stays late
 * is what needs something to already exist — you cannot automate a plant
 * nobody has built, or buy back shares nobody else owns yet — and the two
 * levers that are aimed at people rather than numbers.
 */
export const UNLOCKS: Unlock[] = [
  // Year two: the whole company's money, the forecast, and room to rent.
  { role: "ceo", field: "budget", year: 2 },
  { role: "cmo", field: "forecast", year: 2 },
  { role: "coo", field: "leaseCapacity", year: 2 },
  // Year two: pricing properly, borrowing properly, and the first product bet.
  { role: "cmo", field: "tiers", year: 2 },
  { role: "cfo", field: "borrowTerm", year: 2 },
  { role: "cto", field: "securitySpend", year: 2 },
  { role: "ceo", field: "shockAnswer", year: 2 },
  // Year two: the chief executive starts managing people, and pay becomes a lever.
  { role: "ceo", field: "targets", year: 2 },
  { role: "ceo", field: "bonusPool", year: 2 },
  { role: "cto", field: "engineerPay", year: 2 },
  // Year three: the finance seat's reach over everybody else.
  { role: "cfo", field: "holdBack", year: 3 },
  { role: "cfo", field: "holdBackSeat", year: 3 },
  { role: "cfo", field: "annualDiscount", year: 3 },
  // Year three: who operations hires, how they are trained, and what it runs.
  { role: "coo", field: "recruitingSpend", year: 3 },
  { role: "coo", field: "trainingSpend", year: 3 },
  { role: "coo", field: "programme", year: 3 },
  // Year three: the bets — channels, data, and the big product calls.
  { role: "cto", field: "dataSpend", year: 3 },
  { role: "cmo", field: "prSpend", year: 3 },
  { role: "ceo", field: "pace", year: 3 },
  { role: "cto", field: "featureBet", year: 3 },
  { role: "cto", field: "featureMode", year: 3 },
  { role: "cmo", field: "referralSpend", year: 3 },
  // Year three: the offers that arrive, and the table's vote on them.
  { role: "ceo", field: "deals", year: 3 },
  { role: "cmo", field: "dealVotes", year: 3 },
  { role: "cfo", field: "dealVotes", year: 3 },
  { role: "cto", field: "dealVotes", year: 3 },
  { role: "coo", field: "dealVotes", year: 3 },
  // Year four: the sharp tools, the patient money, and aiming the marketing.
  { role: "ceo", field: "overrule", year: 4 },
  { role: "cfo", field: "costReview", year: 4 },
  { role: "cmo", field: "promo", year: 4 },
  // Operations puts the announced region up; the other four vote on it.
  { role: "coo", field: "expand", year: 4 },
  { role: "ceo", field: "expandVote", year: 4 },
  { role: "cmo", field: "expandVote", year: 4 },
  { role: "cfo", field: "expandVote", year: 4 },
  { role: "cto", field: "expandVote", year: 4 },
  { role: "cmo", field: "winbackSpend", year: 4 },
  { role: "cmo", field: "research", year: 4 },
  { role: "cfo", field: "insurance", year: 4 },
  { role: "cfo", field: "dividendPct", year: 4 },
  { role: "cmo", field: "regionFocus", year: 4 },
  { role: "cmo", field: "segmentFocus", year: 4 },
  /*
   * Going and finding a niche, from year five.
   *
   * Late on purpose. It is the move a company makes once it knows what it is
   * actually good at, and a table that has not yet built anything
   * distinctive would only carve out a corner indistinguishable from the
   * segment it came from — which is what the mechanic would honestly give
   * them, and a lever whose honest answer is "that did nothing" is a bad
   * first experience of it.
   */
  { role: "cmo", field: "openNiche", year: 5 },
  /*
   * Year five, the plant and the balance sheet: refinements of decisions the
   * table has already been making for four years. There is no point automating
   * a plant before anybody has built one, or selling receivables before there
   * is anything owed.
   */
  { role: "coo", field: "automationTarget", year: 5 },
  { role: "coo", field: "shiftCapacity", year: 5 },
  { role: "coo", field: "stockTarget", year: 5 },
  { role: "coo", field: "sourcing", year: 5 },
  { role: "cfo", field: "terms", year: 5 },
  { role: "cfo", field: "factorPct", year: 5 },
  { role: "cfo", field: "refinance", year: 5 },
  // Later, and on purpose: buying the company back needs somebody to buy from,
  // and firing a teammate is not a year-four decision.
  { role: "cfo", field: "buyback", year: 6 },
  { role: "ceo", field: "replaceSeat", year: 5 },
  { role: "ceo", field: "replaceBid", year: 5 },
];

const unlockOf = new Map(UNLOCKS.map((u) => [`${u.role}:${u.field}`, u.year]));

/** The year a lever first appears, or 1 if it has always been there. */
export const unlockYear = (role: Role, field: string): number => unlockOf.get(`${role}:${field}`) ?? 1;

/**
 * Whether a seat has this lever yet.
 *
 * `period` counts decisions and `periods` is how many make a year, because
 * the schedule above is written in years and has to stay written in years. A
 * quarterly season gated on the raw period counter handed a table every lever
 * in the game inside nine months, and a monthly one inside three — which is
 * not a faster game, it is the teaching order thrown away.
 */
export const isUnlocked = (role: Role, field: string, period: number, periods = 1): boolean =>
  Math.floor((period - 1) / Math.max(1, periods)) + 1 >= unlockYear(role, field);

/**
 * The order one person meets the levers in, when there is nobody else at the table.
 *
 * ## Why a solo season needs its own schedule
 *
 * `UNLOCKS` above is written for five people. Each of them starts with three
 * or four levers and ends the season running about a dozen, which is a job a
 * person can hold in their head. A solo founder holds all five desks, so they
 * start with **nineteen** — every seat's opening levers at once, on the first
 * screen they ever see — and by the end of a four-year quarterly season they
 * are looking at forty-nine. Measured, not guessed: `docs/simulation-playtest.md`.
 *
 * Nineteen decisions before you have made one is not a business; it is a
 * spreadsheet with a start button. And the lumpiness is as bad as the size —
 * year two hands a solo founder seven more in a single period, because seven
 * different desks each got one.
 *
 * So a solo season reads the same schedule differently. Eight levers open it,
 * and the rest arrive a few a period, in this order, spread across three
 * quarters of the season so the last stretch is played rather than learned.
 * Nothing is taken away and nothing arrives that a table would not also get:
 * the list is filtered to the years the season is actually long enough to
 * reach, exactly as the team schedule is.
 *
 * The eleven that open it are the decisions a business cannot be run without:
 * where the period goes, who the company is for, what it charges, how much it
 * can serve, two ways people hear about it, how it gets better, how it looks
 * after people, who it employs, what it borrows and what it keeps back.
 *
 * That list is not a taste. It is what the desk's own tests already hold a
 * solo founder's first period to — filing a brand budget, holding cash back,
 * declaring a focus — and they are right: eight was an aesthetic preference,
 * and it would have taken away decisions a first period genuinely makes.
 *
 * `focus` is in it for a second reason as well as the obvious one. It is what
 * every other seat's period is aimed at, and it is the field a solo filing
 * carries for the chief executive's desk — a founder's decision is validated
 * against all five at once, so a period that cannot say where it is going is
 * a period that files awkwardly.
 */
export const SOLO_ORDER: readonly string[] = [
  // ── The first period: what a business cannot open without. ──
  /*
   * `founderActions` opens the season, and it is the one entry here that is not
   * about money at all.
   *
   * It belongs in the first period precisely because of who plays alone: the
   * founder who has been sent a season and has £60,000 and no staff. Every
   * other lever on this line asks them to spend something; this one asks what
   * they will do with the month. Handing it over in period six, after the ramp
   * has got through the spending levers, would withhold the only lever that
   * works on an empty balance sheet from the only person who needs it.
   */
  "focus", "positioning", "founderActions", "price", "capacityTarget",
  "brandSpend", "performanceSpend", "featureSpend", "supportSpend",
  "headcount", "borrow", "cashBuffer",
  // ── The rest of what a table holds on day one. ──
  "targetCities", "reliabilitySpend", "efficiencySpend",
  "repay", "raiseAmount", "researchSpend", "techDebtPaydown", "celebritySpend",
  // ── Year two for a table: planning, pricing properly, renting room. ──
  "forecast", "tiers", "leaseCapacity", "engineerPay",
  "borrowTerm", "securitySpend", "shockAnswer",
  // ── Year three: the channels, the bets, and the offers that arrive. ──
  "prSpend", "referralSpend", "featureBet", "featureMode", "dataSpend",
  "trainingSpend", "recruitingSpend", "programme", "pace",
  "annualDiscount", "holdBack", "deals", "dealVotes",
  // ── Year four: expansion, and the sharper money. ──
  "expand", "expandVote", "regionFocus", "segmentFocus", "promo",
  "winbackSpend", "research", "costReview", "insurance", "dividendPct",
  // ── Year five: refinements of things that have to exist first. ──
  "openNiche", "automationTarget", "shiftCapacity", "stockTarget",
  "sourcing", "terms", "factorPct", "refinance",
  // ── Later still. ──
  "buyback",
];

/**
 * How many open the season, before anything is spread.
 *
 * Twelve rather than eleven since `founderActions` joined the first line: the
 * count is a deliberate ceiling on how much a first period asks of somebody,
 * and leaving it at eleven would have pushed `cashBuffer` out of the opening
 * to make room — taking away a decision a business really does make on day one
 * to pay for one that costs nothing.
 */
const SOLO_OPENING = 12;

/**
 * How much of the season is spent learning.
 *
 * The last quarter arrives with nothing new in it, on purpose: a lever handed
 * over in the final period is a lever nobody gets to find out about, and a
 * season should end on decisions the player already understands.
 */
const SOLO_RAMP = 0.75;

/** The earliest year any desk gets this lever, for filtering and for order. */
const soloYearOf = (field: string): number => {
  let best = 1;
  let found = false;
  for (const u of UNLOCKS) {
    if (u.field !== field) continue;
    if (!found || u.year < best) { best = u.year; found = true; }
  }
  return found ? best : 1;
};

const soloCache = new Map<string, Map<string, number>>();

/**
 * The period each lever arrives in, for one person playing this season alone.
 *
 * `total` is how many decisions the whole season has and `periods` how many
 * make a year. Both are needed: the years decide *which* levers a season is
 * long enough to reach, and the periods decide how thinly the rest are spread.
 */
export function soloSchedule(total: number, periods = 1): ReadonlyMap<string, number> {
  const per = Math.max(1, periods);
  const span = Math.max(1, Math.round(total));
  const key = `${span}:${per}`;
  const cached = soloCache.get(key);
  if (cached) return cached;

  const years = Math.max(1, Math.ceil(span / per));
  const reachable = SOLO_ORDER.filter((f) => soloYearOf(f) <= years);
  const opening = reachable.slice(0, SOLO_OPENING);
  const rest = reachable.slice(SOLO_OPENING);

  const schedule = new Map<string, number>();
  for (const f of opening) schedule.set(f, 1);
  /*
   * Everything else spread evenly from the second period to the end of the
   * ramp. A season with no room to spread anything (a four-period yearly one,
   * say) collapses to "period two", which is the honest answer: there is
   * nowhere else to put them.
   */
  const last = Math.max(2, Math.round(span * SOLO_RAMP));
  for (let i = 0; i < rest.length; i++) {
    const at = rest.length <= 1 ? 2 : 2 + Math.round((i * (last - 2)) / (rest.length - 1));
    schedule.set(rest[i], at);
  }
  soloCache.set(key, schedule);
  return schedule;
}

/**
 * Whether the founder has this lever yet, in a season they are playing alone.
 *
 * A lever the solo order does not mention is one only a table ever sees (see
 * `LEVERS_FOR_A_TABLE`), and the desk filters those out separately — but
 * answering `false` here as well means a crafted filing cannot reach one
 * through a door the screen does not open.
 */
export const soloUnlocked = (field: string, period: number, total: number, periods = 1): boolean => {
  const at = soloSchedule(total, periods).get(field);
  return at !== undefined && period >= at;
};

/** What arrives next year, for the "coming up" line on the desk. */
export const arrivingIn = (role: Role, period: number, periods = 1): string[] => {
  const year = Math.floor((period - 1) / Math.max(1, periods)) + 1;
  return UNLOCKS.filter((u) => u.role === role && u.year === year).map((u) => u.field);
};

// ─── Capacity: build, lease, sell ────────────────────────────────────────────

/**
 * What one unit of capacity costs to build, once, as a share of one sale.
 *
 * Capacity used to be free to build and only cost money while it sat idle.
 * That made building ahead a bet with a floor under it, and it left nothing
 * for leasing to be dearer than. A quarter of a sale per unit is paid back by
 * about three months of that customer; building for people who never arrive
 * is now a cost on top of the idle charge, which is what a forecast is for.
 */
export const BUILD_RATE = 0.1;

/** Leasing costs this much more than building, for one year's use. */
export const LEASE_PREMIUM = 1.4;

/** Capacity sold back fetches this share of what it cost to build. */
export const SELL_BACK = 0.3;

export const buildCostPerUnit = (niche: Niche): number => marketPriceOf(niche) * BUILD_RATE;
export const leaseCostPerUnit = (niche: Niche): number => buildCostPerUnit(niche) * LEASE_PREMIUM;

export interface CapacityMoney {
  /** Paid this year for room that opens next year. */
  build: number;
  /** Paid this year for room used this year and returned. */
  lease: number;
  /** Received this year for room given up. */
  sold: number;
}

/**
 * The money side of this year's capacity decisions.
 *
 * Building is charged in the year it is ordered, although the room opens a
 * year later: the builders are paid while they build. Leased room is
 * immediate and gone at the year's end. A cut sells the room back at a loss.
 */
export function capacityMoney(input: { current: number; target: number; lease: number; niche: Niche }): CapacityMoney {
  const current = Math.max(0, input.current);
  const target = Math.max(0, input.target);
  const perUnit = buildCostPerUnit(input.niche);
  return {
    build: Math.max(0, target - current) * perUnit,
    lease: Math.max(0, input.lease) * leaseCostPerUnit(input.niche),
    sold: Math.max(0, current - target) * perUnit * SELL_BACK,
  };
}

// ─── Price tiers ─────────────────────────────────────────────────────────────

/**
 * How easily a customer on a dear tier finds their way to a cheap one.
 *
 * Tiers are only worth having because each segment pays something different;
 * they are only a decision because the fences between them leak. The wider
 * the gap between a segment's tier and the cheapest one on offer, the more of
 * that segment works out how to pay the cheaper price — so a premium set far
 * above the rest is partly a price nobody pays, and a free tier drags every
 * other tier down with it.
 */
export const TIER_LEAK = 0.45;

/** What a free user is worth in advertising, as a share of what their segment would pay. */
export const FREE_AD_RATE = 0.06;

/** Free users cost this share of a paying one to serve: lighter, never nothing. */
export const FREE_SERVE_COST = 0.5;

/** What one segment is asked to pay: its tier, or the list price if it has none. */
export function priceFor(company: Pick<Company, "price" | "tiers">, segmentId: string): number {
  const tier = company.tiers?.[segmentId];
  return typeof tier === "number" && Number.isFinite(tier) && tier >= 0 ? tier : company.price;
}

/** Whether this segment has a tier of its own, rather than paying the list price. */
export function hasTier(company: Pick<Company, "tiers">, segmentId: string): boolean {
  const tier = company.tiers?.[segmentId];
  return typeof tier === "number" && Number.isFinite(tier) && tier >= 0;
}

/** The cheapest price anybody can pay this company, which every other tier leaks towards. */
export function cheapestPrice(company: Pick<Company, "price" | "tiers">, segments: Pick<Segment, "id">[]): number {
  return Math.min(...segments.map((s) => priceFor(company, s.id)));
}

/**
 * What a segment's customers actually pay, on average, once some of them
 * have found the cheaper tier.
 */
export function paidBy(company: Pick<Company, "price" | "tiers">, segment: Pick<Segment, "id">, floor: number): number {
  const asked = priceFor(company, segment.id);
  if (asked <= 0 || asked <= floor) return asked;
  const leak = TIER_LEAK * (1 - floor / asked);
  return asked * (1 - leak) + floor * leak;
}

export interface Takings {
  revenue: number;
  /** Customers on a free tier, who pay in attention rather than money. */
  freeUsers: number;
  /** Of the revenue, what advertising to free users brought in. */
  adRevenue: number;
  /** Revenue lost to customers trading down to a cheaper tier than their own. */
  leaked: number;
}

/**
 * What a year's customers pay, tier by tier.
 *
 * Without tiers this is exactly customers times price, as it always was —
 * a company that never touches the lever is billed precisely as before.
 */
export function takings(company: Pick<Company, "price" | "tiers">, customers: Record<string, number>, segments: Segment[]): Takings {
  const floor = cheapestPrice(company, segments);
  let revenue = 0;
  let freeUsers = 0;
  let adRevenue = 0;
  let leaked = 0;
  for (const segment of segments) {
    const n = Math.max(0, customers[segment.id] ?? 0);
    if (n === 0) continue;
    const asked = priceFor(company, segment.id);
    if (asked <= 0) {
      freeUsers += n;
      const ads = n * segment.referencePrice * FREE_AD_RATE;
      adRevenue += ads;
      revenue += ads;
      continue;
    }
    const paid = paidBy(company, segment, floor);
    revenue += n * paid;
    leaked += n * (asked - paid);
  }
  return { revenue, freeUsers, adRevenue, leaked };
}

/**
 * Brand from a free tier: people who use the thing for nothing tell people.
 * Worth up to four points a year, at a free base of a tenth of the market.
 */
export function freeTierBrand(freeUsers: number, niche: Niche): number {
  const market = niche.segments.reduce((sum, s) => sum + s.size, 0) || 1;
  return Math.min(4, saturate(freeUsers / market, 0.1) * 8);
}

// ─── The forecast ────────────────────────────────────────────────────────────

/** Within this, the forecast was right and the year was planned well. */
export const FORECAST_GOOD = 0.1;
/** Beyond this, it was wrong enough to cost money. */
export const FORECAST_BAD = 0.2;
/** Share of revenue saved by a year planned on a good number. */
export const FORECAST_SAVING = 0.02;
/** Share of revenue lost per unit of error beyond the bad line, and the most it can cost. */
export const FORECAST_COST_SLOPE = 0.2;
export const FORECAST_COST_MAX = 0.08;

export interface ForecastOutcome {
  /** (actual − forecast) / forecast. Positive means more came than were expected. */
  error: number;
  /** Money saved (positive) or lost (negative) because of it. */
  effect: number;
  verdict: "good" | "fine" | "bad";
}

/**
 * What the marketing seat's number did to the year.
 *
 * Everybody else plans on it: hiring, stock, the cash the finance seat
 * expects to have. A good number is quietly worth a couple of per cent of
 * revenue in things bought at the right volume. A bad one is expensive in
 * either direction — too high and the company paid for customers who never
 * came, too low and it paid rush rates for the ones who did.
 */
export function forecastOutcome(
  forecast: number | undefined,
  actual: number,
  revenue: number,
  /** Extra room for error the company's data buys (see `dataEffects` in product.ts). */
  tolerance = 0,
): ForecastOutcome | null {
  if (!forecast || forecast <= 0) return null;
  const error = (actual - forecast) / forecast;
  const miss = Math.abs(error);
  if (miss <= FORECAST_GOOD + tolerance) return { error, effect: revenue * FORECAST_SAVING, verdict: "good" };
  if (miss <= FORECAST_BAD + tolerance) return { error, effect: 0, verdict: "fine" };
  const share = Math.min(FORECAST_COST_MAX, (miss - FORECAST_BAD - tolerance) * FORECAST_COST_SLOPE);
  return { error, effect: -revenue * share, verdict: "bad" };
}

// ─── The budget split, and the finance seat's hold-back ──────────────────────

/** The seats whose spending the chief executive divides between them. */
export const SPENDING_SEATS = ["cmo", "cto", "coo"] as const;
export type SpendingSeat = (typeof SPENDING_SEATS)[number];

/** The most the finance seat can hold back from anyone's plan. */
export const HOLD_BACK_MAX = 20;

/**
 * How much of each seat's plan survives the chief executive's split and the
 * finance seat's hold-back, as a multiplier on what it asked for.
 *
 * The split is a share of what the company can actually spend once the
 * salaries are paid. A seat that asks for more than its share is cut to it;
 * a seat under its share keeps everything — unspent allowance is not handed to
 * somebody else, because a split that moved money silently between seats
 * would be a split nobody could argue with. No split filed means no caps, as
 * before the lever existed.
 */
export function seatAllowances(input: {
  wanted: Record<SpendingSeat, number>;
  /** Percentages per seat. Missing or empty means the chief executive set none. */
  budget?: Partial<Record<SpendingSeat, number>> | null;
  /** What the company can spend once salaries are owed. */
  spendable: number;
  holdBack?: number;
  holdBackSeat?: string;
}): { factor: Record<SpendingSeat, number>; capped: SpendingSeat[]; heldBack: SpendingSeat[] } {
  const factor = { cmo: 1, cto: 1, coo: 1 } as Record<SpendingSeat, number>;
  const capped: SpendingSeat[] = [];
  const heldBack: SpendingSeat[] = [];
  const split = input.budget && SPENDING_SEATS.some((s) => Number(input.budget?.[s]) > 0) ? input.budget : null;

  for (const seat of SPENDING_SEATS) {
    const wanted = Math.max(0, input.wanted[seat] ?? 0);
    if (wanted <= 0) continue;
    if (split) {
      const share = Math.max(0, Math.min(100, Number(split[seat]) || 0)) / 100;
      const allowance = Math.max(0, input.spendable) * share;
      if (wanted > allowance) {
        factor[seat] = allowance / wanted;
        capped.push(seat);
      }
    }
    const pct = Math.max(0, Math.min(HOLD_BACK_MAX, Number(input.holdBack) || 0));
    const target = input.holdBackSeat || "all";
    if (pct > 0 && (target === "all" || target === seat)) {
      factor[seat] *= 1 - pct / 100;
      heldBack.push(seat);
    }
  }
  return { factor, capped, heldBack };
}

// ─── Annual plans ────────────────────────────────────────────────────────────

/** The deepest discount the finance seat can offer for paying a year up front. */
export const ANNUAL_DISCOUNT_MAX = 30;
/** Of next year's takings from annual customers, the share collected this year. */
export const PREPAID_SHARE = 0.4;

export interface AnnualPlans {
  /** Share of customers who take the annual plan. */
  uptake: number;
  /** Multiplier on this year's revenue: the discount they were given. */
  revenueFactor: number;
  /** How much less likely a customer is to leave, 0–1. */
  retention: number;
  /**
   * And what happens when the plan ends: extra churn, as an annual rate.
   *
   * Somebody who has spent a year paying 30% under the list price does not
   * see the list price as the price. They see a rise of 43%, and a rise on
   * people already paying is the one thing this market model has always said
   * they walk out over (`resented`, in `market.ts`). Coming off the plan is
   * exactly that event, and nothing charged for it.
   *
   * That mattered because it is the only cost here that does not scale
   * linearly with the discount. Giving away `d` costs `d`, and what it buys —
   * customers who cannot leave — is worth the same at every depth, so a
   * deeper discount was always the better buy and the lever's whole range
   * collapsed onto its cap. Measured over twenty-four quarters, the cap was
   * the right answer in all seven markets and worth 20% to 40% of the company.
   *
   * The step back up is `d / (1 - d)`, which is what the rise actually is, so
   * the cost of a deep discount rises faster than the discount does and there
   * is a depth past which it stops being worth it.
   */
  unwind: number;
}

/**
 * How much of the step back up to list price is felt as churn.
 *
 * Calibrated, not derived, against the standard this file sets for every lever
 * it defines: a range where it helps and a setting where it hurts. Worth of
 * the company after twenty-four quarters, by how deep the discount is:
 *
 *              d=0       d=10      d=20      d=30     best
 *   dating   376,416   446,640   442,272   406,176    10%
 *   drones   197,010   213,030   209,250   122,984    10%   ← 30% worse than none
 *   pods     262,399   304,214   305,155   288,658    20%
 *   MMOs      63,340   110,357    65,609         0    10%   ← 30% worse than none
 *
 * Higher and the cap becomes ruinous rather than merely wrong, which is no
 * better a lever than one whose cap is always right. Lower and the whole range
 * flattens back out toward the cap. At 0.3 a shallow plan is worth taking in
 * every market, a deep one is worth taking in none, and in two of them going
 * to the cap is worse than never offering a plan at all.
 */
export const ANNUAL_UNWIND = 0.3;

/**
 * Paying a year up front, for a discount.
 *
 * The discount costs revenue on everybody who takes it. What it buys is
 * customers who cannot leave until the year is up — worth most where people
 * leave most, and least in a segment that was never going anywhere — and
 * cash collected before it is earned.
 */
export function annualPlans(discountPct: number | undefined): AnnualPlans {
  const d = Math.max(0, Math.min(ANNUAL_DISCOUNT_MAX, Number(discountPct) || 0)) / 100;
  if (d <= 0) return { uptake: 0, revenueFactor: 1, retention: 0, unwind: 0 };
  const uptake = 0.6 * saturate(d, 0.12);
  return {
    uptake,
    revenueFactor: 1 - d * uptake,
    retention: 0.5 * uptake,
    unwind: uptake * (d / (1 - d)) * ANNUAL_UNWIND,
  };
}

// ─── Borrowing on terms ──────────────────────────────────────────────────────

export interface Bond {
  amount: number;
  /** The rate fixed when it was issued. */
  rate: number;
  /** The year it is repaid, in full, from cash. */
  maturesYear: number;
}

/** A long-term loan is this much cheaper than the credit line, for being locked in. */
export const BOND_DISCOUNT = 0.015;
/** Years a long-term loan runs. */
export const BOND_TERM = 3;
/** The covenant: operating profit must cover interest this many times over. */
export const COVENANT_COVER = 1.5;
/** What breaking it costs: rating points, and a penalty on the bonds' rate. */
export const COVENANT_RATING_HIT = 6;
export const COVENANT_PENALTY = 0.02;

/** How much of the company's debt is on long-term terms. */
export const bondTotal = (company: Pick<Company, "bonds">): number =>
  (company.bonds ?? []).reduce((sum, b) => sum + Math.max(0, b.amount), 0);

// ─── Funding the year ────────────────────────────────────────────────────────

/**
 * What a drawdown actually draws: never more than the bank will lend.
 *
 * `borrow` used to be taken at face value, so a finance seat filing fifty
 * million against a two-million line funded forty-eight million the bank had
 * never agreed to, and the credit rating that sets the line was decorative.
 * And what is still available afterwards is what is left *after* the draw —
 * counted from before, a million borrowed appeared twice, as cash in hand and
 * as credit still to draw. Used by the year, the meter and the phone alike.
 */
export function drawdown(company: Pick<Company, "creditLimit" | "debt">, borrow: number | undefined): number {
  return Math.min(Math.max(0, Number(borrow) || 0), Math.max(0, company.creditLimit - company.debt));
}

/**
 * What each seat is actually allowed to spend, decided before anything reads
 * a single figure.
 *
 * Three things can cut a seat's plan: the finance seat's floor (cash nobody
 * may spend), the chief executive's split of what is left, and the finance
 * seat's hold-back. They used to be applied to the bill only — the floor cut
 * what a team was charged while every pound of the uncut plan still bought
 * brand, quality and service, so holding cash back was a discount rather than
 * a cost, and a company with no money kept growing on marketing it never paid
 * for. Cutting the decisions themselves makes one figure true everywhere:
 * what was spent is what was charged is what it bought.
 *
 * Shared by the year (`resolveYear`) and the forecast, so a forecast never
 * predicts what a plan the company cannot pay for would have bought.
 */
/**
 * The regions a plan can actually pay to open, cheapest first.
 *
 * Regions already open are always kept — this decides what is *added*, never
 * what is given up, because closing a region is not a thing the lever does.
 */
export function affordableCities(
  company: Pick<Company, "cities">,
  niche: Pick<Niche, "cities">,
  wanted: readonly string[] | undefined,
  spendable: number,
): string[] {
  const here = Array.isArray(company.cities) ? company.cities : [];
  if (!Array.isArray(wanted)) return [...here];
  const adding = niche.cities
    .filter((c) => wanted.includes(c.id) && !here.includes(c.id))
    .sort((a, b) => a.entryCost - b.entryCost);
  const kept: string[] = [...here];
  let left = Math.max(0, spendable);
  for (const city of adding) {
    if (city.entryCost > left) continue;
    left -= city.entryCost;
    kept.push(city.id);
  }
  return kept;
}

export function fundYear(company: Company, d: TeamDecisions, niche: Niche, economy: Economy): { decisions: TeamDecisions; notes: string[] } {
  /*
   * Marketing's money, including the moves that are one price or nothing: a
   * research report, a win-back campaign, and the statement the chief
   * executive makes about last year's shock.
   */
  /*
   * Opening a region is charged in full, in the period it happens, and it was
   * the one purchase in the game with no affordability check at all: a table
   * could tick four regions it could not begin to afford, and the engine
   * opened all of them and funded the hole with an emergency loan at a
   * punitive rate. Played out — a company holding $88,915 opened $149,000 of
   * regions, finished the quarter on nothing, and carried $43,290 of debt it
   * had never agreed to take.
   *
   * So the regions are trimmed to what the money reaches. What is deliberately
   * *not* done is counting the entry cost against the same purse as the
   * spending below it. It is real money and it belongs there in principle, and
   * putting it there narrows the gap between a table that plays well and one
   * that does not by about half — those markets are tuned against expansion
   * being free of the budget, and re-tuning them is a bigger job than this.
   * Written down in `docs/simulation-backlog.md` rather than half-done.
   */
  /*
   * What the table could spend at all, worked out before anything is priced
   * against it: cash, plus anything drawn down, plus the credit still
   * available, less what finance is holding back. The commitment meter on the
   * desk shows the same total.
   */
  const buffer = Math.max(0, d.cfo?.cashBuffer ?? 0);
  const drawn = drawdown(company, d.cfo?.borrow);
  const spendable = Math.max(0, company.cash + drawn + Math.max(0, company.creditLimit - company.debt - drawn) - buffer);

  const here = Array.isArray(company.cities) ? company.cities : [];
  /* Only the regions the money reaches — see `affordableCities`. */
  const cities = affordableCities(company, niche, d.cmo?.targetCities, spendable);
  const refused = Array.isArray(d.cmo?.targetCities)
    ? niche.cities.filter((c) => d.cmo!.targetCities!.includes(c.id) && !here.includes(c.id) && !cities.includes(c.id))
    : [];
  const marketing = (d.cmo?.brandSpend ?? 0) + (d.cmo?.performanceSpend ?? 0) + (d.cmo?.celebritySpend ?? 0)
    + (d.cmo?.prSpend ?? 0) + (d.cmo?.referralSpend ?? 0) + (d.cmo?.winbackSpend ?? 0)
    + (d.cmo?.research && d.cmo.research !== "none" ? researchCost(niche) : 0)
    + (company.shock && d.ceo?.shockAnswer === "statement" ? statementCost(niche) : 0);
  // At the engineering pay the technology seat set (see `people.ts`).
  const payCost = Math.max(80, Math.min(130, Number(d.cto?.engineerPay) || 100)) / 100;
  /*
   * A feature bet is all or nothing: it is charged in full when placed, and
   * counted here so a table cannot place one it cannot afford without the rest
   * of the product plan being cut to make room.
   */
  const bet = d.cto?.featureBet ? featureCost(niche, d.cto.featureMode === "copy" ? "copy" : "build") : 0;
  const product = ((d.cto?.featureSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0) + (d.cto?.techDebtPaydown ?? 0) + (d.cto?.researchSpend ?? 0)
    + (d.cto?.securitySpend ?? 0) + (d.cto?.dataSpend ?? 0) + bet) * payCost;
  /*
   * Building and leasing room are the operations seat's spending like any
   * other: a plan cut to fit the money builds proportionally less room.
   */
  const room = capacityMoney({
    current: company.capacity,
    target: d.coo?.capacityTarget ?? company.capacity,
    lease: d.coo?.leaseCapacity ?? 0,
    niche,
  });
  const plant = automationCost({ from: company.automation ?? 0, to: d.coo?.automationTarget ?? company.automation ?? 0, capacity: company.capacity, niche })
    + shiftCapacity({ capacity: company.capacity, requested: d.coo?.shiftCapacity, niche }).cost
    + stockCost(d.coo?.stockTarget, niche);
  const ops = (d.coo?.supportSpend ?? 0) + (d.coo?.efficiencySpend ?? 0) + (d.coo?.recruitingSpend ?? 0) + (d.coo?.trainingSpend ?? 0)
    + (d.coo?.programme && !(company.programmes ?? []).some((p) => p.id === d.coo!.programme) ? programmeCost(niche) : 0)
    + plant + room.build + room.lease;
  const wanted = marketing + product + ops;
  if (wanted <= 0) return { decisions: d, notes: [] };

  const floorCut = wanted > spendable ? spendable / wanted : 1;
  const notes: string[] = [];
  if (refused.length > 0) {
    notes.push(`There was not enough to open ${refused.map((c) => c.name).join(", ")}. ${refused.length === 1 ? "It stays" : "They stay"} closed rather than being opened on money the company does not have.`);
  }
  if (floorCut < 1) {
    const became = `${Math.round(wanted).toLocaleString()} of planned spending became ${Math.round(wanted * floorCut).toLocaleString()}. Everyone's year was cut by the same fraction.`;
    notes.push(buffer > 0
      ? `Finance held ${Math.round(buffer).toLocaleString()} back, so ${became}`
      : `There was only ${Math.round(spendable).toLocaleString()} to spend, cash and credit together, so ${became}`);
  }

  const fixed = fixedCosts(company, d.coo?.headcount ?? 0, economy, reachOf(company, niche), niche) * focusEffects(d.ceo?.focus).fixed;
  const split = seatAllowances({
    wanted: { cmo: marketing * floorCut, cto: product * floorCut, coo: ops * floorCut },
    budget: d.ceo?.budget,
    spendable: Math.max(0, spendable - fixed),
    holdBack: d.cfo?.holdBack,
    holdBackSeat: d.cfo?.holdBackSeat,
  });
  const seatName = (s: SpendingSeat) => ROLE_TITLES[s].replace("Chief ", "").replace(" Officer", "").toLowerCase();
  for (const s of split.capped) {
    notes.push(`The chief executive's split gave ${seatName(s)} ${d.ceo?.budget?.[s] ?? 0}% of what the company could spend, and its plan was cut to fit.`);
  }
  if (split.heldBack.length > 0) {
    const who = split.heldBack.length === 3 ? "everyone's plans" : split.heldBack.map((s) => `${seatName(s)}'s plan`).join(" and ");
    notes.push(`The chief financial officer held back ${d.cfo?.holdBack}% of ${who}. It was their call, and everyone can see whose.`);
  }

  const f = { cmo: floorCut * split.factor.cmo, cto: floorCut * split.factor.cto, coo: floorCut * split.factor.coo };
  if (f.cmo === 1 && f.cto === 1 && f.coo === 1 && refused.length === 0) return { decisions: d, notes };
  return { notes, decisions: {
    ...d,
    cmo: d.cmo && {
      ...d.cmo, brandSpend: d.cmo.brandSpend * f.cmo, performanceSpend: d.cmo.performanceSpend * f.cmo, celebritySpend: d.cmo.celebritySpend * f.cmo,
      prSpend: (d.cmo.prSpend ?? 0) * f.cmo, referralSpend: (d.cmo.referralSpend ?? 0) * f.cmo,
      winbackSpend: (d.cmo.winbackSpend ?? 0) * f.cmo,
      /*
       * And the regions, to the ones that can actually be paid for.
       *
       * A region is all or nothing — there is no opening 60% of Spain — so
       * this cannot be scaled like the spending above it. The cheapest first,
       * for as far as the money goes: a table that ticked four regions and
       * could afford two gets two, and the two it gets are the two it could
       * most plausibly have meant.
       */
      targetCities: cities,
    },
    cto: d.cto && {
      ...d.cto,
      featureSpend: d.cto.featureSpend * f.cto, reliabilitySpend: d.cto.reliabilitySpend * f.cto,
      techDebtPaydown: d.cto.techDebtPaydown * f.cto, researchSpend: (d.cto.researchSpend ?? 0) * f.cto,
      securitySpend: (d.cto.securitySpend ?? 0) * f.cto, dataSpend: (d.cto.dataSpend ?? 0) * f.cto,
    },
    coo: d.coo && {
      ...d.coo,
      supportSpend: d.coo.supportSpend * f.coo,
      efficiencySpend: d.coo.efficiencySpend * f.coo,
      recruitingSpend: (d.coo.recruitingSpend ?? 0) * f.coo,
      trainingSpend: (d.coo.trainingSpend ?? 0) * f.coo,
      // Growth scaled back to what could be paid for; a cut is free, so it stands.
      capacityTarget: d.coo.capacityTarget > company.capacity
        ? Math.round(company.capacity + (d.coo.capacityTarget - company.capacity) * f.coo)
        : d.coo.capacityTarget,
      leaseCapacity: Math.round((d.coo.leaseCapacity ?? 0) * f.coo),
    },
  } };
}
