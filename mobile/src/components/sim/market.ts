/**
 * The asset market: what it sends, and the arithmetic the screen does to it.
 *
 * Mirrors shared/simulation/assets.ts and the responses of
 * server/simulation-market-routes.ts, restated here rather than imported for
 * the reason desk.ts gives at length — Metro cannot resolve the web app's
 * `@shared` alias — with the source file named above anything copied.
 *
 * ## The one rule this file is written around
 *
 * The bids are sealed. The server returns your own bid and nothing whatsoever
 * about anyone else's: not the amounts, not who bid, not how many. That is a
 * deliberate omission and not a gap to be filled in on the phone, so there is
 * nothing in this module that estimates competition, ranks a bid against a
 * field, or counts rival interest. The screen's job is to help somebody answer
 * "what is this worth to *us*" — the moment it starts hinting at what others
 * are doing, it becomes an auction with a countdown, which is the exact thing
 * a sealed bid exists to prevent.
 *
 * What the screen *can* say honestly is what a thing does, what it would cost,
 * what the company could back, and what is already promised elsewhere. All of
 * that is arithmetic on your own numbers, and all of it is here.
 */

import type { ReportMarketNote } from "./desk";
/* For abbreviating a room count; the same formatter the desk uses, so the two screens agree. */
import { money } from "./desk";
import { lastsFor as lastsForImpl, type PeriodWords } from "./period";

/** Mirrors CompanyAsset["kind"] in shared/simulation/types.ts. */
export type AssetKind = "celebrity" | "distribution" | "patent" | "facility" | "brand_licence";

/**
 * Mirrors CompanyAsset["effect"] in shared/simulation/types.ts — every field
 * optional, because a listing only carries the ones it moves.
 */
export interface AssetEffect {
  brand?: number;
  quality?: number;
  service?: number;
  capacity?: number;
  /** A multiplier: below 1 is cheaper per unit. */
  unitCost?: number;
}

/** One row of `listings` from GET /api/sim/ventures/:id/market. */
export interface MarketListing {
  id: string;
  name: string;
  kind: AssetKind;
  blurb: string;
  effect: AssetEffect;
  /** Years it lasts, or null when it doesn't lapse. */
  expiresIn: number | null;
  reserve: number;
  /** The team selling it, or null for the open market. */
  seller: string | null;
  /** Yours, and only ever yours. */
  yourBid: number | null;
}

/** One row of `holdings`: something the company owns. */
export interface Holding {
  id: string;
  name: string;
  kind: AssetKind;
  effect: AssetEffect;
  expiresIn: number | null;
  bookValue: number;
  /** What an unforced sale fetches. */
  willingSale: number;
  /** What it fetches when the market can see you need the money. */
  forcedSale: number;
  /** Whether this exact asset is on the market right now. */
  listed: boolean;
}

/** One row of `selling`: your own thing, on the market. */
export interface SellingRow {
  /** The listing's id — what the withdraw route takes. */
  id: string;
  /** The asset's own id, so a holding is never matched on its name. */
  assetId: string;
  name: string;
  reserve: number;
  status: "open" | "sold" | "unsold" | "withdrawn" | string;
}

export interface MarketView {
  year: number;
  /** The seat this person holds — selling is the chief executive's or the finance seat's. */
  yourRole: string | null;
  /**
   * What one decision is called here, and how many of them make a year.
   *
   * Sent since the auction stopped being annual and never read on the phone, so
   * this screen called every decision a "year" whatever the table had chosen —
   * and, worse, printed an asset's life in the wrong unit entirely. See
   * `lastsFor`.
   */
  period?: { one: string; many: string; of: string };
  periods?: number;
  /**
   * What this company counts money in.
   *
   * Read for completeness rather than for a symbol: this phone's `money()`
   * deliberately carries none, so that a figure on a card reads the same as the
   * same figure inside a sentence the server wrote. Here so a screen that wants
   * to name the currency can, without fetching the desk.
   */
  currency?: string | null;
  /**
   * Where this company stands on each axis a lot can move.
   *
   * The reason the listings can say what winning something would make *this*
   * company rather than what it would add to somebody. Sent with a comment
   * saying exactly that, and unread here until now: the phone printed "+6
   * quality" and left a founder to do the arithmetic against numbers held on a
   * different screen — which is the whole decision.
   */
  you?: {
    quality: number;
    brand: number;
    service: number;
    capacity: number;
    unitCost: number;
  } | null;
  /** When the year settles every bid on this screen, or null once the season ends. */
  resolvesAt: string | null;
  /** Cash plus what is still borrowable — what a bid can actually be backed by. */
  funds: number;
  listings: MarketListing[];
  holdings: Holding[];
  selling: SellingRow[];
}

/** What POST /api/sim/ventures/:id/bids answers with. */
export interface BidResult {
  ok: boolean;
  listingId: string;
  amount: number;
  funds: number;
}

/** Mirrors the kinds in shared/simulation/types.ts, said the way a person would. */
export const KIND_LABEL: Record<AssetKind, string> = {
  celebrity: "Celebrity",
  distribution: "Distribution",
  patent: "Patent",
  facility: "Facility",
  brand_licence: "Brand licence",
};

export const KIND_ICON: Record<AssetKind, "star" | "git-network" | "ribbon" | "business" | "pricetag"> = {
  celebrity: "star",
  distribution: "git-network",
  patent: "ribbon",
  facility: "business",
  brand_licence: "pricetag",
};

const trim = (s: string) => (s.endsWith(".0") ? s.slice(0, -2) : s);

/** Capacity is a count of people, and reads as one. */
function count(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "+";
  if (abs >= 1_000_000) return `${sign}${trim((abs / 1_000_000).toFixed(1))}m`;
  if (abs >= 1_000) return `${sign}${trim((abs / 1_000).toFixed(1))}k`;
  return `${sign}${Math.round(abs)}`;
}

/**
 * What an asset does, in the terms the rest of the app already uses.
 *
 * The scores are the same 0–100 numbers the desk draws bars for, so "+14
 * brand" is directly comparable to the brand bar someone just scrolled past.
 * Unit cost is the one that needs translating: the engine stores it as a
 * multiplier, and 0.93 means nothing on a phone — "−7% unit cost" is the same
 * fact in the form the player would have said it in.
 */
export function effectLines(
  effect: AssetEffect | null | undefined,
  /**
   * Where this company stands, so each line can say what winning the lot would
   * *make* it rather than what it would add to somebody.
   *
   * "+6 quality" is a fact and "quality 54 → 60" is the decision, and the
   * difference between them is arithmetic nobody can do while holding a phone
   * against numbers that live on another screen. Optional, so a payload from a
   * server that predates the field still reads as it did.
   */
  you?: MarketView["you"],
): string[] {
  const e = effect ?? {};
  const lines: string[] = [];
  /* `label 54 → 60` where this company's standing is known, `+6 label` where it is not. */
  const score = (value: number | undefined, label: string, from: number | undefined) => {
    if (value === undefined || !Number.isFinite(value) || value === 0) return;
    if (from === undefined || !Number.isFinite(from)) {
      lines.push(`${value > 0 ? "+" : "−"}${Math.abs(Math.round(value))} ${label}`);
      return;
    }
    lines.push(`${label} ${Math.round(from)} → ${Math.round(from + value)}`);
  };

  score(e.brand, "brand", you?.brand);
  score(e.quality, "quality", you?.quality);
  score(e.service, "service", you?.service);

  if (e.capacity !== undefined && Number.isFinite(e.capacity) && e.capacity !== 0) {
    /*
     * Room reads as a count rather than a score, and the shortening matters more
     * here than on the three above: "+4,038 capacity" against a company holding
     * 21,500 is a different decision from the same number against one holding
     * 900, and both fit on a phone only abbreviated.
     */
    lines.push(
      you?.capacity !== undefined && Number.isFinite(you.capacity)
        ? `room ${money(you.capacity)} → ${money(you.capacity + e.capacity)}`
        : `${count(e.capacity)} capacity`,
    );
  }

  if (e.unitCost !== undefined && Number.isFinite(e.unitCost) && e.unitCost !== 1) {
    const pct = Math.round(Math.abs(1 - e.unitCost) * 1000) / 10;
    const off = `${e.unitCost < 1 ? "−" : "+"}${trim(pct.toFixed(1))}% unit cost`;
    lines.push(
      you?.unitCost !== undefined && Number.isFinite(you.unitCost) && you.unitCost > 0
        ? `${off} — ${you.unitCost} → ${Math.round(you.unitCost * e.unitCost * 100) / 100}`
        : off,
    );
  }

  return lines;
}

/*
 * `lastsFor` lives in `./period` now, with the rest of the period vocabulary, and
 * is re-exported so this stays the one module the market screen imports from. It
 * moved because four other screens had the same bug and were each going to need
 * their own copy of it otherwise.
 */
export { lastsFor } from "./period";

/** "Four years, then it lapses" / "Yours permanently". */
export function lifeRead(
  expiresIn: number | null | undefined,
  period?: { one: string; many: string; of: string },
  periods?: number,
): string {
  if (expiresIn == null) return "Doesn't expire — yours permanently";
  if (expiresIn <= 0) return `Gone at the end of ${period?.of ?? "this year"}`;
  /*
   * "One year, then it lapses", not "1 year" — a sentence spells a leading one,
   * and this is a sentence rather than a label (`lifePill` is the label). The
   * spelling is only ever applied to a leading "1 ", so "12 quarters" and
   * "21 periods" are untouched.
   */
  const lasts = lastsForImpl(expiresIn, period, periods);
  return `${lasts.startsWith("1 ") ? `One ${lasts.slice(2)}` : lasts}, then it lapses`;
}

/** The short version, for a pill beside the name. */
export const lifePill = (
  expiresIn: number | null | undefined,
  period?: { one: string; many: string },
  periods?: number,
): string =>
  expiresIn == null ? "Permanent"
    : expiresIn <= 1 ? `Last ${period?.one ?? "year"}`
    : lastsForImpl(expiresIn, period, periods);

export interface BidCheck {
  ok: boolean;
  /** Why it can't be sent. */
  error: string | null;
  /** Why it might be a bad idea anyway — never a reason to refuse it. */
  warning: string | null;
}

/**
 * Whether a bid can be sent, and what to say about it.
 *
 * The split between `error` and `warning` follows the server exactly, which
 * matters more here than it looks. The route refuses a negative or unparseable
 * amount, and it deliberately *accepts* a bid larger than the company can
 * currently back — the money may well be back by the tick, and refusing it now
 * would leak that it had moved. So overreaching is a warning, in the player's
 * own interest, and never a locked button.
 *
 * Under the reserve is the one local stop. The reserve is printed on the
 * listing and fixed, so such a bid cannot win anything under any circumstance;
 * letting it through would take a number off somebody and give them nothing
 * back for it.
 */
export function validateBid(input: {
  amount: any;
  reserve: number;
  funds: number;
  /** Everything else already bid this year, so one listing doesn't get judged alone. */
  otherBids?: number;
}): BidCheck {
  const { amount, reserve, funds, otherBids = 0 } = input;

  if (amount === undefined || amount === null || amount === "") {
    return { ok: false, error: "How much?", warning: null };
  }
  const n = Number(amount);
  if (!Number.isFinite(n)) return { ok: false, error: "That isn't an amount.", warning: null };
  if (n < 0) return { ok: false, error: "That isn't an amount.", warning: null };
  if (n < reserve) {
    return { ok: false, error: `The reserve is ${Math.round(reserve).toLocaleString()}. Anything under it buys nothing.`, warning: null };
  }

  if (n > funds) {
    return {
      ok: true, error: null,
      warning: "More than the company can back today. The bid stands, but it loses at settlement if the money isn't there.",
    };
  }
  if (otherBids > 0 && n + otherBids > funds) {
    return {
      ok: true, error: null,
      warning: "Your bids now add up to more than the company has. Winning all of them isn't something you can pay for.",
    };
  }
  return { ok: true, error: null, warning: null };
}

/**
 * What is already promised, across every listing.
 *
 * Each bid is judged alone by the server, and a team can quite easily bid the
 * same million three times without noticing. Saying the total out loud is
 * information about your own decisions only — it leaks nothing about anyone
 * else's, which is the line this screen doesn't cross.
 */
export function bidsOutstanding(listings: MarketListing[] | undefined, funds: number): {
  count: number; total: number; overcommitted: boolean; line: string | null;
} {
  const bids = (listings ?? []).map((l) => l.yourBid).filter((b): b is number => b != null && Number.isFinite(b));
  const total = bids.reduce((sum, b) => sum + b, 0);
  const overcommitted = total > funds;

  return {
    count: bids.length,
    total,
    overcommitted,
    line: bids.length === 0 ? null
      : overcommitted
        ? `${bids.length} bid${bids.length === 1 ? "" : "s"} out, ${Math.round(total).toLocaleString()} in total — more than the ${Math.round(funds).toLocaleString()} behind them. Win them all and some of it won't clear.`
        : `${bids.length} bid${bids.length === 1 ? "" : "s"} out, ${Math.round(total).toLocaleString()} of ${Math.round(funds).toLocaleString()} committed.`,
  };
}

/** Selling what the company owns is the chief executive's or the finance seat's call. */
export const canSell = (role: string | null | undefined): boolean => role === "ceo" || role === "cfo";

/**
 * Who may bid.
 *
 * A bid is the company's — one per listing per year, sealed, spending money
 * the whole table is counting on — so it is filed by the chair that answers
 * for the company's money. Everyone else sees the bid and what it would buy.
 * Mirrors the check in server/simulation-market-routes.ts.
 */
export const canBid = (role: string | null | undefined): boolean => role === "ceo";

/**
 * Whether a reserve can be set, and whether it is a sensible one.
 *
 * `willingSale` is what the engine says an unforced sale is worth, and it is
 * the honest anchor: a reserve above it is allowed — the seller names their
 * price and the market answers — but a seller who has not been told they are
 * above the going rate will read "nobody met it" as the market being broken
 * rather than as the answer it is.
 */
export function validateReserve(input: { reserve: any; willingSale: number }): BidCheck {
  const { reserve, willingSale } = input;
  if (reserve === undefined || reserve === null || reserve === "") {
    return { ok: false, error: "Set a reserve.", warning: null };
  }
  const n = Number(reserve);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Set a reserve.", warning: null };
  if (n > willingSale) {
    return {
      ok: true, error: null,
      warning: `Above the ${Math.round(willingSale).toLocaleString()} an unforced sale usually fetches. Nobody is obliged to meet it.`,
    };
  }
  return { ok: true, error: null, warning: null };
}

/**
 * What a holding is worth in the two situations a company sells in.
 *
 * Both numbers, always, and the gap between them named. The discount on a
 * forced sale is the entire cost of getting into trouble
 * (shared/simulation/assets.ts says why), and a team deciding whether to sell
 * now or hold on is deciding precisely between these two figures.
 */
export function saleRead(holding: Pick<Holding, "willingSale" | "forcedSale" | "bookValue">): {
  discount: number; line: string;
} {
  const willing = Math.max(0, holding.willingSale);
  const forced = Math.max(0, holding.forcedSale);
  const discount = willing > 0 ? 1 - forced / willing : 0;
  return {
    discount,
    line: willing <= 0
      ? "Worth nothing on the market now."
      : `${Math.round(discount * 100)}% less if you're selling because you have to.`,
  };
}

// --- How the market went -------------------------------------------------

/**
 * The other half of a sealed bid: being told what happened to it.
 *
 * A bid commits money on a Tuesday and settles on a Wednesday, and until the
 * player is told, the mechanic is a number that vanished. The engine tells
 * them — `settleMarket` in server/simulation-tick.ts writes an outcome per
 * team, and the tick hangs it on that year's report — so it arrives as
 * `lastYear.market` on the next desk load, already typed.
 *
 * There is nothing to parse here and there should never be again. An earlier
 * version of this file matched the outcome out of the report's prose, which
 * worked exactly until somebody edited a sentence; the field exists so neither
 * client has to.
 */
export type MarketOutcome = ReportMarketNote["kind"];

/**
 * The headline over the outcomes, which is the part a player reads first.
 *
 * Winning something and losing everything you bid on are the same length of
 * list and completely different news, so the summary says which it was rather
 * than counting rows.
 */
export function marketNotesRead(market: ReportMarketNote[] | undefined): string {
  const outcomes = market ?? [];
  if (outcomes.length === 0) return "";

  const won = outcomes.filter((m) => m.kind === "won").length;
  const sold = outcomes.filter((m) => m.kind === "sold").length;
  const lost = outcomes.filter((m) => m.kind === "lost").length;

  const parts: string[] = [];
  if (won > 0) parts.push(won === 1 ? "You won one" : `You won ${won}`);
  if (sold > 0) parts.push(sold === 1 ? "sold one" : `sold ${sold}`);
  if (won === 0 && sold === 0 && lost > 0) parts.push(lost === 1 ? "Your bid didn't take it" : "None of your bids took");

  return parts.length === 0 ? "Nothing changed hands." : `${parts.join(" and ")}.`;
}
