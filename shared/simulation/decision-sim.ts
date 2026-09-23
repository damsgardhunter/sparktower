/**
 * What one decision does to this company over the next few months.
 *
 * ## The question this answers, and the one it doesn't
 *
 * "What happens if I hire twelve people right now?" "If I put a thousand a
 * month into marketing, what comes back?" These are the questions an owner
 * actually asks, and until now the only simulation here was the market season
 * — five people running an imaginary company in a £350m market for fourteen
 * imaginary years. That is a good way to learn how a market works and a
 * useless way to decide whether you can afford a second van, because none of
 * the numbers in it are yours.
 *
 * So this is a different engine for a different job: **one company, the real
 * one, month by month, in its own money.** No segments, no incumbents, no
 * rivals. A business at $10,000 a month with a $100,000 loan is not a small
 * version of a market — it is a cash flow, and cash flow is what decides
 * whether the decision is survivable.
 *
 * ## What it reuses, and why that is the honest part
 *
 * `lift` from the market engine — the saturating curve that says the first
 * thousand of marketing buys far more than the fifth. That curve is the single
 * most important thing the market simulation knows about spending money, and
 * it is exactly as true for a café's Facebook budget as for a dating app's
 * brand campaign. Reusing it means the two simulations cannot drift into
 * disagreeing about whether spending twice as much gets you twice as much.
 *
 * ## Three runs, never one
 *
 * Everything here divides into two kinds of number. What a decision *costs* is
 * knowable: twelve people at $4,000 a month is $48,000 a month, and that is
 * arithmetic. What a decision *brings back* is a guess, always, however
 * confident the guess sounds. A single projected line would put those two on
 * the same footing and be read as a promise.
 *
 * So every scenario runs three times — cautious, likely and bold — with the
 * costs identical in all three and only the returns scaled. The spread between
 * them is the honest width of the answer, and the cautious run is the one to
 * read first, because it is the one you have to be able to survive.
 *
 * ## And always against doing nothing
 *
 * The number that matters is never "you will have $40,000 in June". It is
 * "$18,000 less than if you had not done this, and back in front by October".
 * So every scenario is run twice over: once with the decision and once without
 * it, on the same baseline, and every headline figure is the difference.
 *
 * Pure. No clock, no database, no randomness — the same question asked twice
 * gives the same answer, which is what lets a person edit one assumption and
 * see what it alone did.
 */
import { lift } from "./decisions";

// ─── Where the company is starting from ──────────────────────────────────────

/**
 * The company as it stands, in a month.
 *
 * Monthly rather than weekly, though the check-ins this is filled from are
 * weekly, because the decisions being simulated are monthly ones: nobody hires
 * for a week or takes out a loan repaid weekly. The conversion happens once,
 * where the check-ins are read, so everything below is in one unit.
 *
 * Every field is a number an owner can state or correct about their own
 * business. Nothing here is derived from anything the person cannot see — if
 * it were, the first surprising result would be unarguable, and an
 * unarguable projection is a projection nobody acts on.
 */
export interface Baseline {
  /** Money in, in an ordinary month. */
  monthlyRevenue: number;
  /**
   * Money out, in an ordinary month: wages, rent, stock, everything. Includes
   * what the staff already on the payroll cost, so a hire adds to it rather
   * than being counted twice.
   */
  monthlyCosts: number;
  /** In the bank today. */
  cash: number;
  /** Owed today. */
  debt: number;
  /** What the debt costs a year, 0–1. */
  interestRate: number;
  /** Paid off the debt each month, on top of interest. */
  debtRepayment: number;
  /**
   * How much revenue moves on its own each month, before anybody decides
   * anything. 0.02 is two per cent a month, which is a fast-growing small
   * business; most are nearer zero.
   */
  growth: number;
  /**
   * Of every extra dollar of revenue, how much is left after the cost of
   * delivering it. 0–1.
   *
   * This is the field that decides most answers and the one most often got
   * wrong. A restaurant that adds $10,000 of covers does not keep $10,000 — it
   * keeps perhaps $2,500 once the food and the extra shifts are paid for. A
   * simulation that treated new revenue as profit would tell every owner that
   * every decision works.
   */
  grossMargin: number;
  /** People on the payroll now. */
  staff: number;
}

/** Everything zero, for filling in. */
export const emptyBaseline = (): Baseline => ({
  monthlyRevenue: 0, monthlyCosts: 0, cash: 0, debt: 0, interestRate: 0.1,
  debtRepayment: 0, growth: 0, grossMargin: 0.5, staff: 0,
});

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * A baseline with every field made a number and every number made sane.
 *
 * The same argument as `sanitiseDecisions` in the market engine: the routes
 * validate, and that is where a person's mistake should be caught and
 * explained, but a single `NaN` here turns every month of the projection into
 * `NaN` and the screen shows an owner twelve dashes with no explanation. The
 * engine is the last place that can refuse to spread it.
 */
export function cleanBaseline(raw: unknown): Baseline {
  const b = (raw ?? {}) as Record<string, unknown>;
  return {
    monthlyRevenue: Math.max(0, num(b.monthlyRevenue)),
    monthlyCosts: Math.max(0, num(b.monthlyCosts)),
    // Overdrawn is a real state and the one this is most worth running from.
    cash: num(b.cash),
    debt: Math.max(0, num(b.debt)),
    interestRate: clamp(num(b.interestRate, 0.1), 0, 1),
    debtRepayment: Math.max(0, num(b.debtRepayment)),
    // A business shrinking 10% a month or growing 50% is a typo, not a plan.
    growth: clamp(num(b.growth), -0.5, 0.5),
    grossMargin: clamp(num(b.grossMargin, 0.5), 0, 1),
    staff: Math.max(0, Math.round(num(b.staff))),
  };
}

// ─── The decision, as something that can be run ──────────────────────────────

/**
 * The kinds of decision this can actually simulate.
 *
 * A closed list, deliberately. The free text box accepts anything, and what
 * Nova does with it is turn it into some combination of these — so the set of
 * things the arithmetic knows how to do is written down here rather than
 * implied by whatever a model decided to return. A question that does not fit
 * any of them is answered honestly as "this isn't something the numbers can
 * settle", which is better than an invented lever nobody can check.
 */
export const LEVER_KINDS = ["hire", "spend", "price", "loan", "oneOff", "saving", "other"] as const;
export type LeverKind = (typeof LEVER_KINDS)[number];

interface LeverBase {
  kind: LeverKind;
  /** What it is, in the owner's words. Shown on the assumption they can edit. */
  label: string;
  /** The month it starts, 1-based. 1 is "right now". */
  startMonth: number;
}

/**
 * Taking people on.
 *
 * `monthlyRevenueEach` is the guess and it is stated separately from the cost
 * on purpose: a salesperson who brings in nothing is still a real answer, and
 * the owner who thinks a hire pays for itself should have to look at the
 * number that claim rests on. `rampMonths` is how long before they are worth
 * what they will be worth — nobody is productive in week one, and a hiring
 * plan that assumes they are is the classic way to run out of money.
 */
export interface HireLever extends LeverBase {
  kind: "hire";
  people: number;
  /** All in — salary, tax, tools, the desk. */
  monthlyCostEach: number;
  /** What one of them eventually adds to monthly revenue. Zero for a hire that doesn't sell. */
  monthlyRevenueEach: number;
  /** Months before they are fully up to speed. */
  rampMonths: number;
}

/**
 * Money spent to bring money back: marketing, advertising, sponsorship.
 *
 * `monthlyReturnAtFull` and `halfSpend` are the two ends of the market
 * engine's `lift` curve — what an unlimited budget would eventually bring in a
 * month, and the spend at which you get half of it. Written this way rather
 * than as a flat "every $1 returns $3" because a flat multiple is what makes a
 * projection say that $100,000 a month of marketing turns a café into a chain.
 */
export interface SpendLever extends LeverBase {
  kind: "spend";
  monthlyAmount: number;
  /** How many months it runs. 0 means for the whole horizon. */
  months: number;
  monthlyReturnAtFull: number;
  halfSpend: number;
  /** Months before the spending shows up in revenue. */
  lagMonths: number;
}

/**
 * Changing what you charge.
 *
 * Revenue moves by the price change and by what the price change does to
 * demand, which are opposite signs — that tension is the whole decision.
 * `demandChangePct` is the second half and is a guess; putting it on the
 * assumption list is what stops a price rise reading as free money.
 */
export interface PriceLever extends LeverBase {
  kind: "price";
  /** +10 for a ten per cent rise. */
  changePct: number;
  /** What that does to how much is sold, as a percentage. Usually the opposite sign. */
  demandChangePct: number;
  /** Months for customers to react. */
  lagMonths: number;
}

/** Borrowing. Cash now, interest and repayments for as long as it runs. */
export interface LoanLever extends LeverBase {
  kind: "loan";
  amount: number;
  /** Annual rate, 0–1. */
  apr: number;
  termMonths: number;
}

/** One payment, once: a van, a fit-out, a deposit, a lawyer. */
export interface OneOffLever extends LeverBase {
  kind: "oneOff";
  amount: number;
}

/** A cost taken out: leaving a lease, dropping a subscription, cutting a shift. */
export interface SavingLever extends LeverBase {
  kind: "saving";
  monthlyAmount: number;
}

/**
 * Anything else, stated as what it does to the two lines that matter.
 *
 * The escape hatch, and it earns its place: "what if I open on Sundays" is a
 * real question that is not a hire, a spend or a price change, and refusing it
 * would send the owner away rather than making them state what they think it
 * is worth. What it is not is a licence to invent — the delta is an assumption
 * on the list like every other, editable and shown.
 */
export interface OtherLever extends LeverBase {
  kind: "other";
  monthlyRevenueDelta: number;
  monthlyCostDelta: number;
  rampMonths: number;
}

export type Lever = HireLever | SpendLever | PriceLever | LoanLever | OneOffLever | SavingLever | OtherLever;

/** Every lever's numbers made numbers, and made sane. See `cleanBaseline`. */
export function cleanLever(raw: unknown): Lever | null {
  const l = (raw ?? {}) as Record<string, unknown>;
  const kind = String(l.kind ?? "") as LeverKind;
  if (!(LEVER_KINDS as readonly string[]).includes(kind)) return null;
  const label = String(l.label ?? "").trim().slice(0, 160) || kind;
  // A start beyond any horizon this supports is a lever that never fires.
  const startMonth = clamp(Math.round(num(l.startMonth, 1)) || 1, 1, MAX_MONTHS);
  const base = { label, startMonth };

  switch (kind) {
    case "hire":
      return {
        ...base, kind,
        people: clamp(Math.round(num(l.people, 1)), 0, 10_000),
        monthlyCostEach: Math.max(0, num(l.monthlyCostEach)),
        monthlyRevenueEach: Math.max(0, num(l.monthlyRevenueEach)),
        rampMonths: clamp(Math.round(num(l.rampMonths, 3)), 0, 24),
      };
    case "spend":
      return {
        ...base, kind,
        monthlyAmount: Math.max(0, num(l.monthlyAmount)),
        months: clamp(Math.round(num(l.months)), 0, MAX_MONTHS),
        monthlyReturnAtFull: Math.max(0, num(l.monthlyReturnAtFull)),
        // A half-spend of zero would make the curve a step: any spend at all buys everything.
        halfSpend: Math.max(1, num(l.halfSpend, Math.max(1, num(l.monthlyAmount)))),
        lagMonths: clamp(Math.round(num(l.lagMonths, 1)), 0, 24),
      };
    case "price":
      return {
        ...base, kind,
        changePct: clamp(num(l.changePct), -90, 500),
        demandChangePct: clamp(num(l.demandChangePct), -100, 500),
        lagMonths: clamp(Math.round(num(l.lagMonths, 1)), 0, 24),
      };
    case "loan":
      return {
        ...base, kind,
        amount: Math.max(0, num(l.amount)),
        apr: clamp(num(l.apr, 0.1), 0, 1),
        termMonths: clamp(Math.round(num(l.termMonths, 36)), 1, 600),
      };
    case "oneOff":
      return { ...base, kind, amount: Math.max(0, num(l.amount)) };
    case "saving":
      return { ...base, kind, monthlyAmount: Math.max(0, num(l.monthlyAmount)) };
    default:
      return {
        ...base, kind: "other",
        monthlyRevenueDelta: num(l.monthlyRevenueDelta),
        monthlyCostDelta: num(l.monthlyCostDelta),
        rampMonths: clamp(Math.round(num(l.rampMonths, 1)), 0, 24),
      };
  }
}

export const cleanLevers = (raw: unknown): Lever[] =>
  (Array.isArray(raw) ? raw : []).map(cleanLever).filter((l): l is Lever => !!l).slice(0, MAX_LEVERS);

/** More than this in one question is not a decision, it is a business plan. */
export const MAX_LEVERS = 8;

// ─── The horizon ─────────────────────────────────────────────────────────────

/**
 * How far out this will look.
 *
 * Three years is the ceiling and it is generous. Past about two years a
 * monthly projection of a small business is a statement about the world rather
 * than about the decision, and the further out the line goes the more it is
 * believed. The offered horizons stop at 36 so that nobody is handed a
 * five-year chart to take to a bank.
 */
export const HORIZONS = [3, 6, 12, 24, 36] as const;
export const MAX_MONTHS = 36;
export const DEFAULT_MONTHS = 12;
export const cleanMonths = (v: unknown): number => {
  const n = Math.round(num(v, DEFAULT_MONTHS));
  return (HORIZONS as readonly number[]).includes(n) ? n : DEFAULT_MONTHS;
};

// ─── Confidence: the three runs ──────────────────────────────────────────────

/**
 * How much of the claimed return to believe.
 *
 * Costs are never scaled — twelve salaries are twelve salaries in all three
 * runs — because the whole point of the spread is to separate what is known
 * from what is hoped. `cautious` at 0.5 is not pessimism for its own sake: a
 * new hire delivering half of what was expected, and a month later than
 * expected, is the ordinary case rather than the disaster case.
 */
export const CONFIDENCES = ["cautious", "likely", "bold"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const RETURN_SCALE: Record<Confidence, number> = { cautious: 0.5, likely: 1, bold: 1.4 };
/** And the good case arrives sooner than the bad one. Months added to every ramp and lag. */
export const DELAY_MONTHS: Record<Confidence, number> = { cautious: 2, likely: 0, bold: 0 };

export const CONFIDENCE_COPY: Record<Confidence, { title: string; blurb: string }> = {
  cautious: { title: "If it goes slowly", blurb: "Half of what you expect it to bring in, two months later than you expect it. This is the one you have to be able to survive." },
  likely: { title: "If it goes as you expect", blurb: "Exactly the numbers on the assumptions below, arriving when you said they would." },
  bold: { title: "If it goes well", blurb: "Four tenths more than you expect, on time. Worth seeing, and not worth planning on." },
};

// ─── Running it ──────────────────────────────────────────────────────────────

export interface MonthRow {
  /** 1 is the month starting now. */
  month: number;
  revenue: number;
  costs: number;
  /** What the debt cost this month. Inside `costs`, and separated because it is the line a loan decision is about. */
  interest: number;
  /** Revenue less costs, before anything is repaid. */
  profit: number;
  /** Repaid off the debt this month. Not a cost — it moves money, it doesn't spend it. */
  repaid: number;
  cash: number;
  debt: number;
  staff: number;
}

export interface Run {
  months: MonthRow[];
  endCash: number;
  endDebt: number;
  endStaff: number;
  endMonthlyRevenue: number;
  /** The bottom of the cash curve, and when. The month an owner needs to have planned for. */
  lowestCash: number;
  lowestMonth: number;
  /** The first month the bank balance goes below zero, or null if it never does. */
  runsOutIn: number | null;
  /** Everything earned across the horizon, less everything spent. */
  cumulativeProfit: number;
}

/**
 * What a lever adds to a month's revenue and costs.
 *
 * Returns absolute deltas rather than mutating a running state, so a lever
 * cannot quietly depend on the order the levers happen to be in. The one thing
 * it is given about the wider world is `baseRevenue` — the revenue the company
 * would have had this month anyway — because a price change is a percentage of
 * something and the something is that.
 */
function leverMonth(lever: Lever, month: number, baseRevenue: number, scale: number, delay: number): {
  revenue: number; costs: number; cashIn: number; cashOut: number; staff: number;
  /** What this lever cost in interest this month. Part of `costs` everywhere else; named so a loan's cost is readable. */
  interest: number;
  /** Still owed on this lever at the end of this month. */
  owed: number;
  /** Capital paid off this month. Moves money rather than spending it, so it is not a cost. */
  repaid: number;
} {
  const zero = { revenue: 0, costs: 0, cashIn: 0, cashOut: 0, staff: 0, interest: 0, owed: 0, repaid: 0 };
  const start = lever.startMonth;
  if (month < start) return zero;
  /** Months this lever has been running, counting its first as 0. */
  const age = month - start;

  switch (lever.kind) {
    case "hire": {
      // Ramped: a third of them at month one of a three-month ramp.
      const ramp = lever.rampMonths + delay;
      const upToSpeed = ramp <= 0 ? 1 : Math.min(1, (age + 1) / (ramp + 1));
      return {
        ...zero,
        // The wage bill starts in full on day one whatever the ramp says. That
        // asymmetry is the decision: you pay for them before they earn.
        costs: lever.people * lever.monthlyCostEach,
        revenue: lever.people * lever.monthlyRevenueEach * upToSpeed * scale,
        staff: lever.people,
      };
    }
    case "spend": {
      const running = lever.months === 0 || age < lever.months;
      const spend = running ? lever.monthlyAmount : 0;
      /*
       * The market engine's curve, at monthly scale. Spending stops earning
       * the month it stops — what a budget buys here is attention, and
       * attention is rented. A lever that kept earning after the money stopped
       * would make "advertise for one month, for ever" a winning strategy.
       */
      const earning = age >= lever.lagMonths + delay && running;
      return {
        ...zero,
        costs: spend,
        revenue: earning ? lift(lever.monthlyAmount, lever.halfSpend, lever.monthlyReturnAtFull) * scale : 0,
      };
    }
    case "price": {
      if (age < lever.lagMonths + delay) return zero;
      /*
       * Both halves, multiplied rather than added: ten per cent more from
       * ninety per cent as many customers is 0.99, not 1.00. Added, a price
       * rise that lost exactly as many customers as it gained in price would
       * read as neutral when it is in fact a small loss — and the owner would
       * also be serving fewer people for it.
       *
       * The demand half is a guess, so it is the half that scales with
       * confidence: cautious means the customers you lose, you lose in full,
       * and the extra money arrives at half strength.
       */
      const priceMove = lever.changePct / 100;
      const demandMove = lever.demandChangePct / 100;
      const believed = 1 + priceMove * (priceMove > 0 ? scale : 1);
      const lost = 1 + demandMove * (demandMove < 0 ? 1 : scale);
      return { ...zero, revenue: baseRevenue * (believed * lost - 1) };
    }
    case "loan": {
      if (age >= lever.termMonths) return zero;
      /*
       * Straight-line capital, interest on what is still owed. Not an
       * amortising schedule: over the horizons this offers the difference is
       * small, and this is arithmetic an owner can check against their own
       * loan statement, which an amortisation table is not.
       *
       * The loan carries its own rate rather than the company's. Borrowing at
       * a rate different from what is already owed is most of the reason to
       * simulate a loan at all.
       */
      const owedBefore = lever.amount * (1 - age / lever.termMonths);
      const repaid = lever.amount / lever.termMonths;
      const interest = (owedBefore * lever.apr) / 12;
      return {
        ...zero,
        cashIn: age === 0 ? lever.amount : 0,
        interest,
        costs: interest,
        owed: Math.max(0, owedBefore - repaid),
        repaid,
      };
    }
    case "oneOff":
      return age === 0 ? { ...zero, cashOut: lever.amount } : zero;
    case "saving":
      return { ...zero, costs: -lever.monthlyAmount };
    default: {
      const ramp = lever.rampMonths + delay;
      const upToSpeed = ramp <= 0 ? 1 : Math.min(1, (age + 1) / (ramp + 1));
      return {
        ...zero,
        revenue: lever.monthlyRevenueDelta * upToSpeed * scale,
        costs: lever.monthlyCostDelta,
      };
    }
  }
}

/**
 * The company, month by month.
 *
 * Deliberately simple arithmetic that an owner could check on paper, because
 * one that they cannot check is one they will not act on. Revenue grows at the
 * baseline rate; levers add to revenue and costs; what is left after the cost
 * of delivering the revenue lands in the bank; interest is charged on what is
 * owed and repayments come out of cash.
 *
 * The one piece of non-obvious arithmetic is the margin. Only *new* revenue is
 * margined, because `monthlyCosts` already contains the cost of delivering the
 * revenue the company has today. Margining all of it would charge the company
 * twice for the same food, stock and shifts, and every scenario would show a
 * profitable business losing money.
 */
export function runMonths(input: {
  baseline: Baseline;
  levers: Lever[];
  months: number;
  confidence?: Confidence;
}): Run {
  const baseline = cleanBaseline(input.baseline);
  const levers = input.levers;
  const horizon = clamp(Math.round(input.months) || DEFAULT_MONTHS, 1, MAX_MONTHS);
  const confidence = input.confidence ?? "likely";
  const scale = RETURN_SCALE[confidence];
  const delay = DELAY_MONTHS[confidence];

  let cash = baseline.cash;
  /** What was owed before this decision, which is repaid and charged separately from anything borrowed for it. */
  let owed = baseline.debt;
  let staff = baseline.staff;
  let cumulativeProfit = 0;
  const rows: MonthRow[] = [];

  for (let month = 1; month <= horizon; month += 1) {
    // What the company would have taken this month having done nothing.
    const baseRevenue = baseline.monthlyRevenue * Math.pow(1 + baseline.growth, month - 1);

    let extraRevenue = 0;
    let extraCosts = 0;
    let cashIn = 0;
    let cashOut = 0;
    let extraStaff = 0;
    let borrowedInterest = 0;
    let borrowedOwed = 0;
    let borrowedRepaid = 0;
    for (const lever of levers) {
      const m = leverMonth(lever, month, baseRevenue, scale, delay);
      extraRevenue += m.revenue;
      extraCosts += m.costs;
      cashIn += m.cashIn;
      cashOut += m.cashOut;
      extraStaff += m.staff;
      borrowedInterest += m.interest;
      borrowedOwed += m.owed;
      borrowedRepaid += m.repaid;
    }

    const revenue = Math.max(0, baseRevenue + extraRevenue);
    /*
     * The cost of delivering the extra revenue, which is the difference
     * between a decision that works and one that only looks like it does. A
     * hire who brings in $8,000 a month at a 30% margin has brought in $2,400.
     */
    const costOfNewRevenue = Math.max(0, extraRevenue) * (1 - baseline.grossMargin);
    /*
     * What was already owed, at the rate it is already owed at. New borrowing
     * carries its own rate and charges its own interest inside `extraCosts`,
     * so it is deliberately not in this figure — a loan at 6% taken out by a
     * company already paying 18% must not be charged at 18%.
     */
    const interest = (owed * baseline.interestRate) / 12;
    const costs = baseline.monthlyCosts + extraCosts + costOfNewRevenue + interest;
    const profit = revenue - costs;

    // Never repay more than is owed, and never on a debt already cleared.
    const repaidOnOld = Math.max(0, Math.min(owed, baseline.debtRepayment));
    owed -= repaidOnOld;
    const repaid = repaidOnOld + borrowedRepaid;
    cash += profit + cashIn - cashOut - repaid;
    staff = baseline.staff + extraStaff;
    /*
     * A one-off payment is counted here and a loan drawn is not. Cumulative
     * profit is what the business earned, not what passed through the bank:
     * borrowed money is not income, and the van you bought with it is a cost
     * whoever paid for it.
     */
    cumulativeProfit += profit - cashOut;
    const debt = owed + borrowedOwed;

    rows.push({
      month,
      revenue: Math.round(revenue),
      costs: Math.round(costs),
      interest: Math.round(interest + borrowedInterest),
      profit: Math.round(profit),
      repaid: Math.round(repaid),
      cash: Math.round(cash),
      debt: Math.round(debt),
      staff,
    });
  }

  const lowest = rows.reduce((low, r) => (r.cash < low.cash ? r : low), rows[0]);
  const broke = rows.find((r) => r.cash < 0) ?? null;

  return {
    months: rows,
    endCash: rows[rows.length - 1].cash,
    endDebt: rows[rows.length - 1].debt,
    endStaff: rows[rows.length - 1].staff,
    endMonthlyRevenue: rows[rows.length - 1].revenue,
    lowestCash: lowest.cash,
    lowestMonth: lowest.month,
    runsOutIn: broke ? broke.month : null,
    cumulativeProfit: Math.round(cumulativeProfit),
  };
}

// ─── The answer ──────────────────────────────────────────────────────────────

/**
 * What the numbers say about the decision, computed before Nova is asked
 * anything.
 *
 * The same rule as the "what would it take?" roadmap: models flatter, and an
 * owner who is told that hiring twelve people is "ambitious but achievable"
 * may go and do it. So the verdict is worked out here from the cash curve and
 * handed to Nova as a fact it is writing to, not asked for.
 */
export const VERDICTS = [
  "it pays for itself",
  "it costs more than it brings back",
  "it works, but it is tight",
  "it runs you out of money",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Answer {
  months: number;
  /** Doing nothing, on the same baseline. Every headline number is measured against this. */
  without: Run;
  with: Record<Confidence, Run>;
  /** The computed call, from the cautious and likely runs. Never the model's. */
  verdict: Verdict;
  /**
   * The month the decision has paid for itself — the first month the cash with
   * it is above the cash without it and stays there. Null if it never does
   * inside the horizon, which is an answer in itself.
   */
  paybackMonth: number | null;
  /** End cash with the decision, less end cash without it, on the likely run. */
  cashDifference: number;
  /** Monthly revenue at the end, with less without. */
  revenueDifference: number;
  /** The worst month, on the cautious run: the hole that has to be funded. */
  worstCase: { cash: number; month: number; runsOutIn: number | null };
  /** One line per finding, computed. The part of the answer that is not Nova's. */
  facts: string[];
}

const money = (n: number): string => {
  const a = Math.abs(Math.round(n));
  const body = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(2)}m` : a >= 10_000 ? `${Math.round(a / 1000)}k` : a.toLocaleString("en-GB");
  return `${n < 0 ? "−" : ""}$${body}`;
};

const monthName = (n: number): string => (n === 1 ? "month 1" : `month ${n}`);

/**
 * When the decision has paid for itself.
 *
 * "Stays there" matters: a hire whose first month happens to land above the
 * do-nothing line because the wages fall on the 2nd has not paid for itself,
 * and reporting month one would be a lie the rest of the chart contradicts.
 */
function paybackOf(withRun: Run, without: Run): number | null {
  for (let i = 0; i < withRun.months.length; i += 1) {
    if (withRun.months[i].cash <= without.months[i].cash) continue;
    if (withRun.months.slice(i).every((m, k) => m.cash > without.months[i + k].cash)) {
      return withRun.months[i].month;
    }
  }
  return null;
}

/**
 * The whole answer: the decision run three ways, against doing nothing.
 */
export function answer(input: { baseline: Baseline; levers: Lever[]; months: number }): Answer {
  const baseline = cleanBaseline(input.baseline);
  const months = clamp(Math.round(input.months) || DEFAULT_MONTHS, 1, MAX_MONTHS);
  const without = runMonths({ baseline, levers: [], months });
  const runs = Object.fromEntries(
    CONFIDENCES.map((c) => [c, runMonths({ baseline, levers: input.levers, months, confidence: c })]),
  ) as Record<Confidence, Run>;

  const likely = runs.likely;
  const cautious = runs.cautious;
  const cashDifference = likely.endCash - without.endCash;
  const revenueDifference = likely.endMonthlyRevenue - without.endMonthlyRevenue;
  const paybackMonth = paybackOf(likely, without);

  /*
   * The call, in the order the consequences actually rank.
   *
   * Running out of money comes first and outranks everything, including a
   * decision that is hugely profitable by month twenty-four: a business that
   * cannot make March's payroll does not reach the profitable part. It is read
   * off the *cautious* run rather than the likely one, because the question
   * "can I survive this" is not a question about the expected case.
   */
  const monthOfCosts = baseline.monthlyCosts;
  const verdict: Verdict =
    cautious.runsOutIn !== null ? "it runs you out of money"
    : cashDifference <= 0 ? "it costs more than it brings back"
    : cautious.lowestCash < monthOfCosts ? "it works, but it is tight"
    : "it pays for itself";

  const facts: string[] = [];
  facts.push(
    cashDifference >= 0
      ? `By ${monthName(months)} you have ${money(cashDifference)} more in the bank than if you did nothing.`
      : `By ${monthName(months)} you have ${money(-cashDifference)} less in the bank than if you did nothing.`,
  );
  facts.push(
    paybackMonth
      ? `It is back in front of doing nothing at ${monthName(paybackMonth)}, and stays there.`
      : `It never gets back in front of doing nothing inside ${months} months.`,
  );
  facts.push(
    `At its worst, if it goes slowly, the bank balance bottoms out at ${money(cautious.lowestCash)} in ${monthName(cautious.lowestMonth)}.`,
  );
  if (cautious.runsOutIn !== null) {
    facts.push(`If it goes slowly you run out of money in ${monthName(cautious.runsOutIn)}. That is the number that decides this.`);
  }
  if (revenueDifference !== 0) {
    facts.push(
      `Monthly revenue ends at ${money(likely.endMonthlyRevenue)} against ${money(without.endMonthlyRevenue)} without it.`,
    );
  }
  if (likely.endStaff !== baseline.staff) {
    facts.push(`Headcount goes from ${baseline.staff} to ${likely.endStaff}.`);
  }
  if (likely.endDebt !== baseline.debt) {
    facts.push(
      likely.endDebt > baseline.debt
        ? `Debt goes from ${money(baseline.debt)} to ${money(likely.endDebt)}.`
        : `Debt falls from ${money(baseline.debt)} to ${money(likely.endDebt)}.`,
    );
  }
  /*
   * Said whenever it is true, and it is true more often than owners expect: a
   * business at a 30% margin has to sell three dollars to keep one, so a hire
   * costing $4,000 has to bring in over $13,000 to break even on their own.
   */
  if (baseline.grossMargin < 1) {
    facts.push(
      `Every extra dollar of revenue leaves ${Math.round(baseline.grossMargin * 100)}c once the cost of delivering it is paid. That is what the figures above are worked out on.`,
    );
  }

  return {
    months, without, with: runs, verdict, paybackMonth, cashDifference, revenueDifference,
    worstCase: { cash: cautious.lowestCash, month: cautious.lowestMonth, runsOutIn: cautious.runsOutIn },
    facts,
  };
}

/**
 * Whether there is enough here to run anything, or the sentence saying what is
 * missing.
 *
 * A baseline of zeros produces a flat line at nothing, which is not a
 * projection — it is a picture of a company that does not exist, and an owner
 * shown one would reasonably conclude the feature is broken. Refusing costs
 * nothing and says what to fill in.
 */
export function missingFrom(baseline: Baseline): string | null {
  if (baseline.monthlyRevenue <= 0 && baseline.cash <= 0) {
    return "This needs at least one of two numbers to say anything: what the business takes in a month, or what is in the bank. Fill one in and it has something to work from.";
  }
  if (baseline.monthlyCosts <= 0) {
    return "Fill in what the business pays out in an ordinary month — wages, rent, stock, everything. Without it every decision looks free.";
  }
  return null;
}
