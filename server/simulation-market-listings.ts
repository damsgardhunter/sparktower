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
import { and, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { db } from "./db";
import { simulationListings, simulationPurchases, simSeasons, userProfiles, projects, companies } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { spend, refund, walletOf } from "./wallet";
import { buildCustomMarket } from "@shared/simulation/custom-market";
import { newSeasonCode, joinPathFor, isUniqueViolation } from "./company-season-routes";
import { writeListingCopy } from "./simulation-listing-write";
import { hasAcceptedSellerTerms } from "./simulation-market-compliance";
import { SELLER_TERMS_VERSION, releasableAt } from "@shared/simulation-market-terms";
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

const orderFor = (sort: ListingSort) => {
  switch (sort) {
    case "popular": return [desc(simulationListings.seasonsStarted), desc(simulationListings.publishedAt)];
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

      const rows = await db
        .select({
          listing: simulationListings,
          authorName: userProfiles.displayName,
          authorAvatar: userProfiles.avatarUrl,
        })
        .from(simulationListings)
        .leftJoin(userProfiles, eq(userProfiles.userId, simulationListings.authorId))
        .where(and(...where))
        .orderBy(...orderFor(sort))
        .limit(60);

      res.json({
        listings: rows.map((r) => forCard({ ...r.listing, authorName: r.authorName, authorAvatar: r.authorAvatar })),
        /* So no screen hardcodes a price range or a fee the owner changed. */
        rules: { seatPriceMinCents: SEAT_PRICE_MIN_CENTS, seatPriceMaxCents: SEAT_PRICE_MAX_CENTS, platformSharePercent: PLATFORM_SHARE_PERCENT },
      });
    } catch (error) {
      console.error("Sim marketplace list error:", error);
      res.status(500).json({ message: "Couldn't load the marketplace" });
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

      res.json({
        listing: listingDetail(row, { name: author?.name ?? null, avatarUrl: author?.avatarUrl ?? null }),
        /* What this person already holds, so the page offers "play" rather than "buy". */
        youOwn: { seats: mine.reduce((n, p) => n + p.seatsLeft, 0), purchases: mine.length },
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

      const [listing] = await db.select().from(simulationListings).where(eq(simulationListings.id, req.params.id));
      if (!listing || listing.status !== "listed") return res.status(404).json({ message: "Simulation not found" });
      if (listing.authorId === req.user.id) {
        return res.status(400).json({ message: "This is yours — you can play it without buying seats.", field: "seats" });
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

      try {
        const [purchase] = await db.insert(simulationPurchases).values({
          listingId: listing.id,
          buyerId: req.user.id,
          sellerId: listing.authorId,
          seats,
          paidCents: paid.amountCents,
          platformCents,
          sellerCents,
          seatsLeft: seats,
          /* Held for the refund window — see shared/simulation-market-terms.ts. */
          releasableAt: releasableAt(new Date()),
        }).returning();

        /* Counters beside the row they count, in the same statement. */
        await db.update(simulationListings).set({
          seatsSold: sql`${simulationListings.seatsSold} + ${seats}`,
          grossCents: sql`${simulationListings.grossCents} + ${paid.amountCents}`,
          updatedAt: new Date(),
        }).where(eq(simulationListings.id, listing.id));

        /*
         * The author is not paid here. The money is held for the refund window
         * and released by the sweep in `simulation-market-compliance.ts`;
         * crediting at the moment of sale is money already gone when the
         * refund arrives.
         */

        res.status(201).json({ purchase: { id: purchase.id, seats, paidCents: paid.amountCents } });
      } catch (error) {
        /* The money moved and the row did not. Put it back before anything else. */
        if (paid.amountCents > 0) {
          await refund(req.user.id, paid.amountCents, { outcome: "seasonSeat", note: "Seats that could not be bought" });
        }
        throw error;
      }
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

      const name = String(req.body?.name ?? "").trim() || listing.title;

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
              createdAt: new Date(),
            }).returning();

            await db.update(simulationListings)
              .set({ seasonsStarted: sql`${simulationListings.seasonsStarted} + 1`, updatedAt: new Date() })
              .where(eq(simulationListings.id, listing.id));

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

      res.json({
        listings: mine.map((l) => forCard(l)),
        purchases: bought.map((b) => ({
          id: b.purchase.id, listingId: b.listingId, title: b.title,
          seats: b.purchase.seats, seatsLeft: b.purchase.seatsLeft,
          paidCents: b.purchase.paidCents, at: b.purchase.createdAt,
        })),
        sales: sold.map((s) => ({
          id: s.purchase.id, listingId: s.listingId, title: s.title,
          seats: s.purchase.seats, earnedCents: s.purchase.sellerCents, at: s.purchase.createdAt,
        })),
        /* The totals a seller actually wants, computed once rather than in the browser. */
        totals: {
          earnedCents: sold.reduce((n, s) => n + s.purchase.sellerCents, 0),
          spentCents: bought.reduce((n, b) => n + b.purchase.paidCents, 0),
          seatsLeft: bought.reduce((n, b) => n + b.purchase.seatsLeft, 0),
        },
      });
    } catch (error) {
      console.error("Sim market history error:", error);
      res.status(500).json({ message: "Couldn't load your simulations" });
    }
  });
}
