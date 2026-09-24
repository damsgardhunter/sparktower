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
import type { PricedOutcomeId } from "@shared/plans";

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

// ---------------------------------------------------------------------------
// Dollars, held the same way
// ---------------------------------------------------------------------------
/**
 * The same shape again, for the priced outcomes — a roadmap, a document, an
 * audit — where what was taken up front is real money rather than an action
 * off the monthly allowance.
 *
 * The rule the product owner set is that a failed action's money comes back
 * automatically, and the only way to make that true without auditing every
 * route is to make "nothing was charged" the default: requireCredits spends
 * the money before the model runs, records the hold here, and the money goes
 * back inside `res.end` unless the route settled it. A route settles by doing
 * what it already did — calling storage.deductCredits once the answer is in
 * hand — so no call site had to learn a new verb.
 *
 * Held per user and matched oldest-first, exactly as the credit holds are, and
 * harmless for the same reason: each hold is closed once, either by a
 * settlement or by its own response.
 */
interface MoneyHold {
  userId: string;
  cents: number;
  outcome: PricedOutcomeId;
  projectId: string | null;
  open: boolean;
}

const moneyHolds = new Map<string, MoneyHold[]>();

function forgetMoney(hold: MoneyHold) {
  const list = moneyHolds.get(hold.userId);
  if (!list) return;
  const i = list.indexOf(hold);
  if (i >= 0) list.splice(i, 1);
  if (list.length === 0) moneyHolds.delete(hold.userId);
}

async function releaseMoney(hold: MoneyHold): Promise<void> {
  if (!hold.open) return;
  hold.open = false;
  forgetMoney(hold);
  // Nothing was taken, so there is nothing to give back (see holdCovered).
  if (hold.cents <= 0) return;
  try {
    const { refund } = await import("./wallet");
    await refund(hold.userId, hold.cents, { outcome: hold.outcome, projectId: hold.projectId });
  } catch (err) {
    // Somebody is out real money. Loud, and never worth failing their response over.
    console.error(`[wallet] couldn't refund ${hold.cents}c (${hold.outcome}) to ${hold.userId}:`, err);
  }
}

/**
 * Records money already taken for this response, to be given back if the route
 * never settles it. Same mechanics as holdCredits: the refund lands inside
 * `res.end`, before the bytes go out, so a client that reads its balance
 * straight after a failure sees it whole.
 */
export function holdMoney(
  res: Response,
  userId: string,
  cents: number,
  outcome: PricedOutcomeId,
  projectId: string | null = null,
): void {
  const hold: MoneyHold = { userId, cents, outcome, projectId, open: true };
  const list = moneyHolds.get(userId) ?? [];
  list.push(hold);
  moneyHolds.set(userId, list);

  const end = res.end;
  (res as any).end = function (this: Response, ...args: any[]) {
    (res as any).end = end;
    if (!hold.open) return (end as any).apply(this, args);
    void releaseMoney(hold).finally(() => (end as any).apply(this, args));
    return this;
  };
  res.once("close", () => { void releaseMoney(hold); });
}

/**
 * Closes the oldest open money hold for this user and reports that it existed.
 * True means "the outcome was delivered; the money stays spent".
 */
/**
 * Marks this response as already paid for.
 *
 * Some actions are free at the point of use and still run the same code:
 * an outcome on a project the whole-business build covers, a small action
 * under a day pass. Those return from requireCredits without taking anything —
 * and the route then settles the way every route settles, by calling
 * storage.deductCredits once the answer is in hand. With no hold to find, that
 * falls back to taking an action off the month's free allowance: the person
 * who paid the most would have paid twice.
 *
 * So the free paths leave a hold worth nothing. The settle finds it, closes it
 * and stops, and the release refunds nothing because nothing was taken. The
 * alternative was teaching thirty call sites when not to settle, which is the
 * kind of rule that holds until the thirty-first.
 */
export function holdCovered(res: Response, userId: string, outcome: PricedOutcomeId = "dayPass"): void {
  holdMoney(res, userId, 0, outcome, null);
}

export function settleMoney(userId: string): boolean {
  const hold = moneyHolds.get(userId)?.find((h) => h.open);
  if (!hold) return false;
  hold.open = false;
  forgetMoney(hold);
  return true;
}
