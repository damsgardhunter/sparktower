/**
 * Credits taken before the model call, not after it.
 *
 * Every AI route checks the balance (requireCredits), calls the model, then
 * deducts. The deduction is conditional — it can't take the row over the cap —
 * but its answer was never read, and by then the model had already been paid
 * for. So a script firing twenty requests at once had all twenty pass the
 * check against the same balance, all twenty reach the model, and at most a
 * few of them charged: the rest was the platform's bill.
 *
 * Now requireCredits spends the credits up front, with the same conditional
 * update (storage.chargeCredits), and records the hold here. The route's own
 * deductCredits afterwards settles against the hold instead of charging
 * again: the same amount costs nothing more, a different amount charges or
 * returns the difference. A route that ends without deducting — the model
 * failed, the answer was unreadable, it returned early — gets the hold back
 * before its response goes out, so "nothing was charged" is true by the time
 * the client can ask.
 *
 * Holds are per process and matched to deductions by user, oldest first. That
 * pairing can cross two of one person's concurrent requests, which is harmless:
 * each hold is closed exactly once, by a deduction or by its own response, so
 * the totals come out the same whichever request's deduction closed it.
 */
import type { Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";

interface Hold { userId: string; amount: number; open: boolean }

const holds = new Map<string, Hold[]>();

function forget(hold: Hold) {
  const list = holds.get(hold.userId);
  if (!list) return;
  const i = list.indexOf(hold);
  if (i >= 0) list.splice(i, 1);
  if (list.length === 0) holds.delete(hold.userId);
}

/** Returns credits to the balance. Never below zero: a monthly reset may have landed in between. */
export async function returnCredits(userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await db.update(users).set({ creditsUsed: sql`greatest(0, ${users.creditsUsed} - ${amount})` }).where(eq(users.id, userId));
}

async function release(hold: Hold): Promise<void> {
  if (!hold.open) return;
  hold.open = false;
  forget(hold);
  try {
    await returnCredits(hold.userId, hold.amount);
  } catch (err) {
    // Costs the person one action's credits; never worth failing their response over.
    console.error(`[credits] couldn't return ${hold.amount} held credits to ${hold.userId}:`, err);
  }
}

/**
 * Records credits `requireCredits` has already charged for this response, and
 * arranges for them to come back if the route never deducts.
 *
 * The return happens inside `res.end`, before the response is written, so a
 * client reading its balance straight after a failed call sees it whole. A
 * client that disconnects first gets it back on "close".
 */
export function holdCredits(res: Response, userId: string, amount: number): void {
  const hold: Hold = { userId, amount, open: true };
  const list = holds.get(userId) ?? [];
  list.push(hold);
  holds.set(userId, list);

  const end = res.end;
  (res as any).end = function (this: Response, ...args: any[]) {
    (res as any).end = end;
    if (!hold.open) return (end as any).apply(this, args);
    void release(hold).finally(() => (end as any).apply(this, args));
    return this;
  };
  res.once("close", () => { void release(hold); });
}

/**
 * The oldest open hold for this user, closed and handed to the caller to
 * settle — or null, and the caller charges as it always did.
 */
export function takeHold(userId: string): { amount: number } | null {
  const hold = holds.get(userId)?.find((h) => h.open);
  if (!hold) return null;
  hold.open = false;
  forget(hold);
  return { amount: hold.amount };
}
