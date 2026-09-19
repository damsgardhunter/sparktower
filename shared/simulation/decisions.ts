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
  /** Customers the seat expects to end the year with. Everybody else plans on it. From year two. */
  forecast?: number;
  /** A price per segment; one left out pays `price`, and nought is a free tier. From year three. */
  tiers?: Record<string, number>;
  /** PR and influencers: cheap brand when it lands, which is a little better than half the time. From year three. */
  prSpend?: number;
  /** A referral programme: customers bringing customers, if the product is worth it. From year four. */
  referralSpend?: number;
  /** A promotion: a free first month, or a January sale. From year five. */
  promo?: "none" | "free_month" | "january";
  /** Spent bringing back last year's leavers. From year six. */
  winbackSpend?: number;
  /** A research report: next year's expectations, or what the incumbents will charge. From year six. */
  research?: "none" | "expectations" | "rivals";
  /** A vote on each deal the chief executive sent to the table. From year five. */
  dealVotes?: Record<string, "yes" | "no">;
}

/** Money: where it comes from and what it costs. */
export interface FinanceDecision {
  /** Drawn from the credit line this year. */
  borrow: number;
  /** Paid back this year. */
  repay: number;
  /** Equity sold, and what fraction of the company goes with it. */
  raise?: { amount: number; equityPct: number };
  /**
   * What to raise this year, as the desk files it.
   *
   * A flat number rather than the older `{ amount, equityPct }`: the team says
   * how much they want and the engine prices the dilution against what the
   * company is actually worth. Letting a team name their own equity price
   * would be letting them decide what their company is worth, which is the one
   * number in a raise that is never theirs to choose.
   */
  raiseAmount?: number;
  /** Held back rather than spent. Dull, and the reason a bad year isn't a fatal one. */
  cashBuffer: number;
  /** "short" draws on the credit line; "long" issues a fixed-rate loan with a covenant. From year three. */
  borrowTerm?: "short" | "long";
  /** Percentage, up to 20, held back from what a seat (or everyone) committed. From year four. */
  holdBack?: number;
  /** Whose spending the hold-back applies to: a seat, or "all". */
  holdBackSeat?: string;
  /** Discount, up to 30%, for paying a year up front. From year four. */
  annualDiscount?: number;
  /** Overhead cut this year, up to 20%. Service and morale find out next year. From year five. */
  costReview?: number;
  /** What to insure against. From year six. */
  insurance?: "none" | "breach" | "lawsuit" | "poaching" | "all";
  /** Share of profit paid out, 0–100. From year six. */
  dividendPct?: number;
  /** A vote on each deal the chief executive sent to the table. From year five. */
  dealVotes?: Record<string, "yes" | "no">;
}

/** The product itself. */
export interface TechDecision {
  /** Features, performance, the things a review would mention. */
  featureSpend: number;
  /** Uptime, defects, the things only noticed when absent. */
  reliabilitySpend: number;
  /** Paying down the shortcuts taken in earlier years. Invisible this year, cheaper every year after. */
  techDebtPaydown: number;
  /**
   * Work that lands next year rather than this one.
   *
   * Worth more per pound than shipping features now, and it does nothing at
   * all for the year you spend it in. The only lever in the game that asks a
   * team to be behind this year on purpose — which is the decision every
   * real product organisation actually argues about.
   */
  researchSpend?: number;
  /** Engineering pay as a percentage of the market, 80–130. From year three. */
  engineerPay?: number;
  /** Security: lowers the odds and the size of a breach. Builds up. From year two. */
  securitySpend?: number;
  /** Analytics: a gift to the other seats. Builds up. From year three. */
  dataSpend?: number;
  /** One feature from this year's menu, by id, or "" for none. From year four. */
  featureBet?: string;
  /** Build it (a year, full effect, might flop) or copy a rival's (now, half effect). */
  featureMode?: "build" | "copy";
  /** A vote on each deal the chief executive sent to the table. From year five. */
  dealVotes?: Record<string, "yes" | "no">;
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
  /** Room rented for this year only: immediate, and 40% dearer than building. From year two. */
  leaseCapacity?: number;
  /** Spent on who the year's hires are. Lands when they arrive, next year. From year four. */
  recruitingSpend?: number;
  /** Spent making the staff already here better. Lands next year. From year four. */
  trainingSpend?: number;
  /** One improvement programme to start this year. From year three. */
  programme?: "" | "process" | "vendor" | "quality" | "green" | "benchmarking";
  /** Open the region announced for next year: its city id, or "". From year five. */
  expand?: string;
  /** A vote on each deal the chief executive sent to the table. From year five. */
  dealVotes?: Record<string, "yes" | "no">;
}

/** The decisions only the chief executive can make. */
export interface ExecutiveDecision {
  /** Where the company says its effort goes. Concentrating beats hedging in a market this contested. */
  focus: "growth" | "margin" | "quality" | "survival";
  /** Seats to close, folding their levers into whoever is left. Saves salary and costs judgement. */
  dissolveSeats?: Role[];
  /** An offer to another company in the niche. */
  offer?: { targetCompanyId: string; kind: "buy_asset" | "acquire" | "merge"; assetId?: string; amount: number };
  /**
   * Who the company is for.
   *
   * A positioning decision rather than a spending one: naming a segment makes
   * the company meaningfully more appealing to those people and slightly less
   * to everybody else. It is the chief executive's because it is the decision
   * the other four then have to live inside — the CMO's price, the COO's
   * service and the CTO's roadmap all mean different things depending on who
   * the answer is.
   */
  positioning?: string;
  /** Seats to bring back, at the cost of the salary that was saved by losing them. A single seat arrives as a string. */
  rehire?: Role[] | Role | "";
  /** Percentages of what the company can spend, per spending seat. From year two. */
  budget?: Partial<Record<"cmo" | "cto" | "coo", number>>;
  /** How hard each other seat's next objective is pushed. From year three. */
  targets?: Partial<Record<Role, "easy" | "fair" | "aggressive">>;
  /** Paid, shared equally, to the seats that meet this year's objective. From year three. */
  bonusPool?: number;
  /** One seat whose decision this year is reversed to last year's. From year five. */
  overrule?: Role | "";
  /** One seat to fire, and what to bid for their replacement. From year six. */
  replaceSeat?: Role | "";
  replaceBid?: number;
  /** "ship" it, "balanced", or get it "right". From year four. */
  pace?: "ship" | "balanced" | "right";
  /** Each of this year's offers: accept, decline, or send it to the table for a vote. From year five. */
  deals?: Record<string, "accept" | "decline" | "vote">;
  /** How to answer last year's shock. From year two, and only when there is one. */
  shockAnswer?: string;
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
  /*
   * Reported, and no longer used to discount the marketing itself.
   *
   * This used to scale every pound of marketing by capacity over an implied
   * demand — and the implied demand is a guess, off by a factor of fifty: it
   * put a new dating app's demand from £1.7m of marketing at 436,000 people
   * when the market gave it about 8,000. Harmless while capacity was free and
   * every team sat on hundreds of thousands of it. Once capacity cost money
   * and teams sized it to a real forecast, the guess threw away ninety-eight
   * per cent of their marketing for serving a demand that did not exist.
   *
   * Out-marketing your capacity now costs what it really costs, in the place
   * it really happens: the people you cannot serve go to a rival, and your
   * reputation pays for having turned them away. The year's report says so,
   * from what actually happened rather than from this estimate.
   */
  const deliverable = targetCapacity <= 0 ? 0 : Math.min(1, targetCapacity / Math.max(1, impliedDemand));

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
 * Decisions with every number made a number.
 *
 * The engine used to trust what it was handed, and one bad field was enough to
 * take down a whole market: a `NaN` price makes a company's appeal `NaN`,
 * which makes every allocation weight `NaN`, which makes every company's
 * customers and revenue and cash `NaN` — the incumbents included. One team
 * filing nonsense corrupted the season for the other four, and because the
 * world is stored between years, it stayed corrupted.
 *
 * The routes validate before anything reaches here, and that is the right
 * place for a person's mistake to be caught and explained. This is the other
 * thing: a validator is one refactor away from being bypassed, a new lever can
 * be added without one, and a world saved during an earlier bug can still hold
 * a `NaN` today. The engine is the last place that can refuse to spread it.
 */
const clean = (value: unknown, fallback = 0): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const SEATS = ["cmo", "cfo", "cto", "coo"] as const;
const isSeat = (v: unknown): v is Role => typeof v === "string" && (SEATS as readonly string[]).includes(v);

/** A yes or no per deal, and nothing else. */
function cleanVotes(value: unknown): Record<string, "yes" | "no"> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, "yes" | "no"> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (v === "yes" || v === "no") out[k.slice(0, 64)] = v;
  return Object.keys(out).length ? out : undefined;
}

/** Accept, decline or vote per deal, and nothing else. */
function cleanAnswers(value: unknown): Record<string, "accept" | "decline" | "vote"> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, "accept" | "decline" | "vote"> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (v === "accept" || v === "decline" || v === "vote") out[k.slice(0, 64)] = v;
  return Object.keys(out).length ? out : undefined;
}

/** A stretch per seat, and nothing that is not one. */
function cleanLevels(value: unknown): Partial<Record<Role, "easy" | "fair" | "aggressive">> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Partial<Record<Role, "easy" | "fair" | "aggressive">> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSeat(k) && (v === "easy" || v === "fair" || v === "aggressive")) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A map of numbers, each made a number and bounded; anything else dropped. Empty becomes undefined. */
function cleanNumbers(value: unknown, min: number, max = Infinity): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === "" || v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = Math.max(min, Math.min(max, n));
  }
  return Object.keys(out).length ? out : undefined;
}

export function sanitiseDecisions(d: TeamDecisions): TeamDecisions {
  const out: TeamDecisions = { companyId: d.companyId };

  if (d.cmo) out.cmo = {
    ...d.cmo,
    // A price of nothing is not a decision anybody can act on, so it falls
    // back to a pound rather than to zero and a division by it.
    price: Math.max(0.01, clean(d.cmo.price, 1)),
    brandSpend: Math.max(0, clean(d.cmo.brandSpend)),
    performanceSpend: Math.max(0, clean(d.cmo.performanceSpend)),
    celebritySpend: Math.max(0, clean(d.cmo.celebritySpend)),
    targetCities: Array.isArray(d.cmo.targetCities) ? d.cmo.targetCities.filter((c) => typeof c === "string") : [],
    forecast: Math.max(0, clean(d.cmo.forecast)),
    tiers: cleanNumbers(d.cmo.tiers, 0),
    prSpend: Math.max(0, clean(d.cmo.prSpend)),
    referralSpend: Math.max(0, clean(d.cmo.referralSpend)),
    promo: d.cmo.promo === "free_month" || d.cmo.promo === "january" ? d.cmo.promo : "none",
    winbackSpend: Math.max(0, clean(d.cmo.winbackSpend)),
    research: d.cmo.research === "expectations" || d.cmo.research === "rivals" ? d.cmo.research : "none",
    dealVotes: cleanVotes(d.cmo.dealVotes),
  };

  if (d.cto) out.cto = {
    featureSpend: Math.max(0, clean(d.cto.featureSpend)),
    reliabilitySpend: Math.max(0, clean(d.cto.reliabilitySpend)),
    techDebtPaydown: Math.max(0, clean(d.cto.techDebtPaydown)),
    researchSpend: Math.max(0, clean(d.cto.researchSpend)),
    engineerPay: d.cto.engineerPay === undefined ? undefined : Math.max(80, Math.min(130, clean(d.cto.engineerPay, 100))),
    securitySpend: Math.max(0, clean(d.cto.securitySpend)),
    dataSpend: Math.max(0, clean(d.cto.dataSpend)),
    featureBet: typeof d.cto.featureBet === "string" ? d.cto.featureBet.slice(0, 64) : "",
    featureMode: d.cto.featureMode === "copy" ? "copy" : "build",
    dealVotes: cleanVotes(d.cto.dealVotes),
  };

  if (d.coo) out.coo = {
    ...d.coo,
    capacityTarget: Math.max(0, clean(d.coo.capacityTarget)),
    supportSpend: Math.max(0, clean(d.coo.supportSpend)),
    efficiencySpend: Math.max(0, clean(d.coo.efficiencySpend)),
    headcount: Math.max(0, Math.round(clean(d.coo.headcount))),
    leaseCapacity: Math.max(0, Math.round(clean(d.coo.leaseCapacity))),
    recruitingSpend: Math.max(0, clean(d.coo.recruitingSpend)),
    trainingSpend: Math.max(0, clean(d.coo.trainingSpend)),
    programme: (["process", "vendor", "quality", "green", "benchmarking"] as const).includes(d.coo.programme as any) ? d.coo.programme : "",
    expand: typeof d.coo.expand === "string" ? d.coo.expand.slice(0, 64) : "",
    dealVotes: cleanVotes(d.coo.dealVotes),
  };

  if (d.cfo) out.cfo = {
    ...d.cfo,
    borrow: Math.max(0, clean(d.cfo.borrow)),
    repay: Math.max(0, clean(d.cfo.repay)),
    cashBuffer: Math.max(0, clean(d.cfo.cashBuffer)),
    raiseAmount: Math.max(0, clean((d.cfo as any).raiseAmount)),
    borrowTerm: d.cfo.borrowTerm === "long" ? "long" : "short",
    holdBack: Math.max(0, Math.min(20, clean(d.cfo.holdBack))),
    holdBackSeat: typeof d.cfo.holdBackSeat === "string" && d.cfo.holdBackSeat ? d.cfo.holdBackSeat : "all",
    annualDiscount: Math.max(0, Math.min(30, clean(d.cfo.annualDiscount))),
    costReview: Math.max(0, Math.min(20, clean(d.cfo.costReview))),
    insurance: (["breach", "lawsuit", "poaching", "all"] as const).includes(d.cfo.insurance as any) ? d.cfo.insurance : "none",
    dividendPct: Math.max(0, Math.min(100, clean(d.cfo.dividendPct))),
    dealVotes: cleanVotes(d.cfo.dealVotes),
  };

  if (d.ceo) out.ceo = {
    ...d.ceo,
    focus: (["growth", "margin", "quality", "survival"] as const).includes(d.ceo.focus as any)
      ? d.ceo.focus
      : "growth",
    budget: cleanNumbers(d.ceo.budget, 0, 100),
    targets: cleanLevels(d.ceo.targets),
    bonusPool: Math.max(0, clean(d.ceo.bonusPool)),
    overrule: isSeat(d.ceo.overrule) ? d.ceo.overrule : "",
    replaceSeat: isSeat(d.ceo.replaceSeat) ? d.ceo.replaceSeat : "",
    replaceBid: Math.max(0, clean(d.ceo.replaceBid)),
    pace: d.ceo.pace === "ship" || d.ceo.pace === "right" ? d.ceo.pace : "balanced",
    deals: cleanAnswers(d.ceo.deals),
    shockAnswer: typeof d.ceo.shockAnswer === "string" && /^(statement|silence|blame_(cmo|cfo|cto|coo))$/.test(d.ceo.shockAnswer) ? d.ceo.shockAnswer : "",
  };

  return out;
}

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

/**
 * How much being "for" a segment is worth, and what it costs elsewhere.
 *
 * Deliberately modest. A positioning that doubled appeal would make every
 * other decision a rounding error, and one that did nothing would be a
 * dropdown pretending to be a strategy. Roughly a fifth better where you aimed
 * and a tenth worse everywhere else is enough to change which segment is worth
 * fighting for without deciding the season on its own.
 */
export const POSITIONING_BONUS = 1.18;
export const POSITIONING_COST = 0.92;

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

/**
 * What it costs to keep the doors open, before anyone decides anything.
 *
 * Scaled by how much of the country the company sells in, which is the part
 * that makes the city decision a real trade rather than a button marked
 * "better". A company in one city does not carry a national payroll; one that
 * has opened everywhere is paying for everywhere whether or not it is selling
 * there. Expansion buys reach and buys a bigger bill with it, and a team that
 * spreads faster than it sells feels exactly that.
 *
 * The floor matters as much as the scale: even a single-city company has five
 * executives and a head office, so the base never falls below 40%.
 */
/**
 * What one person costs for a year, and what one executive chair costs.
 *
 * Named because the phone re-implements this arithmetic by hand and there was
 * nothing for its copy to be checked against — two bare literals in a function
 * body cannot be imported by the test that proves the two sides agree.
 */
export const SALARY = 85_000;
export const EXECUTIVE = 140_000;

/**
 * What technical debt does while you carry it.
 *
 * Two effects, both quiet and both compounding: product work buys less,
 * because a share of every engineer's year goes into working around what is
 * already there; and each unit costs more to make and serve, because the same
 * is true of operations. Neither is dramatic in one year, which is exactly why
 * a team lets it run — and why a company at seventy is spending half again as
 * much for the same result as one at ten.
 *
 * Paying it down buys nothing visible in the year you do it. That is the
 * decision: the seat that clears it gets no credit, and the seat that does not
 * hands a slower company to whoever is still playing in year twelve.
 */
export const debtDrag = (techDebt = 0): { product: number; unitCost: number } => {
  const held = Math.max(0, Math.min(100, techDebt));
  return {
    // At 100, product spending is worth half what it would be at nothing.
    product: 1 - held / 200,
    // And every unit costs up to a third more to make.
    unitCost: 1 + held / 300,
  };
};

/**
 * How debt moves in a year.
 *
 * Shipping features adds it; reliability work adds none, because that is the
 * work of doing it properly. Paying it down removes roughly a point per
 * seventy thousand, so clearing a badly-run decade is a real programme rather
 * than a line item. And it decays slightly on its own — some of what rots is
 * replaced in the course of ordinary work.
 */
export function nextTechDebt(input: {
  current?: number;
  featureSpend?: number;
  paydown?: number;
}): number {
  const { current = 0, featureSpend = 0, paydown = 0 } = input;
  const added = saturate(Math.max(0, featureSpend), 400_000) * 9;
  const cleared = Math.max(0, paydown) / 70_000;
  return Math.max(0, Math.min(100, current + added - cleared - 0.5));
}

export function fixedCosts(company: Company, headcount: number, economy: Economy, reach = 1): number {
  const footprint = 0.4 + 0.6 * Math.max(0, Math.min(1, reach));
  const salaries = headcount * SALARY * economy.costIndex;
  // Each filled seat is an executive salary. Dissolving one is a real saving
  // and a real loss — which is the trade the CEO is being offered.
  const executives = company.seats.length * EXECUTIVE;
  return (salaries + executives) * footprint;
}

/**
 * What a year of capacity nobody used costs.
 *
 * Capacity was free. The operations seat could set it to ten times demand at no
 * cost whatever, so the forecast was a number nobody could get wrong in the
 * expensive direction, and "how much can we serve" was never a bet. Real
 * headroom is rent, staff and machines paid for whether or not anybody turns
 * up: a kitchen with no diners in it still has chefs.
 *
 * Charged on the idle part only. The cost of serving somebody is already in the
 * unit cost; this is the cost of being ready to serve somebody who never came.
 * Priced against what the market pays for one sale, so it means the same thing
 * in a market where a sale is £14 and one where it is £14,000.
 */
export const IDLE_RATE = 0.08;

export function marketPriceOf(niche: Niche): number {
  return niche.segments.reduce((sum, s) => sum + s.referencePrice * s.size, 0)
    / Math.max(1, niche.segments.reduce((sum, s) => sum + s.size, 0));
}

export const idleCapacityCost = (idle: number, niche: Niche): number =>
  Math.max(0, idle) * marketPriceOf(niche) * IDLE_RATE;

/**
 * Tax on trading profit, after losses carried from earlier years.
 *
 * Twenty per cent: close enough to the real thing to feel like it, low enough
 * that a profitable year is still plainly worth having. Losses carry forward,
 * so the three hard years a new company spends getting going shelter the
 * first good one rather than being forgotten by it.
 */
export const TAX_RATE = 0.2;

export function taxOn(profit: number, carried = 0): { tax: number; carried: number } {
  if (profit <= 0) return { tax: 0, carried: carried + Math.max(0, -profit) };
  const taxable = Math.max(0, profit - carried);
  return { tax: taxable * TAX_RATE, carried: Math.max(0, carried - profit) };
}
