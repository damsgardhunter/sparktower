/**
 * Money with strings attached.
 *
 * Money used to come without any. A loan cost the same interest whether the
 * company was thriving or on fire; running out of cash quietly drew on the
 * credit line at the normal rate; and selling a stake cost ownership and
 * nothing else — the investors took their share and then never said a word
 * for the rest of the season. So the finance seat's only real decision was
 * how much, never whether it could afford the consequences.
 *
 * Three consequences, each the kind a real finance director loses sleep over:
 *
 *   - **A credit rating that moves with profit.** Every company has a score
 *     that drifts each year towards what its profit, debt and cash justify.
 *     It sets the interest rate on everything it owes and how much the bank
 *     will lend it next. Borrowing cheaply is something a company earns.
 *   - **An emergency loan when cash runs out.** It keeps the company alive —
 *     a season is never ended by one bad year — but at a punitive rate, with a
 *     hit to reputation and to the rating. It is repaid before anything else.
 *   - **Investors with targets and a vote.** Selling a stake now comes with a
 *     revenue target for the next year. Miss it twice running and the board
 *     removes the chief executive and runs that chair itself — until the
 *     company hits a target again and the board gives it back.
 *
 * Pure: the engine calls these at settlement, the desk calls them to show
 * what the year will cost before it is filed.
 */
import type { Company } from "./types";

// ─── The credit rating ──────────────────────────────────────────────────────

/** Where a company with no history starts: neither trusted nor distrusted. */
export const RATING_START = 50;

export type Grade = "AAA" | "AA" | "A" | "BBB" | "BB" | "B" | "CCC" | "D";

/** The letters a bank would use, because a player has seen them before. */
export function ratingGrade(score: number): Grade {
  if (score >= 85) return "AAA";
  if (score >= 75) return "AA";
  if (score >= 65) return "A";
  if (score >= 55) return "BBB";
  if (score >= 45) return "BB";
  if (score >= 35) return "B";
  if (score >= 20) return "CCC";
  return "D";
}

/**
 * What a company pays over the market rate, by its score.
 *
 * A curve rather than steps, so improving the rating is always worth
 * something: half a point over the market for the best companies, a little
 * over three at a middling fifty, and more than twelve for one the market has
 * given up on. Steepest at the bottom, which is where it should hurt.
 */
export function spreadFor(score: number): number {
  const s = Math.max(0, Math.min(100, score)) / 100;
  return 0.005 + Math.pow(1 - s, 2) * 0.12;
}

/**
 * On top of the company's own rate, for money lent because it ran out.
 *
 * Deliberately painful. Emergency money is lent to a company that did not plan
 * for its own year, by lenders who know it has nowhere else to go.
 */
export const EMERGENCY_PREMIUM = 0.15;

/** Reputation lost for having to be rescued. The customers notice. */
export const EMERGENCY_REPUTATION = 4;

/**
 * How much of the gap a year closes between the rating a company has and the
 * one its numbers now justify.
 *
 * Moves with profit but does not lurch with it: a lender who re-rated on one
 * year's figures would be panicking, and a player whose rating collapsed after
 * a single bad year would have no reason to think past it.
 */
const RATING_MOMENTUM = 0.4;

/** What a company's rating should be, on this year's numbers alone. */
export function justifiedRating(input: {
  revenue: number;
  profit: number;
  debt: number;
  cash: number;
  /** A year of salaries: the bills that come whatever happens. */
  fixedCosts: number;
  /** Whether it needed rescuing this year. */
  rescued: boolean;
}): number {
  const { revenue, profit, debt, cash, fixedCosts, rescued } = input;
  const margin = revenue > 0 ? profit / revenue : profit >= 0 ? 0 : -1;
  const leverage = debt / Math.max(revenue, 1);
  const cushion = cash / Math.max(fixedCosts, 1);

  const onMargin = Math.max(0, Math.min(100, 50 + margin * 150));
  const onLeverage = Math.max(0, Math.min(100, 100 - leverage * 70));
  const onCash = Math.max(0, Math.min(100, cushion * 30));

  const score = onMargin * 0.45 + onLeverage * 0.35 + onCash * 0.2;
  return Math.max(0, Math.min(100, score - (rescued ? 25 : 0)));
}

export function nextRating(current: number | undefined, justified: number): number {
  const now = current ?? RATING_START;
  return Math.round((now + (justified - now) * RATING_MOMENTUM) * 10) / 10;
}

/** How much more (or less) a bank will lend for the rating. */
export const creditMultiplier = (score: number): number => 0.4 + Math.max(0, Math.min(100, score)) / 100;

/**
 * This year's interest on what the company owes.
 *
 * Charged on the debt it started the year with. The emergency part of it pays
 * the premium; the rest pays the company's own rate.
 */
export function interestOn(company: Pick<Company, "debt" | "emergencyDebt" | "creditScore">, marketRate: number): {
  interest: number;
  rate: number;
  emergencyRate: number;
} {
  const rate = marketRate + spreadFor(company.creditScore ?? RATING_START);
  const emergencyRate = rate + EMERGENCY_PREMIUM;
  const emergency = Math.max(0, Math.min(company.emergencyDebt ?? 0, company.debt));
  const ordinary = Math.max(0, company.debt - emergency);
  return { interest: ordinary * rate + emergency * emergencyRate, rate, emergencyRate };
}

/** Repayment clears the emergency loan first — the expensive money goes first. */
export function applyRepayment(emergencyDebt: number, repaid: number): number {
  return Math.max(0, emergencyDebt - Math.max(0, repaid));
}

// ─── Investors ──────────────────────────────────────────────────────────────

/** Growth the investors expect in revenue, every year they are on the board. */
export const INVESTOR_GROWTH = 0.25;

/** A share of what they put in that they expect to see in the next year's revenue. */
export const INVESTOR_RETURN_SHARE = 0.25;

/** Missed targets in a row before the board acts. */
export const STRIKES_TO_REMOVE = 2;

export interface Investors {
  /** The year they first bought in. */
  since: number;
  /** Everything raised from them so far. */
  raised: number;
  /** The revenue they expect by the end of `targetYear`. */
  target: number;
  targetYear: number;
  /** Consecutive missed targets. */
  strikes: number;
  /** True while the board has removed the chief executive and runs the chair itself. */
  inCharge: boolean;
}

/**
 * The terms that come with a raise.
 *
 * A quarter more revenue next year than this, plus a quarter of what they put
 * in: the money has to show up somewhere a buyer would see it. Raising again
 * on top of existing terms raises the bar rather than resetting it — new money
 * does not buy a clean slate.
 */
export function termsFor(input: { existing?: Investors; raised: number; revenue: number; year: number }): Investors {
  const { existing, raised, revenue, year } = input;
  const target = Math.round(revenue * (1 + INVESTOR_GROWTH) + raised * INVESTOR_RETURN_SHARE);
  return {
    since: existing?.since ?? year,
    raised: (existing?.raised ?? 0) + raised,
    target: Math.max(target, existing?.targetYear === year + 1 ? existing.target : 0),
    targetYear: year + 1,
    strikes: existing?.strikes ?? 0,
    inCharge: existing?.inCharge ?? false,
  };
}

export interface Review {
  investors: Investors;
  /** What the board said, for the year's report. */
  note: string | null;
  removed: boolean;
  reinstated: boolean;
}

/**
 * The board's view of the year just finished.
 *
 * Only in the year a target falls due. A hit clears the strikes — and gives the
 * chair back, if the board had taken it — and sets the next target from where
 * the company now is. A miss is a strike; two in a row and the board removes
 * the chief executive.
 */
export function reviewInvestors(investors: Investors, revenue: number, year: number): Review {
  if (investors.targetYear !== year) {
    return { investors, note: null, removed: false, reinstated: false };
  }

  const next = Math.round(revenue * (1 + INVESTOR_GROWTH));
  const money = (n: number) => `£${Math.round(n).toLocaleString()}`;

  if (revenue >= investors.target) {
    const reinstated = investors.inCharge;
    return {
      investors: { ...investors, strikes: 0, inCharge: false, target: next, targetYear: year + 1 },
      note: reinstated
        ? `The investors' target was met — ${money(revenue)} against ${money(investors.target)} — and the board has given the chief executive's chair back. Next year they expect ${money(next)}.`
        : `The investors' target was met: ${money(revenue)} against ${money(investors.target)}. Next year they expect ${money(next)}.`,
      removed: false,
      reinstated,
    };
  }

  const strikes = investors.strikes + 1;
  const removed = !investors.inCharge && strikes >= STRIKES_TO_REMOVE;
  const inCharge = investors.inCharge || removed;
  return {
    investors: { ...investors, strikes, inCharge, target: next, targetYear: year + 1 },
    note: removed
      ? `The investors wanted ${money(investors.target)} and got ${money(revenue)} — the second miss in a row. The board has removed the chief executive and will run that chair itself until a target is met.`
      : inCharge
        ? `Another miss — ${money(revenue)} against ${money(investors.target)}. The board is still running the chief executive's chair. Next year they want ${money(next)}.`
        : `The investors wanted ${money(investors.target)} and got ${money(revenue)}. One more miss and the board removes the chief executive. Next year they want ${money(next)}.`,
    removed,
    reinstated: false,
  };
}

/**
 * What the board decides when it holds the chair.
 *
 * Growth, because growth is what its targets measure and what it removed the
 * chief executive for failing to deliver. It keeps the company's positioning
 * rather than lurching somewhere new, and it rehires nobody.
 */
export function boardChiefExecutive(company: Pick<Company, "positioning">): { focus: "growth"; positioning?: string; rehire: "" } {
  return { focus: "growth", positioning: company.positioning || undefined, rehire: "" };
}
