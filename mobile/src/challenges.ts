/**
 * The limits a challenge and its entries are held to, restated for the phone.
 *
 * A copy of the parts of `shared/challenges.ts` and `shared/challenges-money.ts`
 * the app needs, because Metro will not resolve `@shared`.
 * `test/unit/company-challenges-on-the-phone.test.ts` holds every number here
 * against the web's.
 *
 * They are here so the phone can say what a field needs *before* somebody
 * writes four thousand characters of brief and collects a refusal. The server
 * validates again and its message is the one shown.
 */
export const CHALLENGE_LIMITS = {
  title: { min: 5, max: 120 },
  brief: { min: 50, max: 4000 },
  criteria: { max: 2000 },
  prize: { max: 200 },
  terms: { min: 50, max: 4000 },
  /** How far ahead a deadline may be. A year is long enough for a real problem, and short enough that the prize still means something. */
  maxDeadlineDays: 365,
} as const;

export const ENTRY_LIMITS = {
  title: { min: 3, max: 120 },
  pitch: { min: 50, max: 3000 },
  link: { max: 500 },
  feedback: { max: 1000 },
} as const;

export const CHALLENGE_STATUSES = ["open", "judging", "closed"] as const;
export const ENTRY_STATUSES = ["entered", "shortlisted", "winner", "withdrawn"] as const;
/** What a judge may set. "entered" is there so a shortlisting can be taken back. */
export const JUDGED_STATUSES = ["entered", "shortlisted", "winner"] as const;

/** What it costs to post one — `OUTCOME_PRICE_CENTS.challenge` in shared/plans.ts. */
export const CHALLENGE_FEE_CENTS = 499;

export const CHALLENGE_DISCLAIMER =
  "SparkTower doesn't hold or pay prizes. The prize is stated by the company, which pays its winners directly under its own terms. By entering you agree to those terms with the company, not with SparkTower.";

/** Re-exported so a caller writing a price has one import rather than two. */
export { money } from "./projectData";
