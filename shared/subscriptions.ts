/**
 * Which Stripe subscription statuses pay for a tier.
 *
 * One definition for the webhook and for the "sync my subscription" route.
 * They used to disagree: the webhook treated a trial as paid, while the sync
 * route only asked Stripe for "active" subscriptions — so a trialing
 * customer who pressed sync was dropped to the free tier.
 */
export const PAID_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;

export const isPaidSubscriptionStatus = (status: unknown): boolean =>
  (PAID_SUBSCRIPTION_STATUSES as readonly unknown[]).includes(status);

/** The subscription that pays for the account, from a customer's list, or null. */
export function paidSubscription<T extends { status?: unknown }>(subscriptions: readonly T[]): T | null {
  return subscriptions.find((s) => isPaidSubscriptionStatus(s?.status)) ?? null;
}
