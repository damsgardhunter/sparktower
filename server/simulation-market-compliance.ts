/**
 * The parts of a marketplace that exist because strangers are paying each
 * other: consent, refunds, held money, and taking a listing down.
 *
 * None of this makes anything lawful — see `shared/simulation-market-terms.ts`
 * for what that file is and is not. What it does is make sure that whatever
 * the published policy turns out to say, the platform already records consent
 * with a version, holds money before it is anybody's, can give it back, and
 * can remove a listing without interrupting a season somebody paid for.
 */
import type { Express } from "express";
import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { simulationListings, simulationPurchases, sellerAgreements, users } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireReviewer, requireAdmin } from "./platform-roles";
import { rateLimit } from "./moderation";
import { refund, creditEarnings } from "./wallet";
import { seatsRefunded, earningsReleased, listingTakenDown } from "./simulation-market-notices";
import { withJobLock, JOB } from "./job-lock";
import {
  SELLER_TERMS, SELLER_TERMS_VERSION, BUYER_DISCLOSURE, REFUND_WINDOW_DAYS,
  PAYOUT_HOLD_DAYS, EARNINGS_STATEMENT_NOTE, BUYER_TERMS_VERSION, refundableSeats, releasableAt, sellerOwed,
} from "@shared/simulation-market-terms";

/** Whether this person has accepted the agreement that is currently in force. */
export async function hasAcceptedSellerTerms(userId: string): Promise<boolean> {
  const [row] = await db.select({ version: sellerAgreements.version })
    .from(sellerAgreements)
    .where(and(eq(sellerAgreements.userId, userId), eq(sellerAgreements.version, SELLER_TERMS_VERSION)))
    .limit(1);
  return !!row;
}

export function registerSimulationComplianceRoutes(app: Express) {
  /** The agreement, and whether this person has accepted this version of it. */
  app.get("/api/sim-market/seller-terms", isAuthenticated, async (req: any, res) => {
    try {
      const accepted = await db.select().from(sellerAgreements)
        .where(eq(sellerAgreements.userId, req.user.id))
        .orderBy(desc(sellerAgreements.acceptedAt));
      res.json({
        version: SELLER_TERMS_VERSION,
        terms: SELLER_TERMS,
        /* The whole history, because "what did they agree to and when" is the question. */
        accepted: accepted.map((a) => ({ version: a.version, at: a.acceptedAt })),
        current: accepted.some((a) => a.version === SELLER_TERMS_VERSION),
      });
    } catch (error) {
      console.error("Seller terms read error:", error);
      res.status(500).json({ message: "Couldn't load the seller terms" });
    }
  });

  /** Accepting them. Recorded as a row, with the version and where from. */
  app.post("/api/sim-market/seller-terms", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      if (Number(req.body?.version) !== SELLER_TERMS_VERSION) {
        /*
         * The version is sent back so a stale tab cannot accept terms it never
         * displayed — which is the one thing a consent record must never be
         * able to say.
         */
        return res.status(409).json({
          message: "These terms have changed since this page loaded. Read them again before accepting.",
          version: SELLER_TERMS_VERSION,
        });
      }
      await db.insert(sellerAgreements).values({
        userId: req.user.id,
        version: SELLER_TERMS_VERSION,
        acceptedIp: String(req.headers["x-forwarded-for"] ?? req.ip ?? "").split(",")[0].trim() || null,
      });
      res.status(201).json({ version: SELLER_TERMS_VERSION, current: true });
    } catch (error) {
      console.error("Seller terms accept error:", error);
      res.status(500).json({ message: "Couldn't record that" });
    }
  });

  /**
   * What a buyer is told before paying, from one place so no screen invents it.
   *
   * The version comes with it, and the buy call sends it back. That round trip
   * is what stops a tab left open across a terms change from buying under terms
   * it never displayed.
   */
  app.get("/api/sim-market/buyer-terms", isAuthenticated, async (_req, res) => {
    res.json({
      version: BUYER_TERMS_VERSION,
      disclosure: BUYER_DISCLOSURE,
      refundWindowDays: REFUND_WINDOW_DAYS,
    });
  });

  /**
   * A refund, for seats that have not been used.
   *
   * Paid from the hold rather than from the seller's balance: the money has
   * not been released yet, which is the entire reason for the hold.
   */
  app.post("/api/sim-market/purchases/:id/refund", isAuthenticated, rateLimit("checkout"), async (req: any, res) => {
    try {
      const [purchase] = await db.select().from(simulationPurchases)
        .where(eq(simulationPurchases.id, req.params.id));
      if (!purchase || purchase.buyerId !== req.user.id) {
        return res.status(404).json({ message: "Purchase not found" });
      }

      const owed = refundableSeats(purchase as any);
      if ("reason" in owed) return res.status(400).json({ message: owed.reason });

      /*
       * The seats go first and the money second, and the update carries its
       * own condition. Two tabs refunding the same purchase both read two
       * seats left; only one of them finds them still there.
       */
      const [claimed] = await db.update(simulationPurchases)
        .set({
          seatsLeft: sql`${simulationPurchases.seatsLeft} - ${owed.seats}`,
          refundedCents: sql`${simulationPurchases.refundedCents} + ${owed.cents}`,
          refundedAt: new Date(),
        })
        .where(and(
          eq(simulationPurchases.id, purchase.id),
          sql`${simulationPurchases.seatsLeft} >= ${owed.seats}`,
        ))
        .returning();
      if (!claimed) return res.status(409).json({ message: "Those seats have just been used." });

      /*
       * The listing's public counters give the seats back too.
       *
       * `seatsSold` is on every card and `seasonsStarted` sits beside it, so a
       * listing that had four of five seats refunded went on telling strangers
       * it had sold five. `greatest(0, …)` because a counter that can go
       * negative is worse than one that is slightly behind.
       */
      await db.update(simulationListings)
        .set({
          seatsSold: sql`greatest(0, ${simulationListings.seatsSold} - ${owed.seats})`,
          grossCents: sql`greatest(0, ${simulationListings.grossCents} - ${owed.cents})`,
          updatedAt: new Date(),
        })
        .where(eq(simulationListings.id, purchase.listingId));

      if (owed.cents > 0) {
        await refund(req.user.id, owed.cents, { outcome: "seasonSeat", note: "Simulation seats refunded" });
      }
      res.json({ refundedCents: owed.cents, seats: owed.seats });
    } catch (error) {
      console.error("Sim refund error:", error);
      res.status(500).json({ message: "Couldn't refund that" });
    }
  });

  /**
   * A seller's own record of what they earned, by calendar year.
   *
   * Here because the alternative is somebody emailing to ask, and because a
   * marketplace that cannot tell a seller what it paid them is a marketplace
   * that has made their tax return somebody else's problem.
   */
  app.get("/api/sim-market/earnings", isAuthenticated, async (req: any, res) => {
    try {
      /*
       * Grouped by the database, not by a loop over every sale.
       *
       * This read every purchase a seller had ever made and added them up in
       * memory. For a seller with one sale that is indistinguishable from this;
       * for a seller with ten thousand it is ten thousand rows across the wire
       * on every page load, to produce four numbers. The year is taken in UTC
       * here exactly as `getUTCFullYear` did, so an existing statement does not
       * change shape under anybody.
       *
       * `refundedCents` is the seller's share that came back — the clawback,
       * not the whole sale — so `netCents` is what they actually keep.
       */
      const year = sql<number>`extract(year from ${simulationPurchases.createdAt} at time zone 'UTC')::int`;
      const years = await db
        .select({
          year,
          grossCents: sql<number>`coalesce(sum(greatest(0, ${simulationPurchases.sellerCents})), 0)::int`,
          refundedCents: sql<number>`coalesce(sum(greatest(0, greatest(0, ${simulationPurchases.sellerCents}) - (${sellerOwedSql}))), 0)::int`,
          netCents: sql<number>`coalesce(sum(${sellerOwedSql}), 0)::int`,
          sales: sql<number>`count(*)::int`,
        })
        .from(simulationPurchases)
        .where(eq(simulationPurchases.sellerId, req.user.id))
        .groupBy(year)
        .orderBy(desc(year));

      const [heldRow] = await db
        .select({ cents: sql<number>`coalesce(sum(${sellerOwedSql}), 0)::int` })
        .from(simulationPurchases)
        .where(and(
          eq(simulationPurchases.sellerId, req.user.id),
          isNull(simulationPurchases.releasedAt),
        ));

      res.json({
        note: EARNINGS_STATEMENT_NOTE,
        years,
        held: {
          /* What is earned but not yet theirs, which is the figure sellers ask about. */
          cents: heldRow?.cents ?? 0,
          days: PAYOUT_HOLD_DAYS,
        },
      });
    } catch (error) {
      console.error("Sim earnings error:", error);
      res.status(500).json({ message: "Couldn't load your earnings" });
    }
  });

  /**
   * Taking a listing down.
   *
   * A reviewer's decision, not an author's. Seasons already running are
   * untouched: people who paid keep what they paid for, and punishing them for
   * the author's behaviour would be the platform taking something it sold.
   */
  /**
   * What the marketplace has actually earned, for the people who run it.
   *
   * There was no answer to this anywhere. `platform_cents` has been written on
   * every sale since the marketplace shipped and read by nothing, so the one
   * question an owner asks — "what did we make" — could only be answered by
   * someone opening a SQL client. A marketplace that cannot state its own
   * revenue is one that cannot be reconciled against the bank, priced, or
   * taxed.
   *
   * ## The five numbers, and why each is separate
   *
   *   - **gross**: what buyers paid.
   *   - **refunded**: what went back to them. `net` is the difference, and is
   *     the only figure that corresponds to money the platform ever held.
   *   - **sellers**: what the sellers are owed out of it, by `sellerOwed` —
   *     the same arithmetic the payout sweep uses, so this cannot disagree with
   *     what was actually sent.
   *   - **platform**: `net - sellers`, by subtraction rather than by summing
   *     `platform_cents`. The stored column is the split at the moment of sale
   *     and knows nothing about refunds since, so summing it overstates the
   *     take on every partly refunded sale. Subtracting also means the two
   *     halves add up to the whole by construction, which is the property that
   *     makes the report reconcilable.
   *   - **unclaimed**: seller money released with no seller left to pay. It is
   *     not revenue — it is money the platform is sitting on and owes an answer
   *     about — so it is never folded into `platform`.
   *
   * `held` is the other side: earnings not yet released, which is a liability
   * rather than income. Everything is aggregated by the database; this endpoint
   * is a report over every sale ever made, and must not grow a loop.
   */
  app.get("/api/admin/sim-market/revenue", isAuthenticated, requireAdmin, async (req: any, res) => {
    try {
      const months = Math.min(60, Math.max(1, Math.floor(Number(req.query.months) || 12)));

      const month = sql<string>`to_char(date_trunc('month', ${simulationPurchases.createdAt} at time zone 'UTC'), 'YYYY-MM')`;
      const net = sql`greatest(0, ${simulationPurchases.paidCents} - ${simulationPurchases.refundedCents})`;

      const figures = {
        grossCents: sql<number>`coalesce(sum(${simulationPurchases.paidCents}), 0)::int`,
        refundedCents: sql<number>`coalesce(sum(${simulationPurchases.refundedCents}), 0)::int`,
        netCents: sql<number>`coalesce(sum(${net}), 0)::int`,
        sellerCents: sql<number>`coalesce(sum(${sellerOwedSql}), 0)::int`,
        /* By subtraction, so the two halves always add to the whole. */
        platformCents: sql<number>`coalesce(sum(greatest(0, ${net} - (${sellerOwedSql}))), 0)::int`,
        unclaimedCents: sql<number>`coalesce(sum(${simulationPurchases.unclaimedCents}), 0)::int`,
        sales: sql<number>`count(*)::int`,
      };

      const [totals] = await db.select(figures).from(simulationPurchases);

      const byMonth = await db
        .select({ month, ...figures })
        .from(simulationPurchases)
        .groupBy(month)
        .orderBy(desc(month))
        .limit(months);

      /* Not yet released, so not yet income to anybody: the standing liability. */
      const [held] = await db
        .select({ cents: sql<number>`coalesce(sum(${sellerOwedSql}), 0)::int` })
        .from(simulationPurchases)
        .where(isNull(simulationPurchases.releasedAt));

      res.json({
        totals: totals ?? null,
        months: byMonth,
        heldCents: held?.cents ?? 0,
        /* So a screen does not have to know the arithmetic to label the columns. */
        note:
          "Gross is what buyers paid; net is after refunds. Sellers is what they are owed by the same "
          + "calculation the payout sweep uses, and platform is the remainder, so the two always add to net. "
          + "Unclaimed is seller money with no seller left to pay — it is not revenue. Held is not yet released.",
      });
    } catch (error) {
      console.error("Sim revenue error:", error);
      res.status(500).json({ message: "Couldn't work out the revenue" });
    }
  });


  app.post("/api/admin/sim-market/:id/takedown", isAuthenticated, requireReviewer, rateLimit("post"), async (req: any, res) => {
    try {
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 8) return res.status(400).json({ message: "Say why, in a sentence.", field: "reason" });

      const [row] = await db.update(simulationListings)
        .set({ takenDownAt: new Date(), takenDownReason: reason, takenDownBy: req.user.id, status: "unlisted", updatedAt: new Date() })
        .where(eq(simulationListings.id, req.params.id))
        .returning();
      if (!row) return res.status(404).json({ message: "Simulation not found" });

      /*
       * The author is told, with the reason. It is a decision taken about their
       * work that they would otherwise meet as a refusal days later, and the
       * reason is already written down — withholding it only means they cannot
       * answer it or avoid repeating it.
       */
      void listingTakenDown({ authorId: row.authorId, listingId: row.id, reason })
        .catch((err) => console.error("[sim-market] takedown notice failed:", err));

      res.json({ id: row.id, takenDownAt: row.takenDownAt, reason });
    } catch (error) {
      console.error("Sim takedown error:", error);
      res.status(500).json({ message: "Couldn't take that down" });
    }
  });
}

/**
 * `sellerOwed`, as SQL, so a seller's totals can be summed by the database.
 *
 * ## Why this exists twice
 *
 * The JS one is the definition and is where the reasoning lives
 * (`shared/simulation-market-terms.ts`). This is the same arithmetic in a form
 * Postgres can aggregate, because the alternative was reading every purchase a
 * seller has ever made into memory and adding it up in a loop — which is what
 * the earnings statement did, unbounded, on every page load.
 *
 * Two copies of a money calculation is a real risk, so it is not left to
 * inspection: `sim-market-owed-parity.test.ts` runs both over the same rows,
 * including the awkward ones, and fails if they ever disagree by a penny.
 *
 * `floor` matches `Math.floor`, and the cast back to int happens after the
 * division so the rounding is done once, in the same place, on the same number.
 * Which way the penny goes is argued where the definition lives.
 */
export const sellerOwedSql = sql<number>`
  case
    when ${simulationPurchases.paidCents} <= 0 then 0
    when ${simulationPurchases.refundedCents} <= 0 then greatest(0, ${simulationPurchases.sellerCents})
    else greatest(0, greatest(0, ${simulationPurchases.sellerCents}) - floor(
      greatest(0, ${simulationPurchases.sellerCents})::numeric
      * least(greatest(${simulationPurchases.refundedCents}, 0), ${simulationPurchases.paidCents})
      / ${simulationPurchases.paidCents}
    ))
  end`;

/**
 * Gives buyers back the seats they will never be able to use, because the
 * person who sold them is leaving.
 *
 * The marketplace equivalent of `refundPledgesLeavingWith`, and the same
 * reasoning: a seat is a licence to run a simulation that its author stands
 * behind, and nobody stands behind it any more. The seller agreed to exactly
 * that — "if a simulation is broken, misdescribed, or cannot be played, buyers
 * are refunded from your earnings for that sale".
 *
 * ## Why the fourteen-day window does not apply
 *
 * It is the buyer's window, for changing their mind. This is not the buyer
 * changing their mind; it is the other side of the bargain walking away, which
 * is also how the backing refund treats a creator closing their account. A
 * buyer who bought seats five months ago and still has three of them is
 * exactly the person this is for.
 *
 * Seats already used are not refunded. Those seasons were delivered, played,
 * and are still playable — `/play` deliberately keeps working for people who
 * paid — so the sale stands for them and `sellerOwed` pays the seller for that
 * part and no more.
 *
 * Run before `deleteAccount` and outside its transaction, like the pledge
 * refunds, so a failure here stops the closure rather than half-finishing it.
 */
export async function refundOpenSeatsOnSellerClose(sellerId: string): Promise<number> {
  const open = await db.select().from(simulationPurchases)
    .where(and(
      eq(simulationPurchases.sellerId, sellerId),
      isNull(simulationPurchases.refundedAt),
      gt(simulationPurchases.seatsLeft, 0),
    ));

  let refunded = 0;
  for (const purchase of open) {
    /* What the unused seats cost, priced from what was actually paid. */
    const perSeat = purchase.seats > 0 ? Math.round(purchase.paidCents / purchase.seats) : 0;
    const cents = Math.min(perSeat * purchase.seatsLeft, Math.max(0, purchase.paidCents - purchase.refundedCents));
    const seats = purchase.seatsLeft;

    /*
     * The seats go first and the condition travels in the UPDATE, so this and a
     * buyer refunding by hand at the same moment cannot both pay out.
     */
    const [claimed] = await db.update(simulationPurchases)
      .set({
        seatsLeft: sql`${simulationPurchases.seatsLeft} - ${seats}`,
        refundedCents: sql`${simulationPurchases.refundedCents} + ${cents}`,
        refundedAt: new Date(),
      })
      .where(and(
        eq(simulationPurchases.id, purchase.id),
        sql`${simulationPurchases.seatsLeft} >= ${seats}`,
        isNull(simulationPurchases.refundedAt),
      ))
      .returning();
    if (!claimed) continue;

    await db.update(simulationListings)
      .set({
        seatsSold: sql`greatest(0, ${simulationListings.seatsSold} - ${seats})`,
        grossCents: sql`greatest(0, ${simulationListings.grossCents} - ${cents})`,
        updatedAt: new Date(),
      })
      .where(eq(simulationListings.id, purchase.listingId));

    if (cents > 0) {
      await refund(purchase.buyerId, cents, {
        outcome: "seasonSeat",
        note: "Seats refunded — the seller closed their account",
      });

      /*
       * And told why. The buyer did not ask for this, so without a word it is
       * money appearing on their balance with no explanation — which the
       * backing side names as the way a person decides a product took their
       * money, and it had the same hole until it was given one.
       *
       * Never fatal: a refund that failed because a bell could not be rung
       * would be far worse than a bell left silent, and this runs inside an
       * account closure that must not be left half-done.
       */
      void seatsRefunded({
        buyerId: purchase.buyerId,
        listingId: purchase.listingId,
        seats,
        amountCents: cents,
      }).catch((err) => console.error("[sim-market] refund notice failed:", err));
    }
    refunded += 1;
  }

  /*
   * And the listings come off sale. The marketplace already hides a closed
   * account's listings and refuses to sell them (`deletedAt` is checked in both
   * places), so this is the row agreeing with what every reader of it already
   * does — and it does not depend on a future reader remembering the join.
   */
  await db.update(simulationListings)
    .set({ status: "unlisted", updatedAt: new Date() })
    .where(and(eq(simulationListings.authorId, sellerId), eq(simulationListings.status, "listed")));

  return refunded;
}

/**
 * Releases held earnings that are past their window.
 *
 * Idempotent by `releasedAt` and keyed per purchase inside `creditEarnings`,
 * so a sweep that runs twice — or two instances racing — pays once.
 */
export async function releaseDueEarnings(limit = 200): Promise<number> {
  const due = await db.select().from(simulationPurchases)
    .where(and(
      isNull(simulationPurchases.releasedAt),
      /*
       * Refunded rows are NOT skipped.
       *
       * They were, and a partial refund is the ordinary case — `refundableSeats`
       * gives back the seats nobody used, not the purchase — so a seller who
       * delivered two seats out of five was paid for none of them, and the
       * buyer's money for the two stayed with the platform. `sellerOwed` is what
       * decides the amount now; a fully refunded row comes out at zero and is
       * marked released so it stops being rescanned every half hour forever.
       */
      lte(simulationPurchases.releasableAt, new Date()),
    ))
    .limit(limit);

  let paid = 0;
  /* Released, owed to somebody who is no longer here to receive it. */
  let unclaimed = 0;
  for (const row of due) {
    /* Claimed first: the row is the lock, so a second sweep finds nothing to do. */
    const [claimed] = await db.update(simulationPurchases)
      .set({ releasedAt: new Date() })
      .where(and(eq(simulationPurchases.id, row.id), isNull(simulationPurchases.releasedAt)))
      .returning();
    if (!claimed) continue;
    /*
     * From the claimed row, not the one the query read. A refund landing
     * between the select and this update would otherwise be paid as though it
     * had not happened — the whole reason the condition travels in the UPDATE.
     */
    const owed = sellerOwed(claimed);
    if (owed <= 0) continue;

    /*
     * Is there anybody left to pay?
     *
     * Crediting a closed account puts the money in a balance nobody can sign in
     * to spend: the ledger then says the seller was paid and the money is
     * unreachable, which is the worst of the three possible answers because it
     * is wrong *and* silent. Read after the claim rather than joined into the
     * query above, so a seller who closed their account while this pass was
     * running is seen as closed.
     */
    const [seller] = await db.select({ deletedAt: users.deletedAt })
      .from(users).where(eq(users.id, claimed.sellerId));
    if (seller?.deletedAt) {
      /*
       * Written down rather than decided. What becomes of it — the platform's,
       * refunded to the buyer, or held against a reclaim — is a policy question
       * with legal shape; this is the number that makes it answerable, and the
       * revenue report shows it on its own line.
       */
      await db.update(simulationPurchases)
        .set({ unclaimedCents: owed })
        .where(eq(simulationPurchases.id, claimed.id));
      unclaimed += 1;
      continue;
    }

    await creditEarnings(claimed.sellerId, owed, `sim-sale:${claimed.id}`, "Simulation seats sold");
    /*
     * And they are told the money is theirs. Before this a payout was a number
     * that changed in a corner of one screen with nothing to say why.
     */
    void earningsReleased({ sellerId: claimed.sellerId, listingId: claimed.listingId, amountCents: owed })
      .catch((err) => console.error("[sim-market] payout notice failed:", err));
    paid += 1;
  }
  if (unclaimed > 0) {
    console.log(`[sim-market] ${unclaimed} released sale(s) had no seller left to pay; recorded as unclaimed`);
  }
  return paid;
}

/** Every half hour: pay out what has come off hold. */
export function startSimulationMarketJobs(): void {
  const sweep = async () => {
    await withJobLock(JOB.simEarnings, async () => {
      const paid = await releaseDueEarnings();
      if (paid) console.log(`[sim-market] released ${paid} held sale${paid === 1 ? "" : "s"}`);
    });
  };
  setInterval(() => { sweep().catch((err) => console.error("[sim-market] release sweep failed:", err)); }, 30 * 60_000).unref();
}
