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
import { ROLES } from "./types";
import { salaryIn } from "./workforce";
import { atScale, saturate } from "./market";

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
  /** A price per segment; one left out pays `price`, and nought is a free tier. From year two. */
  tiers?: Record<string, number>;
  /** PR and influencers: cheap brand when it lands, which is a little better than half the time. From year three. */
  prSpend?: number;
  /** A referral programme: customers bringing customers, if the product is worth it. From year three. */
  referralSpend?: number;
  /** A promotion: a free first month, or a January sale. From year four. */
  promo?: "none" | "free_month" | "january";
  /** Spent bringing back last year's leavers. From year four. */
  winbackSpend?: number;
  /** A research report: next year's expectations, or what the incumbents will charge. From year four. */
  research?: "none" | "expectations" | "rivals";
  /** How the year's marketing attention is split across the regions you sell in. From year four. */
  regionFocus?: Record<string, number>;
  /** And across the segments you sell to. From year four. */
  segmentFocus?: Record<string, number>;
  /** A vote on each deal the chief executive sent to the table. From year three. */
  dealVotes?: Record<string, "yes" | "no">;
  /** Vote on the region operations put to the table, keyed by its id. From year four. */
  expandVote?: Record<string, "yes" | "no">;
  /**
   * The segment to go looking inside for a niche of your own, or "" for none.
   * One a year at most, and it costs a year's marketing. From year five.
   */
  openNiche?: string;
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
  /** "short" draws on the credit line; "long" issues a fixed-rate loan with a covenant. From year two. */
  borrowTerm?: "short" | "long";
  /** Percentage, up to 20, held back from what a seat (or everyone) committed. From year three. */
  holdBack?: number;
  /** Whose spending the hold-back applies to: a seat, or "all". */
  holdBackSeat?: string;
  /** Discount, up to 30%, for paying a year up front. From year three. */
  annualDiscount?: number;
  /** Overhead cut this year, up to 20%. Service and morale find out next year. From year four. */
  costReview?: number;
  /** What to insure against. From year four. */
  insurance?: "none" | "breach" | "lawsuit" | "poaching" | "all";
  /** Share of profit paid out, 0–100. From year four. */
  dividendPct?: number;
  /** Days customers get to pay: 0, 30, 60 or 90. From year five. */
  terms?: number;
  /** Share of what customers owe, sold to a factor for cash now, 0–100. From year five. */
  factorPct?: number;
  /** Credit-line debt to move onto fixed terms this year. From year five. */
  refinance?: number;
  /** Cash spent buying a stake back from investors. From year six. */
  buyback?: number;
  /** A vote on each deal the chief executive sent to the table. From year three. */
  dealVotes?: Record<string, "yes" | "no">;
  /** Vote on the region operations put to the table, keyed by its id. From year four. */
  expandVote?: Record<string, "yes" | "no">;
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
  /** Engineering pay as a percentage of the market, 80–130. From year two. */
  engineerPay?: number;
  /** Security: lowers the odds and the size of a breach. Builds up. From year two. */
  securitySpend?: number;
  /** Analytics: a gift to the other seats. Builds up. From year three. */
  dataSpend?: number;
  /** One feature from this year's menu, by id, or "" for none. From year three. */
  featureBet?: string;
  /** Build it (a year, full effect, might flop) or copy a rival's (now, half effect). */
  featureMode?: "build" | "copy";
  /** A vote on each deal the chief executive sent to the table. From year three. */
  dealVotes?: Record<string, "yes" | "no">;
  /** Vote on the region operations put to the table, keyed by its id. From year four. */
  expandVote?: Record<string, "yes" | "no">;
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
  /** Spent on who the year's hires are. Lands when they arrive, next year. From year three. */
  recruitingSpend?: number;
  /** Spent making the staff already here better. Lands next year. From year three. */
  trainingSpend?: number;
  /** One improvement programme to start this year. From year three. */
  programme?: "" | "process" | "vendor" | "quality" | "green" | "benchmarking";
  /** Open the region announced for next year: its city id, or "". From year four. */
  expand?: string;
  /** How automated the plant should be next year, 0–100. From year five. */
  automationTarget?: number;
  /** Units of a second shift to run this year, capped at half the room built. From year five. */
  shiftCapacity?: number;
  /** Units of stock to hold for next year. From year five. */
  stockTarget?: number;
  /** Do the work in house, or buy it in. From year five. */
  sourcing?: "in_house" | "outsourced";
  /** A vote on each deal the chief executive sent to the table. From year three. */
  dealVotes?: Record<string, "yes" | "no">;
}

/** The decisions only the chief executive can make. */
export interface ExecutiveDecision {
  /** Where the company says its effort goes. Concentrating beats hedging in a market this contested. */
  focus: "growth" | "margin" | "quality" | "survival";
  /**
   * What the founders will do with the period themselves, by action id.
   *
   * The only lever on this desk that spends time instead of money — see
   * `actions.ts` for what each one does and why the effects are flat. Bounded
   * by `cleanDecision` to what the market offered and to one a month, two a
   * quarter, three a year, so neither a hand-written filing nor a bot can take
   * five.
   */
  founderActions?: string[];
  /**
   * Seats to close, folding their levers into whoever is left.
   *
   * **Nothing reads this.** `resolveYear` has never looked at it, it is not in
   * `LEVER_FIELDS`, and neither client can set it — so a reader of this type
   * would have found a feature that does not exist. `types.ts` records the
   * decision ("those come back to this list when they come back to
   * `resolveYear`, and not before"); this is the same note where somebody would
   * actually meet the field.
   *
   * Closing a seat is real and arrives another way: `RecoveryKind
   * "dissolve_seat"` in `recovery.ts`, offered to a company in trouble and filed
   * through its own route. Kept rather than deleted so the one-shot reset in
   * `defaultDraft` keeps clearing a stale value out of a carried draft, and so
   * the history is legible to whoever wires it up.
   */
  dissolveSeats?: Role[];
  /**
   * An offer to another company in the niche.
   *
   * **Nothing reads this either**, and `targetCompanyId` appears nowhere else in
   * the repository. Buying another team's company is live and has its own home:
   * `canOffer`, `assessOffer` and `applyAcquisition` in `mergers.ts`, driven from
   * `simulation-market-routes.ts` and settled by the tick.
   */
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
  /** How hard each other seat's next objective is pushed. From year two. */
  targets?: Partial<Record<Role, "easy" | "fair" | "aggressive">>;
  /** Paid, shared equally, to the seats that meet this year's objective. From year two. */
  bonusPool?: number;
  /** One seat whose decision this year is reversed to last year's. From year four. */
  overrule?: Role | "";
  /** One seat to fire, and what to bid for their replacement. From year five. */
  replaceSeat?: Role | "";
  replaceBid?: number;
  /** "ship" it, "balanced", or get it "right". From year three. */
  pace?: "ship" | "balanced" | "right";
  /** Each of this year's offers: accept, decline, or send it to the table for a vote. From year three. */
  deals?: Record<string, "accept" | "decline" | "vote">;
  /** Vote on the region operations put to the table, keyed by its id. From year four. */
  expandVote?: Record<string, "yes" | "no">;
  /** How to answer last year's shock. From year two, and only when there is one. */
  shockAnswer?: string;
}

/** One year, from all five seats. A missing seat is a real state, not an error. */
export interface TeamDecisions {
  /**
   * False when every seat was empty: nobody filed anything at all.
   *
   * Set by `decisionsForYear`, read by `resolveYear` to know the difference
   * between a company running on a caretaker's plan and one nobody is running
   * — which is the difference between a bad season and a closed business.
   */
  steered?: boolean;
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
  const impliedDemand = held + saturate(marketingSpend, atScale(400_000, company.scale)) * reachable * 0.09;
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
  const awareness = saturate((d.cmo?.brandSpend ?? 0) + (d.cmo?.celebritySpend ?? 0) * 0.7, atScale(250_000, company.scale));
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
    regionFocus: cleanNumbers(d.cmo.regionFocus, 0, 100),
    segmentFocus: cleanNumbers(d.cmo.segmentFocus, 0, 100),
    dealVotes: cleanVotes(d.cmo.dealVotes),
    openNiche: typeof d.cmo.openNiche === "string" ? d.cmo.openNiche.slice(0, 64) : "",
    expandVote: cleanVotes(d.cmo.expandVote),
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
    expandVote: cleanVotes(d.cto.expandVote),
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
    automationTarget: d.coo.automationTarget === undefined ? undefined : Math.max(0, Math.min(100, clean(d.coo.automationTarget))),
    shiftCapacity: Math.max(0, Math.round(clean(d.coo.shiftCapacity))),
    stockTarget: Math.max(0, Math.round(clean(d.coo.stockTarget))),
    sourcing: d.coo.sourcing === "outsourced" ? "outsourced" : "in_house",
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
    terms: d.cfo.terms === undefined || (d.cfo.terms as unknown) === "" ? undefined : Math.max(0, Math.min(90, Math.round(clean(d.cfo.terms, 30)))),
    factorPct: Math.max(0, Math.min(100, clean(d.cfo.factorPct))),
    refinance: Math.max(0, clean(d.cfo.refinance)),
    buyback: Math.max(0, clean(d.cfo.buyback)),
    dealVotes: cleanVotes(d.cfo.dealVotes),
    expandVote: cleanVotes(d.cfo.expandVote),
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
    expandVote: cleanVotes(d.ceo.expandVote),
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
/**
 * How many executive salaries a company pays.
 *
 * The count of filled seats, unless the company says otherwise. A solo
 * founder's company holds all five desks so that every lever works and no
 * decision goes unmade, and pays for one person, because that is how many
 * there are. Anything charging for chairs rather than for people reads this.
 */
export const officersOf = (company: { seats?: Role[]; officers?: number }): number =>
  Math.max(1, company.officers ?? (company.seats ?? []).length);

/**
 * A year of this company's running costs — the unit distress is measured in.
 *
 * Three places wanted this number and two of them wrote a flat 1,100,000: the
 * salary bill of a company in one of the seven catalogue markets, which are
 * all sized around that. A market Nova wrote for a startup runs at a
 * hundredth of it and a solo founder employs one person, so a company with
 * $308,000 of headroom and a profit was measured against a corporation's
 * payroll and told, every period, that it had less than a year of costs in
 * reach. It never had a way to stop being told that: nothing it could earn
 * would clear a bar set for a business a hundred times its size.
 *
 * Officers and scale, the same two facts the fixed-cost sum uses, because it
 * is the same salary bill seen from a different screen.
 *
 * Expressed as the old figure moved, not rebuilt from executive salaries. It
 * was never only executives — it is a year of everything a company of five
 * running at catalogue scale pays out — so recomputing it as `officers *
 * EXECUTIVE` came to 700,000 and quietly moved the threshold for the seven
 * markets as well, which the tests on them caught. A full table at full scale
 * gets exactly the number it always got.
 */
export const REFERENCE_YEAR_OF_COSTS = 1_100_000;

export const yearOfCostsFor = (company: { seats?: Role[]; officers?: number; scale?: number }): number =>
  REFERENCE_YEAR_OF_COSTS * (officersOf(company) / ROLES.length) * payScale(company.scale);

export const SALARY = 85_000;
export const EXECUTIVE = 140_000;

/**
 * How a person's pay moves with the size of the market they work in.
 *
 * Not linearly, which is what it used to do. `EXECUTIVE * scale` is right in
 * spirit — a founder in a market worth £1.3m is not on a corporate chief
 * executive's package — and wrong in arithmetic, because a market a hundredth
 * the size made a founder cost a hundredth of a person: **£700 a year**. At
 * that price a company that decided nothing at all was comfortably profitable
 * from its first period and ended a four-year season richer than it started,
 * which is the finding this exists to fix (`docs/simulation-playtest.md`).
 *
 * Pay compresses instead of shrinking. Rent, tooling and headcount scale with
 * the business; the floor under one person does not, because the person still
 * has to eat. A square root is the same compression `marketFor` already uses
 * on the field of companies, and it has the property that matters here: at
 * catalogue scale it is exactly one, so the seven hand-written markets get the
 * number they have always had and nothing balanced against them moves.
 *
 *     scale 1.00  →  1.000  ·  £140,000   (the seven catalogue markets)
 *     scale 0.10  →  0.200  ·  £27,900
 *     scale 0.01  →  0.040  ·  £5,600     (a startup market Nova wrote)
 *
 * The exponent is calibrated rather than derived, so here is the measurement
 * it came from — four strategies, sixteen quarters, the market in
 * `docs/simulation-playtest.md`, reading the company's value at the end:
 *
 *     exponent   does nothing        plays it well
 *     1.0 (old)  +£176 a period      −£208 a period   ← doing nothing pays
 *     0.8        −£62                −£172            ← barely a cost
 *     0.7        −£471               −£114            ← chosen
 *     0.6        −£1,119             −£148, £527 left ← squeezes the player too
 *
 * 0.7 is the point where a company that decides nothing is visibly bleeding
 * and halving its customers, while one that fixes the axis its segment weighs
 * still ends the season worth nearly three times as much. Below it the
 * founder's own salary starts deciding the season, which is not a decision
 * anybody gets to make.
 */
export const PAY_SCALE_POWER = 0.7;

export const payScale = (scale?: number): number =>
  Math.pow(Math.max(0, Math.min(1, Number(scale) || 1)), PAY_SCALE_POWER);

/**
 * What one executive chair costs for a year in this company's market.
 *
 * One definition, because there were two and they disagreed. `fixedCosts`
 * charged this with the regional footprint applied and `startingCompany` sized
 * the opening plant against it without — so every company opened with a plant
 * built for two and a half times the payroll it actually paid. Both now ask
 * here.
 */
export const officerCost = (company: { seats?: Role[]; officers?: number; scale?: number; officerPay?: number }): number =>
  /* `officerPay` is what founders actually draw — absent means a full salary. See `opening.ts`. */
  officersOf(company) * EXECUTIVE * payScale(company.scale) * Math.max(0, company.officerPay ?? 1);

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
  /**
   * The market's size. Both figures below are absolute money and neither was
   * scaled, so in a market Nova wrote for a founder debt never accumulated
   * (£5,000 of features against a £400,000 threshold is nothing) and could
   * never be cleared either — a point of it cost £70,000, and ten points more
   * than the company had ever had. The mechanic was simply absent at that
   * scale. See `atScale`.
   */
  scale?: number;
}): number {
  const { current = 0, featureSpend = 0, paydown = 0, scale = 1 } = input;
  const added = saturate(Math.max(0, featureSpend), atScale(400_000, scale)) * 9;
  const cleared = Math.max(0, paydown) / Math.max(1, atScale(70_000, scale));
  return Math.max(0, Math.min(100, current + added - cleared - 0.5));
}

/**
 * What it costs to keep a plant of this size ready, full or not.
 *
 * The cost base used to be five executive salaries and whoever operations had
 * hired — about £320,000 against a full plant worth £1.5–2.4m, so a company
 * only had to fill a *sixth* of what it built to cover its costs. Measured
 * across 140 seasons, that one number was why failure was nearly impossible:
 * a company that got traction could not then lose it, and every lever that
 * squeezed a working business changed nothing, because no amount of squeezing
 * reaches a business with that much headroom.
 *
 * Room costs money. Rent, licences, the systems, the people who keep it
 * running — a share of what that room earns when it is full, paid whether it
 * is full or not. It is what makes a bad year a bad year, and it is why the
 * operations seat's judgement about how much to build is the decision the
 * season turns on.
 *
 * Measured at the market's own reference price, not the company's, so a team
 * cannot make its overhead disappear by discounting.
 *
 * ## Written, measured, and not yet wired in
 *
 * This is the lever that works. At 0.55 it lands the failure rate on exactly
 * six seasons in twenty, which is the target, and it is the only one of seven
 * things tried that moved the number at all — starting cash, incumbent
 * strength, the leave-rate cap, opening plant, idle cost and contribution
 * margin between them moved it by half a death.
 *
 * It is not wired in because at that strength it does not only kill weak
 * companies, it suppresses strong ones: a competent team's share in MMOs
 * falls from 5% to 2.4% and a good plan stops growing before the season ends.
 * Fourteen guard tests fail and two of them are guarding principles rather
 * than thresholds, which is the difference between a balance that needs
 * re-calibrating and one that is wrong.
 *
 * What it needs before it goes in:
 *
 *   - Incumbents pay it too. They run on a simplified model and have never
 *     paid `fixedCosts` at all, which was ignorable at £320,000 and is not at
 *     £1.2m — charging it to players alone is a tax on being the newcomer.
 *     Wiring that up on its own did not fix the share collapse, so there is
 *     more to it than symmetry.
 *   - A lower setting paired with the second half of the plan: harder opening
 *     segments in the soft markets. Overhead alone at 0.55 is a blunt
 *     instrument; overhead at ~0.35 plus a fickle opening segment in podcasts,
 *     project management and MMOs should reach the same number without
 *     flattening everybody.
 *   - The guard tests re-set against the new economics *afterwards*, never to
 *     make a red suite green.
 *
 * ## Wired in at zero, and swept — 1 Oct 2026
 *
 * It is called now, from its own line in `resolve.ts` beside the idle-capacity
 * cost, so turning it on is this constant and nothing else. It was dead code
 * before: written, measured in some other working copy, and never invoked, which
 * is a four-line change waiting to be made differently by each person who tries.
 * Putting it inside `fixedCosts` is the wrong one of those four lines — that
 * function is salaries and executives, and three tests assert on what it
 * returns.
 *
 * Swept against the repaired skill guard (150 seasons, all seven markets) and
 * the winnability guards:
 *
 *   PLANT_OVERHEAD   deaths/20   skill guard   principle guards
 *       0.0             2.9         holds        all pass
 *       0.05            —           holds        2 construction failures
 *       0.1             3.9         holds        1 construction failure
 *       0.2             4.9         holds        3 failures
 *       0.3             6.9         holds        —
 *
 * So the target death rate is reachable at about 0.25, and the skill guard is
 * not what stops it — that holds at every setting tried, in all seven markets.
 * **Construction is what stops it, and it stops it immediately.** At 0.05 the
 * self-funding archetype there reaches 18% of the best way to play against a
 * floor of 25%: a plan that will not raise capital cannot absorb a new fixed
 * cost, and construction is already the market with the most deaths in it.
 *
 * Which reverses the plan above. The second half was to make the *soft* markets
 * harder; the blocker is the *hardest* market breaking first. Construction wants
 * easing or exempting before the cost base can come up anywhere, and that is a
 * market-content decision rather than a constant.
 */
export const PLANT_OVERHEAD = 0.0;

/**
 * The cost of being a company at all, as a share of what it takes.
 *
 * Premises, insurance, accountancy, software, the phone, the van's MOT, the
 * person who does the invoicing. None of it is a decision and all of it grows
 * with the business, which is exactly the shape of cost this engine was
 * missing: salaries are a step function in the number of officers, unit costs
 * are per sale, and between them nothing scaled with size. So gross profit
 * arrived at the bottom line almost untouched — 38-74% net across fourteen
 * markets, against 5-25% in the trades being modelled.
 *
 * ## Why a share of revenue rather than of the plant
 *
 * `PLANT_OVERHEAD` above is the other candidate and was swept: at 0.25 it is
 * the strongest margin instrument in the engine, taking a veterinary software
 * business from 54.5% net to 21.3%. It also breaks five winnability guards
 * across four markets, because it charges per unit of *capacity* at a quarter
 * of the unit gross margin — which is ruinous in a high-volume market like
 * drone delivery and cannot be eased without re-pricing the market itself.
 *
 * A share of revenue cannot do that. It is zero for a company with no
 * revenue, so it cannot bankrupt a business for being new or small — the
 * failure mode that stopped every previous attempt at raising the cost base —
 * and it is largest exactly where the problem is, on the companies turning
 * over tens of millions at a 70% margin.
 *
 * Fifteen per cent is the middle of what a real small business spends on
 * running itself, and `script/simulation-report.ts` is how the figure was
 * chosen rather than guessed.
 */
/**
 * What running the company costs, as a share of what it takes — and the share
 * grows with the company.
 *
 * A flat share was tried first and it is the wrong instrument. It charges the
 * one-van operation and the £450m consultancy the same proportion, so the
 * ceiling is set by the smallest business in the game: at 0.12 a one-town
 * domestic builder loses £211,655 across fourteen years and the guard that
 * asks for a business worth having fails, while the markets actually sitting
 * at sixty per cent margins were barely touched.
 *
 * Which is backwards, because this is the one cost that really does rise with
 * size. A builder with a van and a phone has almost no administration. A
 * company turning over a third of its market has finance, HR, legal, premises,
 * procurement and a floor of people who never meet a customer — and every one
 * of them is paid out of the same revenue. Real general-and-administrative
 * spend runs around five to eight per cent of revenue in a small firm and
 * twenty to twenty-five in a large one.
 *
 * So the share is interpolated on how much of its own market the company has
 * taken. `SMALL` applies to somebody with a rounding error of it, `LARGE` to
 * somebody holding `OVERHEAD_AT_SHARE` of it or more. It leaves the bottom of
 * the game alone and takes the top of it apart, which is where the 38-74% net
 * margins were.
 */
/*
 * ## The two rates, and why they are where they are
 *
 * Swept against every balance guard there is — `balance`, `every-market-winnable`,
 * `known-imbalances`, `every-way-of-playing`, `responsibilities`, `depth`,
 * `forecast` and `mobile-mirror`, 252 of them. Twice I swept a subset, reported
 * a ceiling, and found it wrong when the rest ran; this is the number that
 * survives all of them.
 *
 * 0.25 at the top is the ceiling. At 0.30 one guard fails and it is a lever
 * promise rather than a balance figure: renting room stops paying for itself
 * when a company is turning people away, because a quarter of the revenue the
 * extra room wins goes straight back out as overhead. A lever that does not
 * pay when it should is worse than a fat margin.
 *
 * It got this far only because the rate is progressive. A flat share is capped
 * by the smallest business in the game — it charges the van and the £450m
 * consultancy alike, so the ceiling was 0.10 and above it a one-town builder
 * failed while the sixty-per-cent margins were barely touched.
 */
export const OVERHEAD_SMALL = 0.05;
export const OVERHEAD_LARGE = 0.25;
/**
 * The turnover between which the share climbs, in a market of scale one.
 *
 * Keyed on what the company actually turns over and not on its share of the
 * market, which was the first attempt and let the worst case through: a launch
 * business taking £684m a year holds 6.7% of a £10.2bn market, so a
 * share-keyed rate charged it 10.6% and left it on a 62.7% net margin — the
 * fattest in the game, untouched. Administration does not care what fraction
 * of a market you hold. It cares how many people you employ and how many
 * offices they sit in, and those track turnover.
 *
 * Scaled by the market, like every other absolute figure in this engine, so a
 * £1m market reaches the full rate at its own version of £50m rather than
 * never.
 */
export const OVERHEAD_FROM = 1_000_000;
export const OVERHEAD_TO = 50_000_000;

/**
 * The share of revenue this company spends on running itself.
 *
 * `scale` is the market's own size against the catalogue's, so the thresholds
 * above mean the same thing in a £1m market as in a £400m one.
 */
export function overheadShare(revenue: number, scale = 1): number {
  if (!(revenue > 0)) return 0;
  const at = Math.max(0.001, scale);
  const from = OVERHEAD_FROM * at;
  const to = OVERHEAD_TO * at;
  /*
   * Nothing at all below the floor, and that is the part that took three
   * attempts to get right.
   *
   * The floor used to charge `OVERHEAD_SMALL` — five per cent — to everybody,
   * and five per cent is enough to break construction. Its self-funding way of
   * playing ("out of revenue", in `every-way-of-playing.test.ts`) has no margin
   * to give: at a flat 5% it never has a single profitable quarter in fourteen
   * years and reaches 22% of the best play against a floor of 25%. Measured at
   * 0.05, 0.08, 0.12, 0.2, 0.25 and 0.35 — it fails at every one of them, and
   * passes the moment the share is zero.
   *
   * Which is also the truer shape. A sole trader's overhead is already inside
   * their unit costs and whatever they pay themselves; there is no separate
   * administration to account for. The explicit line appears when there are
   * premises to heat, people to pay who never meet a customer, and somebody
   * doing the invoicing — and that is exactly what being above the floor means.
   */
  if (revenue <= from) return 0;
  if (revenue >= to) return OVERHEAD_LARGE;
  const along = (revenue - from) / (to - from);
  return OVERHEAD_SMALL + (OVERHEAD_LARGE - OVERHEAD_SMALL) * along;
}

export function plantOverhead(capacity: number, niche: Niche): number {
  const opening = [...niche.segments].sort((a, b) => a.referencePrice - b.referencePrice)[0];
  const perUnit = Math.max(0, (opening?.referencePrice ?? 0) - niche.baseUnitCost);
  return Math.max(0, capacity) * perUnit * PLANT_OVERHEAD;
}

/**
 * What running a company of this size actually costs, over the payroll.
 *
 * The cost base was five executive salaries and whoever operations had hired
 * — about £320,000 against a full plant worth £1.5–2.4m, so a company only
 * had to fill a *sixth* of what it built to cover its costs. That one number
 * is why failure was nearly impossible: a company that got traction could not
 * then lose it, and every lever that squeezed a working business changed
 * nothing, because no amount of squeezing reaches a business with that much
 * headroom.
 *
 * A business is not five salaries. It is premises, systems, insurance,
 * accountants, the people nobody counts — and none of it stops when a year
 * goes badly.
 *
 * Deliberately *not* charged on the size of the plant, which was tried first
 * and measured: an overhead proportional to capacity punishes exactly the
 * strategies that build capacity, and the volume plays — growing and
 * competing on price — fell from 7.8% and 4.2% of a market to 0.4% each. A
 * cost base that rises with the company rather than with its room leaves
 * every way of playing intact and still makes a bad year a bad year.
 */

export function fixedCosts(company: Company, headcount: number, economy: Economy, reach = 1, niche?: Pick<Niche, "workforce">): number {
  const footprint = 0.4 + 0.6 * Math.max(0, Math.min(1, reach));
  /*
   * At this market's own rate. A kitchen's people cost £65,000 and a
   * studio's £128,000, which is the difference between the two businesses
   * as much as anything in their segments — and it is why "should we hire"
   * is a different question in each. See `workforce.ts`.
   */
  const perHead = niche ? salaryIn(niche) : SALARY;
  const salaries = headcount * perHead * economy.costIndex;
  // Each filled seat is an executive salary. Dissolving one is a real saving
  // and a real loss — which is the trade the CEO is being offered.
  // `officersOf` rather than `seats.length`, because one founder holding five
  // desks is five levers and one salary. See Company.officers.
  const executives = officerCost(company);
  /*
   * At the scale of the market this company is in.
   *
   * These salaries are right for a market worth £400m, which is what all
   * seven of the hand-written ones are worth. A market Nova wrote for one
   * business can be a two-hundredth of that, and a five-person company paying
   * London executive salaries in a market worth £1.65m a year is not a hard
   * game — it is an impossible one, and it was: fourteen years of losses
   * every single time. A smaller business pays smaller salaries.
   */
  /*
   * The footprint applies to both lines, as it always has.
   *
   * It is arguably wrong on the executive line — the same five people run the
   * company whether it sells in one region or ten — but the seven catalogue
   * markets are balanced against this number over years of play, and taking
   * 0.4 off their payroll doubles their fixed costs overnight. It is written
   * down in `docs/simulation-backlog.md` rather than changed here.
   */
  return (salaries * (company.scale ?? 1) + executives) * footprint;
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
