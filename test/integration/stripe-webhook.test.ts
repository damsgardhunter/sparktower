/**
 * Stripe webhook signature verification.
 *
 * The failure this guards against is silent by nature. If verification breaks
 * open, forged webhooks move people between paid tiers and nothing looks wrong.
 * If it breaks closed, real webhooks are rejected and subscriptions quietly
 * stop syncing — also nothing looks wrong, until someone cancels and keeps
 * their plan, or pays and doesn't get one.
 *
 * The event used throughout is `customer.subscription.deleted`, chosen because
 * it is the only branch that changes a user's tier without calling the Stripe
 * API — so "was it processed?" is answerable by reading a row rather than by
 * trusting a mock, and the whole suite runs with no network.
 *
 * What is stubbed and what is not: the sync layer is replaced, because its
 * `processEvent` reaches for the Stripe account before it does anything else.
 * The *verification* inside the stub is the genuine article —
 * `stripe.webhooks.constructEvent` with a real secret — and everything from the
 * route inwards is the application's own: raw body handling, error mapping, and
 * the tier-updating handler.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { users } from "@shared/schema";

const WEBHOOK_SECRET = "whsec_test_secret_for_signature_verification";
const stripe = new Stripe("sk_test_dummy_key_not_used_for_network", {
  apiVersion: "2025-08-27.basil",
});

/** What the route actually handed to the sync layer, captured per test. */
let delivered: { payload: unknown; signature: string }[] = [];

vi.mock("../../server/stripeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/stripeClient")>();
  const StripeCtor = (await import("stripe")).default;
  const client = new StripeCtor("sk_test_dummy_key_not_used_for_network", {
    apiVersion: "2025-08-27.basil",
  });

  return {
    ...actual,
    getUncachableStripeClient: async () => client,
    /*
     * Stands in for stripe-replit-sync. Its real processEvent calls
     * getAccountId() and getCurrentAccount() before looking at the event at
     * all, both of which hit Stripe — so the library is out, but the signature
     * check it performs is reproduced exactly, including throwing on failure,
     * because that throw is what the route turns into a 400.
     */
    getStripeSync: async () => ({
      processWebhook: async (payload: Buffer, signature: string) => {
        delivered.push({ payload, signature });
        client.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET);
      },
    }),
  };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");

afterAll(async () => {
  await closeTestApp();
});

beforeEach(() => {
  delivered = [];
});

/** A cancellation for a given Stripe customer. */
const cancellationEvent = (customerId: string) => ({
  id: `evt_${Math.random().toString(36).slice(2, 10)}`,
  object: "event",
  type: "customer.subscription.deleted",
  data: {
    object: {
      id: "sub_test_123",
      object: "subscription",
      customer: customerId,
      status: "canceled",
    },
  },
});

/** A paying account whose tier the webhook is expected to change. */
async function aPaidUser() {
  const customerId = `cus_test_${Math.random().toString(36).slice(2, 10)}`;
  const [user] = await db.insert(users).values({
    email: `stripe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`,
    firstName: "Paying",
    lastName: "Customer",
    authProvider: "local",
    stripeCustomerId: customerId,
    stripeSubscriptionId: "sub_test_123",
    subscriptionTier: "pro",
  }).returning();
  return { user, customerId };
}

const tierOf = async (id: string) => {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row.subscriptionTier;
};

describe("stripe webhook signature verification", () => {
  it("accepts a correctly signed payload and processes it", async () => {
    const app = await getTestApp();
    const { user, customerId } = await aPaidUser();
    expect(await tierOf(user.id)).toBe("pro");

    const body = JSON.stringify(cancellationEvent(customerId));
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    });

    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    // Processed, observably: the cancellation moved them off the paid tier.
    expect(await tierOf(user.id)).toBe("free");
  });

  it("rejects a bad signature and changes nothing", async () => {
    const app = await getTestApp();
    const { user, customerId } = await aPaidUser();

    const body = JSON.stringify(cancellationEvent(customerId));
    // Right shape, wrong secret — what a forgery looks like.
    const forged = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: "whsec_an_attacker_does_not_have_the_real_one",
    });

    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", forged)
      .send(body);

    expect(res.status).toBe(400);

    /*
     * The assertion that matters. A 400 alone would still be satisfied if the
     * handler had already downgraded the account and then thrown — and an
     * endpoint that mutates before it verifies is the whole vulnerability.
     */
    expect(await tierOf(user.id)).toBe("pro");
  });

  it("rejects a payload whose body was altered after signing", async () => {
    const app = await getTestApp();
    const { user, customerId } = await aPaidUser();

    const signed = JSON.stringify(cancellationEvent(customerId));
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: signed,
      secret: WEBHOOK_SECRET,
    });

    // A valid signature, over different bytes than the ones now being sent.
    const tampered = signed.replace('"status":"canceled"', '"status":"active"');
    expect(tampered).not.toBe(signed);

    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(tampered);

    expect(res.status).toBe(400);
    expect(await tierOf(user.id)).toBe("pro");
  });

  it("rejects a request with no signature header at all", async () => {
    const app = await getTestApp();
    const body = JSON.stringify(cancellationEvent("cus_whatever"));

    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/signature/i);
    // Refused before the sync layer was ever reached.
    expect(delivered).toHaveLength(0);
  });

  it("hands the handler the raw bytes, unparsed", async () => {
    const app = await getTestApp();
    const { customerId } = await aPaidUser();

    const body = JSON.stringify(cancellationEvent(customerId));
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    });

    await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(body);

    /*
     * This is the regression that breaks billing silently and is invisible in
     * review: mounting express.json() above this route replaces the Buffer
     * with a parsed object, re-serialising it loses the original byte order,
     * and every signature fails from then on. Nothing else in the app notices.
     */
    expect(delivered).toHaveLength(1);
    expect(Buffer.isBuffer(delivered[0].payload)).toBe(true);
    expect((delivered[0].payload as Buffer).toString("utf8")).toBe(body);
    expect(delivered[0].signature).toBe(signature);
  });
});
