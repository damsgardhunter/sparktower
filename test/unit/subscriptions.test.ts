/**
 * Which subscription pays for a tier — the one definition the webhook and the
 * "sync my subscription" route share, so a trial can't be paid in one and
 * free in the other.
 */
import { describe, it, expect } from "vitest";
import { isPaidSubscriptionStatus, paidSubscription } from "@shared/subscriptions";

describe("paid subscriptions", () => {
  it("counts active and trialing, and nothing else", () => {
    for (const s of ["active", "trialing"]) expect(isPaidSubscriptionStatus(s)).toBe(true);
    for (const s of ["past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused", undefined]) expect(isPaidSubscriptionStatus(s)).toBe(false);
  });

  it("finds the paying one in a customer's list, whatever order Stripe returns", () => {
    expect(paidSubscription([{ id: "a", status: "canceled" }, { id: "b", status: "trialing" }])?.id).toBe("b");
    expect(paidSubscription([{ id: "a", status: "past_due" }])).toBeNull();
    expect(paidSubscription([])).toBeNull();
  });
});
