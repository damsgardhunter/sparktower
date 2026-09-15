/**
 * Where payment turns into what someone can use — the revenue loop's server
 * side after checkout.
 *
 * - A tier set from Stripe (webhook, checkout, or the post-checkout sync)
 *   refills the month's allowance when it's an upgrade, so what someone just
 *   paid for is there when they come back.
 * - Each paid renewal refills it again, and clears a failed payment.
 * - A failed subscription payment is kept on the account, so the app can say
 *   "update your card" — the tier still follows the subscription's status.
 * - A subscription payment refunded in full takes the paid plan away, and
 *   keeps it away through later subscription events, until an invoice is paid again.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { REFILLING_INVOICE_REASONS, refillsOnTierChange } from "@shared/credits";

const customerOf = (obj: any): string | null => (typeof obj?.customer === "string" ? obj.customer : obj?.customer?.id ?? null);

/** Whether an invoice belongs to a subscription, across Stripe API versions. */
export function invoiceSubscriptionId(invoice: any): string | null {
  const id = invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription ?? null;
  if (id) return typeof id === "string" ? id : id.id ?? null;
  return typeof invoice?.billing_reason === "string" && invoice.billing_reason.startsWith("subscription") ? "unknown" : null;
}

export async function applyTier(userId: string, tier: string, stripeSubscriptionId: string | null | undefined): Promise<{ refilled: boolean; heldByRefund?: boolean }> {
  const [user] = await db.select({ tier: users.subscriptionTier, refundedAt: users.subscriptionRefundedAt }).from(users).where(eq(users.id, userId));
  if (!user) return { refilled: false };
  // Refunded: a subscription event saying "active" doesn't hand the plan back; a paid invoice does.
  if (user.refundedAt && tier !== "free") {
    if (stripeSubscriptionId !== undefined) await db.update(users).set({ stripeSubscriptionId }).where(eq(users.id, userId));
    return { refilled: false, heldByRefund: true };
  }
  const refilled = refillsOnTierChange(user.tier, tier);
  await db.update(users).set({
    subscriptionTier: tier,
    ...(stripeSubscriptionId !== undefined ? { stripeSubscriptionId } : {}),
    ...(refilled ? { creditsUsed: 0, creditsResetAt: new Date() } : {}),
  }).where(eq(users.id, userId));
  return { refilled };
}

/**
 * invoice.paid for a subscription: a failed payment is fixed, a refund hold is
 * lifted (the tier is read again from the subscription — `tierFor`, which may
 * ask Stripe and throws for a retry), and a renewal refills the allowance.
 */
export async function onInvoicePaid(event: any, tierFor: (subscriptionId: string) => Promise<string>): Promise<void> {
  if (event?.type !== "invoice.paid" && event?.type !== "invoice.payment_succeeded") return;
  const invoice = event.data?.object;
  const customer = customerOf(invoice);
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!customer || !subscriptionId) return;
  const [user] = await db.select({ id: users.id, refundedAt: users.subscriptionRefundedAt, subscriptionId: users.stripeSubscriptionId }).from(users).where(eq(users.stripeCustomerId, customer));
  if (!user) return;
  const refill = REFILLING_INVOICE_REASONS.has(invoice?.billing_reason);
  await db.update(users).set({
    paymentFailedAt: null, paymentFailureMessage: null,
    ...(refill ? { creditsUsed: 0, creditsResetAt: new Date() } : {}),
  }).where(eq(users.id, user.id));
  if (user.refundedAt) {
    const sub = subscriptionId !== "unknown" ? subscriptionId : user.subscriptionId;
    const tier = sub ? await tierFor(sub) : "free";
    await db.update(users).set({ subscriptionRefundedAt: null }).where(eq(users.id, user.id));
    await applyTier(user.id, tier, sub ?? undefined);
  }
  console.log(`Invoice paid for user ${user.id}${refill ? ": credits refilled" : ""}${user.refundedAt ? "; refund hold lifted" : ""}`);
}

/** invoice.payment_failed for a subscription: kept on the account until a payment goes through. */
export async function onSubscriptionPaymentFailed(event: any): Promise<boolean> {
  if (event?.type !== "invoice.payment_failed") return false;
  const invoice = event.data?.object;
  const customer = customerOf(invoice);
  if (!customer || !invoiceSubscriptionId(invoice)) return false;
  const message = String(invoice?.last_finalization_error?.message ?? "Your card was declined or couldn't be charged.").slice(0, 300);
  const updated = await db.update(users).set({ paymentFailedAt: new Date(), paymentFailureMessage: message })
    .where(eq(users.stripeCustomerId, customer)).returning({ id: users.id });
  return updated.length > 0;
}

/**
 * charge.refunded that wasn't a donation or a backing: if it paid a
 * subscription invoice and went back in full, the paid plan goes with it.
 * `paidSubscription` answers whether the charge paid one (it may ask Stripe).
 */
export async function onSubscriptionChargeRefunded(charge: any, paidSubscription: (charge: any) => Promise<boolean>): Promise<boolean> {
  const customer = customerOf(charge);
  if (!customer || charge?.refunded !== true) return false;
  const [user] = await db.select({ id: users.id, subscriptionId: users.stripeSubscriptionId, tier: users.subscriptionTier }).from(users).where(eq(users.stripeCustomerId, customer));
  if (!user?.subscriptionId || user.tier === "free") return false;
  if (!(await paidSubscription(charge))) return false;
  await db.update(users).set({ subscriptionTier: "free", subscriptionRefundedAt: new Date() }).where(eq(users.id, user.id));
  console.log(`Subscription payment refunded in full for user ${user.id}: back to free until the next paid invoice`);
  return true;
}

/** What the app shows about billing trouble: a failed payment to fix, or a refunded plan. Null when there's none. */
export async function billingIssueFor(userId: string): Promise<{ kind: "payment_failed" | "refunded"; at: Date; message: string } | null> {
  const [u] = await db.select({ failedAt: users.paymentFailedAt, message: users.paymentFailureMessage, refundedAt: users.subscriptionRefundedAt }).from(users).where(eq(users.id, userId));
  if (u?.failedAt) return { kind: "payment_failed", at: u.failedAt, message: u.message ?? "Your last payment didn't go through." };
  if (u?.refundedAt) return { kind: "refunded", at: u.refundedAt, message: "Your last subscription payment was refunded, so your plan is paused until the next payment." };
  return null;
}
