/**
 * Publishing a simulation, buying seats on one, and playing it.
 *
 * The engine for all of this already existed: `buildCustomMarket` writes and
 * validates a market, `sim_seasons` runs one. What was missing was the part
 * where somebody other than the author gets to play it, and the author gets
 * paid.
 *
 * ## Why a purchase is seats rather than access
 *
 * A simulation is played by a table, so what somebody buys is the right to put
 * N people in a season of it. Seats are drawn down as seasons are started,
 * which is what makes "I bought six and used four" a thing the row can answer
 * — and what a resale, if it is ever built, would have to draw from.
 *
 * ## Why the money is one spend and one credit
 *
 * `spend` already takes money off a balance with the condition travelling in
 * the UPDATE, so two tabs cannot buy the same last pound twice.
 * `creditEarnings` already pays somebody what the platform owes them, keyed so
 * a retry cannot pay twice. A sale is those two things in a transaction,
 * inside the ledger people can already read, rather than a second money system
 * beside the first.
 */
import type { Express } from "express";
import crypto from "crypto";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import {
  simulationListings, simulationListingPlayers, simulationPurchases, simulationSeasonStarts,
  simulationShareLinks, simulationShareUses, simSeasons, userProfiles, users, projects, companies,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { spend, refund, walletOf } from "./wallet";
import { buildCustomMarket } from "@shared/simulation/custom-market";
import { newSeasonCode, joinPathFor, isUniqueViolation } from "./company-season-routes";
import { takeSeatInSeason, advanceVenture } from "./simulation-routes";
import { seatBotCompanies } from "./simulation-bots";
import { startSeason } from "./simulation-tick";
import { RIVALS_IN_A_CUSTOM_SEASON } from "@shared/simulation/custom-market";
import { writeListingCopy } from "./simulation-listing-write";
import { hasAcceptedSellerTerms, sellerOwedSql } from "./simulation-market-compliance";
import { listingPublished, listingSold } from "./simulation-market-notices";
import {
  SELLER_TERMS_VERSION, BUYER_TERMS_VERSION, PAYOUT_HOLD_DAYS, releasableAt, sellerOwed,
} from "@shared/simulation-market-terms";
import {
  checkListing, seatsCost, splitSale, LISTING_SORTS,
  SEAT_PRICE_MIN_CENTS, SEAT_PRICE_MAX_CENTS, PLATFORM_SHARE_PERCENT,
  type ListingSort,
} from "@shared/simulation-market";

/** The most seats one purchase may be, which is a lobby and then some. */
export const MAX_SEATS_PER_PURCHASE = 50;

export type Listing = typeof simulationListings.$inferSelect;

/** The listing as a card sees it. The market itself is never sent to a browser. */
const forCard = (row: Listing & { authorName?: string | null; authorAvatar?: string | null }) => ({
  id: row.id,
  title: row.title,
  summary: row.summary,
  tags: row.tags ?? [],
  pricing: row.pricing,
  seatPriceCents: row.seatPriceCents,
  cadence: row.cadence,
  botSkill: row.botSkill,
  totalYears: row.totalYears,
  seatsSold: row.seatsSold,
  seasonsStarted: row.seasonsStarted,
  /* The number the card shows: different people, not starts. See the column. */
  players: row.players,
  status: row.status,
  publishedAt: row.publishedAt,
  author: { id: row.authorId, name: row.authorName ?? null, avatarUrl: row.authorAvatar ?? null },
});

/**
 * The market is deliberately absent from every client response.
 *
 * It is the product. A browser that can read `customMarket` can copy a paid
 * listing and publish it as its own, and the only thing stopping that would be
 * nobody having looked. The season reads it server-side when one is started.
 */
export const listingDetail = (row: Listing, author: { name: string | null; avatarUrl: string | null }) => ({
  ...forCard({ ...row, authorName: author.name, authorAvatar: author.avatarUrl }),
  description: row.description,
  projectId: row.projectId,
});

/**
 * Records that somebody played a listing, and says whether it was their first.
 *
 * The insert is the decision. `onConflictDoNothing().returning()` comes back
 * empty when a row was already there, so two people — or one person in two
 * tabs — cannot both be counted as the first, and the counter cannot drift
 * from the set it is counting. A read-then-increment would get both of those
 * wrong under exactly the load that makes a listing worth ranking.
 *
 * Never the author: `players` answers "have other people chosen this", and the
 * author choosing their own listing is not evidence of anything. Callers pass
 * their own `isAuthor` because they have already worked it out.
 */
async function countPlayer(listingId: string, userId: string): Promise<void> {
  const [first] = await db.insert(simulationListingPlayers)
    .values({ listingId, userId })
    .onConflictDoNothing({ target: [simulationListingPlayers.listingId, simulationListingPlayers.userId] })
    .returning({ id: simulationListingPlayers.id });
  if (!first) return;
  await db.update(simulationListings)
    .set({ players: sql`${simulationListings.players} + 1` })
    .where(eq(simulationListings.id, listingId));
}

// ─── Share links ─────────────────────────────────────────────────────────────

/**
 * The ceilings on one link, and why there are any.
 *
 * A link is given away rather than sold, so the only thing stopping a thousand
 * free seasons from one link is a number. Twenty is more than enough for the
 * thing this is for — one business, its owner, and whoever they want to show it
 * to — and small enough that a leaked link is a bounded loss rather than the
 * listing being free. A year is long enough that nobody's link dies before they
 * get round to it.
 */
export const SHARE_USES_MAX = 20;
export const SHARE_DAYS_MAX = 365;

export type ShareLink = typeof simulationShareLinks.$inferSelect;

/**
 * The secret in the URL, and the whole of the access control on a share.
 *
 * So it is sized like a password rather than like an id: 32 bytes from
 * `randomBytes`, base64url, which is 256 bits and not worth anybody's time.
 * `randomInt`-per-character, as the season codes do, is right for a code a
 * person reads down a phone and wrong for this — a season code is short
 * because it has to be typed, and it guards a lobby you were invited to rather
 * than a market somebody paid to have written.
 */
export const newShareToken = (): string => crypto.randomBytes(32).toString("base64url");

/** What a link may be asked for, before anything is written. */
export function checkShare(input: { uses?: unknown; expiresInDays?: unknown; note?: unknown }):
  { message: string; field: string }[] {
  const problems: { message: string; field: string }[] = [];
  if (input.uses !== undefined) {
    const uses = Number(input.uses);
    if (!Number.isFinite(uses) || uses < 1 || !Number.isInteger(uses)) {
      problems.push({ message: "How many times it can be used has to be a whole number, at least one.", field: "uses" });
    } else if (uses > SHARE_USES_MAX) {
      problems.push({ message: `One link can be used up to ${SHARE_USES_MAX} times. Make another for more.`, field: "uses" });
    }
  }
  if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
    const days = Number(input.expiresInDays);
    if (!Number.isFinite(days) || days <= 0) {
      problems.push({ message: "Leave the expiry out for a link that doesn't expire.", field: "expiresInDays" });
    } else if (days > SHARE_DAYS_MAX) {
      problems.push({ message: `A link can last up to ${SHARE_DAYS_MAX} days.`, field: "expiresInDays" });
    }
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    problems.push({ message: "The note has to be text.", field: "note" });
  }
  return problems;
}

/** Why a link is not usable, or `open` if it is. */
export type ShareState = "open" | "revoked" | "expired" | "spent";

export function shareState(link: ShareLink, now = new Date()): ShareState {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && link.expiresAt <= now) return "expired";
  if (link.usesSpent >= link.uses) return "spent";
  return "open";
}

/** What to tell somebody holding a link that no longer works. */
export const shareGone = (link: ShareLink): string => ({
  revoked: "Whoever sent you this link has taken it back. Ask them for another.",
  expired: "This link has expired. Ask whoever sent it for another.",
  spent: "This link has already been used. Ask whoever sent it for another.",
  open: "",
}[shareState(link)]);

/**
 * A link as its author sees it, with the token.
 *
 * The token is only ever sent back to the person who minted it, which is the
 * one party already able to mint another.
 */
export const shareForAuthor = (link: ShareLink) => ({
  id: link.id,
  listingId: link.listingId,
  token: link.token,
  /* Built here so no screen has to know the shape of the address. */
  url: `/s/${link.token}`,
  note: link.note,
  uses: link.uses,
  usesSpent: link.usesSpent,
  usesLeft: Math.max(0, link.uses - link.usesSpent),
  expiresAt: link.expiresAt,
  revokedAt: link.revokedAt,
  state: shareState(link),
  createdAt: link.createdAt,
});

/**
 * A link by its token.
 *
 * Returns spent, revoked and expired links too: the routes answer 410 for those
 * rather than 404, because "this was yours and is finished" and "this was never
 * a thing" are different messages, and only one of them makes a person ask for
 * another link instead of assuming a typo.
 */
export async function shareByToken(token: string): Promise<ShareLink | null> {
  /* Cheap guard, and it keeps an empty path segment from matching a row. */
  if (!token || token.length < 16 || token.length > 128) return null;
  const [link] = await db.select().from(simulationShareLinks)
    .where(eq(simulationShareLinks.token, token));
  return link ?? null;
}

/**
 * The seasons somebody started from listings, newest first.
 *
 * One query for every screen that has to answer "where is the thing I bought":
 * the listing page, the library and the profile all ask it, and a season is
 * only reachable through this table — starting one does not seat you in it, so
 * `/api/sim/ventures` cannot see it until somebody follows the join link.
 *
 * `listingIds` narrows it to one listing for the detail page; omitted, it is
 * the whole library.
 */
export async function seasonsStartedBy(userId: string, listingIds?: string[]) {
  const where = [eq(simulationSeasonStarts.startedBy, userId)];
  if (listingIds) {
    if (!listingIds.length) return [];
    where.push(inArray(simulationSeasonStarts.listingId, listingIds));
  }
  const rows = await db
    .select({
      start: simulationSeasonStarts,
      name: simSeasons.name,
      status: simSeasons.status,
      year: simSeasons.year,
      totalYears: simSeasons.totalYears,
    })
    .from(simulationSeasonStarts)
    .leftJoin(simSeasons, eq(simSeasons.id, simulationSeasonStarts.seasonId))
    .where(and(...where))
    .orderBy(desc(simulationSeasonStarts.createdAt))
    .limit(200);

  return rows.map((r) => ({
    seasonId: r.start.seasonId,
    listingId: r.start.listingId,
    purchaseId: r.start.purchaseId,
    name: r.name,
    /*
     * Null when the season row is gone — a season can be swept, and a start
     * that points at nothing should read as "no longer there" rather than
     * crash a card or vanish silently.
     */
    status: r.status,
    year: r.year,
    totalYears: r.totalYears,
    inviteCode: r.start.inviteCode,
    joinUrl: r.start.inviteCode ? joinPathFor(r.start.inviteCode) : null,
    startedAt: r.start.createdAt,
  }));
}

const orderFor = (sort: ListingSort) => {
  switch (sort) {
    /*
     * Different people, not starts. On `seasonsStarted` the ranking was a
     * volume count: one buyer replaying their own fifty seats outranked a
     * listing fifty strangers had each chosen once.
     */
    case "popular": return [desc(simulationListings.players), desc(simulationListings.publishedAt)];
    case "priceLow": return [simulationListings.seatPriceCents, desc(simulationListings.publishedAt)];
    case "priceHigh": return [desc(simulationListings.seatPriceCents), desc(simulationListings.publishedAt)];
    default: return [desc(simulationListings.publishedAt)];
  }
};

export function registerSimulationMarketplaceRoutes(app: Express) {
  /**
   * The marketplace itself: what is listed, searchable.
   *
   * Open to anyone signed in, including people who have never written one —
   * browsing is how somebody decides to.
   */
  app.get("/api/sim-market/listings", isAuthenticated, async (req: any, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const sort = (LISTING_SORTS as readonly string[]).includes(String(req.query.sort))
        ? (req.query.sort as ListingSort) : "newest";
      const freeOnly = req.query.free === "1";

      const where = [eq(simulationListings.status, "listed")];
      if (q) {
        /* Title and summary only: the description is long and matching it returns everything. */
        where.push(or(ilike(simulationListings.title, `%${q}%`), ilike(simulationListings.summary, `%${q}%`))!);
      }
      if (freeOnly) where.push(eq(simulationListings.pricing, "free"));

      /*
       * A page, rather than the first sixty and nothing else.
       *
       * `limit(60)` with no offset was a ceiling on the whole marketplace: the
       * sixty-first listing ever published could not be reached by any
       * combination of search and sort. One more row than the page is read so
       * the client knows whether to offer "more" without a second count query.
       */
      const PAGE = 60;
      const offset = Math.max(0, Math.min(5_000, Math.floor(Number(req.query.offset) || 0)));

      const rows = await db
        .select({
          listing: simulationListings,
          authorName: userProfiles.displayName,
          authorAvatar: userProfiles.avatarUrl,
        })
        .from(simulationListings)
        /*
         * The author joined, and the banned and the closed left out.
         *
         * `public-edges.test.ts` writes this rule down for projects —
         * "suspension blocks writes, and before this change that was all it
         * did" — and the marketplace is the same rule with money on it, which
         * makes it worse: a listing nobody had taken down went on taking
         * payment for a seller the platform had just banned. An inner join,
         * so a listing whose author row is gone drops out with them.
         */
        .innerJoin(users, eq(users.id, simulationListings.authorId))
        .leftJoin(userProfiles, eq(userProfiles.userId, simulationListings.authorId))
        .where(and(...where, isNull(users.suspendedAt), isNull(users.deletedAt)))
        .orderBy(...orderFor(sort))
        .limit(PAGE + 1)
        .offset(offset);

      const page = rows.slice(0, PAGE);
      res.json({
        listings: page.map((r) => forCard({ ...r.listing, authorName: r.authorName, authorAvatar: r.authorAvatar })),
        /* Where the next page starts, or null when this was the last of them. */
        nextOffset: rows.length > PAGE ? offset + PAGE : null,
        /* So no screen hardcodes a price range or a fee the owner changed. */
        rules: { seatPriceMinCents: SEAT_PRICE_MIN_CENTS, seatPriceMaxCents: SEAT_PRICE_MAX_CENTS, platformSharePercent: PLATFORM_SHARE_PERCENT },
      });
    } catch (error) {
      console.error("Sim marketplace list error:", error);
      res.status(500).json({ message: "Couldn't load the marketplace" });
    }
  });

  /**
   * The same listing, for somebody who has no account yet.
   *
   * Public, deliberately, and the only public route in this file. A link sent
   * to somebody thinking about starting a business lands on `/try/:id` before
   * they have signed up for anything, and a page that cannot say what it is
   * offering until you have an account is asking for the signup first. So this
   * answers the questions a stranger is entitled to ask — what market, how
   * long, who wrote it, what it costs — and nothing else.
   *
   * It carries no `youOwn`, because there is nobody to own anything, and no
   * market: `listingDetail` never sends `customMarket` to any client, signed
   * in or not, because the market is the product. Only a listed listing is
   * visible; a draft 404s for everyone here, including its author, who has a
   * signed-in route that shows it.
   */
  app.get("/api/sim-market/listings/:id/preview", async (req: any, res) => {
    try {
      const [row] = await db.select().from(simulationListings).where(eq(simulationListings.id, req.params.id));
      if (!row || row.status !== "listed") return res.status(404).json({ message: "Simulation not found" });
      const [author] = await db.select({ name: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl })
        .from(userProfiles).where(eq(userProfiles.userId, row.authorId));
      res.json({
        listing: listingDetail(row, { name: author?.name ?? null, avatarUrl: author?.avatarUrl ?? null }),
        /* Nobody is signed in, so nobody owns anything. Shaped like the signed-in reply so the page needs no second branch. */
        youOwn: { seats: 0, purchases: 0, seasons: [] },
        isAuthor: false,
      });
    } catch (error) {
      console.error("Sim listing preview error:", error);
      res.status(500).json({ message: "Couldn't load that simulation" });
    }
  });

  /** One listing, as its own page. Unlisted and draft are visible to their author only. */
  app.get("/api/sim-market/listings/:id", isAuthenticated, async (req: any, res) => {
    try {
      const [row] = await db.select().from(simulationListings).where(eq(simulationListings.id, req.params.id));
      if (!row) return res.status(404).json({ message: "Simulation not found" });
      if (row.status !== "listed" && row.authorId !== req.user.id) {
        /* 404 rather than 403: a draft's existence is not somebody else's business. */
        return res.status(404).json({ message: "Simulation not found" });
      }
      const [author] = await db.select({ name: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl })
        .from(userProfiles).where(eq(userProfiles.userId, row.authorId));

      const mine = await db.select().from(simulationPurchases)
        .where(and(eq(simulationPurchases.listingId, row.id), eq(simulationPurchases.buyerId, req.user.id)));

      /*
       * And the seasons they already started from it, so the page offers the
       * game they are in the middle of before it offers them another one.
       */
      const started = await seasonsStartedBy(req.user.id, [row.id]);

      res.json({
        listing: listingDetail(row, { name: author?.name ?? null, avatarUrl: author?.avatarUrl ?? null }),
        /* What this person already holds, so the page offers "play" rather than "buy". */
        youOwn: {
          seats: mine.reduce((n, p) => n + p.seatsLeft, 0),
          purchases: mine.length,
          seasons: started,
        },
        isAuthor: row.authorId === req.user.id,
      });
    } catch (error) {
      console.error("Sim listing read error:", error);
      res.status(500).json({ message: "Couldn't load that simulation" });
    }
  });

  /**
   * Buying seats.
   *
   * Free listings go through the same route and the same row, with a paid
   * amount of zero — so "how many people played this" is one question with one
   * answer, and a listing that later starts charging does not begin its history
   * at zero.
   */
  app.post("/api/sim-market/listings/:id/buy", isAuthenticated, rateLimit("checkout"), async (req: any, res) => {
    try {
      const seats = Math.floor(Number(req.body?.seats ?? 1));
      if (!Number.isFinite(seats) || seats < 1 || seats > MAX_SEATS_PER_PURCHASE) {
        return res.status(400).json({ message: `Between 1 and ${MAX_SEATS_PER_PURCHASE} seats.`, field: "seats" });
      }

      /*
       * Which buyer terms this purchase happens under.
       *
       * The disclosure is on screen beside the pay button, so buying with it
       * there is the acceptance, and the version in force is what gets written
       * on the row. The client sends the version it actually displayed, and a
       * mismatch is refused — that is the one failure nothing else here can
       * see: a tab left open across a terms change would otherwise buy under
       * terms it never showed anybody.
       *
       * Absent is allowed and records the current version. A caller that does
       * not send it is not lying about what it displayed, and making this
       * mandatory would have broken every existing caller for no gain in what
       * is actually recorded.
       */
      const shown = req.body?.acceptedTermsVersion;
      if (shown !== undefined && shown !== null && Number(shown) !== BUYER_TERMS_VERSION) {
        return res.status(409).json({
          message: "The terms have changed since this page loaded. Read them again before buying.",
          field: "acceptedTermsVersion",
          version: BUYER_TERMS_VERSION,
        });
      }

      /*
       * The seller's standing comes down with the listing.
       *
       * Hiding a banned seller's listings from the marketplace is not enough on
       * its own — anybody holding the link, or a stale tab, could still buy —
       * and this is the route where money moves. 404 rather than a reason,
       * which is the same answer this file gives for a listing that is not
       * listed: a stranger is not owed an account of somebody else's standing.
       */
      const [row] = await db
        .select({ listing: simulationListings, suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
        .from(simulationListings)
        .innerJoin(users, eq(users.id, simulationListings.authorId))
        .where(eq(simulationListings.id, req.params.id));
      if (!row || row.listing.status !== "listed" || row.suspendedAt || row.deletedAt) {
        return res.status(404).json({ message: "Simulation not found" });
      }
      const listing = row.listing;
      if (listing.authorId === req.user.id) {
        return res.status(400).json({ message: "This is yours — you can play it without buying seats.", field: "seats" });
      }

      /*
       * The same attempt arriving twice.
       *
       * Checked before any money moves, so the ordinary retry — a double tap, a
       * reload, a connection the browser retried for us — costs nothing and
       * answers with the purchase that already exists. The unique index is what
       * settles two arriving at once; see the conflict handling below.
       */
      const attempt = typeof req.body?.idempotencyKey === "string"
        ? req.body.idempotencyKey.trim().slice(0, 100) || null
        : null;
      if (attempt) {
        const [already] = await db.select().from(simulationPurchases)
          .where(and(
            eq(simulationPurchases.buyerId, req.user.id),
            eq(simulationPurchases.idempotencyKey, attempt),
          ));
        if (already) {
          return res.status(200).json({
            purchase: { id: already.id, seats: already.seats, paidCents: already.paidCents },
            /* Said plainly, so a client can tell "bought" from "already bought". */
            repeated: true,
          });
        }
      }

      const total = seatsCost(listing.pricing, listing.seatPriceCents, seats);
      const paid = total > 0
        ? await spend(req.user.id, total, { outcome: "seasonSeat", note: `${seats} seat${seats === 1 ? "" : "s"} — ${listing.title}` })
        : { id: "", amountCents: 0, balanceAfter: (await walletOf(req.user.id)).balanceCents };

      if (!paid) {
        return res.status(402).json({
          message: `That is ${(total / 100).toFixed(2)} and there isn't that much on the account.`,
          field: "balance",
        });
      }

      const { platformCents, sellerCents } = splitSale(paid.amountCents);

      let purchaseId: string;
      try {
        /*
         * One transaction, because the compensating refund below assumes the
         * rows did not land.
         *
         * These were two statements. The seats row went in, the counters went
         * second, and a failure on the second ran the catch — which refunds the
         * money. So a buyer whose counter update failed got their money back
         * *and* kept the seats, and the only thing standing between that and a
         * free simulation was the counter update never failing. It is an
         * increment on a single hot row, which is exactly what starts failing
         * when a popular listing is being bought concurrently.
         */
        purchaseId = await db.transaction(async (tx) => {
          const [purchase] = await tx.insert(simulationPurchases).values({
            listingId: listing.id,
            buyerId: req.user.id,
            sellerId: listing.authorId,
            seats,
            paidCents: paid.amountCents,
            platformCents,
            sellerCents,
            seatsLeft: seats,
            /* What they were shown and bought under. See BUYER_TERMS_VERSION. */
            buyerTermsVersion: BUYER_TERMS_VERSION,
            idempotencyKey: attempt,
            /* Held for the refund window — see shared/simulation-market-terms.ts. */
            releasableAt: releasableAt(new Date()),
          }).returning();

          /* Counters beside the row they count. */
          await tx.update(simulationListings).set({
            seatsSold: sql`${simulationListings.seatsSold} + ${seats}`,
            grossCents: sql`${simulationListings.grossCents} + ${paid.amountCents}`,
            updatedAt: new Date(),
          }).where(eq(simulationListings.id, listing.id));

          return purchase.id;
        });
      } catch (error) {
        /* The money moved and the rows did not. Put it back before anything else. */
        if (paid.amountCents > 0) {
          await refund(req.user.id, paid.amountCents, { outcome: "seasonSeat", note: "Seats that could not be bought" });
        }

        /*
         * Two arrivals of one attempt, close enough together that both got past
         * the read above. The index refused the second; its money has just gone
         * back, and the purchase the first one made is the answer.
         *
         * This is why the key is checked *and* unique rather than only checked:
         * a read-then-write cannot settle a race with itself.
         */
        if (attempt && isUniqueViolation(error)) {
          const [winner] = await db.select().from(simulationPurchases)
            .where(and(
              eq(simulationPurchases.buyerId, req.user.id),
              eq(simulationPurchases.idempotencyKey, attempt),
            ));
          if (winner) {
            return res.status(200).json({
              purchase: { id: winner.id, seats: winner.seats, paidCents: winner.paidCents },
              repeated: true,
            });
          }
        }
        throw error;
      }

      /*
       * The author is not paid here. The money is held for the refund window
       * and released by the sweep in `simulation-market-compliance.ts`;
       * crediting at the moment of sale is money already gone when the refund
       * arrives.
       *
       * Outside the try on purpose: a throw from here would have run the refund
       * against rows that had already committed.
       */
      /*
       * And the seller is told. Never fatal and never awaited: the sale is
       * complete and the money has moved, so a bell that cannot be rung must
       * not turn a successful purchase into an error for the buyer.
       */
      void listingSold({
        sellerId: listing.authorId,
        listingId: listing.id,
        seats,
        paidCents: paid.amountCents,
        heldDays: PAYOUT_HOLD_DAYS,
      }).catch((err) => console.error("[sim-market] sale notice failed:", err));

      res.status(201).json({ purchase: { id: purchaseId, seats, paidCents: paid.amountCents } });
    } catch (error) {
      console.error("Sim seat purchase error:", error);
      res.status(500).json({ message: "Couldn't buy those seats" });
    }
  });

  /**
   * Markets this person has built, which are the only ones they may list.
   *
   * A market somebody played in is not a market they wrote — a table of five
   * all have seats in the same season, and four of them did not build it. So
   * the source is a season this person *started*, which for a project
   * simulation is the season their own project produced.
   */
  app.get("/api/sim-market/sources", isAuthenticated, async (req: any, res) => {
    try {
      /*
       * Season → company → project → owner, which is the same path
       * `project-simulation-routes.ts` uses to decide whether somebody may
       * replay a market. Reusing it matters: a second, subtly different
       * ownership rule for the same object is how one of them ends up wrong.
       */
      const mine = await db
        .select({
          seasonId: simSeasons.id,
          name: simSeasons.name,
          nicheId: simSeasons.nicheId,
          cadence: simSeasons.cadence,
          botSkill: simSeasons.botSkill,
          totalYears: simSeasons.totalYears,
          createdAt: simSeasons.createdAt,
          projectId: companies.projectId,
        })
        .from(simSeasons)
        .innerJoin(companies, eq(companies.id, simSeasons.companyId))
        .innerJoin(projects, eq(projects.id, companies.projectId))
        .where(and(eq(projects.ownerId, req.user.id), isNotNull(simSeasons.customMarket)))
        .orderBy(desc(simSeasons.createdAt))
        .limit(25);

      /* Which are already listed, so the page does not offer the same market twice. */
      const listed = await db.select({ fromSeasonId: simulationListings.fromSeasonId })
        .from(simulationListings).where(eq(simulationListings.authorId, req.user.id));
      const taken = new Set(listed.map((l) => l.fromSeasonId).filter(Boolean));

      res.json({
        sources: mine
          .filter((m) => !taken.has(m.seasonId))
          .map((m) => ({
            seasonId: m.seasonId, name: m.name, cadence: m.cadence,
            botSkill: m.botSkill, totalYears: m.totalYears, projectId: m.projectId,
          })),
      });
    } catch (error) {
      console.error("Sim sources error:", error);
      res.status(500).json({ message: "Couldn't find your markets" });
    }
  });

  /**
   * Creating a draft from a market somebody has.
   *
   * A draft is private and costs nothing. Publishing is the moment anything is
   * promised, so that is where the checks are — a person thinking is not a
   * person selling.
   */
  app.post("/api/sim-market/listings", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      /*
       * The market is fetched here, not posted.
       *
       * A browser that can send a market is a browser that was given one, and
       * the market is the product — handing it out to build a draft would
       * undo the care taken everywhere else to keep it server-side. So the
       * client names a season it owns and the market is copied across inside
       * this request.
       */
      const fromSeasonId = typeof req.body?.fromSeasonId === "string" ? req.body.fromSeasonId : null;
      const nicheId = typeof req.body?.nicheId === "string" ? req.body.nicheId : null;
      if (!fromSeasonId && !nicheId) {
        return res.status(400).json({ message: "Pick one of your markets first.", field: "market" });
      }

      let market: unknown = null;
      let source: typeof simSeasons.$inferSelect | null = null;
      if (fromSeasonId) {
        const [owned] = await db
          .select({ season: simSeasons })
          .from(simSeasons)
          .innerJoin(companies, eq(companies.id, simSeasons.companyId))
          .innerJoin(projects, eq(projects.id, companies.projectId))
          .where(and(eq(simSeasons.id, fromSeasonId), eq(projects.ownerId, req.user.id)));
        /* 404 rather than 403: whose season this is, is not the asker's business. */
        if (!owned) return res.status(404).json({ message: "Market not found" });
        source = owned.season;
        market = owned.season.customMarket;
      }

      /*
       * Validated here and not trusted from the browser. `buildCustomMarket`
       * is what stands between a posted blob and an engine that divides by
       * zero, and a listing is the one path where the blob comes from outside.
       */
      const checked = market ? buildCustomMarket(market, `listing-${Date.now()}`, { fresh: true }) : null;
      if (market && !checked) {
        return res.status(400).json({ message: "That market isn't playable. Rebuild it and try again.", field: "market" });
      }

      const copy = checked
        ? await writeListingCopy({
          niche: checked,
          brief: typeof req.body?.brief === "string" ? req.body.brief : null,
          cadence: req.body?.cadence ?? source?.cadence ?? "yearly",
          botSkill: req.body?.botSkill ?? source?.botSkill ?? "survivor",
          totalYears: Number(req.body?.totalYears) || source?.totalYears || 14,
        }).catch(() => null)
        : null;

      const [row] = await db.insert(simulationListings).values({
        authorId: req.user.id,
        projectId: typeof req.body?.projectId === "string" ? req.body.projectId : null,
        title: String(req.body?.title ?? copy?.title ?? "Untitled simulation").slice(0, 80),
        summary: copy?.summary ?? null,
        description: copy?.description ?? null,
        tags: copy?.tags ?? [],
        customMarket: checked ?? null,
        nicheId: nicheId ?? source?.nicheId ?? null,
        fromSeasonId,
        /* The settings it was actually played at, unless the author changes them. */
        cadence: req.body?.cadence ?? source?.cadence ?? "yearly",
        botSkill: req.body?.botSkill ?? source?.botSkill ?? "survivor",
        totalYears: Number(req.body?.totalYears) || source?.totalYears || 14,
        status: "draft",
      }).returning();

      res.status(201).json({ listing: listingDetail(row, { name: null, avatarUrl: null }) });
    } catch (error) {
      console.error("Sim listing create error:", error);
      res.status(500).json({ message: "Couldn't create that listing" });
    }
  });

  /**
   * Publishing, which is the moment a draft becomes a promise.
   *
   * Three gates, in the order they matter: the seller has accepted the
   * agreement in force, the listing says enough for somebody to choose it, and
   * it has not been taken down. The third is why a removed listing cannot be
   * quietly re-listed — the author's own switch does not clear a reviewer's
   * decision.
   */
  app.post("/api/sim-market/listings/:id/publish", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [row] = await db.select().from(simulationListings).where(eq(simulationListings.id, req.params.id));
      if (!row || row.authorId !== req.user.id) return res.status(404).json({ message: "Simulation not found" });

      if (row.takenDownAt) {
        return res.status(403).json({
          message: "This listing was taken down by a reviewer and cannot be republished.",
          reason: row.takenDownReason,
        });
      }

      if (!(await hasAcceptedSellerTerms(req.user.id))) {
        return res.status(428).json({
          message: "Read and accept the seller agreement before listing anything.",
          needsTerms: SELLER_TERMS_VERSION,
        });
      }

      const pricing = req.body?.pricing ?? row.pricing;
      const seatPriceCents = Math.round(Number(req.body?.seatPriceCents ?? row.seatPriceCents) || 0);
      const title = String(req.body?.title ?? row.title);
      const summary = String(req.body?.summary ?? row.summary ?? "");

      const problems = checkListing({
        title, summary, pricing, seatPriceCents,
        hasMarket: !!(row.customMarket || row.nicheId),
      });
      if (problems.length) return res.status(400).json({ message: problems[0].message, problems });

      const [published] = await db.update(simulationListings).set({
        title: title.slice(0, 80),
        summary: summary.slice(0, 400),
        description: typeof req.body?.description === "string" ? req.body.description : row.description,
        pricing,
        seatPriceCents: pricing === "free" ? 0 : seatPriceCents,
        status: "listed",
        publishedAt: row.publishedAt ?? new Date(),
        updatedAt: new Date(),
      }).where(eq(simulationListings.id, row.id)).returning();

      /*
       * The people who follow them hear about it — but only the first time it
       * goes up. `publish` is also how a listing is edited and relisted, and
       * announcing a price change to everybody's bell is how a feature becomes
       * noise. `row.publishedAt` is the previous value, so a null there is the
       * one moment this was not already public.
       */
      if (!row.publishedAt) {
        void listingPublished({ listingId: published.id, authorId: req.user.id, title: published.title })
          .catch((err) => console.error("[sim-market] publish notice failed:", err));
      }

      res.json({ listing: listingDetail(published, { name: null, avatarUrl: null }) });
    } catch (error) {
      console.error("Sim publish error:", error);
      res.status(500).json({ message: "Couldn't publish that" });
    }
  });

  /** Taking it off the marketplace. The author's own switch; a takedown is not. */
  app.post("/api/sim-market/listings/:id/unlist", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [row] = await db.update(simulationListings)
        .set({ status: "unlisted", updatedAt: new Date() })
        .where(and(eq(simulationListings.id, req.params.id), eq(simulationListings.authorId, req.user.id)))
        .returning();
      if (!row) return res.status(404).json({ message: "Simulation not found" });
      res.json({ id: row.id, status: row.status });
    } catch (error) {
      console.error("Sim unlist error:", error);
      res.status(500).json({ message: "Couldn't unlist that" });
    }
  });

  /**
   * Starting a season from seats somebody owns.
   *
   * The seat and the season are claimed in one statement, with the condition
   * travelling in the UPDATE: two tabs pressing start on the last seat both
   * read one left, and only one of them finds it there. Spending the seat is
   * also what closes its refund window — the thing bought has been delivered —
   * so the two cannot be allowed to disagree.
   */
  app.post("/api/sim-market/listings/:id/play", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [listing] = await db.select().from(simulationListings).where(eq(simulationListings.id, req.params.id));
      if (!listing) return res.status(404).json({ message: "Simulation not found" });

      /*
       * A reviewer's takedown stops the author, and only the author.
       *
       * Somebody who bought seats keeps them: `sim-marketplace.test.ts` makes
       * that a rule in as many words — "a takedown took away something somebody
       * paid for" — and it is the right call, because the buyer did nothing and
       * the refund window may well have closed by the time a report is acted
       * on. What was missing is the other half. Publishing refuses a
       * taken-down listing and so does minting a share link, but this route
       * checked neither, so its author could go on starting seasons from the
       * thing a reviewer had just removed from them.
       *
       * Before the seat is claimed, so a refusal cannot also cost a seat.
       * Unlisting is deliberately not caught: an author who takes their own
       * listing off sale has not lost the right to play it.
       */
      if (listing.takenDownAt && listing.authorId === req.user.id) {
        return res.status(403).json({
          message: "This was taken down by a reviewer, so it can't be played.",
          reason: listing.takenDownReason,
        });
      }

      const name = String(req.body?.name ?? "").trim() || listing.title;

      /*
       * Whether the other chairs are being saved for people.
       *
       * Nova fills a waiting room a minute after it opens, which is right for
       * somebody playing alone — they pressed play and are owed a game, not a
       * lobby. It is wrong for a table: a buyer who took five seats for their
       * team and starts the season first would come back to find Nova playing
       * three of them. `server/project-simulation-routes.ts` already declines
       * the fill for exactly this reason, and it cannot be guessed from the
       * seat count, because five seats is equally five solo seasons.
       */
      const withTeam = req.body?.withTeam === true;

      /*
       * The author plays their own without owning seats. They wrote it; making
       * them buy from themselves would be the platform taking its share of a
       * sale that did not happen.
       */
      const isAuthor = listing.authorId === req.user.id;

      let purchaseId: string | null = null;
      if (!isAuthor) {
        const held = await db.select().from(simulationPurchases)
          .where(and(
            eq(simulationPurchases.listingId, listing.id),
            eq(simulationPurchases.buyerId, req.user.id),
          ))
          .orderBy(simulationPurchases.createdAt);

        /* Oldest first, so the seats closest to leaving their window go first. */
        const withSeats = held.find((p) => p.seatsLeft > 0);
        if (!withSeats) {
          return res.status(402).json({ message: "You have no seats left on this simulation.", field: "seats" });
        }

        const [claimed] = await db.update(simulationPurchases)
          .set({ seatsLeft: sql`${simulationPurchases.seatsLeft} - 1` })
          .where(and(eq(simulationPurchases.id, withSeats.id), sql`${simulationPurchases.seatsLeft} > 0`))
          .returning();
        if (!claimed) return res.status(409).json({ message: "That seat has just been used." });
        purchaseId = claimed.id;
      }

      try {
        /*
         * The market is copied onto the season, not referenced. A season plays
         * the simulation as it was when it started; an author editing a draft
         * afterwards must not change a game in progress.
         */
        const niche = listing.customMarket
          ? buildCustomMarket(listing.customMarket, `listing-${listing.id}`)
          : null;
        if (listing.customMarket && !niche) {
          throw new Error("This listing's market is no longer playable");
        }

        for (let attempt = 0; attempt < 5; attempt++) {
          const inviteCode = newSeasonCode();
          try {
            const [season] = await db.insert(simSeasons).values({
              nicheId: niche?.id ?? listing.nicheId ?? "custom",
              name,
              status: "forming",
              totalYears: listing.totalYears,
              cadence: listing.cadence,
              botSkill: listing.botSkill,
              customMarket: niche ?? null,
              origin: "nova",
              inviteCode,
              botFill: !withTeam,
              createdAt: new Date(),
            }).returning();

            /*
             * Filed before the response, because the join link in the response
             * is not a record of anything. See `simulationSeasonStarts`.
             */
            await db.insert(simulationSeasonStarts).values({
              listingId: listing.id,
              purchaseId,
              seasonId: season.id,
              startedBy: req.user.id,
              inviteCode,
            });

            /*
             * The author's own runs do not count.
             *
             * `seasonsStarted` is shown on the card, shown on the listing page,
             * and is what `sort=popular` orders by — and the author plays their
             * own listing for nothing, as often as they like. So pressing your
             * own play button was a way to climb the marketplace, free, for as
             * long as you cared to keep clicking. The number means "times
             * somebody else played this", which is what every place reading it
             * is already claiming.
             */
            if (!isAuthor) {
              await db.update(simulationListings)
                .set({ seasonsStarted: sql`${simulationListings.seasonsStarted} + 1`, updatedAt: new Date() })
                .where(eq(simulationListings.id, listing.id));
              await countPlayer(listing.id, req.user.id);
            }

            return res.status(201).json({
              seasonId: season.id,
              inviteCode,
              joinUrl: joinPathFor(inviteCode),
              seatSpent: !isAuthor,
            });
          } catch (err) {
            /* A clashing invite code is the one failure worth retrying. */
            if (!isUniqueViolation(err)) throw err;
          }
        }
        throw new Error("Couldn't make a join code");
      } catch (error) {
        /*
         * The seat was spent and the season was not. Put it back — otherwise a
         * failure here silently costs somebody a seat and the refund window
         * for it, which is money.
         */
        if (purchaseId) {
          await db.update(simulationPurchases)
            .set({ seatsLeft: sql`${simulationPurchases.seatsLeft} + 1` })
            .where(eq(simulationPurchases.id, purchaseId));
        }
        throw error;
      }
    } catch (error) {
      console.error("Sim season start error:", error);
      res.status(500).json({ message: "Couldn't start that season" });
    }
  });

  /**
   * One tap, straight into a playable year.
   *
   * ## Why this is not `/play`
   *
   * `/play` makes the season a *table* plays: five chairs, a lobby, a join
   * code to send your colleagues. That is the right shape when somebody has
   * bought seats for a team, and the wrong one for the thing this is for —
   * sending a simulation of their own business to one person who is thinking
   * about starting one. They should not meet a waiting room, a seat to claim,
   * a company to name or four strangers; they should meet year one.
   *
   * So this makes a table of one, which the engine already handles better than
   * anything had asked it to. `advanceVenture`'s own comment says a solo
   * founder's room "has nothing to claim and nothing to name, so all three
   * transitions are ready at once", and it loops until they have all happened.
   * Started here rather than left to the minute job, because a person who has
   * just followed a link should not watch a waiting screen for up to a minute
   * to be told the thing they clicked is ready.
   *
   * Rivals are seated, which is the part a solo season would otherwise lack:
   * `RIVALS_IN_A_CUSTOM_SEASON` bot companies, so the market has somebody in
   * it to lose customers to. A season with one company in it teaches the wrong
   * lesson about every decision in it.
   */
  app.post("/api/sim-market/listings/:id/try", isAuthenticated, rateLimit("sprint"), async (req: any, res) => {
    try {
      const [listing] = await db.select().from(simulationListings).where(eq(simulationListings.id, req.params.id));
      if (!listing) return res.status(404).json({ message: "Simulation not found" });
      if (listing.status !== "listed" && listing.authorId !== req.user.id) {
        return res.status(404).json({ message: "Simulation not found" });
      }

      const isAuthor = listing.authorId === req.user.id;
      /*
       * A seat, unless it is free or it is the author's own.
       *
       * Taken the same way `/play` takes it — oldest purchase first, drawn
       * down with a conditional UPDATE — so a link cannot be used more times
       * than there are seats behind it, however many people hold it.
       */
      let purchaseId: string | null = null;
      if (!isAuthor && listing.pricing !== "free") {
        const held = await db.select().from(simulationPurchases)
          .where(and(
            eq(simulationPurchases.listingId, listing.id),
            eq(simulationPurchases.buyerId, req.user.id),
          ))
          .orderBy(simulationPurchases.createdAt);
        const withSeats = held.find((p) => p.seatsLeft > 0);
        if (!withSeats) {
          return res.status(402).json({ message: "You have no seats left on this simulation.", field: "seats" });
        }
        const [claimed] = await db.update(simulationPurchases)
          .set({ seatsLeft: sql`${simulationPurchases.seatsLeft} - 1` })
          .where(and(eq(simulationPurchases.id, withSeats.id), sql`${simulationPurchases.seatsLeft} > 0`))
          .returning();
        if (!claimed) return res.status(409).json({ message: "That seat has just been used." });
        purchaseId = claimed.id;
      }

      try {
        const niche = listing.customMarket
          ? buildCustomMarket(listing.customMarket, `listing-${listing.id}`)
          : null;
        if (listing.customMarket && !niche) throw new Error("This listing's market is no longer playable");

        const name = String(req.body?.name ?? "").trim().slice(0, 80) || listing.title;

        for (let attempt = 0; attempt < 5; attempt++) {
          const inviteCode = newSeasonCode();
          try {
            const [season] = await db.insert(simSeasons).values({
              nicheId: niche?.id ?? listing.nicheId ?? "custom",
              name,
              status: "forming",
              totalYears: listing.totalYears,
              cadence: listing.cadence,
              botSkill: listing.botSkill,
              customMarket: niche ?? null,
              origin: "nova",
              inviteCode,
              /* A table of one: no chairs to wait for, nothing to claim, nothing to name. */
              seatCount: 1,
              /* And therefore nothing for Nova to fill — there are no empty chairs. */
              botFill: false,
              botTeams: RIVALS_IN_A_CUSTOM_SEASON,
              createdAt: new Date(),
            }).returning();

            await db.insert(simulationSeasonStarts).values({
              listingId: listing.id,
              purchaseId,
              seasonId: season.id,
              startedBy: req.user.id,
              inviteCode,
            });
            /* The author's own runs do not count — see the same guard in `/play`. */
            if (!isAuthor) {
              await db.update(simulationListings)
                .set({ seasonsStarted: sql`${simulationListings.seasonsStarted} + 1`, updatedAt: new Date() })
                .where(eq(simulationListings.id, listing.id));
              await countPlayer(listing.id, req.user.id);
            }

            /* Their chair, the rivals, the lobby resolved, and the first year started. */
            const ventureId = await db.transaction((tx) => takeSeatInSeason(tx, season.id, req.user.id, 1));
            await seatBotCompanies(season.id, RIVALS_IN_A_CUSTOM_SEASON)
              .catch((err) => console.error("[sim-market] seating rivals failed:", err));
            await advanceVenture(ventureId);
            const started = await startSeason(season.id);

            return res.status(201).json({
              ventureId,
              seasonId: season.id,
              /* Where to send them: the desk itself, not a lobby and not a join page. */
              deskPath: `/simulation/${ventureId}`,
              running: started.outcome === "started",
              seatSpent: !!purchaseId,
            });
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
          }
        }
        throw new Error("Couldn't make a join code");
      } catch (error) {
        /* The seat was spent and the season was not. See `/play`: this is money. */
        if (purchaseId) {
          await db.update(simulationPurchases)
            .set({ seatsLeft: sql`${simulationPurchases.seatsLeft} + 1` })
            .where(eq(simulationPurchases.id, purchaseId));
        }
        throw error;
      }
    } catch (error) {
      console.error("Sim try error:", error);
      res.status(500).json({ message: "Couldn't start that simulation" });
    }
  });

  /**
   * What somebody has bought and what they have sold.
   *
   * One route for both because they are two readings of the same table, and
   * the profile page shows them side by side.
   */
  app.get("/api/sim-market/me", isAuthenticated, async (req: any, res) => {
    try {
      const bought = await db
        .select({ purchase: simulationPurchases, title: simulationListings.title, listingId: simulationListings.id })
        .from(simulationPurchases)
        .leftJoin(simulationListings, eq(simulationListings.id, simulationPurchases.listingId))
        .where(eq(simulationPurchases.buyerId, req.user.id))
        .orderBy(desc(simulationPurchases.createdAt))
        .limit(50);

      const sold = await db
        .select({ purchase: simulationPurchases, title: simulationListings.title, listingId: simulationListings.id })
        .from(simulationPurchases)
        .leftJoin(simulationListings, eq(simulationListings.id, simulationPurchases.listingId))
        .where(eq(simulationPurchases.sellerId, req.user.id))
        .orderBy(desc(simulationPurchases.createdAt))
        .limit(50);

      const mine = await db.select().from(simulationListings)
        .where(eq(simulationListings.authorId, req.user.id))
        .orderBy(desc(simulationListings.createdAt));

      /*
       * Every season this person started from a listing, theirs or somebody
       * else's, hung off the purchase it was started with.
       *
       * This is the whole point of the row: a purchase with four seats left is
       * only half of "what have I got", and the other half — the game that is
       * running right now — had no way to be asked for at all.
       */
      const started = await seasonsStartedBy(req.user.id);
      const byPurchase = new Map<string, typeof started>();
      const byListing = new Map<string, typeof started>();
      for (const s of started) {
        if (s.purchaseId) byPurchase.set(s.purchaseId, [...(byPurchase.get(s.purchaseId) ?? []), s]);
        byListing.set(s.listingId, [...(byListing.get(s.listingId) ?? []), s]);
      }

      /*
       * Three sums over every row, in two queries, beside the two capped lists.
       * `sellerOwedSql` is the same arithmetic as `sellerOwed`, held to it by a
       * parity test — see the note on that expression.
       */
      const [earned] = await db
        .select({ cents: sql<number>`coalesce(sum(${sellerOwedSql}), 0)::int` })
        .from(simulationPurchases)
        .where(eq(simulationPurchases.sellerId, req.user.id));
      const [spent] = await db
        .select({
          cents: sql<number>`coalesce(sum(greatest(0, ${simulationPurchases.paidCents} - ${simulationPurchases.refundedCents})), 0)::int`,
          seats: sql<number>`coalesce(sum(greatest(0, ${simulationPurchases.seatsLeft})), 0)::int`,
        })
        .from(simulationPurchases)
        .where(eq(simulationPurchases.buyerId, req.user.id));
      const totals = {
        earnedCents: earned?.cents ?? 0,
        spentCents: spent?.cents ?? 0,
        seatsLeft: spent?.seats ?? 0,
      };

      res.json({
        listings: mine.map((l) => ({ ...forCard(l), seasons: byListing.get(l.id) ?? [] })),
        purchases: bought.map((b) => ({
          id: b.purchase.id, listingId: b.listingId, title: b.title,
          seats: b.purchase.seats, seatsLeft: b.purchase.seatsLeft,
          paidCents: b.purchase.paidCents, at: b.purchase.createdAt,
          seasons: byPurchase.get(b.purchase.id) ?? [],
        })),
        /*
         * `sellerOwed`, not the split recorded at the sale.
         *
         * This read `sellerCents` and so ignored refunds completely: a seller
         * who had three of five seats sent back was still told they had earned
         * the full split of all five, while the earnings statement said
         * something else again and the sweep paid a third number. One sale
         * should have one figure, and this is the figure that arrives.
         */
        sales: sold.map((s) => ({
          id: s.purchase.id, listingId: s.listingId, title: s.title,
          seats: s.purchase.seats, earnedCents: sellerOwed(s.purchase), at: s.purchase.createdAt,
        })),
        /* The totals a seller actually wants, computed once rather than in the browser. */
        totals: {
          earnedCents: sold.reduce((n, s) => n + sellerOwed(s.purchase), 0),
          /*
           * What it cost them, after anything that came back. The same mistake
           * as the seller's side above: this summed `paidCents`, so a buyer who
           * had four of five seats refunded was still shown the whole amount as
           * spent.
           */
          spentCents: bought.reduce((n, b) => n + Math.max(0, b.purchase.paidCents - b.purchase.refundedCents), 0),
          seatsLeft: bought.reduce((n, b) => n + b.purchase.seatsLeft, 0),
          /* Games to go back to, which is the number somebody is looking for. */
          running: started.filter((s) => s.status === "forming" || s.status === "running").length,
        },
      });
    } catch (error) {
      console.error("Sim market history error:", error);
      res.status(500).json({ message: "Couldn't load your simulations" });
    }
  });

  // ─── Sending one to somebody ──────────────────────────────────────────────

  /**
   * Mint a link that reaches this listing without listing it.
   *
   * The author's own switch, and the only one that does not need the listing to
   * be public — which is the point. A market written around one real business
   * names its segments, its regions and the competitors already holding share,
   * so publishing it in order to reach one person hands a study of a named
   * company to everybody, including the people it competes with.
   *
   * A draft can be shared. Publishing is the moment something is *promised* to
   * strangers, and this promises nothing to anybody but the person given the
   * link; making them publish first would be the same leak by a longer route.
   */
  app.post("/api/sim-market/listings/:id/shares", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [listing] = await db.select().from(simulationListings)
        .where(eq(simulationListings.id, req.params.id));
      /* 404 and not 403: whose listing this is, is not the asker's business. */
      if (!listing || listing.authorId !== req.user.id) {
        return res.status(404).json({ message: "Simulation not found" });
      }
      if (listing.takenDownAt) {
        return res.status(403).json({
          message: "This listing was taken down by a reviewer and cannot be shared.",
          reason: listing.takenDownReason,
        });
      }

      const problems = checkShare(req.body ?? {});
      if (problems.length) return res.status(400).json({ message: problems[0].message, problems });

      const uses = Math.max(1, Math.min(SHARE_USES_MAX, Math.floor(Number(req.body?.uses) || 1)));
      const days = Number(req.body?.expiresInDays);
      const expiresAt = Number.isFinite(days) && days > 0
        ? new Date(Date.now() + Math.min(SHARE_DAYS_MAX, days) * 86_400_000)
        : null;

      /*
       * Retried on a clash like a season code is. The token is 32 bytes of
       * randomness so a collision is not a thing that happens, but the unique
       * index is what guarantees it and a retry is two lines.
       */
      for (let attempt = 0; attempt < 5; attempt++) {
        const token = newShareToken();
        try {
          const [link] = await db.insert(simulationShareLinks).values({
            listingId: listing.id,
            createdBy: req.user.id,
            token,
            note: typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 120) || null : null,
            uses,
            expiresAt,
          }).returning();
          return res.status(201).json({ share: shareForAuthor(link) });
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
      throw new Error("Couldn't mint a share link");
    } catch (error) {
      console.error("Sim share mint error:", error);
      res.status(500).json({ message: "Couldn't make a link for that" });
    }
  });

  /** Every link on a listing, with how much of each is left. Author only. */
  app.get("/api/sim-market/listings/:id/shares", isAuthenticated, async (req: any, res) => {
    try {
      const [listing] = await db.select().from(simulationListings)
        .where(eq(simulationListings.id, req.params.id));
      if (!listing || listing.authorId !== req.user.id) {
        return res.status(404).json({ message: "Simulation not found" });
      }

      const links = await db.select().from(simulationShareLinks)
        .where(eq(simulationShareLinks.listingId, listing.id))
        .orderBy(desc(simulationShareLinks.createdAt));

      /*
       * Who opened each one, in one query rather than one per link. The author
       * asked "did they play it yet", and that is the answer.
       */
      const uses = links.length
        ? await db.select({
          linkId: simulationShareUses.linkId,
          at: simulationShareUses.createdAt,
          name: userProfiles.displayName,
        })
          .from(simulationShareUses)
          .leftJoin(userProfiles, eq(userProfiles.userId, simulationShareUses.claimedBy))
          .where(inArray(simulationShareUses.linkId, links.map((l) => l.id)))
          .orderBy(desc(simulationShareUses.createdAt))
        : [];

      const byLink = new Map<string, { name: string | null; at: Date }[]>();
      for (const u of uses) {
        const list = byLink.get(u.linkId) ?? [];
        list.push({ name: u.name ?? null, at: u.at });
        byLink.set(u.linkId, list);
      }

      res.json({
        shares: links.map((l) => ({ ...shareForAuthor(l), opened: byLink.get(l.id) ?? [] })),
        rules: { usesMax: SHARE_USES_MAX, daysMax: SHARE_DAYS_MAX },
      });
    } catch (error) {
      console.error("Sim share list error:", error);
      res.status(500).json({ message: "Couldn't load the links for that" });
    }
  });

  /**
   * Stop a link working.
   *
   * The reason this is a row in a table rather than a signed token: a link sent
   * to the wrong address, or to somebody a deal fell through with, has to stop
   * working. Seasons already started from it are left alone — they are somebody
   * else's game now, and taking one away is not what revoking a link means.
   */
  app.post("/api/sim-market/shares/:id/revoke", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [revoked] = await db.update(simulationShareLinks)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(simulationShareLinks.id, req.params.id),
          eq(simulationShareLinks.createdBy, req.user.id),
        ))
        .returning();
      if (!revoked) return res.status(404).json({ message: "Link not found" });
      res.json({ share: shareForAuthor(revoked) });
    } catch (error) {
      console.error("Sim share revoke error:", error);
      res.status(500).json({ message: "Couldn't revoke that" });
    }
  });

  /**
   * What the link shows, to whoever opens it.
   *
   * Public, like `/preview`, and for the same reason: somebody sent this to a
   * person who may have no account, and a page that cannot say what it is
   * offering until you sign up is asking for the signup first.
   *
   * Sends no more than `/preview` does. No market — `listingDetail` never ships
   * `customMarket` to any client, because the market is the product — and not
   * the author's note, which is a note to self about who the link was for.
   *
   * A spent, revoked or expired link answers 410 rather than 404: the
   * difference between "this was never a thing" and "this was yours and is
   * finished" is the difference between a person thinking they were sent a bad
   * address and knowing to ask for another link.
   */
  app.get("/api/sim-market/shares/:token", async (req: any, res) => {
    try {
      const link = await shareByToken(String(req.params.token ?? ""));
      if (!link) return res.status(404).json({ message: "That link doesn't go anywhere" });

      const [listing] = await db.select().from(simulationListings)
        .where(eq(simulationListings.id, link.listingId));
      if (!listing || listing.takenDownAt) {
        return res.status(404).json({ message: "That link doesn't go anywhere" });
      }

      const state = shareState(link);
      const [author] = await db.select({ name: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl })
        .from(userProfiles).where(eq(userProfiles.userId, listing.authorId));

      /* Who sent it and what it is, even when it is spent: that is the message. */
      const body = {
        listing: listingDetail(listing, { name: author?.name ?? null, avatarUrl: author?.avatarUrl ?? null }),
        share: { usesLeft: Math.max(0, link.uses - link.usesSpent), expiresAt: link.expiresAt, state },
        /* Shaped like the signed-in replies so the page needs no second branch. */
        youOwn: { seats: 0, purchases: 0, seasons: [] },
        isAuthor: false,
      };
      res.status(state === "open" ? 200 : 410).json(body);
    } catch (error) {
      console.error("Sim share read error:", error);
      res.status(500).json({ message: "Couldn't open that link" });
    }
  });

  /**
   * Redeem it: one tap from the link into a playable year.
   *
   * The same season `/try` makes — a table of one, rivals seated, year one
   * running — and deliberately so: somebody who followed a link sent to them
   * should meet their business, not a lobby with four empty chairs.
   *
   * What differs is what it costs and what it needs. Nothing, and no seats: the
   * author is giving this away, which is what minting the link said. So no
   * purchase is read, none is written, and nothing lands in anybody's earnings
   * — a share recorded as a zero-priced sale is how an earnings report comes to
   * include sales that never happened.
   *
   * Signing in is still required, because a season belongs to somebody. The
   * page before this one is public so they can see what they were sent first.
   */
  app.post("/api/sim-market/shares/:token/try", isAuthenticated, rateLimit("sprint"), async (req: any, res) => {
    try {
      const link = await shareByToken(String(req.params.token ?? ""));
      if (!link) return res.status(404).json({ message: "That link doesn't go anywhere" });
      if (shareState(link) !== "open") {
        return res.status(410).json({ message: shareGone(link), state: shareState(link) });
      }

      /*
       * The author's standing comes down with the link.
       *
       * Minting one is already impossible while suspended — the suspension
       * check covers every write — but links minted *before* a ban went on
       * working, so the site carried on handing out a banned account's work.
       * Nobody is deprived of anything they paid for here, which is what made
       * the opposite call right for `/play`: a share was free.
       */
      const [row] = await db
        .select({ listing: simulationListings, suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
        .from(simulationListings)
        .innerJoin(users, eq(users.id, simulationListings.authorId))
        .where(eq(simulationListings.id, link.listingId));
      if (!row || row.listing.takenDownAt || row.suspendedAt || row.deletedAt) {
        return res.status(404).json({ message: "That link doesn't go anywhere" });
      }
      const listing = row.listing;

      /*
       * The use is taken BEFORE the season is made, with the condition in the
       * UPDATE — the same shape as a bought seat. Two people opening the last
       * use of a forwarded link both read one left, and only one of them finds
       * it there. Counting afterwards would hand both of them a season.
       */
      const [spentLink] = await db.update(simulationShareLinks)
        .set({ usesSpent: sql`${simulationShareLinks.usesSpent} + 1` })
        .where(and(
          eq(simulationShareLinks.id, link.id),
          sql`${simulationShareLinks.usesSpent} < ${simulationShareLinks.uses}`,
          sql`${simulationShareLinks.revokedAt} is null`,
        ))
        .returning();
      if (!spentLink) return res.status(410).json({ message: "That link has just been used up.", state: "spent" });

      try {
        const niche = listing.customMarket
          ? buildCustomMarket(listing.customMarket, `listing-${listing.id}`)
          : null;
        if (listing.customMarket && !niche) throw new Error("This listing's market is no longer playable");

        const name = String(req.body?.name ?? "").trim().slice(0, 80) || listing.title;

        for (let attempt = 0; attempt < 5; attempt++) {
          const inviteCode = newSeasonCode();
          try {
            const [season] = await db.insert(simSeasons).values({
              nicheId: niche?.id ?? listing.nicheId ?? "custom",
              name,
              status: "forming",
              totalYears: listing.totalYears,
              cadence: listing.cadence,
              botSkill: listing.botSkill,
              customMarket: niche ?? null,
              origin: "nova",
              inviteCode,
              /* A table of one: nothing to wait for, claim or name. See `/try`. */
              seatCount: 1,
              botFill: false,
              botTeams: RIVALS_IN_A_CUSTOM_SEASON,
              createdAt: new Date(),
            }).returning();

            await db.insert(simulationShareUses).values({
              linkId: link.id,
              claimedBy: req.user.id,
              seasonId: season.id,
            });
            /*
             * And not here either. Minting a link and opening it yourself is a
             * quieter version of the same thing — the author is not a stranger
             * who chose this listing, which is what the number claims to count.
             */
            if (listing.authorId !== req.user.id) {
              await db.update(simulationListings)
                .set({ seasonsStarted: sql`${simulationListings.seasonsStarted} + 1`, updatedAt: new Date() })
                .where(eq(simulationListings.id, listing.id));
              await countPlayer(listing.id, req.user.id);
            }

            const ventureId = await db.transaction((tx) => takeSeatInSeason(tx, season.id, req.user.id, 1));
            await seatBotCompanies(season.id, RIVALS_IN_A_CUSTOM_SEASON)
              .catch((err) => console.error("[sim-market] seating rivals failed:", err));
            await advanceVenture(ventureId);
            const started = await startSeason(season.id);

            return res.status(201).json({
              ventureId,
              seasonId: season.id,
              deskPath: `/simulation/${ventureId}`,
              running: started.outcome === "started",
              /* Nothing was spent by anybody. Said plainly, because it is the difference. */
              seatSpent: false,
            });
          } catch (err) {
            if (!isUniqueViolation(err)) throw err;
          }
        }
        throw new Error("Couldn't make a join code");
      } catch (error) {
        /*
         * The use was taken and the season was not. Put it back — otherwise a
         * failure here quietly costs somebody the one use they were sent, and
         * the author has no way to know they need to send another.
         */
        await db.update(simulationShareLinks)
          .set({ usesSpent: sql`greatest(0, ${simulationShareLinks.usesSpent} - 1)` })
          .where(eq(simulationShareLinks.id, link.id));
        throw error;
      }
    } catch (error) {
      console.error("Sim share redeem error:", error);
      res.status(500).json({ message: "Couldn't start that simulation" });
    }
  });
}
