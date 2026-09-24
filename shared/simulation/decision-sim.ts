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
import { businessMoney, symbolOf, DEFAULT_CURRENCY, type CurrencyCode } from "../currency";

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
  /**
   * Hours a week the owner can actually put into this. 0 means "don't model it".
   *
   * The constraint that binds a founder and the one this engine was silent
   * about. A plan built on posting a named letter to 3,500 practices and
   * telephoning each one eight days later is not bought with money, it is paid
   * for in evenings, and a simulation that prices only the postage will tell
   * somebody with a full-time job that their plan works. Zero keeps the old
   * behaviour — unlimited owner — because most decisions do not turn on it and
   * a field nobody filled in should not start refusing plans.
   */
  ownerHours: number;
  /**
   * Days between doing the work and the money arriving. 0 is paid on the spot.
   *
   * A shop is 0, a trade on 60-day terms is 60, and the difference is the
   * commonest way a profitable business dies. Revenue was being banked the
   * month it was earned, which is right for a café and a lie for anyone who
   * invoices.
   */
  daysToGetPaid: number;
  /** Tax on profit, 0–1. Nothing here took any, which made every projection optimistic by a quarter. */
  taxRate: number;
  /**
   * How far the quiet month falls below the average, 0–1. 0.3 is a business
   * whose worst month is 30% down and whose best is 30% up.
   */
  seasonalSwing: number;
  /** Which calendar month is the best one, 1–12. Only means anything when `seasonalSwing` is set. */
  bestMonth: number;
}

/** Everything zero, for filling in. */
export const emptyBaseline = (): Baseline => ({
  monthlyRevenue: 0, monthlyCosts: 0, cash: 0, debt: 0, interestRate: 0.1,
  debtRepayment: 0, growth: 0, grossMargin: 0.5, staff: 0,
  ownerHours: 0, daysToGetPaid: 0, taxRate: 0, seasonalSwing: 0, bestMonth: 12,
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
    // A hundred and twenty hours a week is not a working week, it is a typo.
    ownerHours: clamp(num(b.ownerHours), 0, 120),
    daysToGetPaid: clamp(Math.round(num(b.daysToGetPaid)), 0, 180),
    taxRate: clamp(num(b.taxRate), 0, 0.6),
    seasonalSwing: clamp(num(b.seasonalSwing), 0, 0.9),
    bestMonth: clamp(Math.round(num(b.bestMonth, 12)), 1, 12),
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
export const LEVER_KINDS = ["hire", "spend", "price", "loan", "oneOff", "saving", "job", "drawings", "subscription", "other"] as const;
export type LeverKind = (typeof LEVER_KINDS)[number];

interface LeverBase {
  kind: LeverKind;
  /** What it is, in the owner's words. Shown on the assumption they can edit. */
  label: string;
  /** The month it starts, 1-based. 1 is "right now". */
  startMonth: number;
  /**
   * Hours a month of the owner's own time this needs. 0 for anything bought
   * rather than done.
   *
   * Money was the only resource here, and it is not the scarce one for most of
   * the people using this. "A named letter to 2,100 practices, then a phone
   * call to each eight days later" costs about £900 in postage and about a
   * hundred hours, and the engine could see the £900. Against `ownerHours` on
   * the baseline, a plan that needs more of the week than there is gets
   * throttled to what can actually be done, and is told so.
   */
  ownerHoursAMonth: number;
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
  /**
   * Hours a week this takes off the owner, once they are up to speed. Zero for
   * a hire that doesn't.
   *
   * The reason this exists: the two paths this product is mostly about —
   * systemising a business and running one — are both about getting the owner
   * out of the middle of it, and the commonest decision in that story is
   * hiring somebody to do what the owner does. In money alone that decision is
   * always a loss, because a manager costs a salary and sells nothing. The
   * engine was answering "it costs more than it brings back" to the one move
   * the rest of the product exists to help somebody make, which is true,
   * useless, and reads as a warning.
   *
   * It is not converted into money. An hour of an owner's week has no
   * defensible price — for some it is the difference between a business and a
   * job, for others it is genuinely worth less than the salary — and inventing
   * a rate would put a guess in the same column as the arithmetic. It is
   * carried, named, and allowed to change the verdict.
   */
  ownerHoursFreedEach?: number;
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
 * Customers who stay, and stack up.
 *
 * `spend` models a *level* of revenue held up by a *level* of spending: stop
 * advertising and trade falls back. That is right for a café and badly wrong
 * for anything people subscribe to, and the gap showed the moment somebody
 * brought a finished product to this engine. A garage app at £39 a month, sold
 * to two or three garages a month, was modelled as revenue that plateaus at
 * whatever the marketing budget holds up — so a business with twenty thousand
 * possible customers and 90% margins was shown flatlining at £1,750 a month
 * for ever, and there was no way for its owner to be right.
 *
 * The difference is that customers accumulate. Each month's spend wins some,
 * some leave, and what is left is a stock that earns every month afterwards —
 * which is why the business compounds and why churn, not marketing, is what
 * eventually caps it.
 *
 * ## Worked out rather than accumulated
 *
 * The month's effect is a pure function of its age, so the stock is a closed
 * form rather than a running total: with `n` joining a month and a churn of
 * `c`, after `k` months the stock is `n·(1−(1−c)^k)/c`, and once the spend
 * stops it decays by `(1−c)` a month from wherever it had got to. Same numbers
 * as a loop, and it keeps every lever independent of the order they are
 * applied in.
 *
 * `marketSize` is the honest ceiling. A niche with twenty thousand businesses
 * in it is a large market and it is not an infinite one, and a projection that
 * sells to more customers than exist is the kind of number that discredits
 * everything beside it.
 */
export interface SubscriptionLever extends LeverBase {
  kind: "subscription";
  /** What winning them costs a month. */
  monthlyAmount: number;
  /** How many months the spend runs. 0 means the whole horizon. */
  months: number;
  /** New paying customers a month, at a spend well past `halfSpend`. */
  newCustomersAtFull: number;
  /**
   * New paying customers a month won by the owner's own `ownerHoursAMonth`,
   * rather than by the spend.
   *
   * Acquisition was a pure function of money, and for most of the people this
   * is built for it is not. Somebody with $500 a month and twelve hours a week
   * wins customers by standing at the markets, answering the question in the
   * forum, and messaging fifty traders by hand — and the engine's answer to a
   * plan made entirely of that was zero customers, zero revenue, and a verdict
   * of "it pays for itself", because she had not spent anything. That is the
   * bootstrapper's entire strategy returned as a rounding error.
   *
   * Scaled by how much of the week she actually has: unlike the spend, which
   * goes out whether or not she has the evening, effort not put in wins
   * nobody.
   */
  newCustomersFromHours: number;
  /** The spend that wins half of that — the same saturating curve `spend` uses. */
  halfSpend: number;
  /** What one of them pays a month. */
  pricePerMonth: number;
  /**
   * The share who leave each month once they are settled, 0–1.
   *
   * The *steady* rate, not the average. See `earlyChurn`.
   */
  monthlyChurn: number;
  /**
   * The share who leave each month in their first `earlyMonths`, 0–1.
   *
   * Churn is not one number. It is front-loaded, badly: most of the people who
   * will ever leave do so before they have got any value out of the thing, and
   * a business with 3% steady churn typically loses 8–12% of each intake in
   * the first couple of months. Applying the steady rate from day one — which
   * is what a single constant does — compounds a lie in the flattering
   * direction, because it is the early months that are being over-counted and
   * every later month is built on the survivors. It is why lifetime value came
   * out at 33 months when the honest figure was nearer twenty.
   */
  earlyChurn: number;
  /** How long the early rate lasts. Three months is the usual shape. */
  earlyMonths: number;
  /** Months before the first ones arrive. */
  lagMonths: number;
  /** How many customers exist to be had at all. 0 for no ceiling. */
  marketSize: number;
  /**
   * The share of that market somebody else already has, 0–1.
   *
   * There was no competitor anywhere in this engine: the whole market sat
   * waiting, and price was something the owner set rather than something the
   * market answered back on. The reachable market is what is left after the
   * incumbents, and it is the number that decides whether "200,000 practices"
   * means anything.
   */
  rivalShare: number;
  /**
   * How much the price falls in a year under competitive pressure, 0–1.
   *
   * 0 for a business nobody is undercutting. 0.05 is five per cent a year off
   * the list price, which is an ordinary software market and compounds into a
   * fifth of the revenue over three years.
   */
  priceErosion: number;
  /**
   * New customers each existing customer brings in per month, 0–1.
   *
   * The thing that was missing, and the reason every projection flattened out
   * however good the business was. Intake was a function of money and hours
   * alone, so the arithmetic was always a fixed number joining against a
   * percentage leaving — which has exactly one shape: a curve that rises and
   * then stops at intake ÷ churn. Nothing an owner did could change that
   * shape, only where it levelled off. Watching it happen to every plan they
   * try is the point at which somebody decides the tool does not believe in
   * their business.
   *
   * Real ones are not like that: customers recommend you, review you, bring
   * the trader on the next stall. 0.02 means one customer brings another every
   * fifty months — modest, and enough to turn a plateau into a climb. Once it
   * is larger than `monthlyChurn` the base grows on its own and the ceiling
   * becomes the market rather than the budget.
   */
  wordOfMouth: number;
  /**
   * The share of this lever's own revenue put back into winning customers, 0–1.
   *
   * The other half of the same problem. The spend was one figure for the whole
   * horizon, so a business could be sitting on $50,000 at month thirty-six and
   * still spending the $380 a month it started with — which no owner has ever
   * done. Reinvestment is what turns a business that grows into one that
   * accelerates, and its absence is most of why the curve always looked like
   * it was running out of steam.
   */
  reinvestShare: number;
}

/**
 * Money the owner takes out.
 *
 * The other half of `job`, and it was missing. The engine could model somebody
 * putting their wages into a business for a year and had no way to model the
 * thing they were doing it for — drawing a living out of it once it works. So
 * every plan ended with the money still in the company, which is not what
 * anybody is trying to achieve, and "can I eventually pay myself?" — the
 * question underneath most of these — could not be asked at all.
 *
 * It is cash out and not a cost: what an owner draws is not an expense of the
 * business in any sense that matters here, and counting it as one would make
 * the profit line lie about whether the thing works. The bank balance tells
 * the truth on its own — if the drawings are too big, the cash curve goes
 * down, which is exactly what should happen.
 */
export interface DrawingsLever extends LeverBase {
  kind: "drawings";
  /** What the owner takes out a month. */
  monthlyAmount: number;
  /** How many months it runs. 0 means for the whole horizon. */
  months: number;
}

/**
 * Money from outside the business — a wage, and what of it goes in.
 *
 * Without this the engine could only answer questions that started with
 * money. Someone with an idea, no savings and a shift job could model spending
 * and borrowing but not the thing they were actually going to do first, which
 * is work for a year and put some of it aside. Asked "what can I start with?",
 * the honest answer was a flat line at nothing, and the only advice available
 * was about decisions they could not make.
 *
 * It is not revenue. The business has not sold anything; the owner has. So it
 * arrives as cash in and touches neither the revenue line nor the margin, and
 * every figure that compares this against doing nothing stays true — doing
 * nothing, for somebody in a job, also means keeping the wage.
 *
 * `intoBusiness` is the part that reaches the business, because the rest pays
 * the rent. An owner who says they will put everything in is saying something
 * about their life, and the number should make them say it on purpose.
 */
export interface JobLever extends LeverBase {
  kind: "job";
  /** What they clear a month from the work, after tax. */
  monthlyTakeHome: number;
  /** How many months it runs. 0 means for the whole horizon. */
  months: number;
  /** The share of it that goes into the business, 0–1. */
  intoBusiness: number;
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

export type Lever = HireLever | SpendLever | PriceLever | LoanLever | OneOffLever | SavingLever | JobLever | DrawingsLever | SubscriptionLever | OtherLever;

/** Every lever's numbers made numbers, and made sane. See `cleanBaseline`. */
export function cleanLever(raw: unknown): Lever | null {
  const l = (raw ?? {}) as Record<string, unknown>;
  const kind = String(l.kind ?? "") as LeverKind;
  if (!(LEVER_KINDS as readonly string[]).includes(kind)) return null;
  const label = String(l.label ?? "").trim().slice(0, 160) || kind;
  // A start beyond any horizon this supports is a lever that never fires.
  const startMonth = clamp(Math.round(num(l.startMonth, 1)) || 1, 1, MAX_MONTHS);
  const base = { label, startMonth, ownerHoursAMonth: clamp(num(l.ownerHoursAMonth), 0, 400) };

  switch (kind) {
    case "hire":
      return {
        ...base, kind,
        people: clamp(Math.round(num(l.people, 1)), 0, 10_000),
        monthlyCostEach: Math.max(0, num(l.monthlyCostEach)),
        monthlyRevenueEach: Math.max(0, num(l.monthlyRevenueEach)),
        rampMonths: clamp(Math.round(num(l.rampMonths, 3)), 0, 24),
        // A week has 168 hours and an owner does not work all of them; the cap
        // is there to stop a model's enthusiasm becoming a fact on the screen.
        ownerHoursFreedEach: clamp(Math.round(num(l.ownerHoursFreedEach)), 0, 80),
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
    case "drawings":
      return {
        ...base, kind,
        monthlyAmount: Math.max(0, num(l.monthlyAmount)),
        months: clamp(Math.round(num(l.months)), 0, MAX_MONTHS),
      };
    case "subscription":
      return {
        ...base, kind,
        monthlyAmount: Math.max(0, num(l.monthlyAmount)),
        months: clamp(Math.round(num(l.months)), 0, MAX_MONTHS),
        newCustomersAtFull: Math.max(0, num(l.newCustomersAtFull)),
        newCustomersFromHours: Math.max(0, num(l.newCustomersFromHours)),
        halfSpend: Math.max(1, num(l.halfSpend, 1)),
        pricePerMonth: Math.max(0, num(l.pricePerMonth)),
        /*
         * Floored just above zero: a churn of exactly nothing means customers
         * who never leave, which no business has, and it is also the value
         * that divides by zero in the stock below.
         */
        monthlyChurn: clamp(num(l.monthlyChurn, 0.03), 0.001, 1),
        /*
         * Defaults to two and a half times the steady rate, which is the shape
         * most subscription businesses actually have, so a lever written
         * before this field existed — or by a model that did not think to set
         * it — gets a realistic early curve rather than a flat one.
         */
        earlyChurn: clamp(num(l.earlyChurn, clamp(num(l.monthlyChurn, 0.03) * 2.5, 0.001, 1)), 0.001, 1),
        earlyMonths: clamp(Math.round(num(l.earlyMonths, 3)), 0, 24),
        lagMonths: clamp(Math.round(num(l.lagMonths, 1)), 0, 24),
        marketSize: Math.max(0, Math.round(num(l.marketSize))),
        rivalShare: clamp(num(l.rivalShare), 0, 0.95),
        priceErosion: clamp(num(l.priceErosion), 0, 0.5),
        // Capped well below 1: a customer who brings one every month is not
        // word of mouth, it is a pyramid, and the curve it draws would
        // discredit everything beside it.
        wordOfMouth: clamp(num(l.wordOfMouth), 0, 0.5),
        reinvestShare: clamp(num(l.reinvestShare), 0, 1),
      };
    case "job":
      return {
        ...base, kind,
        monthlyTakeHome: Math.max(0, num(l.monthlyTakeHome)),
        months: clamp(Math.round(num(l.months)), 0, MAX_MONTHS),
        // Defaults to all of it: somebody modelling a job for the business is
        // usually modelling what they can put in, not what they take home.
        intoBusiness: clamp(num(l.intoBusiness, 1), 0, 1),
      };
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
/**
 * A horizon this can actually run, from whatever was asked for.
 *
 * It used to accept only an exact member of `HORIZONS` and silently return the
 * *default* for anything else — so asking for 48 months got you 12, and asking
 * for 18 got you 12. Not the maximum, not an error: the shortest ordinary
 * horizon, with nothing on screen to say so. Anything the plan did after month
 * twelve — an owner starting to draw a wage in month 24, a loan that matured
 * in month 30 — simply never happened, and the answer came back looking
 * perfectly reasonable. Eight plans that differed only in when she quit her
 * job all returned the identical figure, which is how it was found.
 *
 * Snapped to the nearest offered horizon instead, preferring the longer one on
 * a tie: being given less time than you asked for is the more misleading of
 * the two errors, because the things that break a plan are usually at the end.
 */
export const cleanMonths = (v: unknown): number => {
  const asked = Math.round(num(v, DEFAULT_MONTHS));
  if (!Number.isFinite(asked) || asked <= 0) return DEFAULT_MONTHS;
  const offered = HORIZONS as readonly number[];
  if (offered.includes(asked)) return asked;
  return offered.reduce((best, h) =>
    Math.abs(h - asked) < Math.abs(best - asked) || (Math.abs(h - asked) === Math.abs(best - asked) && h > best)
      ? h : best);
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
  /** Tax charged on this month's profit. */
  tax: number;
  /** What actually reached the bank, which is not what was earned when customers pay late. */
  banked: number;
  /**
   * Paying customers this month, from any subscription lever in the decision.
   *
   * Null when nothing in the decision models a customer stock — which is most
   * decisions, and is not the same as zero customers.
   */
  customers: number | null;
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
  /** What the owner actually drew across the horizon. */
  drawnTotal: number;
  /** What they asked to draw and the business could not cover. Zero when every month paid in full. */
  drawnShortfall: number;
  /** Tax paid across the horizon. */
  taxTotal: number;
  /** Months in which the plan wanted more of the owner's week than there was. */
  stretchedMonths: number;
  /** The worst month's shortfall of owner time, 0–1. 0.4 is a month that got 60% of what it asked for. */
  worstStretch: number;
  /** Revenue earned but not yet banked at the end. Zero when customers pay on the spot. */
  owedToYou: number;
}

/**
 * What a subscriber base looks like at a given age — the cohort model.
 *
 * This replaced a closed form, `n·(1−(1−c)^k)/c`, which was elegant, fast, and
 * wrong in two ways that both flattered.
 *
 * **Churn is front-loaded.** One constant rate applied from the first month
 * treats somebody who signed up yesterday and somebody who has paid for two
 * years as equally likely to leave. They are not, by a factor of three or
 * four: most of the people who ever leave do so before they have got anything
 * out of it. Each month's intake is now its own cohort and decays on its own
 * age — `earlyChurn` for its first `earlyMonths`, the steady rate after — so
 * the survivors of month one are the ones still paying in month thirty, which
 * is what actually happens and is a materially smaller number.
 *
 * **The cheap customers go first.** The old model won the same number every
 * month for ever: the five-hundredth customer cost exactly what the fifth did.
 * In reality the first are the ones who already know you, and the cost per
 * customer climbs as the reachable market empties. Intake is now scaled by
 * what is left of it, so acquisition slows as penetration rises and the curve
 * bends the way real ones do instead of running straight at the ceiling.
 *
 * `rivalShare` is taken off the market before any of that: what is reachable
 * is what the incumbents do not already hold.
 *
 * Still a pure function of age — it rebuilds the cohorts each call rather than
 * carrying state — so levers stay independent of the order they are applied
 * in, which is the property the closed form was there to protect. Thirty-six
 * months of cohorts is a few hundred operations.
 */
export function subscriptionAt(
  lever: SubscriptionLever,
  age: number,
  scale: number,
  stretch = 1,
  /**
   * What each month of this lever's life is worth against an average one,
   * looked up by age. Defaults to a flat year.
   *
   * A subscription business's season is not the café's. A café takes less
   * money in January because fewer people come through the door that month,
   * and its revenue line wobbles. A subscription takes the same £29 from
   * everybody who is still subscribed, whatever the month — what the season
   * actually moves is **who joins and who leaves**. Market traders sign up
   * when the markets start and cancel when they stop, and the shape that
   * produces is not a sine wave through the revenue: it is a staircase, where
   * the base climbs through the season and flattens or slips back out of it.
   *
   * Getting that distinction right is the whole point of applying the season
   * here rather than to the revenue at the end.
   */
  seasonAt: (age: number) => number = () => 1,
): {
  /** Paying customers this month. */
  stock: number;
  /** Joined this month. */
  joined: number;
  /** Everyone ever won, including those since gone. */
  everWon: number;
  /** What is reachable at all, after the incumbents. 0 when no market size was given. */
  reachable: number;
} {
  /*
   * Read defensively, because a lever is not always a fresh one.
   *
   * Scenarios stored before these fields existed come back out of the database
   * as `Lever` with `earlyChurn`, `rivalShare` and the rest simply absent, and
   * an `undefined` anywhere in this arithmetic turns every month of the
   * projection into NaN — which the owner sees as a screen of dashes with no
   * explanation. The same argument as `cleanBaseline`: the routes validate,
   * and the engine is the last place that can refuse to spread it.
   */
  const steady = Number.isFinite(lever.monthlyChurn) ? lever.monthlyChurn : 0.03;
  const early = Number.isFinite(lever.earlyChurn) ? lever.earlyChurn : steady * 2.5;
  const earlyMonths = Number.isFinite(lever.earlyMonths) ? lever.earlyMonths : 3;
  const rivals = Number.isFinite(lever.rivalShare) ? lever.rivalShare : 0;
  const reachable = lever.marketSize > 0 ? lever.marketSize * (1 - rivals) : 0;
  const word = Number.isFinite(lever.wordOfMouth) ? lever.wordOfMouth : 0;
  const reinvest = Number.isFinite(lever.reinvestShare) ? lever.reinvestShare : 0;

  /*
   * Walked forward a month at a time, carrying every cohort separately.
   *
   * There were two shortcuts here and the season took both away. The first
   * version worked each month out independently and summed the survivors at
   * the end, which cannot express customers who bring customers or revenue put
   * back in — both need to know how big the base was last month. The second
   * kept a running base for those and still read the stock off a precomputed
   * survival curve, which works only while a cohort's decay depends on nothing
   * but its own age. Seasonal churn breaks exactly that: how much of a cohort
   * survives now depends on which calendar months it lived through, so two
   * cohorts of the same age that joined in different seasons are different
   * sizes. The cohorts are therefore carried one by one and decayed on their
   * own age and this month's season, which is O(months²) — a few hundred
   * operations over three years, and the only version that is actually right.
   */
  const cohorts: { age: number; size: number }[] = [];
  const joinedAt: number[] = [];
  let everWon = 0;
  let base = 0;
  let spendNow = lever.monthlyAmount;

  for (let a = 0; a <= age; a += 1) {
    const since = a - lever.lagMonths;
    const spending = lever.months === 0 || a < lever.months;
    const season = seasonAt(a);

    /*
     * Everybody already here gets a month older and some of them leave.
     *
     * The quiet months take customers as well as failing to bring them — the
     * same swing, pointed the other way and at half the strength, because a
     * subscription is stickier than a signup is eager. It needs no field of
     * its own: a quiet month is quiet in both directions, and asking an owner
     * to estimate their off-season churn separately is asking for a number
     * they will invent.
     */
    const churnSeason = clamp(1 - (season - 1) * 0.5, 0.25, 2);
    for (const c of cohorts) {
      /*
       * `earlyMonths`, the defended local — not `lever.earlyMonths`.
       *
       * A lever stored before the field existed has it undefined, and
       * `c.age < undefined` is false for every cohort at every age, so the
       * early rate never applied and the whole front-loaded-churn correction
       * silently turned itself off. Nothing threw and nothing was NaN; the
       * projection just quietly went back to the flat model it was written to
       * replace, and read a few per cent too kind.
       */
      const rate = clamp((c.age < earlyMonths ? early : steady) * churnSeason, 0, 1);
      c.size *= 1 - rate;
      c.age += 1;
    }

    let joined = 0;
    if (since >= 0) {
      // What is left of the market, which is what makes the next customer dearer.
      const left = reachable > 0 ? Math.max(0, 1 - everWon / reachable) : 1;
      /*
       * Three sources, and only the middle one is throttled by the owner's
       * week: the ads run whether or not she has the evening, the phone calls
       * do not, and a recommendation costs her nothing either way.
       */
      const fromSpend = spending ? lift(spendNow, lever.halfSpend, lever.newCustomersAtFull) : 0;
      const fromHours = spending ? (Number.isFinite(lever.newCustomersFromHours) ? lever.newCustomersFromHours : 0) * stretch : 0;
      const fromWord = base * word;
      /* Nobody signs up for a market-stall app in January. */
      joined = (fromSpend + fromHours + fromWord) * scale * left * season;
    }
    if (joined > 0) cohorts.push({ age: 0, size: joined });
    joinedAt.push(joined);
    everWon += joined;

    base = cohorts.reduce((n, c) => n + c.size, 0);
    if (reachable > 0 && base > reachable) {
      /* Trimmed proportionally, so the age mix of a capped base is honest. */
      const scaleBack = reachable / base;
      for (const c of cohorts) c.size *= scaleBack;
      base = reachable;
    }
    /*
     * Next month's budget. Revenue this lever earned, at the share the owner
     * said they would put back — so a business that works spends more on
     * growth as it grows, which is what owners do and what the fixed figure
     * could never show.
     */
    spendNow = lever.monthlyAmount + base * priceAtAge(lever, a) * reinvest;
  }

  return { stock: base, joined: joinedAt[age] ?? 0, everWon, reachable };
}

/**
 * What one customer pays at this age, after the market has leaned on the price.
 *
 * Compounded annually rather than monthly so `priceErosion` reads as the
 * number an owner would say out loud: "we lose about five per cent a year on
 * price" is 0.05, and three years of it is a fifth of the revenue gone.
 */
export const priceAtAge = (lever: SubscriptionLever, age: number): number =>
  // Defensive for the same reason as `subscriptionAt`: an older stored lever
  // has no `priceErosion`, and `Math.pow(NaN, x)` is NaN all the way down.
  lever.pricePerMonth * Math.pow(1 - (Number.isFinite(lever.priceErosion) ? lever.priceErosion : 0), age / 12);

/**
 * What a lever adds to a month's revenue and costs.
 *
 * Returns absolute deltas rather than mutating a running state, so a lever
 * cannot quietly depend on the order the levers happen to be in. The one thing
 * it is given about the wider world is `baseRevenue` — the revenue the company
 * would have had this month anyway — because a price change is a percentage of
 * something and the something is that.
 */
function leverMonth(
  lever: Lever, month: number, baseRevenue: number, scale: number, delay: number, stretch = 1,
  /**
   * What each calendar month is worth against an average one, by absolute
   * month of the projection.
   *
   * Applied per kind rather than to the total, because the kinds are not the
   * same sort of number. A salesperson sells less in the quiet months and a
   * level of trade held up by advertising falls with the season, so both are
   * multiplied. A price change is a percentage of `baseRevenue`, which has
   * already had the season applied to it, so multiplying again would count it
   * twice. And a subscription's season is not in its revenue at all — see
   * `subscriptionAt`.
   */
  seasonAt: (month: number) => number = () => 1,
): {
  revenue: number; costs: number; cashIn: number; cashOut: number; staff: number;
  /** Money the owner took out. Leaves the bank, but is not something the business spent. */
  drawn: number;
  /** What this lever cost in interest this month. Part of `costs` everywhere else; named so a loan's cost is readable. */
  interest: number;
  /** Still owed on this lever at the end of this month. */
  owed: number;
  /** Capital paid off this month. Moves money rather than spending it, so it is not a cost. */
  repaid: number;
  /** Paying customers this lever is holding this month. Only a subscription sets it. */
  customers: number;
} {
  const zero = { revenue: 0, costs: 0, cashIn: 0, cashOut: 0, drawn: 0, staff: 0, interest: 0, owed: 0, repaid: 0, customers: 0 };
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
        // The wage is the same in January; what they sell is not.
        revenue: lever.people * lever.monthlyRevenueEach * upToSpeed * scale * seasonAt(month),
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
        // A level of trade, so it rises and falls with the trade.
        revenue: earning ? lift(lever.monthlyAmount, lever.halfSpend, lever.monthlyReturnAtFull) * scale * seasonAt(month) : 0,
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
    case "job": {
      // Cash in, not revenue: the owner earned it, not the business. Stops the
      // month it stops, and never scales with confidence — a wage is a wage.
      if (lever.months > 0 && age >= lever.months) return zero;
      return { ...zero, cashIn: lever.monthlyTakeHome * lever.intoBusiness };
    }
    case "subscription": {
      /* Age → absolute month, so a cohort knows which January it lived through. */
      const { stock } = subscriptionAt(lever, age, scale, stretch, (a) => seasonAt(lever.startMonth + a));
      const spending = lever.months === 0 || age < lever.months;
      return {
        ...zero,
        revenue: stock * priceAtAge(lever, age),
        costs: spending ? lever.monthlyAmount : 0,
        /*
         * The stock is the answer to the question a subscription business
         * actually asks, and it was being thrown away the line after it was
         * computed. Revenue alone cannot say whether 11k a month is 220
         * customers or 2,200, whether the curve is flattening because the
         * spend stopped or because the market ran out, or how near the
         * ceiling `marketSize` sets you are.
         */
        customers: stock,
      };
    }
    case "drawings": {
      // Drawn, not spent: it leaves the bank, and it is not something the
      // business bought. Counting it as either a cost or a purchase would make
      // the profit line lie about whether the business works.
      if (lever.months > 0 && age >= lever.months) return zero;
      return { ...zero, drawn: lever.monthlyAmount };
    }
    default: {
      const ramp = lever.rampMonths + delay;
      const upToSpeed = ramp <= 0 ? 1 : Math.min(1, (age + 1) / (ramp + 1));
      return {
        ...zero,
        revenue: lever.monthlyRevenueDelta * upToSpeed * scale * seasonAt(month),
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
/**
 * What this month is worth against an average one.
 *
 * A cosine with its peak on `bestMonth`, so a swing of 0.3 means the best
 * month runs 30% above the average and the worst 30% below. Crude next to a
 * real seasonal index and enough to stop a plan being signed off on the
 * strength of an August that was never going to repeat — which is what a flat
 * twelve months does to anybody in hospitality, retail or the trades. Averages
 * to 1 over a year, so a full year of this is the same total as none of it.
 *
 * `month` is months from now, not a calendar month, so it is offset by where
 * in the year the projection starts.
 */
export function seasonalFactor(baseline: Baseline, month: number, startingMonth: number): number {
  if (baseline.seasonalSwing <= 0) return 1;
  const calendar = ((startingMonth - 1 + month - 1) % 12) + 1;
  const offset = ((calendar - baseline.bestMonth) % 12 + 12) % 12;
  return 1 + baseline.seasonalSwing * Math.cos((2 * Math.PI * offset) / 12);
}

/** A working week turned into a working month. Not 4, which loses three weeks a year. */
const WEEKS_A_MONTH = 52 / 12;

export function runMonths(input: {
  baseline: Baseline;
  levers: Lever[];
  months: number;
  confidence?: Confidence;
  /** Calendar month the projection starts in, 1–12. Only matters with seasonality. */
  startingMonth?: number;
  /*
   * The three below exist for `ruinRisk`, which needs to run this engine with
   * a drawn multiplier and a rough month rather than one of the three named
   * confidences. Left off every ordinary call, where the confidence decides
   * both and nothing is shocked.
   */
  /** Overrides the confidence's returns multiplier. */
  scale?: number;
  /** Overrides the confidence's delay, in months. */
  delay?: number;
  /** Per-month multiplier on new revenue — 0 for a month where it does not arrive. */
  shockRevenue?: number[];
  /** Per-month unbudgeted cost. */
  shockCosts?: number[];
}): Run {
  const baseline = cleanBaseline(input.baseline);
  const levers = input.levers;
  const horizon = clamp(Math.round(input.months) || DEFAULT_MONTHS, 1, MAX_MONTHS);
  const confidence = input.confidence ?? "likely";
  const scale = input.scale ?? RETURN_SCALE[confidence];
  const delay = input.delay ?? DELAY_MONTHS[confidence];

  let cash = baseline.cash;
  /** What was owed before this decision, which is repaid and charged separately from anything borrowed for it. */
  let owed = baseline.debt;
  let staff = baseline.staff;
  let cumulativeProfit = 0;
  let drawnTotal = 0;
  let drawnShortfall = 0;
  let taxTotal = 0;
  /** Worst month's shortfall of owner time, as a share of what the plan asked for. */
  let worstStretch = 0;
  let stretchedMonths = 0;
  const rows: MonthRow[] = [];
  const startingMonth = clamp(Math.round(input.startingMonth ?? 1), 1, 12);
  /*
   * Revenue earned but not yet banked, oldest first.
   *
   * Everything here used to land in the bank the month it was earned, which is
   * true of a shop and false of everyone who invoices. A business on 60-day
   * terms that doubles its trade is at its most likely to fail in the month
   * after the good news, and the old curve could not show that at all.
   */
  const unbanked: { due: number; amount: number }[] = [];

  /*
   * The season, by absolute month, so a lever can ask about its own months.
   * Levers need this rather than the single figure below: a subscription's
   * cohorts each lived through a different set of calendar months.
   */
  const seasonOf = (m: number) => seasonalFactor(baseline, m, startingMonth);

  for (let month = 1; month <= horizon; month += 1) {
    const season = seasonOf(month);
    // What the company would have taken this month having done nothing.
    const baseRevenue = baseline.monthlyRevenue * Math.pow(1 + baseline.growth, month - 1) * season;

    /*
     * The owner's week, before anything is earned from it.
     *
     * Hires that free the owner up add to the supply as they come up to speed;
     * the plan's own demands come off it. If the plan asks for more than there
     * is, everything that needs the owner is throttled to the share that can
     * actually be done — the money still goes out, because you cannot half-buy
     * the postage, but the calls that follow it do not all get made. That
     * asymmetry is the point: an over-committed founder pays in full and
     * collects a fraction.
     */
    let hoursSupply = baseline.ownerHours * WEEKS_A_MONTH;
    let hoursWanted = 0;
    for (const lever of levers) {
      if (month < lever.startMonth) continue;
      hoursWanted += Number.isFinite(lever.ownerHoursAMonth) ? lever.ownerHoursAMonth : 0;
      if (lever.kind === "hire" && lever.ownerHoursFreedEach) {
        const ramp = lever.rampMonths + delay;
        const upToSpeed = ramp <= 0 ? 1 : Math.min(1, (month - lever.startMonth + 1) / (ramp + 1));
        hoursSupply += lever.people * lever.ownerHoursFreedEach * WEEKS_A_MONTH * upToSpeed;
      }
    }
    /* 1 when the week is big enough, or when nobody said how big it is. */
    const stretch = baseline.ownerHours > 0 && hoursWanted > hoursSupply && hoursWanted > 0
      ? hoursSupply / hoursWanted
      : 1;
    if (stretch < 1) {
      stretchedMonths += 1;
      worstStretch = Math.max(worstStretch, 1 - stretch);
    }

    let extraRevenue = 0;
    let extraCosts = 0;
    let cashIn = 0;
    let cashOut = 0;
    let drawn = 0;
    let extraStaff = 0;
    let customers = 0;
    let anyStock = false;
    let borrowedInterest = 0;
    let borrowedOwed = 0;
    let borrowedRepaid = 0;
    for (const lever of levers) {
      /*
       * A subscription lever is handed the stretch and applies it itself — to
       * the customers its hours win, and not to the ones its spending wins.
       * The ads run whether or not she has the evening; the phone calls do
       * not. Every other kind is throttled wholesale, which is the right shape
       * for work that is all somebody's own time.
       */
      const inner = lever.kind === "subscription" ? stretch : 1;
      const m = leverMonth(lever, month, baseRevenue, scale, delay, inner, seasonOf);
      const held = lever.kind !== "subscription"
        && (Number.isFinite(lever.ownerHoursAMonth) ? lever.ownerHoursAMonth : 0) > 0 ? stretch : 1;
      extraRevenue += m.revenue * held;
      extraCosts += m.costs;
      cashIn += m.cashIn;
      cashOut += m.cashOut;
      drawn += m.drawn;
      extraStaff += m.staff;
      if (lever.kind === "subscription") { customers += m.customers; anyStock = true; }
      borrowedInterest += m.interest;
      borrowedOwed += m.owed;
      borrowedRepaid += m.repaid;
    }

    /* A month where the new revenue simply did not arrive — see `ruinRisk`. */
    const shock = input.shockRevenue?.[month - 1] ?? 1;
    extraRevenue *= shock;
    if (shock !== 1) customers *= shock;
    extraCosts += input.shockCosts?.[month - 1] ?? 0;

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
    /*
     * Drawings are taken last, and only as far as the money goes.
     *
     * An owner drawing £1,500 a month does not keep drawing it while the
     * balance heads for minus sixteen thousand; they take less, or nothing,
     * and that is the whole difference between a plan that fails and a plan
     * that is uncomfortable. Modelled as a fixed payment it made every
     * drawings plan read "it runs you out of money" in the cautious case,
     * which is not what a cautious case is — it is the case where you take
     * less out. What could not be paid is counted so the answer can say so.
     */
    /*
     * Tax on profit, which nothing here took.
     *
     * Charged only on a profit, never refunded on a loss — the engine has no
     * concept of carrying one forward and inventing a rebate would be the
     * flattering error again. A quarter to a third of every profitable month
     * was being banked that was never the owner's to bank.
     */
    const tax = profit > 0 ? profit * baseline.taxRate : 0;
    taxTotal += tax;

    /*
     * What actually reaches the bank this month.
     *
     * The money earned goes into `unbanked` with the month it is due, and what
     * comes out is whatever has come due by now. At 0 days that is the same
     * month and this is a no-op; at 60 days the first two months of a plan
     * bank nothing at all, which is exactly the hole that kills people.
     * Everything that is not revenue — a loan drawn, wages put in, a one-off
     * paid — is unaffected: only customers pay late.
     */
    const banked = (() => {
      if (baseline.daysToGetPaid <= 0) return revenue;
      unbanked.push({ due: month + baseline.daysToGetPaid / 30, amount: revenue });
      let out = 0;
      for (let i = unbanked.length - 1; i >= 0; i -= 1) {
        if (unbanked[i].due <= month + 1e-9) { out += unbanked[i].amount; unbanked.splice(i, 1); }
      }
      return out;
    })();
    /* Costs are paid on time whatever the customers do; that is the squeeze. */
    const cashProfit = banked - costs - tax;

    const beforeDrawings = cash + cashProfit + cashIn - cashOut - repaid;
    const taken = Math.max(0, Math.min(drawn, beforeDrawings));
    drawnTotal += taken;
    drawnShortfall += drawn - taken;
    cash = beforeDrawings - taken;
    staff = baseline.staff + extraStaff;
    /*
     * A one-off payment is counted here and a loan drawn is not. Cumulative
     * profit is what the business earned, not what passed through the bank:
     * borrowed money is not income, and the van you bought with it is a cost
     * whoever paid for it.
     */
    // Drawings are deliberately not here: what an owner takes out is a share
    // of what the business earned, not a reduction in what it earned.
    cumulativeProfit += profit - tax - cashOut;
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
      customers: anyStock ? Math.round(customers) : null,
      tax: Math.round(tax),
      banked: Math.round(banked),
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
    drawnTotal: Math.round(drawnTotal),
    drawnShortfall: Math.round(drawnShortfall),
    taxTotal: Math.round(taxTotal),
    stretchedMonths,
    worstStretch,
    owedToYou: Math.round(unbanked.reduce((n, u) => n + u.amount, 0)),
  };
}

// ─── How often it goes wrong ─────────────────────────────────────────────────

/**
 * A small deterministic random source.
 *
 * Seeded, so the same question always gets the same answer: a projection that
 * quietly changed every time somebody reloaded it would be worthless for
 * arguing with, which is the whole purpose of this thing. Mulberry32 — short,
 * well-behaved, and no dependency.
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How often a plan may fail and still be called workable.
 *
 * One in four is the line. Below it a plan is ordinarily risky and the cash
 * curve is the thing to read; at or above it the headline has to say so,
 * because nobody reads a percentage buried in the eighth bullet and then
 * revises what the badge above it told them.
 */
export const FRAGILE = 0.25;

export interface RuinRead {
  /** How many runs were tried. */
  trials: number;
  /** How many of them ran the bank balance below zero. */
  ruined: number;
  /** Ruined as a share, 0–1. */
  risk: number;
  /** The median month of ruin among the runs that failed, or null if none did. */
  typicalMonth: number | null;
  /** The worst ending balance seen, and the best. */
  worstEnd: number;
  bestEnd: number;
  /** The middle outcome — the ending balance half the runs beat. */
  medianEnd: number;
}

/**
 * How often this plan ends badly.
 *
 * The three confidence runs look like uncertainty and are not. Cautious is
 * "half the returns, two months later" — a *smaller success*, on a smooth
 * curve, with the same shape as the other two. Nothing in them can contain the
 * things that actually close businesses: the biggest customer leaving, a
 * quarter where nothing lands, a bill nobody saw coming. A founder reading
 * three tidy curves is being shown the range of ways this works, and calling
 * the lowest one "cautious".
 *
 * So: several hundred runs, each with the returns, the delay and the churn
 * drawn around the owner's own estimate, and each exposed month by month to
 * the ordinary discrete misfortunes — a month where the revenue does not
 * arrive, a cost nobody budgeted for. What comes back is the only honest
 * headline for a plan with no slack in it: how often it does not survive.
 *
 * Deliberately not presented as a probability of anything in the world. It is
 * the probability under these assumptions, which is a statement about the
 * plan's fragility rather than about the future — a plan that survives 95% of
 * its own uncertainty is a different object from one that survives 55%, and
 * that difference is knowable from the numbers already on the screen.
 */
export function ruinRisk(input: {
  baseline: Baseline;
  levers: Lever[];
  months: number;
  trials?: number;
  seed?: number;
}): RuinRead {
  const baseline = cleanBaseline(input.baseline);
  const months = clamp(Math.round(input.months) || DEFAULT_MONTHS, 1, MAX_MONTHS);
  const trials = clamp(Math.round(input.trials ?? 240), 20, 2000);
  const rand = seeded(input.seed ?? 12345);
  const ends: number[] = [];
  const ruinMonths: number[] = [];

  for (let t = 0; t < trials; t += 1) {
    /*
     * Returns drawn around the owner's estimate, skewed low.
     *
     * Two draws multiplied gives a lump around 0.5–1.1 with a thin tail up to
     * about 1.6, which is the shape of what actually happens to a forecast:
     * missing it by half is common, beating it by half is not.
     */
    const scale = (0.35 + rand() * 0.95) * (0.75 + rand() * 0.5);
    const delay = rand() < 0.35 ? (rand() < 0.5 ? 1 : 2) : 0;
    /* Churn runs worse as often as better, and the bad tail is longer. */
    const churnMult = 0.7 + rand() * 1.1;
    const levers = input.levers.map((l) =>
      l.kind === "subscription"
        ? { ...l, monthlyChurn: clamp(l.monthlyChurn * churnMult, 0.001, 1), earlyChurn: clamp(l.earlyChurn * churnMult, 0.001, 1) }
        : l);

    /*
     * The shocks. Each month, independently:
     *   - 3% chance a month's new revenue simply does not arrive;
     *   - 2% chance of an unbudgeted cost worth a month of outgoings.
     * Applied to the baseline rather than inside the engine so the run stays
     * the ordinary one with a rough month in it.
     */
    const shockRevenue: number[] = [];
    const shockCosts: number[] = [];
    for (let m = 1; m <= months; m += 1) {
      shockRevenue.push(rand() < 0.03 ? 0 : 1);
      shockCosts.push(rand() < 0.02 ? baseline.monthlyCosts * (0.5 + rand()) : 0);
    }
    const run = runMonths({ baseline, levers, months, confidence: "likely", startingMonth: 1, scale, delay, shockRevenue, shockCosts });
    ends.push(run.endCash);
    if (run.runsOutIn != null) ruinMonths.push(run.runsOutIn);
  }

  ends.sort((a, b) => a - b);
  ruinMonths.sort((a, b) => a - b);
  return {
    trials,
    ruined: ruinMonths.length,
    risk: ruinMonths.length / trials,
    typicalMonth: ruinMonths.length ? ruinMonths[Math.floor(ruinMonths.length / 2)] : null,
    worstEnd: Math.round(ends[0]),
    bestEnd: Math.round(ends[ends.length - 1]),
    medianEnd: Math.round(ends[Math.floor(ends.length / 2)]),
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
  /*
   * The same shape as "it costs more than it brings back" — the money is
   * negative either way — said differently because the money is not what the
   * decision was for. Reserved for a decision that takes real hours off the
   * owner: see `ownerHoursFreedEach`.
   */
  "it costs money and buys back your time",
  "it works, but it is tight",
  /*
   * Makes money on the central case and falls over too often to plan on.
   *
   * The three confidence runs are three ways this *works*; `ruinRisk` is the
   * only thing here that knows how often it does not. Without this the verdict
   * could not tell them apart, and did not: a plan that failed in 43% of its
   * own runs and one that failed in 5% both came back "it works, but it is
   * tight", in the same colour. The distinction is the whole reason for
   * running the thing hundreds of times.
   */
  "it works only if little goes wrong",
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
  /** How often this plan does not survive its own uncertainty. See `ruinRisk`. */
  ruin: RuinRead;
}

/**
 * Written in the business's own money — see shared/currency.ts. It used to be
 * dollars whatever the business was, so a café in Leeds was told its third
 * shop would leave it "$37k" short.
 */
const moneyIn = (code: CurrencyCode) => (n: number): string => businessMoney(n, code);

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
export function answer(input: {
  baseline: Baseline; levers: Lever[]; months: number; currency?: CurrencyCode;
  /** Calendar month this starts in, 1–12, for seasonality. Defaults to January. */
  startingMonth?: number;
}): Answer {
  const money = moneyIn(input.currency ?? DEFAULT_CURRENCY);
  const baseline = cleanBaseline(input.baseline);
  const months = clamp(Math.round(input.months) || DEFAULT_MONTHS, 1, MAX_MONTHS);
  const startingMonth = input.startingMonth;
  const without = runMonths({ baseline, levers: [], months, startingMonth });
  const runs = Object.fromEntries(
    CONFIDENCES.map((c) => [c, runMonths({ baseline, levers: input.levers, months, confidence: c, startingMonth })]),
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
  /*
   * Hours the decision takes off the owner each week, once everybody hired is
   * up to speed. Only a hire can carry them, and most hires carry none.
   */
  const hoursFreed = input.levers.reduce(
    (sum, l) => sum + (l.kind === "hire" ? Math.max(0, l.ownerHoursFreedEach ?? 0) * Math.max(0, l.people) : 0),
    0,
  );
  /*
   * Worked out before the verdict, because it decides one.
   *
   * This used to be computed at the bottom, with the facts, which meant the
   * headline badge could not see it.
   */
  const ruin = ruinRisk({ baseline, levers: input.levers, months });

  const verdict: Verdict =
    cautious.runsOutIn !== null ? "it runs you out of money"
    /*
     * Still a loss in cash, and still said so — but a decision whose whole
     * point was to take work off the owner is not usefully described as
     * "it costs more than it brings back", which is the answer the engine used
     * to give to hiring a manager. Survivability outranks it: if the cautious
     * run runs out of money, that is the verdict whatever it frees.
     */
    : cashDifference <= 0 && hoursFreed > 0 ? "it costs money and buys back your time"
    : cashDifference <= 0 ? "it costs more than it brings back"
    /*
     * Ahead on the central case and fragile underneath it. Said before "tight",
     * because a plan that fails one time in four is not a plan with a narrow
     * margin — it is a plan you should not make on these numbers.
     */
    : ruin.risk >= FRAGILE ? "it works only if little goes wrong"
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
  /*
   * What it could pay its owner, once it works.
   *
   * The question underneath most of these, and the one the engine could not
   * answer: somebody puts a wage in for a year to build the thing, and wants
   * to know when it starts paying them back. Worked from the last three
   * months' profit rather than the final month, so one good month does not
   * become a salary, and stated as what could come out *without the balance
   * falling*, which is the only version of the number that is safe to act on.
   */
  /*
   * What the owner actually got out, and what they had to leave. Said as one
   * fact because the two halves only mean anything together: "you took
   * £36,000 out" is the answer, and "in the cautious case £9,000 of it would
   * not have been there" is the risk on it.
   */
  const alreadyDrawing = input.levers.some((l) => l.kind === "drawings");
  if (alreadyDrawing) {
    facts.push(
      cautious.drawnShortfall > 0
        ? `You take ${money(likely.drawnTotal)} out of it across the ${months} months. If it goes slowly, ${money(cautious.drawnShortfall)} of what you planned to take would not have been there — the months it falls short are the ones to have a plan for.`
        : `You take ${money(likely.drawnTotal)} out of it across the ${months} months, and it covers that in full even if it goes slowly.`,
    );
  }

  const tail = likely.months.slice(-3);
  const steadyProfit = tail.length ? tail.reduce((sum, m) => sum + m.profit, 0) / tail.length : 0;
  if (!alreadyDrawing && steadyProfit > 0 && likely.endCash > 0) {
    facts.push(
      `By ${monthName(months)} it is making about ${money(steadyProfit)} a month. That is roughly what it could pay you without the balance starting to fall — worth running again with that coming out, to see it hold.`,
    );
  }
  if (hoursFreed > 0) {
    /*
     * Said as a trade, with both halves, because that is the decision. Never
     * converted to money — see `ownerHoursFreedEach`.
     */
    const weekly = hoursFreed === 1 ? "an hour" : `${Math.round(hoursFreed)} hours`;
    facts.push(
      cashDifference < 0
        ? `It takes ${weekly} a week off you, and costs ${money(-cashDifference)} over ${months} months to do it. Whether that is worth it is yours to say — this cannot price your week.`
        : `It takes ${weekly} a week off you, and pays for itself as well.`,
    );
  }
  /*
   * Borrowing against nothing.
   *
   * The engine will happily model a loan for somebody with no revenue and no
   * cash, because the arithmetic works — the money arrives and the repayments
   * start. What the arithmetic cannot say is that nobody would lend it. That
   * gap mattered most to exactly the people who need this to be honest: a
   * founder with nothing, asked "can I borrow €10,000 to start?", was shown a
   * clean projection of a loan they could not get. This says the quiet part
   * once, and leaves the plan on the screen, because the answer to "not yet"
   * is a plan for later rather than a blank page.
   */
  const borrows = input.levers.find((l) => l.kind === "loan");
  if (borrows && baseline.monthlyRevenue <= 0 && baseline.cash <= 0) {
    facts.push(
      `This assumes the ${money(borrows.amount)} is lent to you. With nothing coming in and nothing in the bank, most lenders will want to see one of the two first — takings for a few months, or money of your own in the account. Worth running "what if I save for a year first" beside this one.`,
    );
  }
  if (revenueDifference !== 0) {
    facts.push(
      `Monthly revenue ends at ${money(likely.endMonthlyRevenue)} against ${money(without.endMonthlyRevenue)} without it.`,
    );
  }
  if (likely.endStaff !== baseline.staff) {
    facts.push(`Headcount goes from ${baseline.staff} to ${likely.endStaff}.`);
  }
  /*
   * How many customers that revenue is, and how near the end of the market.
   *
   * The engine has tracked a customer stock since it learned about churn, and
   * said nothing about it: the owner was shown revenue ending at £11k without
   * ever being told whether that was 220 customers or 2,200 — which is the
   * number they manage, and the one that says whether the curve is flattening
   * because the spend stopped or because there is nobody left to sell to.
   */
  const subs = input.levers.filter((l) => l.kind === "subscription");
  const endCustomers = likely.months[likely.months.length - 1]?.customers ?? null;
  if (subs.length && endCustomers != null && endCustomers > 0) {
    const ceiling = subs.reduce((n, l) => n + (l.kind === "subscription" ? l.marketSize : 0), 0);
    const share = ceiling > 0 ? endCustomers / ceiling : 0;
    facts.push(
      `That is ${Math.round(endCustomers).toLocaleString("en-GB")} paying customers by ${monthName(months)}`
      + (ceiling > 0
        ? share >= 0.5
          ? `, out of the ${ceiling.toLocaleString("en-GB")} you said exist. Over half the market: the arithmetic stops being about spending more and starts being about who is left.`
          : `, out of the ${ceiling.toLocaleString("en-GB")} you said exist — ${share < 0.01 ? "under 1%" : `about ${Math.round(share * 100)}%`} of them, so the market is not what is holding this back.`
        : "."),
    );
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
  /*
   * The owner's week, when it is the thing that does not stretch.
   *
   * Said before the money facts because when it bites it is the answer: a plan
   * that needs sixty hours a week from somebody who has fifteen is not a plan
   * that is tight on cash, it is a plan that does not happen, and every
   * pleasant number above it is a number about a month that will not occur.
   */
  if (likely.stretchedMonths > 0) {
    facts.push(
      `This asks for more of your week than you said you have, in ${likely.stretchedMonths} of the ${months} months — at the worst of them only ${Math.round((1 - likely.worstStretch) * 100)}% of it gets done. The figures above already assume you get through what fits and no more, so the shortfall is in the answer rather than on top of it.`,
    );
  }
  if (likely.owedToYou > 0) {
    facts.push(
      `${money(likely.owedToYou)} of that is earned and not yet paid — at ${baseline.daysToGetPaid} days, that much is always someone else's to hold. It is why the bank balance runs behind the profit line.`,
    );
  }
  if (likely.taxTotal > 0) {
    facts.push(`${money(likely.taxTotal)} of it goes in tax across the ${months} months. Taken out before the balances above.`);
  }
  /*
   * And how often the whole thing simply does not survive. Said last among the
   * computed facts because it is the one that recolours the others.
   */
  if (ruin.ruined > 0) {
    facts.push(
      `Run ${ruin.trials} times with the returns, the timing and the churn varied around your own figures — and a bad month allowed for — it runs out of money in ${Math.round(ruin.risk * 100)}% of them`
      + (ruin.typicalMonth ? `, usually around ${monthName(ruin.typicalMonth)}` : "")
      + `. The middle outcome ends at ${money(ruin.medianEnd)}; the worst at ${money(ruin.worstEnd)}.`,
    );
  } else {
    facts.push(
      `Run ${ruin.trials} times with the returns, the timing and the churn varied around your own figures, it never runs out of money. The middle outcome ends at ${money(ruin.medianEnd)}, the worst at ${money(ruin.worstEnd)}.`,
    );
  }
  if (baseline.grossMargin < 1) {
    facts.push(
      // "dollar" and "c" were written into the sentence, so a business counting
      // in euros was told about its dollars. Said in units instead, which is
      // true in any currency.
      `Every extra ${symbolOf(input.currency)}1 of revenue leaves ${Math.round(baseline.grossMargin * 100)}% once the cost of delivering it is paid. That is what the figures above are worked out on.`,
    );
  }

  return {
    months, without, with: runs, verdict, paybackMonth, cashDifference, revenueDifference,
    worstCase: { cash: cautious.lowestCash, month: cautious.lowestMonth, runsOutIn: cautious.runsOutIn },
    facts, ruin,
  };
}

/**
 * Whether there is enough here to run anything, or the sentence saying what is
 * missing.
 *
 * A baseline nobody has filled in produces a flat line at nothing, which is
 * not a projection — it is a picture of a company that does not exist, and an
 * owner shown one would reasonably conclude the feature is broken. Refusing
 * costs nothing and says what to fill in.
 *
 * ## Zero is an answer
 *
 * That refusal used to read the numbers alone, so it could not tell "nobody
 * has typed anything" from "nothing, and I typed it". Somebody starting a
 * business with no savings, no revenue and no costs — the person the Ship an
 * MVP path is entirely for — filled in €0, €0 and €0, honestly, and was told
 * to fill one in. There was no way past it: the answer *was* zero. The
 * simulator was closed to the people with the least room to get a decision
 * wrong, while the intake two screens away says "$0 is a real starting point"
 * and the baseline form says "overdrawn is a number too".
 *
 * `answered` is the list of fields the owner typed (the `overridden` set the
 * baseline already keeps). A field in it is answered, whatever its value, and
 * a flat line at zero is then a true picture that the levers make interesting:
 * spend €200 a month on flyers, take €600 back, and the arithmetic has
 * something real to say.
 */
export function missingFrom(baseline: Baseline, answered: readonly string[] = []): string | null {
  const said = (field: keyof Baseline) => answered.includes(field) || baseline[field] > 0;
  if (!said("monthlyRevenue") && !said("cash")) {
    return "This needs at least one of two numbers to say anything: what the business takes in a month, or what is in the bank. Fill one in — zero is a real answer — and it has something to work from.";
  }
  if (!said("monthlyCosts")) {
    return "Fill in what the business pays out in an ordinary month — wages, rent, stock, everything. Without it every decision looks free.";
  }
  return null;
}
