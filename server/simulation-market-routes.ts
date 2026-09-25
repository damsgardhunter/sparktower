/**
 * The marketplace, and the moves a company makes when it is in trouble.
 *
 * ## Sealed means sealed
 *
 * The one rule this file exists to enforce: nobody sees anybody else's bid
 * until the tick resolves them. Not the amounts, not who bid, not how many.
 * A marketplace that leaked the current high bid would be an auction with a
 * countdown, decided by whoever happened to be awake at the end of it — and
 * the whole reason for sealing them is to make it a judgement about what the
 * thing is worth to your team instead of a race.
 *
 * So the listings route returns your own bid and nothing about anyone else's,
 * and it does so deliberately rather than by omission.
 */
import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  simSeasons, simSeats, simVentures, simListings, simBids, simRecoveryMoves, simOffers, simReports,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit } from "./moderation";
import { nicheById } from "@shared/simulation/niches";
import { marketOf } from "./simulation-scope";
import { PERIOD_NAME, periodsPerYear, type Cadence } from "@shared/simulation/cadence";
import { currencyForSeason } from "./simulation-desk-routes";
import type { World, Company, CompanyAsset, Role } from "@shared/simulation/types";
import { assetEffects, marketListings, resaleValue, biddableFunds } from "@shared/simulation/assets";
import { distressOf, recoveryOptions, type RecoveryKind } from "@shared/simulation/recovery";
import { valuation, canOffer, assessOffer, alreadySold } from "@shared/simulation/mergers";
import { YEAR_CLOSING, yearClosing } from "./simulation-tick";

const KINDS: RecoveryKind[] = ["restructure", "fire_sale", "dissolve_seat", "rescue_raise"];

/**
 * The venture, the season, this person's seat and their company — or nothing at all.
 *
 * ## A finished season is still a season
 *
 * This used to refuse anything whose status was not exactly `running`, which
 * meant that the instant the fourteenth year resolved, the standings, the
 * market, the boardroom and the recovery screen all started answering 404 —
 * and all four clients read a failed query as "still loading". So the end of a
 * fortnight's play was a spinner on the one screen everybody opens to find out
 * how it went.
 *
 * The giveaway that nobody meant this: both routes serialise `season.status`
 * and both pages branch on it being "finished", code that could never run.
 *
 * So a finished season loads. What it does not do is accept a decision — every
 * route that changes something checks `over` and says so in words, because
 * "the season is over" is a different answer from "no such company" and the
 * person reading it has earned the difference.
 */
async function context(ventureId: string, userId: string) {
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  if (!venture) return null;

  const [seat] = await db.select().from(simSeats)
    .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, userId)));
  if (!seat) return null;

  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
  if (!season?.world || (season.status !== "running" && season.status !== "finished")) return null;

  const world = season.world as World;
  const company = world.companies.find((c) => c.id === ventureId);
  if (!company) return null;

  return { venture, seat, season, world, company, over: season.status === "finished" };
}

/** Said once, so every route that changes something refuses it the same way. */
const SEASON_OVER = {
  message: "The season is over. Nothing moves now — but everything that happened is still here to read.",
  code: "season_over",
};

/*
 * And every route that changes something also refuses once the year is due
 * (`yearClosing`): from that moment the tick may already have read the bids,
 * listings, offers and recovery moves it is going to act on, so anything
 * accepted now would be recorded and then silently not happen.
 */

export function registerSimulationMarketRoutes(app: Express): void {
  /**
   * What is for sale this year, what you own, and what you have bid.
   *
   * Everyone in the season sees the same open market — it is generated from
   * the season and year rather than stored, so it cannot drift and a re-run of
   * the tick deals the same hand.
   */
  app.get("/api/sim/ventures/:id/market", isAuthenticated, async (req: any, res) => {
    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    const { season, company, world } = ctx;

    const niche = marketOf(season)!;
    const year = season.year;

    const fromTeams = await db.select().from(simListings).where(and(
      eq(simListings.seasonId, season.id),
      eq(simListings.year, year),
      eq(simListings.status, "open"),
    ));

    const mine = await db.select().from(simBids).where(and(
      eq(simBids.ventureId, company.id),
      eq(simBids.year, year),
    ));
    const myBid = (listingId: string) => mine.find((b) => b.listingId === listingId)?.amount ?? null;

    const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? "Another team";

    const listings = [
      /* Not the things this company already holds — see `owned` on marketListings. */
      ...marketListings({
        seasonId: season.id, year, niche,
        periods: periodsPerYear(season.cadence as Cadence),
        owned: (company.assets ?? []).map((a) => a.name),
      }).map((l) => ({
        id: l.id,
        name: l.asset.name,
        kind: l.asset.kind,
        blurb: l.blurb,
        effect: l.asset.effect,
        expiresIn: l.asset.expiresIn ?? null,
        reserve: l.reserve,
        seller: null as string | null,
        yourBid: myBid(l.id),
      })),
      ...fromTeams
        // Your own listing is not something to bid on.
        .filter((row) => row.sellerId !== company.id)
        .map((row) => {
          const asset = row.asset as CompanyAsset;
          return {
            id: row.id,
            name: asset.name,
            kind: asset.kind,
            blurb: `Second-hand, from ${nameOf(row.sellerId)}.`,
            effect: asset.effect,
            expiresIn: asset.expiresIn ?? null,
            reserve: row.reserve,
            seller: nameOf(row.sellerId),
            yourBid: myBid(row.id),
          };
        }),
    ];

    const myOpen = await db.select().from(simListings).where(and(
      eq(simListings.seasonId, season.id),
      eq(simListings.sellerId, company.id),
      eq(simListings.year, year),
    ));
    const listedAssetIds = new Set(myOpen.filter((r) => r.status === "open").map((r) => (r.asset as CompanyAsset).id));

    res.json({
      year,
      /**
       * The seat this person holds, and when the year settles.
       *
       * Both are already on the desk, and a client that needed them had to
       * fetch that too just to know whether to show a sell button and what to
       * count down to. Two fields here save a screen a second request for
       * facts it cannot act without.
       */
      yourRole: ctx.seat.role,
      /**
       * What one decision is called here, and how many of them make a year.
       *
       * The auction has always settled once a tick, so a quarterly season's
       * bids were already decided every quarter — only the words said "year".
       * `periods` is sent alongside because an asset's life is counted in
       * periods too: a three-year licence in a quarterly season is twelve of
       * them, and the screen was printing that as "12 years".
       */
      period: PERIOD_NAME[(season.cadence ?? "yearly") as Cadence],
      periods: periodsPerYear(season.cadence as Cadence),
      /* What this company counts money in. The page had £ hardcoded in its own formatter. */
      currency: await currencyForSeason(season.companyId),
      /*
       * Where this company stands on each axis a lot can move.
       *
       * A listing said "+6 quality" and "+4,038 capacity" and left a founder to
       * do the arithmetic against numbers held on a different screen — which is
       * the whole decision. Sent so the listing can say what winning it would
       * make *this* company, rather than what it would add to somebody.
       */
      you: {
        quality: Math.round(company.quality),
        brand: Math.round(company.brand),
        service: Math.round(company.service),
        capacity: Math.round(company.capacity) + assetEffects(company.assets ?? []).capacity,
        unitCost: Math.round(company.unitCost * 100) / 100,
      },
      resolvesAt: season.nextTickAt,
      /** Cash plus what is still borrowable — what a bid can actually be backed by. */
      funds: biddableFunds(company),
      /*
       * Sealed: the number of bidders is not here either. Knowing three other
       * teams want it tells you to bid higher, which is the same auction the
       * sealed bid exists to avoid.
       */
      listings,
      /** What the company owns, and what it would fetch. */
      holdings: company.assets.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        effect: a.effect,
        expiresIn: a.expiresIn ?? null,
        bookValue: a.bookValue,
        willingSale: resaleValue(a, { forced: false }),
        forcedSale: resaleValue(a, { forced: true }),
        /*
         * Real rather than hardcoded false. A client matching a listing to a
         * holding by name would cross-match two assets with the same name,
         * which the open market can hand out in different years.
         */
        listed: listedAssetIds.has(a.id),
      })),
      /** Your own things currently up for sale. */
      selling: myOpen.map((row) => ({
        id: row.id,
        // The asset's own id, so a client never has to match on the name.
        assetId: (row.asset as CompanyAsset).id,
        name: (row.asset as CompanyAsset).name,
        reserve: row.reserve,
        status: row.status,
      })),
    });
  });

  /**
   * Bid, or change your mind.
   *
   * Replaceable until the tick, like every other decision here. A bid you
   * cannot pay for is accepted and simply loses at settlement — refusing it
   * now would leak that the money had moved, and the money may well be back by
   * the time the year resolves.
   */
/**
 * Bidding is the chief executive's call, and the table watches.
 *
 * A bid is the company's, not a seat's: one bid per listing per year, sealed,
 * and it spends money the whole table is counting on. Every seat could place,
 * raise and withdraw it, which meant five people could talk each other's bids
 * over the top of one another with no record of who did what — and the money
 * left the company anyway. So the call sits in the chair that answers for the
 * company's money, exactly like selling the business and taking a deal, and
 * everyone else sees the bid and what it would buy (see `GET /market`, where
 * `yourBid` is the company's bid whoever filed it).
 */
const BID_IS_THE_CEOS = {
  message: "Bidding is the chief executive's call. You can see the bid and what it would buy.",
  code: "not_yours",
} as const;

  app.post("/api/sim/ventures/:id/bids", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;

    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.over) return res.status(409).json(SEASON_OVER);
    if (yearClosing(ctx.season)) return res.status(409).json(YEAR_CLOSING);
    const { season, company, seat } = ctx;
    if (seat.role !== "ceo") return res.status(403).json(BID_IS_THE_CEOS);

    const listingId = String(req.body?.listingId ?? "");
    const amount = Math.round(Number(req.body?.amount));
    if (!listingId) return res.status(400).json({ message: "Which listing?" });
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ message: "That isn't an amount." });

    const niche = marketOf(season)!;
    const year = season.year;
    const open = marketListings({
      seasonId: season.id, year, niche,
      periods: periodsPerYear(season.cadence as Cadence),
      owned: (company.assets ?? []).map((a) => a.name),
    }).map((l) => l.id);
    const [fromTeam] = await db.select().from(simListings).where(and(
      eq(simListings.id, listingId),
      eq(simListings.status, "open"),
      eq(simListings.year, year),
    ));

    if (!open.includes(listingId) && !fromTeam) {
      return res.status(404).json({ message: "That isn't for sale." });
    }
    if (fromTeam?.sellerId === company.id) {
      return res.status(409).json({ message: "You can't bid on your own listing.", code: "own_listing" });
    }

    await db.insert(simBids)
      .values({ ventureId: company.id, listingId, year, amount })
      .onConflictDoUpdate({
        target: [simBids.ventureId, simBids.listingId, simBids.year],
        set: { amount, createdAt: new Date() },
      });

    res.json({ ok: true, listingId, amount, funds: biddableFunds(company) });
  });

  /** Withdraw a bid entirely. */
  app.delete("/api/sim/ventures/:id/bids/:listingId", isAuthenticated, async (req: any, res) => {
    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.over) return res.status(409).json(SEASON_OVER);
    if (yearClosing(ctx.season)) return res.status(409).json(YEAR_CLOSING);
    if (ctx.seat.role !== "ceo") return res.status(403).json(BID_IS_THE_CEOS);

    await db.delete(simBids).where(and(
      eq(simBids.ventureId, ctx.company.id),
      eq(simBids.listingId, req.params.listingId),
      eq(simBids.year, ctx.season.year),
    ));
    res.json({ ok: true });
  });

  /**
   * Put something the company owns up for sale.
   *
   * The seller names the reserve, which is the honest version of pricing: the
   * market answers by meeting it or not, and a reserve nobody meets is its own
   * feedback.
   */
  app.post("/api/sim/ventures/:id/listings", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;

    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.over) return res.status(409).json(SEASON_OVER);
    if (yearClosing(ctx.season)) return res.status(409).json(YEAR_CLOSING);
    const { season, company, seat } = ctx;

    // Selling the company's things is the chief executive's or the finance
    // seat's call, not any of the five.
    if (seat.role !== "ceo" && seat.role !== "cfo") {
      return res.status(403).json({ message: "Selling what the company owns is the chief executive's or the finance seat's call.", code: "not_yours" });
    }

    const assetId = String(req.body?.assetId ?? "");
    const reserve = Math.round(Number(req.body?.reserve));
    const asset = company.assets.find((a) => a.id === assetId);
    if (!asset) return res.status(404).json({ message: "You don't own that." });
    if (!Number.isFinite(reserve) || reserve < 0) return res.status(400).json({ message: "Set a reserve." });

    /*
     * Is this asset already on the block?
     *
     * This used to fetch whichever single open listing the seller happened to
     * have and compare its asset id — so a company selling two things listed
     * A, listed B, then listed A again, and the check looked at B, decided
     * this was something new, and inserted a second open listing for A. At
     * settlement both resolved: two teams each received a copy of the same
     * asset and the seller was paid twice for it.
     *
     * Matched on the asset now, in the query, rather than on whatever came
     * back first. Re-listing the same thing sets a new reserve, which is what
     * the seller meant by doing it.
     */
    const open = await db.select().from(simListings).where(and(
      eq(simListings.sellerId, company.id),
      eq(simListings.year, season.year),
      eq(simListings.status, "open"),
    ));
    const already = open.find((l) => (l.asset as CompanyAsset).id === assetId);
    if (already) {
      await db.update(simListings).set({ reserve }).where(eq(simListings.id, already.id));
      return res.json({ ok: true, reserve });
    }

    await db.insert(simListings).values({
      seasonId: season.id,
      sellerId: company.id,
      year: season.year,
      asset,
      reserve,
    });
    res.json({ ok: true, reserve });
  });

  /** Take it off the market. */
  app.delete("/api/sim/ventures/:id/listings/:listingId", isAuthenticated, async (req: any, res) => {
    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.over) return res.status(409).json(SEASON_OVER);
    if (yearClosing(ctx.season)) return res.status(409).json(YEAR_CLOSING);

    await db.update(simListings).set({ status: "withdrawn" }).where(and(
      eq(simListings.id, req.params.listingId),
      eq(simListings.sellerId, ctx.company.id),
      eq(simListings.status, "open"),
      // A fire sale's lot was sold already, at the forced price; it is not the seller's to take back.
      eq(simListings.forced, false),
    ));
    res.json({ ok: true });
  });

  /**
   * Commit to a recovery move.
   *
   * One per year, and it takes effect before the next year runs rather than
   * immediately — a team that sold everything has to face the coming year
   * without it, which is the whole weight of the decision.
   *
   * Restricted to the chief executive, because these are the moves that change
   * what the company *is*: dissolving a colleague's seat or selling a third of
   * the company is not something one of five people should be able to do to
   * the other four on their own.
   */
  app.post("/api/sim/ventures/:id/recovery", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;

    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.over) return res.status(409).json(SEASON_OVER);
    if (yearClosing(ctx.season)) return res.status(409).json(YEAR_CLOSING);
    const { season, company, seat } = ctx;

    if (seat.role !== "ceo") {
      return res.status(403).json({
        message: "These change what the company is. They're the chief executive's call.",
        code: "not_ceo",
      });
    }

    const kind = String(req.body?.kind ?? "") as RecoveryKind;
    if (!KINDS.includes(kind)) return res.status(400).json({ message: "Not one of the moves." });

    const available = recoveryOptions(company, season.year).map((o) => o.kind);
    if (!available.includes(kind)) {
      return res.status(409).json({
        message: distressOf(company) === "healthy"
          ? "The company isn't in trouble. These are for when it is."
          : "That move isn't available in this position.",
        code: "not_available",
      });
    }

    const seatToDrop = req.body?.seat ? String(req.body.seat) : undefined;
    if (kind === "dissolve_seat") {
      if (!seatToDrop || !company.seats.includes(seatToDrop as Role)) {
        return res.status(400).json({ message: "Which seat?", field: "seat" });
      }
      if (seatToDrop === "ceo") {
        return res.status(400).json({ message: "You can't dissolve your own chair.", field: "seat" });
      }
    }

    await db.insert(simRecoveryMoves)
      .values({ ventureId: company.id, userId: req.user.id, year: season.year, kind, seat: seatToDrop ?? null })
      .onConflictDoUpdate({
        target: [simRecoveryMoves.ventureId, simRecoveryMoves.year],
        set: { kind, seat: seatToDrop ?? null, userId: req.user.id, createdAt: new Date() },
      });

    res.json({ ok: true, kind, seat: seatToDrop ?? null });
  });

  /**
   * Who could be bought, what they are worth, and what is on the table.
   *
   * Valuations are published to everyone, including the company being valued.
   * A negotiation where only one side can do the arithmetic is not a
   * negotiation — it is a trick played on whoever is newer to the game, and
   * the argument worth having is not "what is it worth" but "what is it worth
   * to *you*", which only starts once the boring part is settled.
   */
  app.get("/api/sim/ventures/:id/offers", isAuthenticated, async (req: any, res) => {
    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    const { season, company, world, seat } = ctx;

    const [made, received] = await Promise.all([
      db.select().from(simOffers).where(and(
        eq(simOffers.fromVentureId, company.id),
        eq(simOffers.year, season.year),
      )),
      db.select().from(simOffers).where(and(
        eq(simOffers.toVentureId, company.id),
        eq(simOffers.year, season.year),
      )),
    ]);

    const nameOf = (id: string) => world.companies.find((c) => c.id === id)?.name ?? "Another team";
    const rivals = world.companies.filter((c) => c.kind === "player" && c.id !== company.id);

    res.json({
      year: season.year,
      totalYears: season.totalYears,
      yourRole: seat.role,
      resolvesAt: season.nextTickAt,
      /** Where the season is, so a finished one does not render as a live screen. */
      status: season.status,
      /** What your own company is worth, so you know what a number on the table means. */
      you: {
        name: company.name,
        ...valuation(company),
        /*
         * Capacity, because it is the real constraint on buying anybody.
         * Customers bought are customers who must be served, and an acquirer
         * who cannot serve them turns them away — which costs reputation, in
         * public, at the moment everyone is watching. A screen without this
         * cannot warn about the one mistake this mechanic punishes hardest.
         */
        capacity: company.capacity,
        customers: Object.values(company.customers).reduce((sum, n) => sum + n, 0),
      },
      reach: company.cash + Math.max(0, company.creditLimit - company.debt),

      targets: rivals.map((rival) => ({
        id: rival.id,
        name: rival.name,
        customers: Object.values(rival.customers).reduce((sum, n) => sum + n, 0),
        distress: distressOf(rival),
        ...valuation(rival),
        /** Nothing left to buy: they have already sold the business to somebody. */
        hollow: alreadySold(rival),
      })),

      made: made.map((o) => ({
        id: o.id,
        to: nameOf(o.toVentureId),
        toId: o.toVentureId,
        amount: o.amount,
        message: o.message,
        status: o.status,
      })),

      received: received.map((o) => {
        const assessment = assessOffer(o.amount, company);
        return {
          id: o.id,
          from: nameOf(o.fromVentureId),
          fromId: o.fromVentureId,
          amount: o.amount,
          message: o.message,
          status: o.status,
          ...assessment,
        };
      }),
    });
  });

  /**
   * Offer to buy another team's company.
   *
   * The chief executive's, like the other moves that change what the company
   * is. Refused outright when it cannot be paid for, unlike a sealed bid: an
   * offer is a promise made to five other people who will spend a day
   * deciding about it, and dangling a number you never had wastes the one
   * thing this game is short of, which is everyone else's attention.
   */
  app.post("/api/sim/ventures/:id/offers", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;

    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.over) return res.status(409).json(SEASON_OVER);
    if (yearClosing(ctx.season)) return res.status(409).json(YEAR_CLOSING);
    const { season, company, world, seat } = ctx;

    if (seat.role !== "ceo") {
      return res.status(403).json({ message: "Buying another company is the chief executive's call.", code: "not_ceo" });
    }

    const targetId = String(req.body?.targetId ?? "");
    const amount = Math.round(Number(req.body?.amount));
    const message = String(req.body?.message ?? "").trim().slice(0, 280);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ message: "How much?", field: "amount" });

    const target = world.companies.find((c) => c.id === targetId);
    if (!target) return res.status(404).json({ message: "No such company." });

    /*
     * Offers already out there, counting the ones that have been said yes to.
     *
     * Only `pending` used to count, which meant an acceptance freed the money
     * up again: offer three million, have it accepted, then offer the same
     * three million to somebody else — nothing is `pending`, the affordability
     * check passes against cash that has not moved because nothing moves until
     * the tick, and the buyer arrives at the tick owing six.
     *
     * The tick now refuses the second purchase outright, so this is the half
     * that matters to the person at the screen: they find out when they make
     * the offer rather than when it silently fails to complete a day later,
     * having tied up a rival's decision in the meantime.
     */
    const committed = await db.select().from(simOffers).where(and(
      eq(simOffers.fromVentureId, company.id),
      eq(simOffers.year, season.year),
      inArray(simOffers.status, ["pending", "accepted"]),
    ));

    const allowed = canOffer({
      from: company,
      to: target,
      amount,
      pendingFrom: committed.filter((o) => o.toVentureId !== targetId).length,
      year: season.year,
      totalYears: season.totalYears,
    });
    if (!allowed.ok) return res.status(409).json({ message: allowed.message, code: allowed.reason });

    await db.insert(simOffers)
      .values({
        seasonId: season.id,
        year: season.year,
        fromVentureId: company.id,
        toVentureId: targetId,
        amount,
        message: message || null,
      })
      .onConflictDoUpdate({
        target: [simOffers.fromVentureId, simOffers.toVentureId, simOffers.year],
        // Revising an offer puts it back on the table as a new question.
        set: { amount, message: message || null, status: "pending", respondedAt: null, respondedById: null },
      });

    res.json({ ok: true, amount });
  });

  /**
   * Answer an offer.
   *
   * Yes or no, and nobody else can answer for them. An acquisition that could
   * happen without the target agreeing would take a fortnight of five people's
   * decisions away from them without asking, and no amount of drama pays for
   * that.
   */
  app.post("/api/sim/ventures/:id/offers/:offerId/respond", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;

    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.over) return res.status(409).json(SEASON_OVER);
    if (yearClosing(ctx.season)) return res.status(409).json(YEAR_CLOSING);
    const { company, seat } = ctx;

    if (seat.role !== "ceo") {
      return res.status(403).json({ message: "Selling the company is the chief executive's call.", code: "not_ceo" });
    }

    const accept = req.body?.accept === true;
    const [offer] = await db.select().from(simOffers).where(and(
      eq(simOffers.id, req.params.offerId),
      eq(simOffers.toVentureId, company.id),
    ));
    if (!offer) return res.status(404).json({ message: "No such offer." });
    if (offer.status !== "pending") {
      return res.status(409).json({ message: "That offer isn't on the table any more.", code: "not_pending" });
    }

    /*
     * Accepting closes every other offer on the table, and only one acceptance
     * can win.
     *
     * Neither was true. Nothing shut the other offers when one was accepted,
     * and the unique index only stops the same buyer offering twice — so a
     * team could accept offers from every rival in the market and be paid by
     * all of them for a business they handed over once. The second buyer paid
     * for an empty company.
     *
     * Two guards, because they answer two different questions.
     *
     * The condition on `status` makes each offer atomic with itself: the same
     * offer answered twice is answered once. What it cannot do is make the
     * *company* atomic — two offers to the same company are two different
     * rows, so both acceptances matched their own row and both won, and each
     * then declined "the other pendings" by which point neither was pending.
     * The company was paid for twice and handed over once.
     *
     * A `not exists` here would not close it either: under READ COMMITTED both
     * statements read their own snapshot and both find no accepted offer. What
     * closes it is the partial unique index on (to_venture_id, year) where
     * status = 'accepted' (migration 0054) — the second acceptance is refused
     * by the database, and caught below as the 409 it always should have been.
     */
    let answered: { id: string }[];
    try {
      answered = await db.update(simOffers)
        .set({
          status: accept ? "accepted" : "declined",
          respondedById: req.user.id,
          respondedAt: new Date(),
        })
        .where(and(eq(simOffers.id, offer.id), eq(simOffers.status, "pending")))
        .returning({ id: simOffers.id });
    } catch (err: any) {
      // 23505: somebody else's acceptance of this company got there first.
      if (err?.code === "23505") {
        return res.status(409).json({
          message: "This company has already been sold this year — that offer is off the table.",
          code: "already_sold",
        });
      }
      throw err;
    }

    if (answered.length === 0) {
      return res.status(409).json({
        message: "That offer isn't on the table any more — it may already have been answered.",
        code: "not_pending",
      });
    }

    if (accept) {
      // A company is sold once. Everybody else is told, rather than left
      // waiting on a decision that has already been made.
      await db.update(simOffers)
        .set({ status: "declined", respondedById: req.user.id, respondedAt: new Date() })
        .where(and(
          eq(simOffers.toVentureId, company.id),
          eq(simOffers.year, offer.year),
          eq(simOffers.status, "pending"),
        ));
    }

    res.json({
      ok: true,
      status: accept ? "accepted" : "declined",
      // Said plainly, because accepting is the bigger decision anyone makes here.
      message: accept
        ? "Agreed. The business changes hands when the year resolves — you keep the company, every seat, your reputation and the money."
        : "Declined.",
    });
  });

  /** Take an offer back off the table. */
  app.delete("/api/sim/ventures/:id/offers/:offerId", isAuthenticated, async (req: any, res) => {
    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.over) return res.status(409).json(SEASON_OVER);
    if (yearClosing(ctx.season)) return res.status(409).json(YEAR_CLOSING);
    if (ctx.seat.role !== "ceo") return res.status(403).json({ message: "The chief executive's call.", code: "not_ceo" });

    const withdrawn = await db.update(simOffers).set({ status: "withdrawn" }).where(and(
      eq(simOffers.id, req.params.offerId),
      eq(simOffers.fromVentureId, ctx.company.id),
      eq(simOffers.status, "pending"),
    )).returning({ id: simOffers.id });

    /*
     * 409 rather than a cheerful 200 when nothing matched. The offer was
     * answered while the screen was being read, and telling somebody their
     * offer was taken back when it had in fact just been accepted is the
     * worst possible moment to be casually wrong.
     */
    if (withdrawn.length === 0) {
      return res.status(409).json({
        message: "That offer isn't on the table any more — they may have answered it.",
        code: "not_pending",
      });
    }
    res.json({ ok: true });
  });

  /**
   * Where everyone stands.
   *
   * A multiplayer game with no way to see the other players is a single-player
   * game with extra steps — and this is the screen that answers "was that a
   * good year?", which no amount of detail about your own company can.
   *
   * Incumbents are in the table alongside the teams, because they hold most of
   * the market and a league table that quietly omitted them would flatter
   * everybody. Coming fourth out of nine is the honest position.
   */
  app.get("/api/sim/ventures/:id/standings", isAuthenticated, async (req: any, res) => {
    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    const { season, company, world } = ctx;

    const total = world.companies.reduce(
      (sum, c) => sum + Object.values(c.customers).reduce((s, n) => s + n, 0), 0);

    /*
     * Ordered by what each side actually owns, matching how a year is ranked.
     * Share is still here and still the thing people argue about — it is just
     * no longer the only way to be winning.
     */
    const worth = (c: typeof world.companies[number]) => {
      const units = Object.values(c.customers).reduce((sum, n) => sum + n, 0);
      const assets = c.assets.reduce((sum, a) => sum + a.bookValue * 0.8, 0);
      return Math.max(0, Math.round((units * c.price * 1.2 + assets - c.debt) * (c.founderShare ?? 1)));
    };

    const rows = world.companies
      .map((c) => {
        const customers = Object.values(c.customers).reduce((sum, n) => sum + n, 0);
        return {
          founderValue: worth(c),
          founderShare: c.founderShare ?? 1,
          id: c.id,
          name: c.name,
          kind: c.kind,
          customers,
          share: total > 0 ? customers / total : 0,
          revenue: Math.round(customers * c.price),
          reputation: Math.round(c.reputation),
          price: Math.round(c.price),
          isYou: c.id === company.id,
          /* Only a team's own trouble is its own business; a rival's solvency
           * is visible because it is the thing everyone can see in a market. */
          distress: c.kind === "player" ? distressOf(c) : null,
        };
      })
      .sort((a, b) => b.founderValue - a.founderValue)
      .map((row, i) => ({ ...row, rank: i + 1 }));

    /** Each year's history for this company, so a season reads as a story. */
    const history = await db
      .select({ year: simReports.year, report: simReports.report })
      .from(simReports)
      .where(and(eq(simReports.seasonId, season.id), eq(simReports.ventureId, company.id)))
      .orderBy(simReports.year);

    const niche = marketOf(season);

    res.json({
      year: season.year,
      totalYears: season.totalYears,
      status: season.status,
      /*
       * The market's own vocabulary, so a league table of restaurants counts
       * covers and one of podcasts counts listeners. The engine calls them all
       * customers because the arithmetic is the same; nobody reading this
       * should be able to tell.
       */
      niche: niche ? { id: niche.id, name: niche.name, voice: niche.voice } : null,
      rows,
      history: history.map((h) => ({
        year: h.year,
        share: (h.report as any).marketShare,
        customers: (h.report as any).customers,
        profit: (h.report as any).profit,
        rank: (h.report as any).rank,
        /*
         * The figure the table is actually ordered by. Without it a trajectory
         * chart is share-shaped while the rank beside it is value-shaped, so a
         * year that gains share and loses a place looks like a bug.
         */
        founderValue: (h.report as any).founderValue ?? null,
      })),
    });
  });

  /** Change your mind before the year runs. */
  app.delete("/api/sim/ventures/:id/recovery", isAuthenticated, async (req: any, res) => {
    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.over) return res.status(409).json(SEASON_OVER);
    if (yearClosing(ctx.season)) return res.status(409).json(YEAR_CLOSING);
    if (ctx.seat.role !== "ceo") return res.status(403).json({ message: "The chief executive's call.", code: "not_ceo" });

    await db.delete(simRecoveryMoves).where(and(
      eq(simRecoveryMoves.ventureId, ctx.company.id),
      eq(simRecoveryMoves.year, ctx.season.year),
    ));
    res.json({ ok: true });
  });
}
