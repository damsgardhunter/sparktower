/**
 * What a challenge costs to post, and where the prize sits until somebody wins
 * it.
 *
 * ## Why a challenge costs anything
 *
 * It was free, and free is what made it worthless. Anyone could post one under
 * a company they had invented, and a builder could spend a fortnight on an
 * entry judged by nobody for a prize that was a sentence in a text box. A fee
 * is not revenue here — $4.99 is not a business — it is the cheapest possible
 * way to make posting a challenge a decision rather than a reflex.
 *
 * ## Why the prize is held rather than promised
 *
 * A promise costs nothing to make and nothing to break, and the person who
 * pays for a broken one is the entrant, weeks later, with no recourse and
 * nothing to show. So the prize is money, it is taken from the company's
 * balance when the challenge is posted, and it sits in the safe until the
 * company names a winner or the challenge ends.
 *
 * Every state the money can be in is one of four, and it is always in exactly
 * one of them:
 *
 *   held      — taken from the company, owed to nobody yet
 *   awarded   — paid to the entrant the company picked
 *   refunded  — given back, because the challenge closed with no winner
 *   released  — given back because the challenge was cancelled before anybody
 *               could enter it
 *
 * Pure: no database, no money moved. `server/challenge-prizes.ts` does both.
 */

/**
 * What it costs to post one.
 *
 * Re-exported from the price list rather than written twice: plans.ts is the
 * single source of truth for what this product charges for, and a fee that
 * lived in two files would eventually be two different fees.
 */
import { OUTCOME_PRICE_CENTS } from "./plans";

export const CHALLENGE_FEE_CENTS = OUTCOME_PRICE_CENTS.challenge;

/**
 * The smallest prize worth a stranger's fortnight.
 *
 * Not zero. A challenge with a $1 prize is the same problem the fee is meant
 * to solve wearing a different hat — it makes the escrow a formality and the
 * challenge a way to get free work. Fifty dollars is low enough for a small
 * company to post a real one and high enough that nobody posts six by accident.
 */
export const MIN_PRIZE_CENTS = 5_000;

/**
 * And a ceiling, because this holds the money.
 *
 * Twenty thousand is far above any plausible prize on this product today, and
 * the point of it is not the number — it is that an amount typed with a
 * slipped decimal point is refused rather than silently taking a hundred times
 * what somebody meant from their balance.
 */
export const MAX_PRIZE_CENTS = 2_000_000;

export const PRIZE_STATES = ["held", "awarded", "refunded", "released"] as const;
export type PrizeState = (typeof PRIZE_STATES)[number];

export const isPrizeState = (v: unknown): v is PrizeState =>
  typeof v === "string" && (PRIZE_STATES as readonly string[]).includes(v);

/** What the money is doing, in the words shown to whoever is looking. */
export const PRIZE_STATE_COPY: Record<PrizeState, { forCompany: string; forEntrant: string }> = {
  held: {
    forCompany: "Held by SparkTower until you pick a winner.",
    forEntrant: "The prize is already paid in and held by SparkTower.",
  },
  awarded: {
    forCompany: "Paid to the winner.",
    forEntrant: "Paid out.",
  },
  refunded: {
    forCompany: "Returned to your balance — the challenge closed without a winner.",
    forEntrant: "Returned to the company; no winner was picked.",
  },
  released: {
    forCompany: "Returned to your balance — the challenge was cancelled before anyone entered.",
    forEntrant: "The challenge was cancelled.",
  },
};

/** What the entrant is told about the money, which is the only claim worth making. */
export const prizeAssurance = (state: PrizeState, amountCents: number): string =>
  state === "held"
    ? `${formatPrize(amountCents)}, already paid in and held by SparkTower — not a promise.`
    : PRIZE_STATE_COPY[state].forEntrant;

/** "$500", "$1,250.50". Whole dollars where it is whole, because most prizes are. */
export function formatPrize(cents: number): string {
  const whole = cents % 100 === 0;
  const amount = (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `$${amount}`;
}

/** A prize amount cleaned, or the reason it is refused. */
export function readPrize(input: unknown): { ok: true; cents: number } | { ok: false; message: string } {
  const cents = Math.round(Number(input));
  if (!Number.isFinite(cents)) return { ok: false, message: "How much is the prize?" };
  if (cents < MIN_PRIZE_CENTS) {
    return { ok: false, message: `The smallest prize is ${formatPrize(MIN_PRIZE_CENTS)} — below that a challenge is a request for free work.` };
  }
  if (cents > MAX_PRIZE_CENTS) {
    return { ok: false, message: `${formatPrize(MAX_PRIZE_CENTS)} is the most a challenge can hold. Get in touch if you mean to run a larger one.` };
  }
  return { ok: true, cents };
}

/** What posting one costs in total: the fee, plus the prize that gets held. */
export const totalToPost = (prizeCents: number): number => CHALLENGE_FEE_CENTS + prizeCents;
