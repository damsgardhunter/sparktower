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
  simSeasons, simSeats, simVentures, simListings, simBids, simRecoveryMoves,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { enforceRateLimit } from "./moderation";
import { nicheById } from "@shared/simulation/niches";
import type { World, Company, CompanyAsset, Role } from "@shared/simulation/types";
import { marketListings, resaleValue, biddableFunds } from "@shared/simulation/assets";
import { distressOf, recoveryOptions, type RecoveryKind } from "@shared/simulation/recovery";

const KINDS: RecoveryKind[] = ["restructure", "fire_sale", "dissolve_seat", "rescue_raise"];

/** The venture, the season, this person's seat and their company — or nothing at all. */
async function context(ventureId: string, userId: string) {
  const [venture] = await db.select().from(simVentures).where(eq(simVentures.id, ventureId));
  if (!venture) return null;

  const [seat] = await db.select().from(simSeats)
    .where(and(eq(simSeats.ventureId, ventureId), eq(simSeats.userId, userId)));
  if (!seat) return null;

  const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, venture.seasonId));
  if (!season?.world || season.status !== "running") return null;

  const world = season.world as World;
  const company = world.companies.find((c) => c.id === ventureId);
  if (!company) return null;

  return { venture, seat, season, world, company };
}

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

    const niche = nicheById(season.nicheId)!;
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
      ...marketListings({ seasonId: season.id, year, niche }).map((l) => ({
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

    res.json({
      year,
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
        listed: false,
      })),
      /** Your own things currently up for sale. */
      selling: (await db.select().from(simListings).where(and(
        eq(simListings.seasonId, season.id),
        eq(simListings.sellerId, company.id),
        eq(simListings.year, year),
      ))).map((row) => ({
        id: row.id,
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
  app.post("/api/sim/ventures/:id/bids", isAuthenticated, async (req: any, res) => {
    if (!(await enforceRateLimit(res, req.user.id, "session"))) return;

    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    const { season, company } = ctx;

    const listingId = String(req.body?.listingId ?? "");
    const amount = Math.round(Number(req.body?.amount));
    if (!listingId) return res.status(400).json({ message: "Which listing?" });
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ message: "That isn't an amount." });

    const niche = nicheById(season.nicheId)!;
    const year = season.year;
    const open = marketListings({ seasonId: season.id, year, niche }).map((l) => l.id);
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

    const [already] = await db.select().from(simListings).where(and(
      eq(simListings.sellerId, company.id),
      eq(simListings.year, season.year),
      eq(simListings.status, "open"),
    ));
    if (already && (already.asset as CompanyAsset).id === assetId) {
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

    await db.update(simListings).set({ status: "withdrawn" }).where(and(
      eq(simListings.id, req.params.listingId),
      eq(simListings.sellerId, ctx.company.id),
      eq(simListings.status, "open"),
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

  /** Change your mind before the year runs. */
  app.delete("/api/sim/ventures/:id/recovery", isAuthenticated, async (req: any, res) => {
    const ctx = await context(req.params.id, req.user.id);
    if (!ctx) return res.status(404).json({ message: "No such company." });
    if (ctx.seat.role !== "ceo") return res.status(403).json({ message: "The chief executive's call.", code: "not_ceo" });

    await db.delete(simRecoveryMoves).where(and(
      eq(simRecoveryMoves.ventureId, ctx.company.id),
      eq(simRecoveryMoves.year, ctx.season.year),
    ));
    res.json({ ok: true });
  });
}
