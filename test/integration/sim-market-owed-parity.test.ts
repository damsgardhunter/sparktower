/**
 * The two copies of "what is the seller owed" must agree to the penny.
 *
 * `sellerOwed` in `shared/simulation-market-terms.ts` is the definition: it is
 * what the payout sweep pays and what the refund arithmetic is reasoned about
 * in. `sellerOwedSql` is the same thing in a form Postgres can aggregate, which
 * exists because the earnings statement used to read every sale a seller had
 * ever made into memory to add up four numbers.
 *
 * Two copies of a money calculation is a real risk and the kind that is
 * invisible in review — a `floor` where the other has a `round`, an `int`
 * division, a missing clamp. So they are not left to inspection. Every row
 * below goes through both, and the awkward ones are the point: an odd split
 * that cannot divide evenly, a refund of exactly half, a refund of everything,
 * a free sale, and the values that should never exist but would be the worst
 * ones to get wrong if they did.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users, simulationListings, simulationPurchases } from "@shared/schema";
import { sellerOwedSql } from "../../server/simulation-market-compliance";
import { sellerOwed } from "@shared/simulation-market-terms";
import { splitSale } from "@shared/simulation-market";

afterAll(async () => { await closeTestApp(); });

/** paidCents, refundedCents — sellerCents is derived the way a real sale does it. */
const CASES: [number, number, string][] = [
  [0, 0, "a free sale"],
  [100, 0, "the smallest paid sale, untouched"],
  [2500, 0, "five seats at five hundred, nothing back"],
  [2500, 500, "one seat of five back"],
  [2500, 1250, "exactly half back"],
  [2500, 2000, "four of five back"],
  [2500, 2500, "all of it back"],
  [999, 333, "a third of an odd amount, which cannot divide evenly"],
  [1001, 500, "an odd amount, just under half back"],
  [333, 1, "a penny off a small sale"],
  [5000, 4999, "all but a penny"],
  [100, 99, "all but a penny of the smallest sale"],
  /*
   * Should not exist — a refund is capped at what was paid — but if one ever
   * did, the two must at least be wrong in the same direction. Both clamp.
   */
  [1000, 5000, "more refunded than paid, which should be impossible"],
];

describe("the seller's share, in JS and in SQL", () => {
  it("agrees on every shape of sale, including the awkward ones", async () => {
    await getTestApp();

    const [seller] = await db.insert(users).values({
      email: `owed-seller-${Date.now()}@example.test`, firstName: "Seller",
    } as any).returning();
    const [buyer] = await db.insert(users).values({
      email: `owed-buyer-${Date.now()}@example.test`, firstName: "Buyer",
    } as any).returning();
    const [listing] = await db.insert(simulationListings).values({
      authorId: seller.id, title: "Owed parity", nicheId: "dating_apps", status: "listed",
    } as any).returning();

    const disagreements: string[] = [];

    for (const [paidCents, refundedCents, what] of CASES) {
      /* The split as a real sale records it, so this is not testing a fiction. */
      const { sellerCents } = splitSale(paidCents);

      const [row] = await db.insert(simulationPurchases).values({
        listingId: listing.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        seats: 5,
        paidCents,
        platformCents: paidCents - sellerCents,
        sellerCents,
        seatsLeft: 0,
        refundedCents,
      } as any).returning();

      const [read] = await db
        .select({ owed: sql<number>`(${sellerOwedSql})::int` })
        .from(simulationPurchases)
        .where(eq(simulationPurchases.id, row.id));

      const inJs = sellerOwed({ paidCents, refundedCents, sellerCents });
      const inSql = Number(read.owed);
      if (inJs !== inSql) {
        disagreements.push(`${what}: paid ${paidCents}, refunded ${refundedCents} — JS ${inJs}, SQL ${inSql}`);
      }

      /* And neither may ever owe more than the sale was worth, or less than nothing. */
      expect(inJs, `${what}: never negative`).toBeGreaterThanOrEqual(0);
      expect(inJs, `${what}: never more than the split`).toBeLessThanOrEqual(Math.max(0, sellerCents));
    }

    expect(disagreements, `the two definitions disagree:\n  ${disagreements.join("\n  ")}`).toEqual([]);
  }, 90_000);

  it("sums the same way the sweep pays, over many sales at once", async () => {
    await getTestApp();

    const [seller] = await db.insert(users).values({
      email: `owed-sum-seller-${Date.now()}@example.test`, firstName: "Seller",
    } as any).returning();
    const [buyer] = await db.insert(users).values({
      email: `owed-sum-buyer-${Date.now()}@example.test`, firstName: "Buyer",
    } as any).returning();
    const [listing] = await db.insert(simulationListings).values({
      authorId: seller.id, title: "Owed sum", nicheId: "dating_apps", status: "listed",
    } as any).returning();

    /*
     * The aggregate is the thing that replaced the loop, so it is the aggregate
     * that has to match — a per-row agreement that rounds apart at the total is
     * still a wrong number on a statement.
     */
    let expected = 0;
    for (const [paidCents, refundedCents] of CASES) {
      const { sellerCents } = splitSale(paidCents);
      await db.insert(simulationPurchases).values({
        listingId: listing.id, buyerId: buyer.id, sellerId: seller.id,
        seats: 5, paidCents, platformCents: paidCents - sellerCents, sellerCents,
        seatsLeft: 0, refundedCents,
      } as any);
      expected += sellerOwed({ paidCents, refundedCents, sellerCents });
    }

    const [summed] = await db
      .select({ cents: sql<number>`coalesce(sum(${sellerOwedSql}), 0)::int` })
      .from(simulationPurchases)
      .where(eq(simulationPurchases.sellerId, seller.id));

    expect(Number(summed.cents), "the total the database adds up").toBe(expected);
  }, 90_000);
});
