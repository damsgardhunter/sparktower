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
 *  - **Nova top-ups.** Somebody buys balance with Stripe Checkout, or a
 *    consumable through the App Store.
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
 * ## Credit that was never paid for
 *
 * Two kinds of balance appear without a card behind them: the `dev-` top-ups
 * the development bypass mints, and `grant`s support puts on an account by
 * hand. Both used to be invisible here in the worst possible way — the dev
 * ones were summed straight into "collected" as though somebody had paid, so
 * pressing the DEV +$50 button twice reported $100 of revenue.
 *
 * They are not collected, and what is left of them is not owed either: there
 * is no money to give back. So they are counted separately as `mintedCents`,
 * excluded from collected, and the unspent remainder is taken back off the
 * balance liability — otherwise the identity below would report the platform
 * as *owing* money it had invented. Spending is charged against minted credit
 * first, which is the assumption that keeps the real liability whole.
 *
 * ## A pledge is only cash once a card has cleared
 *
 * The one path that writes a pledge is the Stripe webhook for a completed
 * checkout session, and it always records a payment intent. A row without one
 * therefore did not come from a person paying — in practice it is a test
 * fixture or a hand-written row — and counting it collected invents revenue
 * out of somebody's leftover data. Every pledge query here requires the
 * payment intent, so a row that never charged a card cannot reach this page
 * whatever its status says.
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
  /** Cash Stripe or Apple actually took from a card. */
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
    /** Paid-for balances, which are credit we owe. Minted credit is not here. */
    balancesCents: number;
    totalCents: number;
  };
  /**
   * Balance handed out without a card behind it — the dev bypass and support
   * grants — and not yet spent. Neither revenue nor a liability; shown so the
   * difference between this and the balances people actually paid for is
   * visible rather than quietly absorbed.
   */
  mintedCents: number;
  /** What is left over: collected, minus what went out, minus what is owed. */
  oursCents: number;
  /** How many people hold a balance, for scale on the liability. */
  peopleWithBalance: number;
}

const n = (v: unknown) => Math.round(Number(v ?? 0));

/** Credit that appeared without a payment: the dev bypass, and hand-written grants. */
const MINTED = sql`(${novaLedger.kind} = 'grant' or (${novaLedger.kind} = 'topup' and ${novaLedger.stripeSessionId} like 'dev-%'))`;

/** A pledge only counts as cash if a card cleared for it. See the note above. */
const CHARGED = sql`${projectBackings.stripePaymentIntentId} is not null`;

export async function platformRevenue(): Promise<PlatformRevenue> {
  /*
   * Top-ups somebody paid for. "grant" is support putting money on an account
   * by hand and `dev-` is the bypass minting it — neither touched a card, and
   * both are counted as minted below. "earnings" is escrow moving into a
   * balance, which is already counted as a pledge; "spend" and "refund" move
   * credit that is already here.
   */
  const [topUps] = await db.select({ total: sql<number>`coalesce(sum(${novaLedger.amountCents}), 0)` })
    .from(novaLedger).where(and(eq(novaLedger.kind, "topup"), sql`not ${MINTED}`));

  /*
   * Every pledge whose card actually cleared and stayed cleared. "pending" was
   * never charged, "failed" did not go through, and "refunded" went back to
   * the backer — none of those are cash we hold. Nor is a row with no payment
   * intent, whatever its status claims.
   */
  const [pledges] = await db.select({ total: sql<number>`coalesce(sum(${projectBackings.amountCents}), 0)` })
    .from(projectBackings)
    .where(and(inArray(projectBackings.status, ["held", "released", "converted"]), CHARGED));

  const [escrow] = await db.select({ total: sql<number>`coalesce(sum(${projectBackings.amountCents}), 0)` })
    .from(projectBackings).where(and(eq(projectBackings.status, "held"), CHARGED));

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
      CHARGED,
    ));
  const sentOutCents = toBanks.reduce((sum, b) => sum + creatorPayoutCents(n(b.amountCents)), 0);

  const [balances] = await db.select({
    total: sql<number>`coalesce(sum(${users.balanceCents}), 0)`,
    people: sql<number>`count(*) filter (where ${users.balanceCents} > 0)`,
  }).from(users);

  /*
   * How much of the balances above was minted rather than bought, per person.
   *
   * Spending is charged against minted credit first — `greatest(0, minted −
   * outflow)` — so a person who topped up for real and was also given a grant
   * keeps the real money as a liability for as long as possible. Capped at
   * what they actually hold, because a refund or an adjustment can leave the
   * ledger's minted total above the balance it was meant to explain, and a
   * deduction larger than the liability would read as profit.
   */
  const minted: any = await db.execute(sql`
    select coalesce(sum(least(u.balance_cents, greatest(0, t.minted - t.outflow))), 0)::int as total
    from (
      select ${novaLedger.userId} as user_id,
             sum(case when ${MINTED} then ${novaLedger.amountCents} else 0 end) as minted,
             sum(case when ${novaLedger.amountCents} < 0 then -${novaLedger.amountCents} else 0 end) as outflow
      from ${novaLedger}
      group by ${novaLedger.userId}
    ) t
    join ${users} u on u.id = t.user_id
    where u.balance_cents > 0 and t.minted > 0
  `);
  const mintedCents = n((minted.rows ?? minted)[0]?.total);

  const topUpsCents = n(topUps?.total);
  const pledgesCents = n(pledges?.total);
  const collectedTotal = topUpsCents + pledgesCents;
  const escrowCents = n(escrow?.total);
  const balancesCents = Math.max(0, n(balances?.total) - mintedCents);
  const owedTotal = escrowCents + balancesCents;

  return {
    collected: { topUpsCents, pledgesCents, totalCents: collectedTotal },
    sentOutCents,
    owed: { escrowCents, balancesCents, totalCents: owedTotal },
    mintedCents,
    oursCents: collectedTotal - sentOutCents - owedTotal,
    peopleWithBalance: n(balances?.people),
  };
}
