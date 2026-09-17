/**
 * The same purchase, delivered twice, under two different event ids.
 *
 * The ledger stops a *redelivery* of one event. It does not stop Stripe from
 * describing one purchase in several events — `checkout.session.completed`
 * and `customer.subscription.created` are both true of the same upgrade, and
 * each has its own id. What must not happen is the allowance refilling twice:
 * spend a month's credits, receive the second event, and the month starts
 * again for free.
 *
 * Two things make that safe, and both are checked here: the tier is read from
 * Stripe at handling time rather than trusted from the payload, and a refill
 * only happens when the plan moves *up* from what the account already has.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { FAKE_STRIPE_TEST_KEY, fakeWebhookSecret } from "../helpers/fake-secrets";
import request from "supertest";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { users, stripeEvents } from "@shared/schema";

const WEBHOOK_SECRET = fakeWebhookSecret("replay-checks");
const signer = new Stripe(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });

/** A Stripe that answers about one subscription and one price, without a network. */
let subscriptionStatus = "active";
vi.mock("../../server/stripeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/stripeClient")>();
  const StripeCtor = (await import("stripe")).default;
  const real = new StripeCtor(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });
  const fake: any = {
    subscriptions: { retrieve: async (id: string) => ({ id, status: subscriptionStatus, items: { data: [{ price: { id: "price_builder" } }] } }) },
    prices: { retrieve: async (id: string) => ({ id, metadata: { tier: "builder" }, product: { metadata: {} } }) },
    webhooks: real.webhooks,
  };
  return {
    ...actual,
    getUncachableStripeClient: async () => fake,
    getStripeSync: async () => ({
      processWebhook: async (payload: Buffer, signature: string) => { real.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET); },
    }),
  };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
afterAll(async () => { await closeTestApp(); });

const deliver = (app: any, event: unknown) => {
  const body = JSON.stringify(event);
  return request(app).post("/api/stripe/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signer.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET }))
    .send(body);
};
const accountOf = async (id: string) => (await db.select({ tier: users.subscriptionTier, used: users.creditsUsed }).from(users).where(eq(users.id, id)))[0];

async function aCustomer(tier = "free") {
  const customer = `cus_replay_${Math.random().toString(36).slice(2, 10)}`;
  const [user] = await db.insert(users).values({
    email: `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    firstName: "Replay", authProvider: "local", stripeCustomerId: customer, subscriptionTier: tier, creditsUsed: 0,
  }).returning();
  return { user, customer };
}

describe("one purchase described by two events", () => {
  it("upgrades once and refills once, however many event ids carry it", async () => {
    const app = await getTestApp();
    subscriptionStatus = "active";
    const { user, customer } = await aCustomer();
    const session = { id: "cs_replay_1", object: "checkout.session", mode: "subscription", subscription: "sub_replay_1", customer };
    const checkout = (id: string) => ({ id, object: "event", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), data: { object: session } });

    expect((await deliver(app, checkout("evt_checkout_a"))).status).toBe(200);
    expect(await accountOf(user.id)).toMatchObject({ tier: "builder", used: 0 });

    // A month's work happens.
    await db.update(users).set({ creditsUsed: 180 }).where(eq(users.id, user.id));

    // The same purchase, a different event id — a second description, not a second sale.
    expect((await deliver(app, checkout("evt_checkout_b"))).status).toBe(200);
    expect(await accountOf(user.id), "a second event for one purchase must not hand back the allowance").toMatchObject({ tier: "builder", used: 180 });

    // And the subscription event for the same upgrade does the same nothing.
    expect((await deliver(app, {
      id: "evt_sub_same", object: "event", type: "customer.subscription.created", created: Math.floor(Date.now() / 1000),
      data: { object: { id: "sub_replay_1", customer, status: "active", items: { data: [{ price: { id: "price_builder" } }] } } },
    })).status).toBe(200);
    expect(await accountOf(user.id)).toMatchObject({ tier: "builder", used: 180 });

    // Both deliveries are in the ledger, each processed once.
    for (const id of ["evt_checkout_a", "evt_checkout_b", "evt_sub_same"]) {
      const [row] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, id));
      expect(row, id).toMatchObject({ status: "processed" });
    }
  });

  it("reads the plan from Stripe, so a replayed purchase can't revive a cancelled one", async () => {
    const app = await getTestApp();
    const { user, customer } = await aCustomer();
    const session = { id: "cs_replay_2", object: "checkout.session", mode: "subscription", subscription: "sub_replay_2", customer };

    subscriptionStatus = "active";
    expect((await deliver(app, { id: "evt_buy", object: "event", type: "checkout.session.completed", created: 1, data: { object: session } })).status).toBe(200);
    expect((await accountOf(user.id)).tier).toBe("builder");

    // They cancel. Stripe now says the subscription is over.
    subscriptionStatus = "canceled";
    await db.update(users).set({ subscriptionTier: "free" }).where(eq(users.id, user.id));

    // The old purchase event turns up again under a new id: the tier comes from Stripe, not the payload.
    expect((await deliver(app, { id: "evt_buy_again", object: "event", type: "checkout.session.completed", created: 2, data: { object: session } })).status).toBe(200);
    expect((await accountOf(user.id)).tier, "a stale purchase event must not restore a cancelled plan").toBe("free");
  });
});
