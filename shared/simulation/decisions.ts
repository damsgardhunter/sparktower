/**
 * What each seat decides in a year, and how five sets of decisions become one
 * company.
 *
 * ## Why the levers multiply
 *
 * The brief asks for a game where a team has to work together, and that is a
 * property of the arithmetic, not of the copy. If effects added up, four idle
 * seats and one hard-working CMO would still move the company four fifths as
 * far as five working seats — and the game would be about who spends most.
 * Combined multiplicatively, the same total effort spread across five
 * coordinated decisions beats it comfortably, and a team that ignores a seat
 * feels the hole immediately.
 *
 * The specific couplings, each chosen because it is true of real companies and
 * teaches something at the table:
 *
 *   - **Marketing without capacity is churn.** Demand the COO cannot serve
 *     turns into people who tried you once and tell others. The CMO cannot
 *     safely spend without asking the COO what they can deliver.
 *   - **Quality without awareness is invisible.** The CTO can build the best
 *     product in the niche and watch nothing happen until the CMO pays to make
 *     it known.
 *   - **Price without cost is a wound.** The CMO can cut price whenever they
 *     like; whether it is a strategy or a slow death depends on what the COO
 *     has done to unit cost.
 *   - **Everything without cash is nothing.** The CFO decides how much of any
 *     of it is affordable, and a plan that runs the company out of money is a
 *     plan that ends the season early.
 *
 * ## On the shape of a decision
 *
 * These are not multiple-choice. Each seat allocates real money across
 * competing uses, and the interesting decisions are the trade-offs inside one
 * seat as much as between seats — a CTO choosing reliability over features, a
 * CFO choosing a cheaper loan with a covenant over an expensive one without.
 */
import type { Company, Economy, Niche, Role } from "./types";
import { saturate } from "./market";

/** Price and how the market hears about you. */
export interface MarketingDecision {
  /** What a customer pays. The most public number a company has. */
  price: number;
  /** Long-lived awareness. Slow, compounding, and what makes everything else cheaper later. */
  brandSpend: number;
  /** Buying attention now. Immediate, and gone the moment it stops. */
  performanceSpend: number;
  /** A name attached to yours: large, fast, and a liability if the company disappoints. */
  celebritySpend: number;
  /** Cities to concentrate on rather than spraying the whole market. Focus beats reach at small budgets. */
  targetCities: string[];
}

/** Money: where it comes from and what it costs. */
export interface FinanceDecision {
  /** Drawn from the credit line this year. */
  borrow: number;
  /** Paid back this year. */
  repay: number;
  /** Equity sold, and what fraction of the company goes with it. */
  raise?: { amount: number; equityPct: number };
  /** Held back rather than spent. Dull, and the reason a bad year isn't a fatal one. */
  cashBuffer: number;
}

/** The product itself. */
export interface TechDecision {
  /** Features, performance, the things a review would mention. */
  featureSpend: number;
  /** Uptime, defects, the things only noticed when absent. */
  reliabilitySpend: number;
  /** Paying down the shortcuts taken in earlier years. Invisible this year, cheaper every year after. */
  techDebtPaydown: number;
}

/** Making and serving what is sold. */
export interface OpsDecision {
  /** Units the company can deliver next year. Too little loses customers, too much burns cash. */
  capacityTarget: number;
  /** Support quality: the difference between a complaint and a story someone tells. */
  supportSpend: number;
  /** Process work that lowers what each unit costs to make. */
  efficiencySpend: number;
  /** People. Cheaper than it looks in year one, and the largest fixed cost by year five. */
  headcount: number;
}

/** The decisions only the chief executive can make. */
export interface ExecutiveDecision {
  /** Where the company says its effort goes. Concentrating beats hedging in a market this contested. */
  focus: "growth" | "margin" | "quality" | "survival";
  /** Seats to close, folding their levers into whoever is left. Saves salary and costs judgement. */
  dissolveSeats?: Role[];
  /** An offer to another company in the niche. */
  offer?: { targetCompanyId: string; kind: "buy_asset" | "acquire" | "merge"; assetId?: string; amount: number };
}

/** One year, from all five seats. A missing seat is a real state, not an error. */
export interface TeamDecisions {
  companyId: string;
  cmo?: MarketingDecision;
  cfo?: FinanceDecision;
  cto?: TechDecision;
  coo?: OpsDecision;
  ceo?: ExecutiveDecision;
}

/**
 * What the five decisions add up to before the market sees them.
 *
 * Every coupling described at the top of this file happens here, which is why
 * it is one function rather than five: the interactions are the design, and
 * splitting them per seat would let one of them quietly stop applying.
 */
export interface Interlock {
  /** Multiplier on marketing's effect, cut when there is nothing to deliver. */
  deliverable: number;
  /** Multiplier on quality's effect, cut when nobody has heard of it. */
  known: number;
  /** True when the company sold below what it costs to make. */
  sellingAtALoss: boolean;
  /** Plain-language notes for the year's report — the game teaching itself. */
  notes: string[];
}

export function interlock(company: Company, d: TeamDecisions, niche: Niche): Interlock {
  const notes: string[] = [];

  const marketingSpend = (d.cmo?.brandSpend ?? 0) + (d.cmo?.performanceSpend ?? 0) + (d.cmo?.celebritySpend ?? 0);
  const held = Object.values(company.customers).reduce((sum, n) => sum + n, 0);
  const targetCapacity = d.coo?.capacityTarget ?? company.capacity;

  /*
   * Demand the company cannot serve. Marketing that outruns capacity does not
   * merely waste money — it produces people who tried and were let down, so the
   * effect is capped rather than merely reduced.
   *
   * Measured against the market rather than against the customers already held:
   * in year one every company holds nothing, so anchoring on `held` made the
   * coupling vanish in exactly the year a team is most likely to over-promise.
   */
  const reachable = niche.segments.reduce((sum, s) => sum + s.size, 0);
  const impliedDemand = held + saturate(marketingSpend, 400_000) * reachable * 0.09;
  const deliverable = targetCapacity <= 0 ? 0 : Math.min(1, targetCapacity / Math.max(1, impliedDemand));
  if (marketingSpend > 50_000 && deliverable < 0.85) {
    notes.push("Marketing brought in more people than operations could serve. The ones turned away don't come back quietly.");
  }

  /*
   * Quality nobody knows about. A great product with no awareness is a great
   * product nobody buys, and the CTO's year reads as wasted unless the CMO
   * spent alongside them.
   */
  const awareness = saturate((d.cmo?.brandSpend ?? 0) + (d.cmo?.celebritySpend ?? 0) * 0.7, 250_000);
  const known = 0.35 + 0.65 * Math.max(awareness, company.brand / 140);
  const techSpend = (d.cto?.featureSpend ?? 0) + (d.cto?.reliabilitySpend ?? 0);
  if (techSpend > 120_000 && known < 0.55) {
    notes.push("The product got materially better and almost nobody found out. Quality is only worth what the market knows about it.");
  }

  const price = d.cmo?.price ?? company.price;
  const sellingAtALoss = price < company.unitCost;
  if (sellingAtALoss) {
    notes.push(`Every unit sold at ${Math.round(price)} costs ${Math.round(company.unitCost)} to make. Volume makes this worse, not better.`);
  }

  if (!d.cmo) notes.push("No marketing decision was made this year: price held, and awareness decayed.");
  if (!d.coo) notes.push("No operations decision was made this year: capacity held flat while the market grew.");
  if (!d.cto) notes.push("No product decision was made this year: quality drifted as rivals moved.");
  if (!d.cfo) notes.push("No finance decision was made this year: no borrowing, no repayment, and whatever cash was there absorbed the costs.");

  return { deliverable, known, sellingAtALoss, notes };
}

/**
 * How far one year of spending moves a 0–100 score.
 *
 * Saturating rather than linear: the first hundred thousand buys far more than
 * the fifth, which is what stops the game being "whoever has the most money
 * wins" and makes the timing of spend matter as much as its size.
 */
export function lift(spend: number, half: number, ceiling: number): number {
  return saturate(Math.max(0, spend), half) * ceiling;
}

/** What the company pays every year before it does anything at all. */
/**
 * What the chief executive's focus actually does.
 *
 * It had to do something. `focus` was declared, shown in the lobby as the
 * chair five people race each other for, and then read by nothing at all — so
 * the most contested seat in the game was the one seat whose decision could
 * not change the outcome. That is worse than an unbalanced lever; it is a
 * promise the simulation quietly refused to keep.
 *
 * The shape of it: a focus is not a sixth set of spending, it is a thumb on
 * everyone else's scale. It cannot win a year on its own and it cannot save a
 * company that has decided nothing, which is right — a chief executive who
 * could out-decide four other people would make their seats decorative
 * instead. Every one of them trades something away, so there is no default
 * answer and choosing is a real argument rather than a lookup.
 */
export const FOCUS_EFFECTS = {
  /** Take share now, and pay for it in efficiency. */
  growth: { marketing: 1.18, quality: 0.95, cost: 1.04, fixed: 1.05, decay: 1 },
  /** Make the customers you have pay properly, and grow slower for it. */
  margin: { marketing: 0.82, quality: 0.95, cost: 0.93, fixed: 0.97, decay: 1 },
  /** Build something worth switching to, and wait to be noticed. */
  quality: { marketing: 0.88, quality: 1.25, cost: 1.01, fixed: 1, decay: 1 },
  /**
   * Stop the bleeding. A hiring freeze and deferred everything: the cheapest
   * year the company can have, and the one it comes out of behind.
   */
  survival: { marketing: 0.7, quality: 0.75, cost: 0.9, fixed: 0.78, decay: 1.15 },
} as const;

export type Focus = keyof typeof FOCUS_EFFECTS;

/** The multipliers for a focus, or a neutral year when no chief executive filed. */
export const focusEffects = (focus?: string) =>
  FOCUS_EFFECTS[(focus ?? "") as Focus] ?? { marketing: 1, quality: 1, cost: 1, fixed: 1, decay: 1 };

/** What the focus did, in the words the team will read afterwards. */
export const FOCUS_NOTES: Record<Focus, string> = {
  growth: "The year was run for growth: marketing went further than it otherwise would, and everything cost a little more to do.",
  margin: "The year was run for margin: each unit cost less to make and to serve, and the marketing did not reach as far.",
  quality: "The year was run for quality: the product moved faster than the spending alone would explain, and fewer people heard about it.",
  survival: "The year was run for survival: a hiring freeze and deferred everything. Much cheaper, and the company comes out of it behind where it would otherwise be.",
};

export function fixedCosts(company: Company, headcount: number, economy: Economy): number {
  const salaries = headcount * 85_000 * economy.costIndex;
  // Each filled seat is an executive salary. Dissolving one is a real saving
  // and a real loss — which is the trade the CEO is being offered.
  const executives = company.seats.length * 140_000;
  return salaries + executives;
}
