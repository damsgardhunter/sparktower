/**
 * Buying another team's company.
 *
 * ## The question this whole file answers
 *
 * What happens to the five people whose company gets bought?
 *
 * The obvious answer — they are out, the acquirer absorbed them — is the worst
 * thing this simulation could do. The brief was explicit that running out of
 * money must not end a season, and being bought is the same problem wearing a
 * better suit: five people with nine days left and nothing to open. Worse than
 * bankruptcy, in fact, because somebody else chose it for them.
 *
 * So an acquisition here buys the *business*, not the people. Customers,
 * assets and debts change hands. What the acquired team keeps is the company
 * shell, their seats, their reputation, and a large amount of cash — and they
 * carry on, small and rich, in a market where the company that just bought
 * them is now the thing to beat.
 *
 * That turns being acquired from an elimination into a decision: cash out of a
 * position you cannot defend, and rebuild with more money than anyone else has
 * got. Selling can be the right move. A team that takes it is still playing on
 * day fourteen, which is the only test that matters.
 *
 * ## Nobody is bought against their will
 *
 * Every offer needs the target's agreement. A hostile takeover would be a
 * mechanic that takes a fortnight of somebody's decisions away from them
 * without asking, and no amount of drama pays for that.
 *
 * ## What stops one team buying everybody
 *
 * Nothing artificial — the existing mechanics already do it. A company is
 * priced on what it earns, so buying one is genuinely expensive; the cash goes
 * out of the money you need to run your own year; the debts come with it; and
 * the customers you just bought need capacity you may not have, which turns
 * them away and costs you the reputation you were building. An acquirer who
 * over-reaches is the most vulnerable company in the market, and everybody can
 * see them.
 */
import type { Company, Segment } from "./types";
import { takings } from "./responsibilities";

export type OfferKind = "acquire";
export type OfferStatus = "pending" | "accepted" | "declined" | "lapsed" | "withdrawn";

export interface Valuation {
  /** A year of sales at the current price and customer count. */
  revenue: number;
  /** What the things it owns would fetch from a willing buyer. */
  assets: number;
  /** Debt the buyer takes on with the business. */
  debt: number;
  /** A defensible asking price, before anyone argues. */
  fair: number;
  /** The reasoning, in the words both sides will argue in. */
  notes: string[];
}

/**
 * What a company is worth, as a number both sides can see.
 *
 * Published to buyer and seller alike, deliberately. A negotiation where only
 * one side can do the arithmetic is not a negotiation, it is a trick played on
 * whoever is newer to the game — and the interesting argument is not "what is
 * it worth" but "what is it worth *to you*", which only starts once the boring
 * part is settled.
 *
 * It is a reference, not a price. Offers above and below it are both perfectly
 * sensible: a company that fits what you already have is worth more to you
 * than to anybody else, and a team that wants out will take less.
 */
export function valuation(company: Company): Valuation {
  const customers = Object.values(company.customers).reduce((sum, n) => sum + n, 0);
  /*
   * What the customers actually pay, tier by tier. Only the segments the
   * company holds or prices matter, and a free tier's advertising is left out
   * of a buyer's arithmetic — it is the part nobody can count on.
   */
  const segmentIds = Array.from(new Set([...Object.keys(company.customers), ...Object.keys(company.tiers ?? {})]));
  const revenue = company.tiers
    ? takings(company, company.customers, segmentIds.map((id) => ({ id, referencePrice: 0 }) as Segment)).revenue
    : customers * company.price;
  const assets = company.assets.reduce((sum, a) => sum + a.bookValue * 0.8, 0);
  const debt = company.debt;

  /*
   * Just over a year of sales, plus what it owns, minus what it owes. A crude
   * multiple on purpose: every player can work it out in their head and argue
   * with it, which is worth more here than a number that is defensible and
   * opaque.
   */
  const fair = Math.max(0, Math.round(revenue * 1.2 + assets - debt));

  const notes: string[] = [];
  notes.push(company.tiers
    ? `${customers.toLocaleString()} customers across its price tiers is ${Math.round(revenue).toLocaleString()} a year.`
    : `${customers.toLocaleString()} customers at ${Math.round(company.price)} is ${Math.round(revenue).toLocaleString()} a year.`);
  if (assets > 0) notes.push(`What it owns would fetch about ${Math.round(assets).toLocaleString()}.`);
  if (debt > 0) notes.push(`It owes ${Math.round(debt).toLocaleString()}, and that comes with it.`);
  if (company.bankruptSince !== undefined) {
    notes.push("It is insolvent, which is why it is cheap and why it may not be a bargain.");
  }
  if (customers === 0) notes.push("It has no customers yet. You would be buying the shell and whatever it owns.");

  return { revenue, assets, debt, fair, notes };
}

export type OfferRefusal =
  | "self" | "not_a_team" | "cannot_afford" | "already_pending" | "season_ending";

/**
 * Whether an offer can be made at all.
 *
 * The affordability check is against cash and credit together, and it is a
 * real refusal rather than a warning — unlike a sealed bid, an offer is a
 * promise made to another team who will spend a day deciding about it. Letting
 * somebody dangle a number they were never able to pay wastes the one thing
 * this game is short of, which is the other players' attention.
 */
export function canOffer(input: {
  from: Company;
  to: Company;
  amount: number;
  pendingFrom: number;
  year: number;
  totalYears: number;
}): { ok: true } | { ok: false; reason: OfferRefusal; message: string } {
  const { from, to, amount, pendingFrom, year, totalYears } = input;

  if (from.id === to.id) {
    return { ok: false, reason: "self", message: "You already own that one." };
  }
  if (to.kind !== "player") {
    return {
      ok: false, reason: "not_a_team",
      message: "The incumbents are not for sale. They were here before you and they intend to be here after.",
    };
  }
  if (pendingFrom > 0) {
    return {
      ok: false, reason: "already_pending",
      message: "You have an offer on the table already. Withdraw it before making another.",
    };
  }
  /*
   * An acquisition in the final year would land after the last result, which
   * is a purchase nobody gets to play with — money spent for a number on a
   * league table rather than for a company to run.
   */
  if (year >= totalYears) {
    return {
      ok: false, reason: "season_ending",
      message: "Too late in the season. Anything bought now would never trade a single year.",
    };
  }

  const reach = from.cash + Math.max(0, from.creditLimit - from.debt);
  if (amount > reach) {
    return {
      ok: false, reason: "cannot_afford",
      message: `You can reach ${Math.round(reach).toLocaleString()}, counting credit. An offer you cannot pay is a day of somebody else's time.`,
    };
  }

  return { ok: true };
}

/** How an offer reads against what the company is worth — shown to the team deciding. */
export function assessOffer(amount: number, target: Company): {
  fair: number;
  ratio: number;
  verdict: "generous" | "fair" | "low" | "insulting";
  note: string;
} {
  const { fair } = valuation(target);
  const ratio = fair > 0 ? amount / fair : amount > 0 ? 2 : 1;

  const verdict = ratio >= 1.35 ? "generous" : ratio >= 0.9 ? "fair" : ratio >= 0.6 ? "low" : "insulting";
  const note =
    verdict === "generous" ? "Well above what the business is worth on paper. They want something you have."
    : verdict === "fair" ? "About what it is worth. The question is whether you would rather have the money or the company."
    : verdict === "low" ? "Below what it is worth. Worth a conversation before a yes."
    : "Barely a gesture. They are hoping you are tired.";

  return { fair, ratio, verdict, note };
}

export interface AcquisitionOutcome {
  buyer: Company;
  seller: Company;
  /** Said to the buyer. */
  buyerNotes: string[];
  /** Said to the seller. */
  sellerNotes: string[];
}

/**
 * Carry out an agreed acquisition.
 *
 * The buyer takes the business: customers, assets, and the debts that came
 * with them. The seller takes the money and keeps everything that makes them a
 * company — their seats, their name, their reputation, their capacity to build
 * again. They are not removed from anything.
 */
export function applyAcquisition(input: { buyer: Company; seller: Company; amount: number; year?: number }): AcquisitionOutcome {
  const { buyer, seller, amount, year } = input;
  const customers = Object.values(seller.customers).reduce((sum, n) => sum + n, 0);

  const combined: Record<string, number> = { ...buyer.customers };
  for (const [segment, n] of Object.entries(seller.customers)) {
    combined[segment] = (combined[segment] ?? 0) + n;
  }

  /*
   * Paid from cash first, and the rest on credit — the way a marketplace win
   * is settled (see settleMarket in server/simulation-tick.ts).
   *
   * The whole price used to come out of cash. A buyer the tick had just
   * checked could afford it — cash plus undrawn credit — was left overdrawn
   * instead of borrowed, and the engine reads negative cash as a company that
   * cannot pay its bills: it took out an emergency loan on their behalf, at
   * the emergency rate, with the credit score hit that goes with it. The
   * credit line the purchase was approved against went unused, and the team
   * was punished for a deal the game had told them they could make.
   */
  const fromCash = Math.min(Math.max(0, buyer.cash), amount);
  const borrowed = amount - fromCash;

  const buyerAfter: Company = {
    ...buyer,
    cash: buyer.cash - fromCash,
    debt: buyer.debt + seller.debt + borrowed,
    customers: combined,
    assets: [...buyer.assets, ...seller.assets],
  };

  const sellerAfter: Company = {
    ...seller,
    cash: seller.cash + amount,
    debt: 0,
    customers: {},
    assets: [],
    // Solvent again, by definition: they have just been paid.
    bankruptSince: undefined,
    // Remembered, so nobody mistakes a company that sold for one that has not
    // started — the two look identical on paper.
    soldBusinessIn: year,
  };

  const buyerNotes = [
    `Bought ${seller.name} for ${Math.round(amount).toLocaleString()}: ${customers.toLocaleString()} customers, ${seller.assets.length} asset${seller.assets.length === 1 ? "" : "s"}, and ${Math.round(seller.debt).toLocaleString()} of their debt.`,
  ];
  /*
   * The warning that makes the whole thing a decision rather than a purchase.
   * Customers bought are customers who have to be served, and an acquirer who
   * cannot serve them turns them away — which costs reputation, in public, at
   * the exact moment everyone is looking at them.
   */
  if (customers > buyerAfter.capacity) {
    buyerNotes.push(
      `You now hold more customers than you can serve — ${customers.toLocaleString()} arrived and capacity is ${buyerAfter.capacity.toLocaleString()}. Operations have a year to fix that, or a lot of people find out what you are like.`,
    );
  }

  const sellerNotes = [
    `Sold the business to ${buyer.name} for ${Math.round(amount).toLocaleString()}. The customers, what you owned and what you owed all went with it.`,
    `What you keep: the company, every seat, your reputation, and more cash than anybody else in this market. Nobody has taken you out of the season — you are starting again, from in front.`,
  ];

  return { buyer: buyerAfter, seller: sellerAfter, buyerNotes, sellerNotes };
}

/**
 * A company that has already sold its business, and has not rebuilt one yet.
 *
 * The obvious test — no customers and nothing owned — is also the exact
 * description of a company on its first day, so in year one the boardroom
 * declared every team in the market already sold and offered nobody for sale
 * at all. The difference between "has nothing left" and "has not started yet"
 * cannot be read off the balance sheet; it has to be remembered, which is what
 * `soldBusinessIn` is for.
 *
 * It lapses the moment they win a customer back, because a team that has
 * rebuilt is a target again — and being approached twice in a season is a
 * perfectly reasonable thing to happen to somebody who sold and started over.
 */
export const alreadySold = (company: Company): boolean =>
  company.soldBusinessIn !== undefined &&
  Object.values(company.customers).reduce((sum, n) => sum + n, 0) === 0 &&
  company.assets.length === 0;
