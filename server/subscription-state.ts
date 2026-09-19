/**
 * What plan somebody is on, read from everything Stripe holds for them — not
 * from whichever subscription happened to send the last event.
 *
 * The webhook used to treat every subscription event as if it described *the*
 * subscription. That holds only while there is one, and there wasn't always:
 * /api/checkout started a new subscription for anybody who asked, including
 * people already paying, so a Builder member who ran out of credits and
 * pressed "upgrade" ended up with Builder and Pro both billing. From then on:
 *
 *   - every renewal of the old Builder subscription sent an "updated" event,
 *     which set them back to Builder — paying for two plans, getting the
 *     smaller one, and having their credits reset on each flip;
 *   - cancelling either one in the billing portal sent "deleted", which set
 *     them to Free while the other went on charging.
 *
 * So the plan is recomputed from the customer's live subscriptions every time:
 * the highest paid tier among them wins, and more than one paid subscription
 * is reported loudly, because it means somebody is being charged twice and a
 * person needs to refund it. Checkout no longer creates the second one (see
 * /api/checkout), but a race or an old account can still hold two.
 */
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { isPaidSubscriptionStatus } from "@shared/subscriptions";
import { tierRank } from "@shared/plans";
import { applyTier } from "./billing-credits";
import { reportError } from "./error-reporting";

/** Statuses Stripe will never bill again. Anything else can still charge. */
const FINISHED = new Set(["canceled", "incomplete_expired"]);

type Sub = { id: string; status: string; created?: number; items?: any; customer?: any };

/** Every subscription on a customer that could still charge them, newest first. */
export async function liveSubscriptions(stripe: Pick<Stripe, "subscriptions">, customer: string): Promise<Sub[]> {
  const page = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
  return (page.data as unknown as Sub[])
    .filter((s) => !FINISHED.has(s.status))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

/**
 * Sets the account's plan from what the customer is actually paying for.
 *
 * `fresh` is the subscription an event carried: its state in the event can be
 * newer than what a list call returns a moment later (Stripe's reads are
 * eventually consistent), so it overrides the listed copy of itself.
 * `tierFor` reads a subscription's tier from its price and throws if Stripe
 * can't be asked — a retry, never a silent downgrade.
 */
export async function settleTier(opts: {
  userId: string;
  customer: string;
  stripe: Pick<Stripe, "subscriptions">;
  tierFor: (subscription: Sub) => Promise<string>;
  fresh?: Sub | null;
}): Promise<{ tier: string; subscriptionId: string | null; paying: number }> {
  const { userId, customer, stripe, tierFor, fresh } = opts;
  const byId = new Map<string, Sub>();
  for (const s of await liveSubscriptions(stripe, customer)) byId.set(s.id, s);
  if (fresh) {
    if (FINISHED.has(fresh.status)) byId.delete(fresh.id);
    else byId.set(fresh.id, fresh);
  }

  const paid: { sub: Sub; tier: string }[] = [];
  for (const sub of byId.values()) {
    if (isPaidSubscriptionStatus(sub.status)) paid.push({ sub, tier: await tierFor(sub) });
  }
  paid.sort((a, b) => tierRank(b.tier) - tierRank(a.tier) || (b.sub.created ?? 0) - (a.sub.created ?? 0));

  if (paid.length > 1) {
    // Money going out twice for one account. Not cancelled automatically —
    // which one they meant to keep, and what to refund, is a person's call.
    const which = paid.map((p) => `${p.sub.id} (${p.tier}, ${p.sub.status})`).join(", ");
    reportError(new Error(`Charged twice: customer ${customer} has ${paid.length} paid subscriptions: ${which}`), {
      route: "(stripe) settleTier",
      userId,
    });
  }

  const best = paid[0];
  if (best) {
    await applyTier(userId, best.tier, best.sub.id);
    return { tier: best.tier, subscriptionId: best.sub.id, paying: paid.length };
  }

  // Nothing paid. Keep a still-live (say past_due) subscription on the row, so
  // there is something to fix the card on; otherwise nothing at all.
  const pending = [...byId.values()][0] ?? null;
  await db.update(users).set({ subscriptionTier: "free", stripeSubscriptionId: pending?.id ?? null }).where(eq(users.id, userId));
  return { tier: "free", subscriptionId: pending?.id ?? null, paying: 0 };
}
