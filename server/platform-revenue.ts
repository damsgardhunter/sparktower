/**
 * SparkTower's own cash position, for whoever owns it.
 *
 * This is the other half of "where does the money go". `server/earnings.ts`
 * answers it for one creator; this answers it for the platform, and the two
 * have to agree, because every pound in one is a pound in the other.
 *
 * ## What is actually cash, and what only looks like it
 *
 * Only two things here charge a card:
 *
 *  - **Nova top-ups.** Somebody buys balance with Stripe Checkout.
 *  - **Backing pledges.** A backer's card is charged into escrow.
 *
 * Everything else that looks like a transaction is existing credit moving
 * around. Posting a challenge takes the prize and the fee out of the poster's
 * *balance* (`takePrize`), action packs and build passes are bought out of a
 * balance, and a won prize is credited to another balance. Counting any of
 * those as revenue would count the top-up that funded them a second time, and
 * a revenue figure that flatters itself by double-counting is worse than no
 * figure at all.
 *
 * ## The identity
 *
 *     ours = collected − sentOut − owed
 *
 * It holds because every pound collected is in exactly one of four places: a
 * pledge still in escrow (owed), a pledge released to a creator's bank
 * (sentOut, less the fee we kept), somebody's spendable balance (owed), or
 * ours. The platform's cut falls out of the arithmetic rather than being
 * added, which is what makes it hard to get wrong.
 *
 * ## What this is not
 *
 * It is cash position, not profit. Stripe's processing fees, what the model
 * calls actually cost, and every other bill are outside it. It is labelled
 * that way on the page, because an owner reading "$2,246 yours" and planning
 * around it deserves to know what has not been taken off yet.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { novaLedger, projectBackings, users } from "@shared/schema";
import { creatorPayoutCents } from "@shared/backing";

export interface PlatformRevenue {
  /** Cash Stripe actually took from a card. */
  collected: {
    topUpsCents: number;
    pledgesCents: number;
    totalCents: number;
  };
  /** Cash that has already left for somebody else's bank. */
  sentOutCents: number;
  /** Cash collected that other people can still claim or spend. */
  owed: {
    /** Pledges in escrow, still refundable to the backer. */
    escrowCents: number;
    /** Every user's spendable balance, which is credit we owe them. */
    balancesCents: number;
    totalCents: number;
  };
  /** What is left over: collected, minus what went out, minus what is owed. */
  oursCents: number;
  /** How many people hold a balance, for scale on the liability. */
  peopleWithBalance: number;
}

const n = (v: unknown) => Math.round(Number(v ?? 0));

export async function platformRevenue(): Promise<PlatformRevenue> {
  /*
   * Top-ups only. "grant" is support putting money on an account by hand and
   * never touched a card; "earnings" is escrow moving into a balance, which is
   * already counted as a pledge; "spend" and "refund" move credit that is
   * already here.
   */
  const [topUps] = await db.select({ total: sql<number>`coalesce(sum(${novaLedger.amountCents}), 0)` })
    .from(novaLedger).where(eq(novaLedger.kind, "topup"));

  /*
   * Every pledge whose card actually cleared and stayed cleared. "pending" was
   * never charged, "failed" did not go through, and "refunded" went back to
   * the backer — none of those are cash we hold.
   */
  const [pledges] = await db.select({ total: sql<number>`coalesce(sum(${projectBackings.amountCents}), 0)` })
    .from(projectBackings).where(inArray(projectBackings.status, ["held", "released", "converted"]));

  const [escrow] = await db.select({ total: sql<number>`coalesce(sum(${projectBackings.amountCents}), 0)` })
    .from(projectBackings).where(eq(projectBackings.status, "held"));

  /*
   * Released to a bank, and so gone — net of our fee, because the fee is the
   * part we kept. A pledge released into a creator's balance instead has no
   * transfer id and has not left: it is in `balances` below.
   */
  const toBanks = await db.select({ amountCents: projectBackings.amountCents })
    .from(projectBackings)
    .where(and(
      eq(projectBackings.status, "released"),
      sql`${projectBackings.stripeTransferId} is not null`,
    ));
  const sentOutCents = toBanks.reduce((sum, b) => sum + creatorPayoutCents(n(b.amountCents)), 0);

  const [balances] = await db.select({
    total: sql<number>`coalesce(sum(${users.balanceCents}), 0)`,
    people: sql<number>`count(*) filter (where ${users.balanceCents} > 0)`,
  }).from(users);

  const topUpsCents = n(topUps?.total);
  const pledgesCents = n(pledges?.total);
  const collectedTotal = topUpsCents + pledgesCents;
  const escrowCents = n(escrow?.total);
  const balancesCents = n(balances?.total);
  const owedTotal = escrowCents + balancesCents;

  return {
    collected: { topUpsCents, pledgesCents, totalCents: collectedTotal },
    sentOutCents,
    owed: { escrowCents, balancesCents, totalCents: owedTotal },
    oursCents: collectedTotal - sentOutCents - owedTotal,
    peopleWithBalance: n(balances?.people),
  };
}
