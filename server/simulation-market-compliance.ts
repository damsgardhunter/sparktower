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
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { simulationListings, simulationPurchases, sellerAgreements } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireReviewer } from "./platform-roles";
import { rateLimit } from "./moderation";
import { refund, creditEarnings } from "./wallet";
import { withJobLock, JOB } from "./job-lock";
import {
  SELLER_TERMS, SELLER_TERMS_VERSION, BUYER_DISCLOSURE, REFUND_WINDOW_DAYS,
  PAYOUT_HOLD_DAYS, EARNINGS_STATEMENT_NOTE, refundableSeats, releasableAt,
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

  /** What a buyer is told before paying, from one place so no screen invents it. */
  app.get("/api/sim-market/buyer-terms", isAuthenticated, async (_req, res) => {
    res.json({ disclosure: BUYER_DISCLOSURE, refundWindowDays: REFUND_WINDOW_DAYS });
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
      const rows = await db.select().from(simulationPurchases)
        .where(eq(simulationPurchases.sellerId, req.user.id));

      const byYear = new Map<number, { grossCents: number; refundedCents: number; sales: number }>();
      for (const row of rows) {
        const year = new Date(row.createdAt).getUTCFullYear();
        const at = byYear.get(year) ?? { grossCents: 0, refundedCents: 0, sales: 0 };
        at.grossCents += row.sellerCents;
        /* A refunded sale is not income, so it comes back off the year it was in. */
        at.refundedCents += row.refundedCents > 0 ? row.sellerCents : 0;
        at.sales += 1;
        byYear.set(year, at);
      }

      res.json({
        note: EARNINGS_STATEMENT_NOTE,
        years: [...byYear.entries()]
          .map(([year, v]) => ({ year, ...v, netCents: v.grossCents - v.refundedCents }))
          .sort((a, b) => b.year - a.year),
        held: {
          /* What is earned but not yet theirs, which is the figure sellers ask about. */
          cents: rows.filter((r) => !r.releasedAt && !r.refundedAt).reduce((n, r) => n + r.sellerCents, 0),
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
  app.post("/api/admin/sim-market/:id/takedown", isAuthenticated, requireReviewer, rateLimit("post"), async (req: any, res) => {
    try {
      const reason = String(req.body?.reason ?? "").trim();
      if (reason.length < 8) return res.status(400).json({ message: "Say why, in a sentence.", field: "reason" });

      const [row] = await db.update(simulationListings)
        .set({ takenDownAt: new Date(), takenDownReason: reason, takenDownBy: req.user.id, status: "unlisted", updatedAt: new Date() })
        .where(eq(simulationListings.id, req.params.id))
        .returning();
      if (!row) return res.status(404).json({ message: "Simulation not found" });
      res.json({ id: row.id, takenDownAt: row.takenDownAt, reason });
    } catch (error) {
      console.error("Sim takedown error:", error);
      res.status(500).json({ message: "Couldn't take that down" });
    }
  });
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
      isNull(simulationPurchases.refundedAt),
      lte(simulationPurchases.releasableAt, new Date()),
    ))
    .limit(limit);

  let paid = 0;
  for (const row of due) {
    /* Claimed first: the row is the lock, so a second sweep finds nothing to do. */
    const [claimed] = await db.update(simulationPurchases)
      .set({ releasedAt: new Date() })
      .where(and(eq(simulationPurchases.id, row.id), isNull(simulationPurchases.releasedAt)))
      .returning();
    if (!claimed || row.sellerCents <= 0) continue;
    await creditEarnings(row.sellerId, row.sellerCents, `sim-sale:${row.id}`, "Simulation seats sold");
    paid += 1;
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
