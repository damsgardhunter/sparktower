/**
 * A marketplace for simulations people write.
 *
 * `shared/simulation/custom-market.ts` already lets Nova write a market for one
 * business — its segments, its regions, the companies already in it — and
 * `sim_seasons` already runs one privately for a company. What has never
 * existed is a way for the person who wrote one to let anybody else play it,
 * or to be paid when they do.
 *
 * ## What is being sold
 *
 * Not the season and not the software: a *market*, plus the settings that make
 * it a particular contest — how often the table decides, how good the rivals
 * are, whether companies open funded or on the balance sheet the work has
 * earned. Two people buying the same listing get their own seasons from it,
 * which is why a sale is a licence to run one rather than access to a room.
 *
 * ## Why a seat is the unit
 *
 * Because that is how the thing is used. A simulation is played by a table,
 * the table is the point, and a lobby of six costs its host six seats whether
 * they come one at a time or in a block. Pricing per seat also makes the free
 * tier honest: free means free for every seat, not a trial that stops at four.
 *
 * ## Why money moves through the wallet
 *
 * The buyer already has a balance they topped up through Stripe, and
 * `creditEarnings` already pays a person for something the platform owes them,
 * keyed so a retry cannot pay twice. Reusing both means a sale is one spend
 * and one credit inside the ledger everybody can already read, rather than a
 * second money system living beside the first.
 */

/** How a listing charges, which is the only pricing question a seller answers. */
export const LISTING_PRICING = ["free", "perSeat"] as const;
export type ListingPricing = (typeof LISTING_PRICING)[number];

/** Where a listing is in its life. Only `listed` is visible to anybody else. */
export const LISTING_STATUSES = ["draft", "listed", "unlisted"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/**
 * What a seat may cost, in cents.
 *
 * The floor exists because a price below it costs more to move than it is
 * worth: the platform's own seat is 300, and a listing at 20 cents is a
 * rounding error that still has to be charged, recorded and paid out. The
 * ceiling is not about what a simulation is worth — some are worth far more —
 * it is about what somebody can be charged by accident. A seller who wants
 * more than this is selling to a company and should be talking to them.
 */
export const SEAT_PRICE_MIN_CENTS = 100;
export const SEAT_PRICE_MAX_CENTS = 5000;

/**
 * The platform's share of a sale, in percent.
 *
 * Fifteen, which is the low end of what app stores take and the high end of
 * what a marketplace can justify when it is also running the thing being sold:
 * every sale here is a season this platform hosts, ticks for fourteen years,
 * and serves to a table. It is a number the owner will want to change, so it
 * lives here rather than in the four places that would otherwise compute it.
 */
export const PLATFORM_SHARE_PERCENT = 15;

/** What the seller is owed and what the platform keeps, from one sale. */
export function splitSale(totalCents: number): { platformCents: number; sellerCents: number } {
  if (totalCents <= 0) return { platformCents: 0, sellerCents: 0 };
  /*
   * The platform's share is rounded down, so a rounding remainder always goes
   * to the seller. A penny either way does not matter once; it matters that it
   * is never the house that gains it.
   */
  const platformCents = Math.floor((totalCents * PLATFORM_SHARE_PERCENT) / 100);
  return { platformCents, sellerCents: totalCents - platformCents };
}

/** What a number of seats costs at a listing's price. */
export function seatsCost(pricing: ListingPricing, seatPriceCents: number, seats: number): number {
  if (pricing === "free") return 0;
  return Math.max(0, Math.round(seatPriceCents * Math.max(0, Math.floor(seats))));
}

export type ListingProblem = { field: string; message: string };

/**
 * What is wrong with a listing before anybody can see it.
 *
 * Checked at publish rather than at save, because a draft is somebody thinking
 * and a listing is a promise. The messages name the field so a form can put
 * them under the right input.
 */
export function checkListing(input: {
  title?: string | null;
  summary?: string | null;
  pricing?: string | null;
  seatPriceCents?: number | null;
  hasMarket?: boolean;
}): ListingProblem[] {
  const problems: ListingProblem[] = [];
  const title = input.title?.trim() ?? "";
  if (title.length < 4) problems.push({ field: "title", message: "Give it a name somebody could search for." });
  if (title.length > 80) problems.push({ field: "title", message: "Keep the name under 80 characters." });

  const summary = input.summary?.trim() ?? "";
  /*
   * A summary is what somebody reads on a card before deciding, so it is the
   * one piece of writing that cannot be skipped. Nova writes it when it builds
   * the market, so this almost never fires for a Nova-built listing.
   */
  if (summary.length < 40) problems.push({ field: "summary", message: "Say what this simulation puts somebody through, in a sentence or two." });
  if (summary.length > 400) problems.push({ field: "summary", message: "Keep the summary under 400 characters — the detail goes below it." });

  if (!input.hasMarket) problems.push({ field: "market", message: "This listing has no market attached. Build or pick one before publishing." });

  const pricing = input.pricing ?? "free";
  if (!(LISTING_PRICING as readonly string[]).includes(pricing)) {
    problems.push({ field: "pricing", message: "Pick free or a price per seat." });
  } else if (pricing === "perSeat") {
    const price = input.seatPriceCents ?? 0;
    if (price < SEAT_PRICE_MIN_CENTS || price > SEAT_PRICE_MAX_CENTS) {
      problems.push({
        field: "seatPriceCents",
        message: `A seat is between ${(SEAT_PRICE_MIN_CENTS / 100).toFixed(2)} and ${(SEAT_PRICE_MAX_CENTS / 100).toFixed(0)}.`,
      });
    }
  }
  return problems;
}

/** How a marketplace list is ordered, which is the only sort a browser needs. */
export const LISTING_SORTS = ["newest", "popular", "priceLow", "priceHigh"] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];
