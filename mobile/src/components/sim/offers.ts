/**
 * Buying another team's company, and being asked to sell your own.
 *
 * Mirrors shared/simulation/mergers.ts and the responses of the four offer
 * routes in server/simulation-market-routes.ts, restated here rather than
 * imported for the reason desk.ts gives at length — Metro cannot resolve the
 * web app's `@shared` alias — with the source file named above anything
 * copied.
 *
 * ## The one thing this file exists to keep straight
 *
 * An acquisition here buys the *business*, not the people. When an offer is
 * accepted the customers, the assets and the debts move to the buyer; the
 * seller takes the cash and keeps the company, every seat, their reputation
 * and their capacity to build again. They are still playing on day fourteen,
 * with more money than anybody else in the market.
 *
 * So nothing in this module — no label, no verdict, no warning — may read like
 * an elimination. Selling is a legitimate move: cash out of a position you
 * cannot defend and rebuild from in front. The server says this better than a
 * paraphrase would, which is why the sentences below are the server's own and
 * are quoted rather than summarised.
 *
 * ## And the second thing
 *
 * Every offer needs the target's consent. There are no hostile takeovers, and
 * only the target's chief executive can answer one. A screen that implied
 * otherwise — a countdown that "expires into a yes", an offer that looks
 * binding the moment it lands — would be describing a different game.
 */
import { colors } from "../../theme";
import type { Distress, DeskRole } from "./desk";
import { seasonOver, type SeasonStatus } from "./lobby";

/** Mirrors OfferStatus in shared/simulation/mergers.ts. */
export type OfferStatus = "pending" | "accepted" | "declined" | "lapsed" | "withdrawn";

/** Mirrors the verdicts `assessOffer` returns in shared/simulation/mergers.ts. */
export type OfferVerdict = "generous" | "fair" | "low" | "insulting";

/** Mirrors Valuation in shared/simulation/mergers.ts. */
export interface Valuation {
  /** A year of sales at the current price and customer count. */
  revenue: number;
  /** What the things it owns would fetch from a willing buyer. */
  assets: number;
  /** Debt the buyer takes on with the business. */
  debt: number;
  /** A defensible asking price, before anyone argues. */
  fair: number;
  /** The reasoning, published to both sides on purpose. */
  notes: string[];
}

/** `you` from GET /api/sim/ventures/:id/offers: what your own company is worth. */
export interface YourValuation extends Valuation {
  name: string;
  /**
   * How many customers this company can actually serve.
   *
   * On the payload because it is the real constraint on buying anybody:
   * customers bought have to be served, and an acquirer who cannot serve them
   * turns them away, which costs reputation in public at the moment everybody
   * is looking. Without it this screen can only warn about money, which is
   * never the mistake that hurts.
   */
  capacity: number;
  /** How many you hold now, so an arriving crowd can be added to it. */
  customers: number;
}

/** One row of `targets`: a company you could make an offer for. */
export interface OfferTarget extends Valuation {
  id: string;
  name: string;
  customers: number;
  /** Visible because solvency is the thing everyone can see in a market. */
  distress: Distress | null;
  /** They have already sold the business to somebody — there is nothing left to buy. */
  hollow: boolean;
}

/** One row of `made`: an offer you have put on somebody else's table. */
export interface MadeOffer {
  id: string;
  to: string;
  toId: string;
  amount: number;
  message: string | null;
  status: OfferStatus;
}

/** One row of `received`: an offer for your company, already assessed by the server. */
export interface ReceivedOffer {
  id: string;
  from: string;
  fromId: string;
  amount: number;
  message: string | null;
  status: OfferStatus;
  /** What the server says your company is worth, so the amount has a scale. */
  fair: number;
  ratio: number;
  verdict: OfferVerdict;
  /** The server's sentence about this verdict. Shown, never paraphrased. */
  note: string;
}

export interface OffersView {
  year: number;
  totalYears: number;
  /**
   * The seat this person holds. Offering and answering are the chief
   * executive's. Typed as the seat union the desk already uses — the route
   * sends the same `seat.role` the desk does — while every check against it
   * still accepts a bare string, so an unknown seat is simply not the chair
   * rather than a type error on the phone.
   */
  yourRole: DeskRole | null;
  resolvesAt: string | null;
  /** Where the season is. A finished one has no decisions left in it. */
  status: SeasonStatus | string;
  you: YourValuation;
  /** Cash plus available credit — what an offer can actually be backed by. */
  reach: number;
  targets: OfferTarget[];
  made: MadeOffer[];
  received: ReceivedOffer[];
}

/** What POST /api/sim/ventures/:id/offers/:offerId/respond answers with. */
export interface OfferResponseResult {
  ok: boolean;
  status: OfferStatus;
  /** The server's own sentence about what was just agreed. Shown as sent. */
  message: string;
}

/** The refusal codes POST /api/sim/ventures/:id/offers returns in `code`. */
export type OfferRefusal = "self" | "not_a_team" | "cannot_afford" | "already_pending" | "season_ending";

/**
 * Offering, and answering an offer, are the chief executive's.
 *
 * Both routes answer 403 `not_ceo` to anybody else, and a screen that offered
 * a control the server will refuse is a screen teaching four people out of
 * five to distrust its buttons. Everything is *shown* to all five — the
 * argument about whether to sell is the whole point and it does not belong to
 * one seat — but only the chair acts.
 */
export const canTrade = (role: DeskRole | string | null | undefined): boolean => role === "ceo";

/** How a verdict reads, and the colour it carries. */
export const VERDICT_COPY: Record<OfferVerdict, { label: string; color: string }> = {
  generous: { label: "Generous", color: colors.success },
  fair: { label: "Fair", color: colors.info },
  low: { label: "Low", color: colors.warning },
  insulting: { label: "Insulting", color: colors.danger },
};

/** The same, safe against a verdict this build hasn't heard of. */
export function verdictRead(verdict: OfferVerdict | string): { label: string; color: string } {
  return VERDICT_COPY[verdict as OfferVerdict] ?? { label: String(verdict), color: colors.textSecondary };
}

/**
 * The amount against what the company is worth, as a sentence.
 *
 * `ratio` is the server's — amount over fair — and the phone only says it out
 * loud. Two decisions in here matter. Anything inside a couple of per cent is
 * "about what it's worth" rather than "2% above", because a negotiation
 * conducted to the nearest percentage point is a negotiation about the wrong
 * thing. And the direction is always named: "40%" alone, on a screen where
 * both halves of the trade are looking at the same number, is the kind of
 * ambiguity that gets a company sold by accident.
 */
export function ratioRead(ratio: number): string {
  if (!Number.isFinite(ratio)) return "Hard to compare to what it's worth.";
  const pct = Math.round(Math.abs(1 - ratio) * 100);
  if (pct <= 2) return "About what the business is worth on paper.";
  return ratio > 1
    ? `${pct}% above what the business is worth on paper.`
    : `${pct}% below what the business is worth on paper.`;
}

/**
 * What a status means, said from the side of the table you are sitting on.
 *
 * The same word means two different things to the two companies: `accepted` is
 * "you bought it" to one of them and "you sold it" to the other, and a single
 * neutral label would be the least useful sentence on the screen. `live` is
 * what the buttons key off — exactly one status can still be acted on.
 */
export function offerStatusRead(status: OfferStatus | string, side: "made" | "received"): {
  label: string; line: string; live: boolean; color: string;
} {
  const made = side === "made";
  switch (status) {
    case "pending":
      return {
        label: "On the table",
        line: made
          ? "Waiting on their chief executive. You can revise it or take it back until they answer."
          : "Waiting on you. Nothing happens to your company unless you say yes.",
        live: true,
        color: colors.warning,
      };
    case "accepted":
      return {
        label: "Accepted",
        line: made
          ? "Agreed. Their customers, assets and debts come to you when the year resolves."
          : "Agreed. The business changes hands when the year resolves — you keep the company, every seat, your reputation and the money.",
        live: false,
        color: colors.success,
      };
    case "declined":
      return {
        label: "Declined",
        line: made ? "They said no. You can make a different offer." : "You said no. Nothing changed hands.",
        live: false,
        color: colors.textSecondary,
      };
    case "lapsed":
      return {
        label: "Lapsed",
        line: "The year resolved with nobody having answered, so it stopped being an offer.",
        live: false,
        color: colors.textTertiary,
      };
    case "withdrawn":
      return {
        label: "Withdrawn",
        line: made ? "You took it back off their table." : "They took it back off the table.",
        live: false,
        color: colors.textTertiary,
      };
    default:
      return { label: String(status), line: "", live: false, color: colors.textTertiary };
  }
}

/** Exactly one status can still be acted on, and both screens ask this rather than the string. */
export const isLive = (status: OfferStatus | string): boolean => status === "pending";

/** The ones still waiting on somebody, either way round. */
export const liveOffers = <T extends { status: OfferStatus }>(offers: T[] | undefined): T[] =>
  (offers ?? []).filter((o) => isLive(o.status));

/**
 * What the seller keeps, in the server's own words.
 *
 * Mirrors the `sellerNotes` in `applyAcquisition` (shared/simulation/mergers.ts)
 * and the accept message in POST /api/sim/ventures/:id/offers/:offerId/respond.
 * Quoted rather than rewritten, because these are the two sentences that decide
 * whether somebody reads accepting as a strategy or as being knocked out, and
 * the engine is where they are maintained.
 */
export const KEEP_LINES = [
  "The company, and every seat at this table.",
  "Your reputation, and the capacity you built.",
  "The money — more cash than anybody else in this market.",
] as const;

/**
 * What the money does *not* do, which is sit there.
 *
 * The proceeds land and then the year runs: the salary bill still goes out,
 * and a table that files nothing still spends the opening defaults — on a
 * company with no customers to earn any of it back. A team that sells ends the
 * year holding a great deal of cash and no debt at all, and slightly down on
 * where they started.
 *
 * Worth saying out loud in the panel, because "you keep the money" invites
 * "so we will be richer next year", and that is the one part of this which
 * isn't true. Being ahead on cash is the position; it is not an income.
 */
export const MONEY_IS_A_POSITION_NOT_AN_INCOME =
  "It isn't a cushion that grows. The year still runs after the money lands — salaries and whatever is already committed go out of a company with no customers — so you end it a little down on where you started, with no debt and more cash than anyone else in the market.";

/** The sentence that has to survive any redesign of this screen. */
export const NOT_AN_ELIMINATION =
  "Nobody has taken you out of the season — you are starting again, from in front.";

/** And what actually leaves, so the trade is stated in full before a yes. */
export const GOES_WITH_THE_BUSINESS =
  "The customers, what you own and what you owe all go with it when the year resolves.";

/**
 * Whether you could actually serve the customers you are about to buy.
 *
 * This is the mistake the mechanic punishes hardest and the one an asking
 * price says nothing about. `applyAcquisition` hands the buyer every customer
 * the seller had; anybody beyond capacity is turned away, and being turned
 * away costs reputation in public, in the year when everybody is already
 * watching the company that just bought somebody. An acquirer who over-reaches
 * is the most vulnerable company in the market.
 *
 * Both numbers are returned as well as the sentence, so a screen can show the
 * arithmetic beside the warning rather than asking anyone to take it on faith.
 */
export function serviceGap(input: {
  you: Pick<YourValuation, "capacity" | "customers"> | null | undefined;
  target: Pick<OfferTarget, "customers">;
}): { held: number; capacity: number; short: number; over: boolean; line: string | null } {
  const { you, target } = input;
  const capacity = Number.isFinite(you?.capacity) ? Number(you?.capacity) : Number.NaN;
  const yours = Number.isFinite(you?.customers) ? Number(you?.customers) : Number.NaN;
  const arriving = Number.isFinite(target.customers) ? Math.max(0, target.customers) : 0;

  // Without the server's figures there is nothing honest to say, and a
  // reassuring guess here would be worse than silence.
  if (!Number.isFinite(capacity) || !Number.isFinite(yours)) {
    return { held: arriving, capacity: 0, short: 0, over: false, line: null };
  }

  const held = Math.max(0, yours) + arriving;
  const short = Math.max(0, held - capacity);

  return {
    held,
    capacity,
    short,
    over: short > 0,
    line: short > 0
      ? `You would hold ${held.toLocaleString()} customers and can serve ${capacity.toLocaleString()}. ${short.toLocaleString()} of them get turned away — in public, and it costs reputation. Operations have a year to fix that.`
      : `You would hold ${held.toLocaleString()} customers and can serve ${capacity.toLocaleString()}. Everybody who arrives gets served.`,
  };
}

export interface OfferCheck {
  ok: boolean;
  /** Why it can't be sent. Mirrors a refusal the server would make. */
  error: string | null;
  /** Why it might be a bad idea anyway — never a reason to refuse it. */
  warning: string | null;
}

/**
 * Whether an offer can be made, and what to say instead.
 *
 * Mirrors the checks in `canOffer` (shared/simulation/mergers.ts) in the order
 * the route applies them, so the reason shown before the request is the reason
 * that would have come back from it.
 *
 * The affordability check is a real refusal here, unlike the market's sealed
 * bid, and the difference is worth keeping: a bid is a number in a box, while
 * an offer is a promise made to five other people who will spend a day
 * deciding about it. Dangling one you could never pay spends their attention,
 * which is the thing this game is shortest of.
 *
 * Price is never a refusal. A low offer is allowed to be sent and allowed to
 * be insulting — the target sees the verdict and answers accordingly — so a
 * cheeky number gets a warning and a live button.
 */
export function validateOffer(input: {
  amount: any;
  reach: number;
  target: OfferTarget | null;
  role: DeskRole | string | null;
  year: number;
  totalYears: number;
  /** A live offer of yours already on somebody *else's* table. */
  pendingElsewhere?: MadeOffer | null;
  /** Your own capacity and customer count, for the warning that matters. */
  you?: Pick<YourValuation, "capacity" | "customers"> | null;
  /** The season's status: a finished one has no decisions left in it. */
  status?: SeasonStatus | string;
}): OfferCheck {
  const { amount, reach, target, role, year, totalYears, pendingElsewhere = null, you = null, status } = input;

  if (seasonOver(status)) {
    return { ok: false, error: "The season is over. Nothing changes hands now.", warning: null };
  }

  if (!canTrade(role)) {
    return { ok: false, error: "Buying another company is the chief executive's call.", warning: null };
  }
  if (!target) return { ok: false, error: "Who for?", warning: null };
  if (target.hollow) {
    return {
      ok: false,
      error: "They have already sold the business. There is nothing left to buy — the shell, the seats and the money are theirs.",
      warning: null,
    };
  }
  if (pendingElsewhere) {
    return {
      ok: false,
      // An agreed purchase cannot be withdrawn, so telling somebody to do so
      // would send them looking for a button that is not there.
      error: pendingElsewhere.status === "accepted"
        ? `${pendingElsewhere.to} has already agreed to sell to you this year. One purchase a year — the next can wait until it completes.`
        : `You have an offer on ${pendingElsewhere.to}'s table already. Withdraw it before making another.`,
      warning: null,
    };
  }
  if (year >= totalYears) {
    return {
      ok: false,
      error: "Too late in the season. Anything bought now would never trade a single year.",
      warning: null,
    };
  }

  if (amount === undefined || amount === null || amount === "") {
    return { ok: false, error: "How much?", warning: null };
  }
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "That isn't an amount.", warning: null };

  if (n > reach) {
    return {
      ok: false,
      error: `You can reach ${Math.round(reach).toLocaleString()}, counting credit. An offer you cannot pay is a day of somebody else's time.`,
      warning: null,
    };
  }

  /*
   * Capacity before price, when both apply.
   *
   * A cheap offer that gets refused costs a day. An affordable offer that
   * doubles your customers and leaves half of them queuing costs the
   * reputation the whole company is built on, in public, and cannot be undone
   * by revising anything. The more expensive mistake gets the one warning
   * slot.
   */
  const service = serviceGap({ you, target });
  if (service.over) {
    return { ok: true, error: null, warning: service.line };
  }

  const ratio = target.fair > 0 ? n / target.fair : n > 0 ? 2 : 1;
  if (ratio < 0.6) {
    return {
      ok: true, error: null,
      warning: "Well under what it is worth. They will see exactly that, and they are allowed to say no and remember it.",
    };
  }
  return { ok: true, error: null, warning: null };
}

/**
 * What buying this one would leave you holding.
 *
 * Both numbers said plainly before the offer goes out: the customers arriving
 * and the debt arriving with them. `applyAcquisition` hands the buyer the
 * seller's debts along with their business, and a buyer who only read the
 * asking price finds that out a day later, on the tick, in public.
 */
export function purchaseRead(target: OfferTarget, amount: number): string[] {
  const lines: string[] = [];
  lines.push(`${Math.round(target.customers).toLocaleString()} customers come with it, and they have to be served.`);
  if (target.debt > 0) {
    lines.push(`So does ${Math.round(target.debt).toLocaleString()} of their debt — on top of the ${Math.round(amount).toLocaleString()} you would pay.`);
  }
  if (target.assets > 0) {
    lines.push(`What they own comes too, worth about ${Math.round(target.assets).toLocaleString()}.`);
  }
  return lines;
}

/**
 * The offer you have out this year, if any — waiting on an answer, or agreed.
 *
 * One at a time is the server's rule (`already_pending`), and the server
 * counts an *accepted* offer as well as a pending one
 * (POST /api/sim/ventures/:id/offers in server/simulation-market-routes.ts):
 * nothing changes hands until the tick, so an acceptance must not free the
 * money up for a second purchase. This used to find pending offers only, so
 * the moment a seller said yes the phone offered the CEO every other target
 * again and the server refused each one with a 409.
 *
 * A pending one wins if somehow both exist, since it is the one that can
 * still be acted on. Still a `find` rather than a filter: a screen that
 * showed two would be showing a state the engine cannot produce.
 */
export const outstandingOffer = (made: MadeOffer[] | undefined): MadeOffer | null =>
  (made ?? []).find((o) => isLive(o.status)) ?? (made ?? []).find((o) => o.status === "accepted") ?? null;

/**
 * The order to read targets in.
 *
 * Whoever is in trouble first, because a strained company is the one most
 * likely to want out, then by size. The hollow ones sink to the bottom rather
 * than disappearing: a team that sold up is still in the season, and quietly
 * dropping them off this list is the exact implication the whole feature is
 * written to avoid.
 */
export function sortTargets(targets: OfferTarget[] | undefined): OfferTarget[] {
  const rank: Record<string, number> = { insolvent: 0, distressed: 1, strained: 2, healthy: 3 };
  return [...(targets ?? [])].sort((a, b) => {
    if (a.hollow !== b.hollow) return a.hollow ? 1 : -1;
    const ra = rank[a.distress ?? "healthy"] ?? 3;
    const rb = rank[b.distress ?? "healthy"] ?? 3;
    if (ra !== rb) return ra - rb;
    return b.customers - a.customers;
  });
}

/** How another team's position reads on a card about buying them. */
export const DISTRESS_NOTE: Record<Distress, string | null> = {
  healthy: null,
  strained: "Stretched. Not much between them and a bad year.",
  distressed: "In trouble. Less than a year of costs within reach.",
  insolvent: "Insolvent — which is why they are cheap, and why they may not be a bargain.",
};
