/**
 * Scoring a marketing scheme, and turning one into something the simulator can run.
 *
 * The decision simulator already answers "what if I spend £1,000 a month on
 * marketing": a curve, three ways, against doing nothing. That is the right
 * answer to that question and no answer at all to the one a marketer asks,
 * which is whether *this plan* is any good. A budget is not a scheme.
 *
 * ## What is computed and what is read
 *
 * The same split the rest of this engine keeps. What a scheme costs and what it
 * would have to return to be worth doing is arithmetic, and it is done here:
 * the implied payback, the share of revenue being staked, whether the claim
 * behind it is plausible for this business. Whether the plan names a real
 * audience, says something specific, and could be measured is a judgement, and
 * Nova makes it — but against fixed dimensions, and its scores are averaged
 * into a number this file decides rather than one the model hands back.
 *
 * A model asked for an overall score gives 80. Asked for five scores against
 * named dimensions and then having them averaged, it has to be wrong five
 * specific times to flatter somebody, which is a harder thing to do by
 * accident.
 */

/** What a scheme is judged on. Fixed, so two schemes are comparable. */
export const MARKETING_DIMENSIONS = [
  {
    id: "audience",
    label: "Who it is for",
    blurb: "A specific enough audience that you could name where to find them. 'Everyone local' is not one.",
  },
  {
    id: "offer",
    label: "What it offers",
    blurb: "The reason somebody acts now rather than later. A discount is an offer; a logo is not.",
  },
  {
    id: "channel",
    label: "Where it runs",
    blurb: "Channels this audience is actually reachable through, at this budget.",
  },
  {
    id: "measurement",
    label: "How you would know",
    blurb: "What gets counted, and what number would make you stop. A scheme that cannot fail has not been designed.",
  },
  {
    id: "economics",
    label: "Whether it can pay",
    blurb: "What it costs against what a customer is worth here, and how long before it comes back.",
  },
] as const;

export type MarketingDimensionId = (typeof MARKETING_DIMENSIONS)[number]["id"];
export type MarketingScores = Record<MarketingDimensionId, number>;

/** Worth testing at all, from the score. Deliberately not a pass mark the model can argue with. */
export const WORTH_TESTING_AT = 55;

export interface MarketingEvaluation {
  scores: MarketingScores;
  /** One line per dimension, saying why that score. */
  notes: Partial<Record<MarketingDimensionId, string>>;
  /** The single change that would raise it most. */
  fix: string;
  /** What the scheme is, restated in a sentence, so the owner can see it was understood. */
  restated: string;
  /** Things the scheme assumes without saying so. */
  assumptions: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const int = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/** A model's answer, made safe: every dimension present, every score 0–100. */
export function cleanEvaluation(raw: unknown): MarketingEvaluation {
  const r = (raw ?? {}) as Record<string, any>;
  const rawScores = (r.scores ?? {}) as Record<string, unknown>;
  const scores = Object.fromEntries(
    MARKETING_DIMENSIONS.map((d) => [d.id, clamp(int(rawScores[d.id]), 0, 100)]),
  ) as MarketingScores;
  const notes = Object.fromEntries(
    MARKETING_DIMENSIONS
      .map((d) => [d.id, String((r.notes ?? {})[d.id] ?? "").trim().slice(0, 300)])
      .filter(([, note]) => note),
  ) as MarketingEvaluation["notes"];
  return {
    scores,
    notes,
    fix: String(r.fix ?? "").trim().slice(0, 400),
    restated: String(r.restated ?? "").trim().slice(0, 300),
    assumptions: (Array.isArray(r.assumptions) ? r.assumptions : [])
      .map((a: unknown) => String(a).trim().slice(0, 200)).filter(Boolean).slice(0, 6),
  };
}

/** The score, averaged here rather than asked for. */
export const scoreOf = (e: MarketingEvaluation): number =>
  Math.round(MARKETING_DIMENSIONS.reduce((sum, d) => sum + e.scores[d.id], 0) / MARKETING_DIMENSIONS.length);

/**
 * "Whether it can pay", worked out rather than judged.
 *
 * Four of the five dimensions are judgements about words and belong to Nova.
 * This one is arithmetic, and leaving it to a model meant the most checkable
 * thing on the page was the one thing nobody checked — a plan whose customers
 * cost more than they are worth could be talked into a 70 by describing them
 * warmly.
 *
 * So where the scheme says enough to compute it, the score is computed: what a
 * customer costs against what they are worth, and how long the money is out
 * before it comes back. A scheme that cannot be computed keeps the model's
 * reading, because "unknown" is not the same as "bad" — a campaign with no
 * subscription behind it is a perfectly ordinary thing to run.
 */
export function economicsScore(sums: ReturnType<typeof schemeArithmetic>): number | null {
  if (!sums.recurring || sums.ltvToCac == null || sums.cacPaybackMonths == null) return null;

  /*
   * What a customer is worth against what they cost, on a curve that keeps
   * discriminating where real businesses actually sit.
   *
   * The first version was a staircase topping out at eight times, which gave
   * a perfectly ordinary 8:1 the same mark as a 74:1 — and 8:1 is common in
   * software. It also rewarded the implausible: a ratio in the seventies is
   * not a better business, it is a churn figure nobody has measured, so the
   * curve peaks and then stops rather than climbing for ever. The warning
   * beside it says why.
   */
  const ratio = sums.ltvToCac;
  const between = (lo: number, hi: number, from: number, to: number) =>
    from + ((ratio - lo) / (hi - lo)) * (to - from);
  const fromRatio =
    ratio < 1 ? 10
    : ratio < 3 ? between(1, 3, 30, 60)
    : ratio < 8 ? between(3, 8, 60, 85)
    : ratio < 20 ? between(8, 20, 85, 96)
    /*
     * Past twenty the curve turns down rather than flattening. A full mark
     * should mean "excellent and credible", and a ratio in the fifties is the
     * single most reliable sign that the churn was assumed rather than
     * counted — the warning beside this says so, and the score should not
     * quietly disagree with it.
     */
    : 88;

  /*
   * And how long the money is out, which is what actually closes people. A
   * ratio that arrives in three months is a different business from the same
   * ratio arriving in two years.
   */
  const payback = sums.cacPaybackMonths;
  const adjust =
    payback <= 3 ? 4
    : payback <= 6 ? 0
    : payback <= 12 ? -10
    : payback <= 18 ? -20
    : -30;

  return clamp(Math.round(fromRatio + adjust), 0, 100);
}

export interface SchemeInput {
  monthlyBudget: number;
  months: number;
  /** What the marketer says it will bring in a month once it is working. */
  expectedMonthlyReturn: number;
  /**
   * For a scheme selling something people keep paying for. All three together
   * or none: with them, the scheme is tested as a subscriber base that
   * accumulates rather than as a campaign that holds up a level of trade.
   */
  pricePerMonth?: number;
  /** The share of customers who leave each month, 0–1. */
  monthlyChurn?: number;
  /**
   * New customers a month **at this budget** — not the ceiling an unlimited
   * budget would reach. `schemeAsLever` converts between the two.
   */
  newCustomersAtFull?: number;
  /** How many customers exist at all. 0 for no ceiling. */
  marketSize?: number;
  /** The share of that market the incumbents already hold, 0–1. */
  rivalShare?: number;
  /** How much the price falls in a year under competitive pressure, 0–1. */
  priceErosion?: number;
}

/** Whether this scheme describes people who keep paying, or a campaign. */
export const isRecurring = (i: SchemeInput): boolean =>
  (i.pricePerMonth ?? 0) > 0 && (i.monthlyChurn ?? 0) > 0 && (i.newCustomersAtFull ?? 0) > 0;

/**
 * What the numbers alone say about a scheme, before anybody reads the words.
 *
 * These are the facts a marketer should have to look at: what share of the
 * month's revenue is being staked, how long the claim takes to pay back, and
 * whether the claim is a large multiple of the spend — the last being the most
 * common way a plan is optimistic, because three times back is a good campaign
 * and ten times back is usually a spreadsheet.
 */
export function schemeArithmetic(input: SchemeInput, monthlyRevenue: number, grossMargin: number) {
  const budget = Math.max(0, input.monthlyBudget);
  const claimed = Math.max(0, input.expectedMonthlyReturn);
  /* Gross profit on the claimed revenue — what the spend actually has to come out of. */
  const kept = claimed * clamp(grossMargin, 0, 1);
  const monthlyNet = kept - budget;
  const paybackMonths = monthlyNet > 0 ? Math.ceil(budget / monthlyNet) : null;
  const shareOfRevenue = monthlyRevenue > 0 ? budget / monthlyRevenue : null;
  const multiple = budget > 0 ? claimed / budget : null;
  /*
   * For a scheme selling a subscription, the two numbers that actually decide
   * it — and neither can be got at from a budget and a claim alone.
   *
   * CAC is what one customer costs to win. LTV is what one is worth: their
   * gross profit a month, divided by the share who leave, which is the average
   * number of months they stay. The ratio between them is the whole argument
   * in one figure — under 1 you are paying more for customers than they are
   * worth, and the received wisdom that 3 is healthy is received wisdom for a
   * reason. Payback in months is the other half: a 5:1 ratio that takes three
   * years to arrive will still close a company that has nine months of cash.
   */
  /* What they win a month *at this budget* — see `schemeAsLever` for why that is not the lever's ceiling. */
  const joining = Math.max(0, input.newCustomersAtFull ?? 0);
  const churn = clamp(input.monthlyChurn ?? 0, 0, 1);
  const price = Math.max(0, input.pricePerMonth ?? 0);
  const recurring = isRecurring(input);
  const cac = recurring && joining > 0 ? budget / joining : null;
  const monthsKept = recurring && churn > 0 ? 1 / churn : null;
  const ltv = recurring && monthsKept != null ? price * clamp(grossMargin, 0, 1) * monthsKept : null;
  const ltvToCac = ltv != null && cac != null && cac > 0 ? ltv / cac : null;
  const cacPaybackMonths = cac != null && price > 0
    ? Math.ceil(cac / (price * clamp(grossMargin, 0, 1)))
    : null;

  return {
    budget,
    claimed,
    kept,
    monthlyNet,
    /** Whether this is a subscriber base or a campaign. */
    recurring,
    /** What one customer costs to win, when the scheme says. */
    cac,
    /** What one is worth over their life, at this price, margin and churn. */
    ltv,
    /** The ratio the whole argument comes down to. */
    ltvToCac,
    /** How many months of one customer's gross profit it takes to earn back winning them. */
    cacPaybackMonths,
    /** How long the average customer stays, from churn. */
    monthsKept,
    /** Months of spend before the gross profit it claims has covered a month of it. */
    paybackMonths,
    /** What fraction of a month's takings is being staked, or null with nothing coming in. */
    shareOfRevenue,
    /** Revenue claimed per unit spent. */
    multiple,
    /** Flags worth putting in front of somebody, in plain words. */
    warnings: [
      !recurring && multiple != null && multiple > 8
        ? `It claims ${multiple.toFixed(1)}× back for every 1 spent. Campaigns that return three or four times their cost are good ones; ten is usually a number nobody checked.`
        : null,
      /*
       * The subscription version of the same scepticism. A customer worth
       * seventy times what they cost is not a triumph, it is a churn figure
       * nobody has measured — and the whole answer rests on it.
       */
      ltvToCac != null && ltvToCac > 20
        ? `A customer looks worth ${Math.round(ltvToCac)}× what they cost to win. Ratios that high nearly always mean the churn is a guess: at ${((input.monthlyChurn ?? 0) * 100).toFixed(1)}% a month the average customer stays ${Math.round(monthsKept ?? 0)} months, and that is the number the rest of this rests on.`
        : null,
      /*
       * A campaign's test: does a month of it bring back more than a month of
       * it costs. Never asked of a subscription, where it is the wrong
       * question and always fails — the first month's signups cannot cover the
       * spend that won them, and are not supposed to. The LTV line below is
       * the version of this question that means something there.
       */
      !recurring && monthlyNet <= 0 && claimed > 0
        ? "At these figures the gross profit it brings in does not cover what it costs to run. It pays for itself only if it keeps working after the spend stops."
        : null,
      shareOfRevenue != null && shareOfRevenue > 0.25
        ? `It stakes ${Math.round(shareOfRevenue * 100)}% of a month's takings. That is a bet, not a budget — worth running the cautious case before committing.`
        : null,
      claimed === 0 && !recurring
        ? "No return claimed, so this can only be judged on cost. Put a number on what you expect back, even a cautious one, and it becomes testable."
        : null,
      ltvToCac != null && ltvToCac < 1
        ? `A customer costs about ${Math.round(cac!)} to win and is worth about ${Math.round(ltv!)} before they leave. You would be paying more for them than they bring.`
        : null,
      ltvToCac != null && ltvToCac >= 1 && ltvToCac < 3
        ? `A customer is worth about ${ltvToCac.toFixed(1)}× what they cost to win. That works, with nothing spare for the ones who never convert — 3× is where this is usually comfortable.`
        : null,
      cacPaybackMonths != null && cacPaybackMonths > 18
        ? `It takes about ${cacPaybackMonths} months of a customer's payments to earn back winning them. That is a long time to fund out of ${monthlyRevenue > 0 ? "trading" : "savings"}.`
        : null,
      recurring && input.marketSize && joining * 12 > input.marketSize
        ? `At this rate you would sign up everybody in the market inside a year. Check the ${input.marketSize.toLocaleString()} — a scheme that sells to more customers than exist discredits the rest of it.`
        : null,
    ].filter((w): w is string => !!w),
  };
}

/**
 * The scheme as a lever the decision engine can run.
 *
 * `halfSpend` is the budget itself: the saturating curve the market engine uses
 * says the first half of a budget buys most of what the whole of it buys, and
 * setting the half-point at the stated spend is the honest reading of "this is
 * what I intend to spend" — spending double would not double the return.
 *
 * The claimed return is what the *marketer* said, deliberately. The engine's
 * job is to show what follows from their claim, in their own numbers, three
 * ways; an engine that quietly replaced the claim with its own guess would be
 * answering a question nobody asked.
 *
 * ## Two shapes, and the scheme says which
 *
 * A campaign holds up a level of trade for as long as it runs: stop
 * advertising and it falls back. A subscription does not — those customers
 * accumulate, and what decides the business is churn rather than budget. The
 * same plan modelled the wrong way is wrong by an order of magnitude, so the
 * scheme carries price and churn, and a scheme that gives them is tested as a
 * subscriber base with a market size on it.
 *
 * Without them it is still a campaign, which is a perfectly ordinary thing to
 * run and the right model for a shop's leaflet drop.
 */
/**
 * `months` is how long the spend runs, and **0 means for the whole horizon** —
 * the same convention the engine's own `spend` lever uses. It was being read
 * with `|| 12`, so an explicit zero became a twelve-month campaign: the
 * customers stopped arriving at month twelve and the base decayed from there,
 * turning a business that should have kept compounding into one that peaked in
 * its first year and shrank for the next two.
 */
export function schemeAsLever(input: SchemeInput, label: string) {
  const name = label.slice(0, 160) || "The marketing scheme";
  if (isRecurring(input)) {
    /*
     * The marketer says how many they win **at this budget**; the lever wants
     * the ceiling an unlimited budget would approach. They are not the same
     * number and the difference is exactly half.
     *
     * `lift` is `spend/(spend+half) × ceiling`, and `halfSpend` is set to the
     * budget itself — so passing the stated rate straight through as the
     * ceiling delivered half of it. Somebody who wrote "40 a month at £1,000"
     * got twenty, their revenue came out at half what they had described, and
     * the cost per customer the score was computed from was half what it
     * really would be. Both halves of that were wrong in the flattering
     * direction. The ceiling is worked back from the rate instead, so the
     * simulation joins them at the rate they actually typed.
     */
    const budget = Math.max(0, input.monthlyBudget);
    const half = Math.max(1, budget);
    const atThisBudget = budget > 0 ? budget / (budget + half) : 1;
    return {
      kind: "subscription" as const,
      label: name,
      startMonth: 1,
      /* A scheme is a budget, not a rota: the form never asks for hours. */
      ownerHoursAMonth: 0,
      monthlyAmount: budget,
      months: clamp(Math.round(input.months ?? 12), 0, 120),
      newCustomersAtFull: Math.max(0, (input.newCustomersAtFull ?? 0) / atThisBudget),
      /* A written scheme is a budget, not a rota — it never claims the owner's hours. */
      newCustomersFromHours: 0,
      /* Nor anybody else's: a scheme wins its customers with the budget above. */
      newCustomersFromStaff: 0,
      halfSpend: half,
      pricePerMonth: Math.max(0, input.pricePerMonth ?? 0),
      monthlyChurn: clamp(input.monthlyChurn ?? 0.03, 0.001, 1),
      /*
       * The scheme form asks for one churn rate, because asking a marketer for
       * a cohort curve is asking for a number they will invent. The engine
       * wants two, so the early rate is derived at the usual ratio — see
       * `earlyChurn` in decision-sim.ts. The figure they typed stays the
       * steady-state one, which is the one people know about themselves.
       */
      earlyChurn: clamp((input.monthlyChurn ?? 0.03) * 2.5, 0.001, 1),
      earlyMonths: 3,
      lagMonths: 1,
      marketSize: Math.max(0, Math.round(input.marketSize ?? 0)),
      rivalShare: clamp(input.rivalShare ?? 0, 0, 0.95),
      priceErosion: clamp(input.priceErosion ?? 0, 0, 0.5),
      /*
       * Both zero, because the scheme form does not ask and assuming either
       * would be inventing growth on the marketer's behalf. A scheme tested
       * here is therefore the pessimistic reading — what the budget alone
       * buys — and the decision simulator is where word of mouth and
       * reinvestment can be argued about, with fields for both.
       */
      wordOfMouth: 0,
      reinvestShare: 0,
    };
  }
  return {
    kind: "spend" as const,
    label: name,
    startMonth: 1,
    ownerHoursAMonth: 0,
    monthlyAmount: Math.max(0, input.monthlyBudget),
    months: clamp(Math.round(input.months ?? 12), 0, 120),
    monthlyReturnAtFull: Math.max(0, input.expectedMonthlyReturn),
    halfSpend: Math.max(1, input.monthlyBudget),
    /* Nothing in marketing works the month it starts. */
    lagMonths: 1,
  };
}
