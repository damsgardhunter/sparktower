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

/** Whether a seat has this lever yet. */
export const isUnlocked = (role: Role, field: string, year: number): boolean => year >= unlockYear(role, field);

/** What arrives next year, for the "coming up" line on the desk. */
export const arrivingIn = (role: Role, year: number): string[] =>
  UNLOCKS.filter((u) => u.role === role && u.year === year).map((u) => u.field);

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
}

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
  if (d <= 0) return { uptake: 0, revenueFactor: 1, retention: 0 };
  const uptake = 0.6 * saturate(d, 0.12);
  return { uptake, revenueFactor: 1 - d * uptake, retention: 0.5 * uptake };
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
export function fundYear(company: Company, d: TeamDecisions, niche: Niche, economy: Economy): { decisions: TeamDecisions; notes: string[] } {
  /*
   * Marketing's money, including the moves that are one price or nothing: a
   * research report, a win-back campaign, and the statement the chief
   * executive makes about last year's shock.
   */
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

  const buffer = Math.max(0, d.cfo?.cashBuffer ?? 0);
  /*
   * Measured against everything the table could actually spend, which is
   * what the commitment meter has always shown: cash, plus anything drawn
   * down, plus the credit still available, less what finance is holding back.
   */
  const drawn = drawdown(company, d.cfo?.borrow);
  const spendable = Math.max(0, company.cash + drawn + Math.max(0, company.creditLimit - company.debt - drawn) - buffer);
  const floorCut = wanted > spendable ? spendable / wanted : 1;
  const notes: string[] = [];
  if (floorCut < 1) {
    const became = `${Math.round(wanted).toLocaleString()} of planned spending became ${Math.round(wanted * floorCut).toLocaleString()}. Everyone's year was cut by the same fraction.`;
    notes.push(buffer > 0
      ? `Finance held ${Math.round(buffer).toLocaleString()} back, so ${became}`
      : `There was only ${Math.round(spendable).toLocaleString()} to spend, cash and credit together, so ${became}`);
  }

  const fixed = fixedCosts(company, d.coo?.headcount ?? 0, economy, reachOf(company, niche)) * focusEffects(d.ceo?.focus).fixed;
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
  if (f.cmo === 1 && f.cto === 1 && f.coo === 1) return { decisions: d, notes };
  return { notes, decisions: {
    ...d,
    cmo: d.cmo && {
      ...d.cmo, brandSpend: d.cmo.brandSpend * f.cmo, performanceSpend: d.cmo.performanceSpend * f.cmo, celebritySpend: d.cmo.celebritySpend * f.cmo,
      prSpend: (d.cmo.prSpend ?? 0) * f.cmo, referralSpend: (d.cmo.referralSpend ?? 0) * f.cmo,
      winbackSpend: (d.cmo.winbackSpend ?? 0) * f.cmo,
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
