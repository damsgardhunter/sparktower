/**
 * The finance seat's balance sheet: money that is owed, money that is sold,
 * and money that is bought back.
 *
 * Borrowing and raising were the only two ways the finance seat could change
 * the shape of the company. These are the quieter ones a real finance seat
 * spends its year on — what you let customers owe you, what you do with what
 * they owe, what your debt costs after you have already borrowed it, and
 * buying back the part of the company somebody else owns.
 *
 * They are all trades between *when* money arrives and *how much* of it there
 * is, which is the one thing the rest of the game has no way to express.
 */
import type { Company } from "./types";

// ─── Payment terms ───────────────────────────────────────────────────────────

export const TERMS_DAYS = [0, 30, 60, 90] as const;
export type Terms = (typeof TERMS_DAYS)[number];

/**
 * How long customers get to pay.
 *
 * Longer terms win business — a company that bills on ninety days is easier
 * to buy from, and in a market of businesses it is sometimes the whole reason
 * — and the money arrives after the year it was earned. Cash on delivery is
 * the reverse: every pound now, and a little harder to sell.
 */
export function termsOf(days: number | undefined | ""): { days: number; appeal: number; deferred: number } {
  /*
   * Billing on delivery is the baseline, not a penalty: it is how every
   * company here has always billed, and a seat that never touches the lever —
   * or a year before the lever exists — must be exactly as it was. Terms are
   * something you *give*, at a price.
   */
  const d = days === undefined || days === null || days === "" || !Number.isFinite(Number(days))
    ? 0
    : Math.max(0, Math.min(90, Math.round(Number(days))));
  return {
    days: d,
    // Four per cent more appealing at ninety days, and nothing at all on delivery.
    appeal: 1 + 0.04 * (d / 90),
    // The share of a year's takings still owed when the year ends.
    deferred: d / 365,
  };
}

/** What the segment sees, for the market to read. */
export const termsAppeal = (company: Pick<Company, "terms">): number => termsOf(company.terms).appeal;

// ─── Factoring ───────────────────────────────────────────────────────────────

/** What a factor keeps: sell what you are owed, get most of it now. */
export const FACTOR_DISCOUNT = 0.08;

/**
 * Selling what customers owe you, for cash today.
 *
 * Expensive money — eight per cent of the invoice, which on ninety-day terms
 * is an eye-watering annual rate — and the fastest money in the game that is
 * not an emergency loan. It exists so a company that has sold hard on long
 * terms is not forced to choose between growth and solvency.
 */
export function factoring(input: { receivables: number; share: number | undefined }): { sold: number; cash: number; cost: number } {
  const share = Math.max(0, Math.min(100, Number(input.share) || 0)) / 100;
  const sold = Math.max(0, input.receivables) * share;
  return { sold, cash: sold * (1 - FACTOR_DISCOUNT), cost: sold * FACTOR_DISCOUNT };
}

// ─── Refinancing ─────────────────────────────────────────────────────────────

/** What arranging it costs, as a share of what is moved. */
export const REFINANCE_FEE = 0.01;

/**
 * Moving what is on the credit line onto fixed terms.
 *
 * The line moves with the rating and can be pulled; a fixed loan cannot. A
 * company that has borrowed its way through a bad year and then recovered can
 * lock the debt in at the rate its new rating earns — and one that refinances
 * while the rating is poor locks in the poor rate for three years, which is
 * the mistake this makes possible.
 */
export function refinance(input: { onLine: number; amount: number | undefined; rate: number; year: number; term: number }): { moved: number; fee: number; bond: { amount: number; rate: number; maturesYear: number } | null } {
  const moved = Math.max(0, Math.min(Math.max(0, input.onLine), Number(input.amount) || 0));
  if (moved <= 0) return { moved: 0, fee: 0, bond: null };
  return {
    moved,
    fee: moved * REFINANCE_FEE,
    bond: { amount: moved, rate: input.rate, maturesYear: input.year + input.term },
  };
}

// ─── Buying the company back ─────────────────────────────────────────────────

/** What the seller wants over the going valuation to part with a stake. */
export const BUYBACK_PREMIUM = 1.15;

/**
 * Buying back a slice of what investors own.
 *
 * Priced off what the company is worth now, plus a premium, because a
 * shareholder who can see the same numbers does not sell at par. It is the
 * only way a founder's share goes back up, and the money it costs is money
 * not spent on the year — which is exactly the argument worth having.
 */
export function buyback(input: { spend: number | undefined; worth: number; founderShare: number }): { paid: number; bought: number; share: number } {
  const spend = Math.max(0, Number(input.spend) || 0);
  const theirs = Math.max(0, 1 - Math.max(0, Math.min(1, input.founderShare)));
  if (spend <= 0 || theirs <= 0 || input.worth <= 0) return { paid: 0, bought: 0, share: input.founderShare };
  const perPoint = (input.worth * BUYBACK_PREMIUM) / 100;
  const bought = Math.min(theirs * 100, spend / Math.max(1, perPoint)) / 100;
  return { paid: bought * 100 * perPoint, bought, share: Math.min(1, input.founderShare + bought) };
}

/** A sensible ceiling for the control, so the desk can bound it against what is left to buy. */
export const buybackCeiling = (worth: number, founderShare: number): number =>
  Math.max(0, (1 - Math.max(0, Math.min(1, founderShare)))) * worth * BUYBACK_PREMIUM;

/** Only worth offering once somebody else owns a piece. */
export const hasOutsideOwners = (company: Pick<Company, "founderShare">): boolean => (company.founderShare ?? 1) < 0.999;

/** How long a refinanced loan runs, matching a new one. */
export const REFINANCE_TERM_YEARS = 3;
