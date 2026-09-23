/**
 * One Stripe customer per account, however many requests ask for it at once.
 *
 * Subscription checkout and backing checkout both created a customer when the
 * account had none, then wrote its id to the row. Two of those at the same
 * moment — a double click, two tabs, a pledge and an upgrade — each created a
 * customer, and whichever write landed second won. The other customer was
 * detached: anything paid through it (a subscription, most dangerously) was
 * billed to a customer no account pointed at, so the webhook couldn't match
 * its events to anyone and cancelling from the app couldn't find it.
 *
 * Two things close it. The create carries an idempotency key per account, so
 * Stripe hands concurrent (and retried) requests the same customer for a day.
 * And the row is only written if it's still empty, then read back, so even a
 * customer created outside that window never replaces one already recorded —
 * everyone uses whichever id the row holds.
 */
import type Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";

export async function ensureStripeCustomer(
  stripe: Pick<Stripe, "customers">,
  user: { id: string; email?: string | null; stripeCustomerId?: string | null },
): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe.customers.create(
    { email: user.email || undefined, metadata: { userId: user.id } },
    { idempotencyKey: `customer_${user.id}` },
  );
  const [claimed] = await db.update(users).set({ stripeCustomerId: customer.id })
    .where(and(eq(users.id, user.id), isNull(users.stripeCustomerId)))
    .returning({ id: users.stripeCustomerId });
  if (claimed?.id) return claimed.id;
  const [row] = await db.select({ id: users.stripeCustomerId }).from(users).where(eq(users.id, user.id));
  return row?.id ?? customer.id;
}
