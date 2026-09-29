/**
 * The safe: taking a prize out of a company's balance, holding it, and letting
 * it out again exactly once.
 *
 * ## Why the money moves at all
 *
 * A prize used to be a sentence in a text box. A sentence costs nothing to
 * promise and nothing to break, and the person who pays for a broken one is an
 * entrant who spent a fortnight on it and has no recourse. So the money leaves
 * the company's balance when the challenge is posted and sits in a row until
 * somebody wins it — which is what lets the challenge page say "already paid
 * in and held" rather than "the company says".
 *
 * ## The one rule everything here serves
 *
 * **A prize leaves the safe once.** Every exit — awarded, refunded,
 * released — moves the row out of `held` in the same statement that reads it,
 * so two requests racing to award the same prize cannot both pay out. That is
 * the whole reason these are not four separate "check then update" helpers: a
 * check and an update with a gap between them is a double payout waiting for a
 * double-click, and this is real money.
 *
 * ## The fee is not the prize
 *
 * They are charged together and separated immediately. The $4.99 is ours and
 * is never refunded with the prize; the prize is the company's until an
 * entrant wins it. Keeping both numbers on the row means a refund can never
 * accidentally hand back the fee, and a receipt can say what happened to each.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { challengePrizes, novaLedger, users } from "@shared/schema";
import { CHALLENGE_FEE_CENTS, formatPrize } from "@shared/challenges-money";

/**
 * Move money into somebody's balance and write the line explaining it.
 *
 * Inside the caller's transaction, always: a prize that left the safe and did
 * not arrive is the one outcome worth engineering against.
 */
async function credit(tx: any, userId: string, cents: number, note: string) {
  const [row] = await tx.update(users)
    .set({ balanceCents: sql`${users.balanceCents} + ${cents}` })
    .where(eq(users.id, userId))
    .returning({ balanceAfter: users.balanceCents });
  // The account may have been closed since; the money has still left the safe,
  // and a ledger line against a row that is gone helps nobody.
  if (!row) return;
  await tx.insert(novaLedger).values({
    userId, kind: "refund", outcome: "challenge",
    amountCents: cents, balanceAfter: row.balanceAfter, note,
  });
}

/**
 * Charge nothing for a challenge, so the flow can be driven end to end without
 * real money.
 *
 * Gated exactly like the other development doors in this codebase
 * (`/api/dev/credit-wallet`, `SIM_DEV_ADVANCE`): never in production unless a
 * second, explicit variable says so, and never at all on a machine holding
 * live Stripe keys — a server that can take real payments has no business
 * giving away challenge slots.
 *
 * The prize is still *recorded* at its full amount and still moves through the
 * safe. Waiving the money and skipping the escrow would mean the development
 * path exercised a different mechanism from the real one, which is how a bug
 * in the real one survives every test somebody runs by hand.
 */
export function challengeChargesWaived(): boolean {
  if (process.env.STRIPE_SECRET_KEY?.startsWith("sk_live")) return false;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_TIER_OVERRIDE !== "true") return false;
  return process.env.DEV_FREE_CHALLENGES === "1" || process.env.DEV_FREE_CHALLENGES === "true";
}

export interface PrizeTaken {
  ok: true;
  amountCents: number;
  feeCents: number;
}
export interface PrizeRefused {
  ok: false;
  code: "insufficient_balance";
  shortfallCents: number;
  needCents: number;
  haveCents: number;
}

/**
 * Take the fee and the prize together, or take neither.
 *
 * One conditional update against the balance: a company that cannot cover both
 * is refused without being charged the fee for the privilege of finding out.
 * `gte` in the where clause is what makes it atomic — two challenges posted in
 * the same second from two tabs cannot both pass a balance that only covers
 * one.
 */
export async function takePrize(input: {
  tx: any;
  companyId: string;
  userId: string;
  amountCents: number;
  now: Date;
}): Promise<PrizeTaken | PrizeRefused> {
  const { tx, userId, amountCents } = input;
  const waived = challengeChargesWaived();
  const total = waived ? 0 : amountCents + CHALLENGE_FEE_CENTS;

  /*
   * Waived: the row is still written, at the full amount, in the `held` state.
   * Everything downstream — awarding, refunding, what the entrant is told —
   * runs the same code it runs in production, which is the only way driving
   * this by hand proves anything about it.
   */
  if (waived) return { ok: true, amountCents, feeCents: 0 };

  const [moved] = await tx.update(users)
    .set({ balanceCents: sql`${users.balanceCents} - ${total}` })
    .where(and(eq(users.id, userId), sql`${users.balanceCents} >= ${total}`))
    .returning({ balanceAfter: users.balanceCents });

  if (!moved) {
    const [u] = await tx.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, userId));
    const have = u?.balanceCents ?? 0;
    return { ok: false, code: "insufficient_balance", shortfallCents: Math.max(0, total - have), needCents: total, haveCents: have };
  }

  /*
   * Two ledger lines, not one. "Why is there $504.99 missing" has a different
   * answer for each part of it, and a single line would make the fee and the
   * prize impossible to tell apart on a statement six months later.
   */
  await tx.insert(novaLedger).values({
    userId, kind: "spend", outcome: "challenge",
    amountCents: -CHALLENGE_FEE_CENTS, balanceAfter: moved.balanceAfter + amountCents,
    note: "Posting a challenge",
  });
  await tx.insert(novaLedger).values({
    userId, kind: "spend", outcome: "challenge",
    amountCents: -amountCents, balanceAfter: moved.balanceAfter,
    note: `Prize held by SparkTower — ${formatPrize(amountCents)}`,
  });

  return { ok: true, amountCents, feeCents: CHALLENGE_FEE_CENTS };
}

/**
 * Write the safe's row, once the challenge it belongs to exists.
 *
 * Separate from taking the money, and called after the challenge is inserted,
 * because the row's primary key is the challenge's id. Keeping them apart is
 * also what lets the caller debit *first* and write nothing at all when the
 * balance cannot cover it — no insert to undo, and so no rollback, which is
 * one less thing to get wrong with real money in the middle of it.
 */
export async function recordPrize(input: {
  tx: any;
  challengeId: string;
  companyId: string;
  userId: string;
  taken: PrizeTaken;
  now: Date;
}): Promise<void> {
  const { tx, challengeId, companyId, userId, taken, now } = input;
  await tx.insert(challengePrizes).values({
    challengeId, companyId, fundedBy: userId,
    amountCents: taken.amountCents, feeCents: taken.feeCents,
    state: "held", createdAt: now,
  });
}

export type PrizeExit = "awarded" | "refunded" | "released";

/**
 * Let a prize out of the safe, once.
 *
 * The `where` carries `state = 'held'`, so the read and the write are one
 * statement and a second caller finds nothing to update rather than a row it
 * can pay out again. Returns null when there was nothing held — which is the
 * honest answer to "award this twice" and to "award a challenge that was
 * already refunded".
 */
export async function releasePrize(input: {
  challengeId: string;
  exit: PrizeExit;
  /** Who gets it. The winner for an award; the funder for a refund or a release. */
  toUserId?: string | null;
  now: Date;
}): Promise<{ amountCents: number; toUserId: string | null } | null> {
  const { challengeId, exit, now } = input;

  return db.transaction(async (tx) => {
    const [prize] = await tx.update(challengePrizes)
      .set({
        state: exit,
        settledAt: now,
        ...(exit === "awarded" ? { awardedTo: input.toUserId ?? null, awardedAt: now } : {}),
      })
      .where(and(eq(challengePrizes.challengeId, challengeId), eq(challengePrizes.state, "held")))
      .returning();
    if (!prize) return null;

    /*
     * An award goes to the winner; a refund and a release go back to whoever
     * funded it. Falling back to the funder for an award with nobody named
     * would quietly pay the company its own prize, so that case returns the
     * money to them *as a refund* — which is what it actually is.
     */
    const to = exit === "awarded" ? (input.toUserId ?? null) : prize.fundedBy;
    if (to) {
      await credit(tx, to, prize.amountCents, exit === "awarded"
        ? `Challenge prize — ${formatPrize(prize.amountCents)}`
        : `Challenge prize returned — ${formatPrize(prize.amountCents)}`);
    }
    return { amountCents: prize.amountCents, toUserId: to };
  });
}

/** What is in the safe for one challenge, for the page that has to say so. */
export async function prizeFor(challengeId: string) {
  const [row] = await db.select().from(challengePrizes).where(eq(challengePrizes.challengeId, challengeId));
  return row ?? null;
}

/** The prizes for a list of challenges, in one query, for a list screen. */
export async function prizesFor(challengeIds: string[]) {
  if (!challengeIds.length) return new Map<string, typeof challengePrizes.$inferSelect>();
  /*
   * `inArray`, not a hand-written `= any(...)`.
   *
   * A JS array interpolated into a template goes to Postgres as one bound
   * parameter, so `any($1)` was handed a bare uuid where it wanted an array
   * literal and threw "malformed array literal" — a 500 on GET /api/challenges,
   * which is the public list. It only showed up with challenges on the page;
   * an empty board returns early on the line above and looked perfectly fine.
   */
  const rows = await db.select().from(challengePrizes)
    .where(inArray(challengePrizes.challengeId, challengeIds));
  return new Map(rows.map((r) => [r.challengeId, r]));
}
