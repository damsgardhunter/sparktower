/**
 * The rules a marketplace needs before strangers can sell each other things.
 *
 * ## What this file is and is not
 *
 * It is the *mechanisms*: what a seller has agreed to and when, how long a
 * buyer has to change their mind, how long the money waits before it is
 * somebody's, and what a listing promises before anybody pays. Those are
 * engineering decisions and they belong in code where they can be tested.
 *
 * It is not legal advice and it does not make anything lawful. The policy text
 * below is a plain-English starting point; which jurisdictions this operates
 * in, what the published terms say, whether the platform is the seller of
 * record for tax, and what has to be filed and when, are decisions for the
 * owner and their solicitor. What this file guarantees is that whatever those
 * decisions turn out to be, the platform already records consent with a
 * version, holds money before releasing it, and can take a listing down.
 *
 * ## Why consent is versioned
 *
 * "They agreed to the terms" is worth nothing without "which terms". Terms
 * change, and a seller who joined under the old ones did not agree to the new.
 * Every acceptance stores the version it was given, so the question "what did
 * this person actually agree to" has an answer years later — which is the only
 * form of the question that ever gets asked.
 */

/**
 * The version of the seller agreement in force.
 *
 * Bumped whenever the text below changes in a way that alters what somebody is
 * agreeing to. A seller whose accepted version is older than this is asked
 * again before they may publish — not blocked from what they have already
 * listed, because retroactively unpublishing somebody's work over a wording
 * change is its own kind of wrong.
 */
export const SELLER_TERMS_VERSION = 1;

/**
 * What a seller is agreeing to.
 *
 * Written as plain statements rather than legalese, because a term somebody
 * does not understand is a term that will be disputed. Each is a thing the
 * platform can actually act on: every one of these has either a check in the
 * code or a takedown behind it.
 */
export const SELLER_TERMS = [
  {
    id: "own_rights",
    heading: "It is yours to sell",
    body: "You wrote this simulation, or you have the rights to sell it. It does not copy somebody else's market, scenario or written material, and it does not use a company's name, brand or confidential information without their permission.",
  },
  {
    id: "accurate",
    heading: "It is described honestly",
    body: "The description matches what a buyer gets. You do not promise an outcome, a qualification, or a result in anybody's real business.",
  },
  {
    id: "lawful",
    heading: "It is lawful and not harmful",
    body: "It does not instruct anyone to break the law, does not target or demean a group of people, and is not built to deceive. Simulations that teach a real business skill are the point; anything presented as financial, legal or medical advice is not.",
  },
  {
    id: "support",
    heading: "You stand behind it",
    body: "If a simulation is broken, misdescribed, or cannot be played, buyers are refunded from your earnings for that sale. Listings that are repeatedly refunded may be taken down.",
  },
  {
    id: "takedown",
    heading: "It can be taken down",
    body: "A listing reported for any of the above can be removed while it is reviewed. Seasons already running are not interrupted — people who paid keep what they paid for.",
  },
  {
    id: "tax",
    heading: "Your earnings are yours to declare",
    body: "Money you earn here is income. You are responsible for declaring and paying tax on it in your own country. The platform records what you earned and when, and will provide that record.",
  },
] as const;

/**
 * How long a buyer has to ask for their money back.
 *
 * Fourteen days is the consumer right on digital goods across the EU and UK,
 * and it is simpler to give everybody the strongest rule than to decide where
 * each buyer lives and apply a different one. It is written here once because
 * two different numbers — one in the refund route and one in the payout hold —
 * is how a platform ends up paying out money it still owes somebody.
 */
export const REFUND_WINDOW_DAYS = 14;

/**
 * How long a seller's earnings wait before they are theirs.
 *
 * The same fourteen days, deliberately. Money credited at the moment of sale
 * is money that has already gone when the refund arrives — the platform then
 * either takes it back out of a balance that may be empty, or absorbs it. A
 * hold that matches the refund window means a refund is always paid from money
 * nobody has spent yet.
 *
 * Seats are usable immediately. The wait is on the money, not the product.
 */
export const PAYOUT_HOLD_DAYS = REFUND_WINDOW_DAYS;

/**
 * The one thing a buyer gives up by playing straight away.
 *
 * Under the same consumer rules, the withdrawal right on digital content ends
 * once delivery begins *if* the buyer agreed to that and acknowledged it. A
 * season started is delivery begun, which is why starting one is the act that
 * closes the window rather than the clock alone. Buying seats and not using
 * them leaves the full fourteen days intact.
 */
export const REFUNDABLE_UNTIL_PLAYED = true;

/** What a buyer is told before they pay, in the order it matters. */
/**
 * The version of the buyer terms in force.
 *
 * Bumped whenever `BUYER_DISCLOSURE` changes what somebody is agreeing to —
 * the refund window, what a seat is, who gets the money. Versioned for the
 * same reason the seller's are: "they agreed to the terms" is worth nothing
 * without "which terms", and the only form of that question anybody ever asks
 * is years later.
 *
 * ## Why this is recorded on the purchase and not in an agreements table
 *
 * A seller accepts once and then publishes many times, so their consent is a
 * fact about the person. A buyer's is a fact about the *sale*: what mattered on
 * the day was the refund window they were shown, and a table saying they
 * accepted version 1 once in March answers nothing about a purchase made in
 * November under version 2. So the version in force travels on the row that
 * records the money.
 *
 * ## Why buying is the acceptance
 *
 * The disclosure is rendered beside the pay button rather than behind a link —
 * deliberately, and `simulation-listing.tsx` says why: "a page that puts it
 * after is a page that has decided they will not read it." So the act of
 * buying, with those four statements on screen, is the acceptance, and the
 * version in force is what gets written down.
 *
 * The client still sends the version it displayed, and a mismatch is refused.
 * That is the one failure this cannot otherwise see: a tab left open across a
 * terms change would buy under terms it never showed anybody.
 */
export const BUYER_TERMS_VERSION = 1;

export const BUYER_DISCLOSURE = [
  "You are buying seats in this simulation — the right to run it with that many people. It is a licence to play, not ownership of the market.",
  `You can ask for a refund within ${REFUND_WINDOW_DAYS} days on any seats you have not yet used to start a season.`,
  "Starting a season uses a seat and ends the refund right for that seat, because the thing you bought has been delivered.",
  "The author receives most of the price; the platform keeps a share for running and hosting the simulation.",
] as const;

/** Whether a purchase is still inside its refund window. */
export function refundableUntil(boughtAt: Date): Date {
  const until = new Date(boughtAt);
  until.setUTCDate(until.getUTCDate() + REFUND_WINDOW_DAYS);
  return until;
}

/** When a sale's earnings stop being held and become the seller's. */
export function releasableAt(boughtAt: Date): Date {
  const at = new Date(boughtAt);
  at.setUTCDate(at.getUTCDate() + PAYOUT_HOLD_DAYS);
  return at;
}

export type RefundRefusal = { reason: string };

/**
 * Whether these seats can still be refunded, and why not when they cannot.
 *
 * Returns the refundable amount rather than a yes or no, because a part-used
 * purchase is the ordinary case: somebody buys six seats, runs a season with
 * four, and is owed for two.
 */
export function refundableSeats(purchase: {
  seats: number;
  seatsLeft: number;
  paidCents: number;
  refundedCents: number;
  createdAt: Date;
}, now: Date = new Date()): { seats: number; cents: number } | RefundRefusal {
  if (purchase.refundedCents >= purchase.paidCents && purchase.paidCents > 0) {
    return { reason: "This purchase has already been refunded." };
  }
  /*
   * Nothing was paid, so there is nothing to give back — and the refund route
   * spends the seats to record one. Without this, a buyer who pressed refund on
   * a free listing lost every seat they had and got nothing in return, which is
   * the worst possible reading of the word.
   */
  if (purchase.paidCents <= 0) {
    return { reason: "These seats were free, so there's nothing to refund. You can keep using them." };
  }
  if (now > refundableUntil(purchase.createdAt)) {
    return { reason: `Refunds are available for ${REFUND_WINDOW_DAYS} days after buying, and that has passed.` };
  }
  if (purchase.seatsLeft <= 0) {
    /*
     * Which of the two it is matters. A partial refund takes the unused seats,
     * so `seatsLeft` reaches zero both when every seat was played and when the
     * spare ones were given back — and the second case was being told "it has
     * been delivered", which reads as "you were charged for those and they are
     * gone". The opposite of what happened.
     */
    if (purchase.refundedCents > 0) {
      return { reason: "The seats you didn't use have already been refunded. The rest were used to start seasons." };
    }
    return { reason: "Every seat from this purchase has been used to start a season, so it has been delivered." };
  }
  /*
   * Priced per seat from what was actually paid, not from the listing's price
   * today: a seller who raises their price does not change what a past buyer
   * is owed, and one who lowers it does not get to refund less.
   */
  const perSeat = purchase.seats > 0 ? Math.round(purchase.paidCents / purchase.seats) : 0;
  return { seats: purchase.seatsLeft, cents: Math.min(perSeat * purchase.seatsLeft, purchase.paidCents - purchase.refundedCents) };
}

/**
 * What the seller is owed on a purchase, after any refunds against it.
 *
 * ## The bug this replaces
 *
 * Three places treated a refund as all-or-nothing — the payout sweep skipped
 * any row with a `refunded_at`, the earnings statement subtracted the whole
 * `sellerCents` if `refundedCents` was anything above zero, and the seller's
 * library ignored refunds entirely. But a partial refund is the *ordinary* case
 * here, because `refundableSeats` returns the seats that were not used rather
 * than the purchase: five seats bought for a table, two people turn up and
 * play, the other three go back.
 *
 * So a seller who sold five seats and delivered two was paid nothing for the
 * two, and the buyer's money for them stayed with the platform. Meanwhile the
 * library said they had earned the full split of all five. Three numbers for
 * one sale, none of them what arrived.
 *
 * ## Why proportional, and not `splitSale` on what is left
 *
 * Re-splitting the kept amount would apply *today's* `PLATFORM_SHARE_PERCENT`
 * to a sale made under the old one, so changing the platform's share would
 * quietly rewrite what past sellers are owed. Scaling the split that was
 * actually recorded keeps each sale on the terms it was made under. On a
 * 15% share the two agree to the penny; after a change, only this one is right.
 *
 * ## Which way the penny goes
 *
 * Floored, and clamped at zero. The clawback is what comes *off* the seller, so
 * flooring it leaves them the remainder — which is `splitSale`'s rule, stated
 * there as "it matters that it is never the house that gains it".
 *
 * This read `round` first, with a comment claiming that was the same direction.
 * It is the opposite: rounding a clawback up takes a penny off the seller and
 * leaves it with the platform. Neither choice makes this agree exactly with
 * re-splitting what is left — checked over twelve thousand combinations, both
 * differ on about a quarter of them — so there is no arithmetic reason to
 * prefer one. There is only the rule about who the remainder belongs to.
 */
export function sellerOwed(purchase: {
  paidCents: number;
  refundedCents: number;
  sellerCents: number;
}): number {
  const paid = Math.max(0, purchase.paidCents);
  const owedAtSale = Math.max(0, purchase.sellerCents);
  /* A free seat earns nothing and can refund nothing; there is no ratio to take. */
  if (paid <= 0) return 0;
  const refunded = Math.min(Math.max(0, purchase.refundedCents), paid);
  if (refunded <= 0) return owedAtSale;
  const clawedBack = Math.floor((owedAtSale * refunded) / paid);
  return Math.max(0, owedAtSale - clawedBack);
}

/**
 * The yearly figure a seller needs in order to declare anything.
 *
 * Not a tax calculation and not a threshold for any particular country — it is
 * the number somebody needs when their accountant asks, available without
 * anybody having to ask the platform for it.
 */
export const EARNINGS_STATEMENT_NOTE =
  "This is what you earned on this platform in this calendar year, after the platform's share and after any refunds. It is not tax advice and does not account for anything you earned elsewhere.";
