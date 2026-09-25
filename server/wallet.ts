/**
 * The money on an account: what's there, what takes it, and what puts it back.
 *
 * There are no credits here and no plans. A person has a dollar balance, a
 * monthly allowance of small Nova actions, and possibly a day pass — and every
 * question the rest of the server asks about money is one of:
 *
 *   - what is in this wallet right now (`walletOf`),
 *   - take this much for this outcome, or say you couldn't (`spend`),
 *   - put it back, the action failed (`refund`),
 *   - this Checkout session paid, credit it once and only once (`creditTopUp`).
 *
 * ## Why the balance is a column and the ledger is a table
 *
 * `users.balance_cents` is read on every request that might cost money, so it
 * has to be one indexed read, not a sum over a person's history. But a running
 * total with no history is unauditable — when somebody writes in asking why
 * they have $2 left, "because the column says so" is not an answer. So every
 * movement also writes a nova_ledger row carrying the balance it produced, and
 * the two are written in one transaction. If they ever disagree, the ledger is
 * the truth and the column is the bug.
 *
 * ## Why taking money is a conditional UPDATE
 *
 * The same lesson the credits learned the hard way (server/storage.ts,
 * chargeCredits): read-decide-write lets two requests both see $3 and both
 * spend it. The condition travels with the update — `where balance_cents >=
 * cents` — so the database decides, once, and the loser is told no. A model
 * call that got through on a balance that wasn't there is money we never had.
 */
import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { users, novaLedger, novaBuildPasses } from "@shared/schema";
import {
  ACTIONS_PER_PACK, MONTHLY_SMALL_ACTIONS, OUTCOME_PRICE_CENTS,
  formatMoney, type PricedOutcomeId,
  type Wallet,
} from "@shared/plans";

/** Everything a dialog needs to say where somebody stands, in one object. */

export function walletFrom(row: {
  balanceCents: number; creditsUsed: number; dayPassUntil: Date | null;
  imagePassUntil?: Date | null; novaActionsBought?: number; devUnlimited?: boolean;
}): Wallet {
  const used = Math.max(0, row.creditsUsed ?? 0);
  const active = !!row.dayPassUntil && row.dayPassUntil.getTime() > Date.now();
  return {
    actionsBought: Math.max(0, row.novaActionsBought ?? 0),
    /* Never true in a production build: see requireCredits. */
    devUnlimited: process.env.NODE_ENV !== "production" && !!row.devUnlimited,
    balanceCents: row.balanceCents ?? 0,
    balanceDisplay: formatMoney(row.balanceCents ?? 0),
    allowanceUsed: used,
    allowanceLimit: MONTHLY_SMALL_ACTIONS,
    allowanceRemaining: Math.max(0, MONTHLY_SMALL_ACTIONS - used),
    dayPassUntil: row.dayPassUntil ? row.dayPassUntil.toISOString() : null,
    dayPassActive: active,
    imagePassUntil: row.imagePassUntil ? row.imagePassUntil.toISOString() : null,
    imagePassActive: !!row.imagePassUntil && row.imagePassUntil.getTime() > Date.now(),
  };
}

/**
 * The wallet as it stands. Rolls the month over first, so "you have 25 left"
 * is true on the 1st without waiting for the next charge to notice.
 */
export async function walletOf(userId: string): Promise<Wallet> {
  const { storage } = await import("./storage");
  await storage.resetCreditsIfNeeded(userId);
  const [row] = await db.select({
    balanceCents: users.balanceCents, creditsUsed: users.creditsUsed, dayPassUntil: users.dayPassUntil,
    imagePassUntil: users.imagePassUntil, novaActionsBought: users.novaActionsBought,
    devUnlimited: users.devUnlimited,
  }).from(users).where(eq(users.id, userId));
  if (!row) return walletFrom({ balanceCents: 0, creditsUsed: 0, dayPassUntil: null });
  return walletFrom(row);
}

/**
 * Whether this account is a developer's, and so never charged.
 *
 * Read rather than cached: a developer flips it mid-session and expects the
 * next click to behave differently. Callers must also check that this is not
 * production — see the note in requireCredits.
 */
export async function devUnlimited(userId: string): Promise<boolean> {
  const [row] = await db.select({ on: users.devUnlimited }).from(users).where(eq(users.id, userId));
  return !!row?.on;
}

/** True while a day pass is running. */
export async function dayPassActive(userId: string): Promise<boolean> {
  const [row] = await db.select({ until: users.dayPassUntil }).from(users).where(eq(users.id, userId));
  return !!row?.until && row.until.getTime() > Date.now();
}

export interface SpendRecord {
  id: string;
  amountCents: number;
  balanceAfter: number;
}

/**
 * Takes `cents` off the balance, or returns null because it wasn't there.
 *
 * Both writes are one transaction, and the update carries its own condition,
 * so two requests spending the last dollar at the same moment end with one
 * spend and one null rather than a balance of -100.
 */
export async function spend(
  userId: string,
  cents: number,
  about: { outcome: PricedOutcomeId; note?: string; projectId?: string | null },
): Promise<SpendRecord | null> {
  if (cents <= 0) return { id: "", amountCents: 0, balanceAfter: (await walletOf(userId)).balanceCents };
  /*
   * A developer's account, outside production: the price is nothing.
   *
   * The switch says "Everything free — nothing charges and the allowance
   * stops moving", and for small actions it was true, because those go
   * through `requireCredits` which has honoured the flag for a long time.
   * Priced outcomes do not go through it — they come straight here — so the
   * one thing the toggle exists to let somebody test was the one thing it
   * could not: opening the $14.99 whole-business build ended at a Stripe
   * checkout, on an account whose own wallet said `devUnlimited: true` in the
   * same response that refused it.
   *
   * Put here rather than at each of the seven call sites so a new priced
   * outcome cannot quietly miss it, and guarded the same two ways
   * `requireCredits` is: only outside production, and never on a server
   * holding live Stripe keys, because a switch that turns off charging is
   * worth being paranoid about twice.
   */
  if (process.env.NODE_ENV !== "production"
      && !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live")
      && await devUnlimited(userId)) {
    return { id: "", amountCents: 0, balanceAfter: (await walletOf(userId)).balanceCents };
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.update(users)
      .set({ balanceCents: sql`${users.balanceCents} - ${cents}` })
      .where(and(eq(users.id, userId), gte(users.balanceCents, cents)))
      .returning({ balanceAfter: users.balanceCents });
    if (!row) return null;
    const [entry] = await tx.insert(novaLedger).values({
      userId, kind: "spend", outcome: about.outcome,
      amountCents: -cents, balanceAfter: row.balanceAfter,
      note: about.note ?? null, projectId: about.projectId ?? null,
    }).returning({ id: novaLedger.id });
    return { id: entry.id, amountCents: cents, balanceAfter: row.balanceAfter };
  });
}

/**
 * Money back, for an outcome that didn't happen.
 *
 * A refund is its own row rather than an edit to the spend: the spend really
 * did happen, and a history that rewrites itself can't be read back to
 * somebody. Never fails — if the account has since been deleted the update
 * matches nothing and the ledger row is skipped, which is the right amount of
 * fuss for money going back to a row that no longer exists.
 */
export async function refund(
  userId: string,
  cents: number,
  about: { outcome: PricedOutcomeId; note?: string; projectId?: string | null },
): Promise<void> {
  if (cents <= 0) return;
  await db.transaction(async (tx) => {
    const [row] = await tx.update(users)
      .set({ balanceCents: sql`${users.balanceCents} + ${cents}` })
      .where(eq(users.id, userId))
      .returning({ balanceAfter: users.balanceCents });
    if (!row) return;
    await tx.insert(novaLedger).values({
      userId, kind: "refund", outcome: about.outcome,
      amountCents: cents, balanceAfter: row.balanceAfter,
      note: about.note ?? "Refunded — the action didn't finish", projectId: about.projectId ?? null,
    });
  });
}

/**
 * A paid Checkout session becomes balance. Exactly once, however many times
 * Stripe sends it.
 *
 * The ledger insert goes first and carries the session id, which is unique:
 * a redelivery inserts nothing, the transaction short-circuits, and the
 * balance is untouched. The webhook's own event ledger already stops the same
 * *event* twice; this stops the same *session* arriving as two different
 * events (completed, then async_payment_succeeded), which is a thing Stripe
 * really does for delayed payment methods.
 *
 * Returns whether this call was the one that credited it.
 */
export async function creditTopUp(
  userId: string,
  cents: number,
  stripeSessionId: string,
  note = "Added to your balance",
): Promise<{ credited: boolean; balanceCents: number }> {
  if (cents <= 0) return { credited: false, balanceCents: (await walletOf(userId)).balanceCents };
  return db.transaction(async (tx) => {
    const claimed = await tx.insert(novaLedger).values({
      userId, kind: "topup", outcome: null, amountCents: cents,
      // Filled in below once the balance has actually moved.
      balanceAfter: 0, stripeSessionId, note,
    }).onConflictDoNothing({ target: novaLedger.stripeSessionId }).returning({ id: novaLedger.id });
    if (!claimed.length) {
      const [u] = await tx.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, userId));
      return { credited: false, balanceCents: u?.balanceCents ?? 0 };
    }
    const [row] = await tx.update(users)
      .set({ balanceCents: sql`${users.balanceCents} + ${cents}` })
      .where(eq(users.id, userId))
      .returning({ balanceAfter: users.balanceCents });
    await tx.update(novaLedger).set({ balanceAfter: row?.balanceAfter ?? cents }).where(eq(novaLedger.id, claimed[0].id));
    return { credited: true, balanceCents: row?.balanceAfter ?? cents };
  });
}

/**
 * Buys a pack of small Nova actions out of the balance.
 *
 * They add up rather than replacing each other: somebody who buys a second
 * pack with nine actions left on the first has thirty-four, not twenty-five.
 * Returns null when the balance couldn't cover it.
 *
 * This replaced a day pass — a dollar for twenty-four hours of unlimited small
 * actions. The trouble with renting a window is that what it really costs
 * depends on how fast somebody types, and the thing being rented is a model
 * call, which costs real money every time. A pack is the same promise as the
 * balance itself: a fixed number of things for a fixed price, spent when you
 * spend them, expiring never.
 */
export async function buyActionPack(userId: string): Promise<{ actions: number; wallet: Wallet } | null> {
  const cents = OUTCOME_PRICE_CENTS.actionPack;
  const taken = await spend(userId, cents, {
    outcome: "actionPack",
    note: `${ACTIONS_PER_PACK} more small Nova actions`,
  });
  if (!taken) return null;
  const [row] = await db.update(users)
    .set({ novaActionsBought: sql`${users.novaActionsBought} + ${ACTIONS_PER_PACK}` })
    .where(eq(users.id, userId))
    .returning({ actions: users.novaActionsBought });
  return { actions: row?.actions ?? ACTIONS_PER_PACK, wallet: await walletOf(userId) };
}

/**
 * Spends one bought action, if there is one. True when it took it.
 *
 * A conditional update rather than a read then a write, so two requests
 * arriving together cannot both spend the last one.
 */
export async function spendBoughtAction(userId: string): Promise<boolean> {
  const [row] = await db.update(users)
    .set({ novaActionsBought: sql`${users.novaActionsBought} - 1` })
    .where(and(eq(users.id, userId), gt(users.novaActionsBought, 0)))
    .returning({ left: users.novaActionsBought });
  return !!row;
}

/** Hands one back, for work that was reserved and never delivered. */
export async function refundBoughtAction(userId: string): Promise<void> {
  await db.update(users)
    .set({ novaActionsBought: sql`${users.novaActionsBought} + 1` })
    .where(eq(users.id, userId));
}

/** Whether "Nova builds the whole business" has been bought for this project. */
export async function hasBuildPass(userId: string, projectId: string | null | undefined): Promise<boolean> {
  if (!projectId) return false;
  const [row] = await db.select({ id: novaBuildPasses.id }).from(novaBuildPasses)
    .where(and(eq(novaBuildPasses.userId, userId), eq(novaBuildPasses.projectId, projectId)));
  return !!row;
}

/**
 * Every project this account has bought the whole-business build for.
 *
 * The client needs this, not just the server. `requireCredits` has always
 * treated a build pass as covering every priced outcome on that project — the
 * route that sells it says "from here on every priced outcome on it is already
 * paid for" — but the confirmation dialog knew only an action's list price and
 * the balance, so on a project that had already paid for the build it still opened with
 * "Price $6 / Balance $20 → $14" and a Pay button. Pressing it took nothing,
 * which is right and is not what the buyer was told; declining it meant not
 * using something they already owned.
 */
export async function buildPassProjects(userId: string): Promise<string[]> {
  const rows = await db.select({ projectId: novaBuildPasses.projectId })
    .from(novaBuildPasses).where(eq(novaBuildPasses.userId, userId));
  return rows.map((r) => r.projectId);
}

/** The last movements on an account, newest first — a statement somebody can read. */
export async function recentLedger(userId: string, limit = 25) {
  return db.select({
    id: novaLedger.id, kind: novaLedger.kind, outcome: novaLedger.outcome,
    amountCents: novaLedger.amountCents, balanceAfter: novaLedger.balanceAfter,
    note: novaLedger.note, projectId: novaLedger.projectId, createdAt: novaLedger.createdAt,
  }).from(novaLedger).where(eq(novaLedger.userId, userId))
    .orderBy(desc(novaLedger.createdAt)).limit(Math.min(100, Math.max(1, limit)));
}
