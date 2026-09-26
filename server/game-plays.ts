/**
 * Who may have a game valued, and what the second one in a day costs.
 *
 * The Ten Years verdict is a model call. It has never been metered — no
 * credits, no ceiling — so every play has been a small bill with no revenue
 * against it, and it never appeared in what a credit was thought to cost.
 *
 * It stays free, because it is how people meet the product and a paywall on
 * the first taste is a bad trade. But free once a day: the second valuation a
 * person asks for in the same day is a dollar. That keeps the hook and stops
 * the subsidy being unbounded.
 *
 * Counted from `ai_spend`, which already records every model call by person
 * and action, so this needs no ledger of its own — and a game valuation
 * finally shows up in the same place as everything else Nova spends.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { aiSpend, users } from "@shared/schema";

/** The action's key in `ai_spend`. */
export const GAME_VERDICT = "gameVerdict";
/** One valuation a day, free. */
export const FREE_PER_DAY = 1;
/** What another one costs, in cents. */
export const PLAY_PRICE_CENTS = 100;
/** The most extra plays one checkout can carry, so a typo is not a big charge. */
export const PLAYS_PER_PURCHASE_MAX = 50;

const dayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

/** How many valuations this person has had in the last day. */
export async function valuationsToday(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(aiSpend)
    .where(and(eq(aiSpend.userId, userId), eq(aiSpend.action, GAME_VERDICT), gte(aiSpend.createdAt, dayAgo())));
  return Number(row?.n ?? 0);
}

export interface PlayAllowance {
  allowed: boolean;
  /** True when this one is free rather than drawn from what they bought. */
  free: boolean;
  usedToday: number;
  paidPlays: number;
  pricePerPlay: number;
}

/** Whether this person may have a game valued right now, and on whose money. */
export async function mayValue(userId: string): Promise<PlayAllowance> {
  const [usedToday, [me]] = await Promise.all([
    valuationsToday(userId),
    db.select({ paid: users.gamePlaysPaid }).from(users).where(eq(users.id, userId)),
  ]);
  const paidPlays = me?.paid ?? 0;
  const free = usedToday < FREE_PER_DAY;
  return {
    allowed: free || paidPlays > 0,
    free,
    usedToday,
    paidPlays,
    pricePerPlay: PLAY_PRICE_CENTS / 100,
  };
}

/**
 * Take the play, and say whether there was one to take.
 *
 * The paid decrement is conditional in SQL rather than read-then-write: two
 * tabs polling the same finished game arrive here together, and a check
 * followed by an update would let both through on one bought play. Returns
 * false when there was nothing left, and the caller does not call the model.
 */
export async function takePlay(userId: string): Promise<{ ok: boolean; paid: boolean }> {
  const allowance = await mayValue(userId);
  if (allowance.free) return { ok: true, paid: false };
  if (allowance.paidPlays <= 0) return { ok: false, paid: false };

  const taken = await db
    .update(users)
    .set({ gamePlaysPaid: sql`${users.gamePlaysPaid} - 1` })
    .where(and(eq(users.id, userId), sql`${users.gamePlaysPaid} > 0`))
    .returning({ id: users.id });
  return { ok: taken.length > 0, paid: taken.length > 0 };
}

/**
 * Give a bought play back, because the model did not answer.
 *
 * The play has to be taken before the call — two tabs polling the same
 * finished game would otherwise both spend it — which means a call that fails
 * has already cost somebody a dollar for nothing. A free play needs no refund:
 * it is counted from what was recorded, and a failure records nothing.
 */
export async function refundPlay(userId: string): Promise<void> {
  try {
    await db.update(users)
      .set({ gamePlaysPaid: sql`${users.gamePlaysPaid} + 1` })
      .where(eq(users.id, userId));
  } catch (err) {
    console.error("[game] could not give a play back:", (err as Error)?.message ?? err);
  }
}

/**
 * Write the valuation down. Zero credits — it is free to the person — but it
 * is a real model call, so it belongs in the same ledger as everything else:
 * it is what the daily allowance counts, and what says later how much the
 * game actually costs to give away.
 */
export async function recordValuation(userId: string, model: string): Promise<void> {
  try {
    await db.insert(aiSpend).values({ userId, action: GAME_VERDICT, credits: 0, model });
  } catch (err) {
    console.error("[game] could not record a valuation:", (err as Error)?.message ?? err);
  }
}
