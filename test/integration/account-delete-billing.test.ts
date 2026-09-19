/**
 * Deleting an account stops the billing — before the record of it is erased.
 *
 * Deletion nulls the Stripe customer and subscription ids on the tombstone,
 * and nothing cancelled the subscription first. A paying member who deleted
 * their account kept being charged every month, and the next invoice's webhook
 * could not be matched to anyone, because the only link had just been deleted.
 *
 * Stripe is faked here: what matters is what the route asks it to do, in what
 * order, and what it does when Stripe says no.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

const stripe = {
  cancelled: [] as string[],
  subs: [] as { id: string; status: string }[],
  failWith: null as null | Error,
  calls: 0,
};

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => {
    stripe.calls += 1;
    if (stripe.failWith) throw stripe.failWith;
    return {
      subscriptions: {
        list: async () => ({ data: stripe.subs }),
        retrieve: async (id: string) => {
          const sub = stripe.subs.find((s) => s.id === id);
          if (!sub) throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
          return sub;
        },
        cancel: async (id: string) => { stripe.cancelled.push(id); return { id, status: "canceled" }; },
      },
    };
  },
  getStripeSync: async () => ({}),
}));

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");

afterAll(async () => { await closeTestApp(); });
beforeEach(() => { stripe.cancelled = []; stripe.subs = []; stripe.failWith = null; stripe.calls = 0; });

let n = 0;
const password = "Testpass123!";
async function member(billing?: { customer?: string; subscription?: string }) {
  const app = await getTestApp();
  n += 1;
  const agent = request.agent(app);
  const email = `billing-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.160.${20 + n}`)
    .send({ email, password, firstName: "Paying", lastName: "Member" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  if (billing) {
    await db.update(users).set({
      stripeCustomerId: billing.customer ?? null,
      stripeSubscriptionId: billing.subscription ?? null,
      subscriptionTier: "pro",
    }).where(eq(users.id, res.body.id));
  }
  return { agent, id: res.body.id as string, email };
}

describe("deleting an account that pays", () => {
  it("cancels every live subscription on the customer, then deletes", async () => {
    const m = await member({ customer: "cus_live", subscription: "sub_current" });
    stripe.subs = [
      { id: "sub_current", status: "active" },
      // Left behind by a plan change — it bills just the same.
      { id: "sub_leftover", status: "past_due" },
      // Already over: cancelling it again would be an error, not a safety.
      { id: "sub_old", status: "canceled" },
    ];

    const res = await m.agent.post("/api/account/delete").send({ password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.billingCancelled).toBe(2);
    expect(stripe.cancelled.sort()).toEqual(["sub_current", "sub_leftover"]);

    const [after] = await db.select().from(users).where(eq(users.id, m.id));
    expect(after.deletedAt, "the account is gone").toBeTruthy();
    expect(after.stripeCustomerId).toBeNull();
  });

  it("deletes nothing when Stripe can't be reached, and says so", async () => {
    const m = await member({ customer: "cus_unreachable", subscription: "sub_unreachable" });
    stripe.failWith = new Error("connect ETIMEDOUT api.stripe.com");

    const res = await m.agent.post("/api/account/delete").send({ password });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("billing_cancel_failed");
    expect(res.body.message).toMatch(/nothing was deleted/i);

    // Exactly as it was: still signed in, still linked to the subscription to cancel.
    const [after] = await db.select().from(users).where(eq(users.id, m.id));
    expect(after.deletedAt).toBeNull();
    expect(after.stripeSubscriptionId).toBe("sub_unreachable");
    expect((await m.agent.get("/api/auth/user")).status).toBe(200);
  });

  it("treats a subscription Stripe no longer has as already stopped", async () => {
    // The row remembers a subscription Stripe has since removed; the customer has none.
    const m = await member({ subscription: "sub_vanished" });
    const res = await m.agent.post("/api/account/delete").send({ password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.billingCancelled).toBe(0);
    expect(stripe.cancelled).toEqual([]);
  });
});

describe("deleting an account that never paid", () => {
  it("never asks Stripe at all, so it works with Stripe down", async () => {
    const m = await member();
    stripe.failWith = new Error("Stripe is not configured");

    const res = await m.agent.post("/api/account/delete").send({ password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(stripe.calls, "no billing, no call").toBe(0);
  });
});
