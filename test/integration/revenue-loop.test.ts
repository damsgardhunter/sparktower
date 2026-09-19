/**
 * The revenue loop: hit the AI credits limit. Generating on the path spends
 * credits; running low shows in the subscription the client reads; running out
 * refuses the generate — before any model call — with what the client needs to
 * offer "Upgrade to keep generating"; paying (a tier set from Stripe) refills
 * the allowance so the same generate goes through; and a paid renewal refills
 * it again. E2E: e2e/revenue-loop.spec.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { FAKE_STRIPE_TEST_KEY, fakeWebhookSecret } from "../helpers/fake-secrets";
import request from "supertest";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { users } from "@shared/schema";

const WEBHOOK_SECRET = fakeWebhookSecret("revenue-loop");
const stripe = new Stripe(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });

vi.mock("../../server/stripeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/stripeClient")>();
  const StripeCtor = (await import("stripe")).default;
  const client: any = new StripeCtor(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });
  // What Stripe would answer for a Builder subscription, without the network.
  client.subscriptions.retrieve = async (id: string) => ({ id, status: "active", items: { data: [{ price: { id: "price_builder_test" } }] } });
  // No other subscriptions on the customer: the plan is settled from the one the event carries.
  client.subscriptions.list = async () => ({ data: [] });
  client.prices.retrieve = async () => ({ id: "price_builder_test", metadata: { tier: "builder" } });
  return {
    ...actual,
    getUncachableStripeClient: async () => client,
    // The signature check the sync library does, and nothing that needs the network.
    getStripeSync: async () => ({ processWebhook: async (payload: Buffer, signature: string) => { client.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET); } }),
  };
});

// Nova's model is never reached in these tests: a refused generate stops before it, and the allowed one is answered here.
vi.mock("../../server/phase-trees-nova", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/phase-trees-nova")>();
  return { ...actual, draftLoops: vi.fn(async () => { throw new Error("model unavailable in tests"); }) };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { applyTier } = await import("../../server/billing-credits");
afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.102.${10 + n}`)
    .send({ email: `revenue-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: "Payer" });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}
const setUsed = (id: string, creditsUsed: number) => db.update(users).set({ creditsUsed, creditsResetAt: new Date() }).where(eq(users.id, id));
const usedOf = async (id: string) => (await db.select({ u: users.creditsUsed, t: users.subscriptionTier }).from(users).where(eq(users.id, id)))[0];

describe("hitting the AI credits limit", () => {
  let app: any;
  beforeEach(async () => { app = await getTestApp(); });

  it("warns when low, refuses at zero with an upgrade, and a paid upgrade lets generating go on", async () => {
    const me = await builder(app);
    const project = (await me.agent.post("/api/projects").send({ title: "Paying Path", description: "A project that runs out of AI credits on its path.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const tasks = (await me.agent.get(`/api/projects/${project.id}/kanban`)).body;
    const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.3")) ?? tasks.find((t: any) => (t.tags ?? []).some((x: string) => x.startsWith("backbone:")));

    expect((await me.agent.get("/api/subscription")).body).toMatchObject({ tier: "free", creditsLimit: 20, creditsRemaining: 20, creditState: "ok", lowCreditsAt: 4 });
    await setUsed(me.id, 17);
    expect((await me.agent.get("/api/subscription")).body).toMatchObject({ creditsRemaining: 3, creditState: "low" });

    // Out: the path generate is refused before the model, with what the upgrade prompt needs.
    await setUsed(me.id, 20);
    expect((await me.agent.get("/api/subscription")).body.creditState).toBe("out");
    const refused = await me.agent.post(`/api/projects/${project.id}/path/work`).send({ taskId: step.id });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "insufficient_credits", creditState: "out", upgradeUrl: "/pricing", cost: 4, creditsRemaining: 0, tier: "free" });
    const loops = await me.agent.post(`/api/projects/${project.id}/path/loops/write`).send({});
    expect(loops.body.code).toBe("insufficient_credits");
    expect((await usedOf(me.id)).u).toBe(20);

    // Plans above theirs are what's offered.
    const plans = (await request(app).get("/api/plans")).body.plans.map((p: any) => p.tier);
    expect(plans).toEqual(expect.arrayContaining(["starter", "builder", "pro"]));

    // Paying for Builder (as the webhook or the post-checkout sync sets it): the allowance is full, and generating goes on.
    expect(await applyTier(me.id, "builder", "sub_revenue_1")).toEqual({ refilled: true });
    expect((await me.agent.get("/api/subscription")).body).toMatchObject({ tier: "builder", creditsRemaining: 750, creditState: "ok" });
    const again = await me.agent.post(`/api/projects/${project.id}/path/loops/write`).send({});
    expect(again.body.code).not.toBe("insufficient_credits");
    // A same-tier update (a renewal's subscription event) doesn't hand out a second refill.
    await setUsed(me.id, 700);
    expect(await applyTier(me.id, "builder", "sub_revenue_1")).toEqual({ refilled: false });
    expect((await usedOf(me.id)).u).toBe(700);
  });

  it("refills the allowance when a renewal invoice is paid — and not for other invoices", async () => {
    const me = await builder(app);
    const customer = `cus_revenue_${Date.now()}`;
    await db.update(users).set({ stripeCustomerId: customer, subscriptionTier: "starter", creditsUsed: 200, creditsResetAt: new Date() }).where(eq(users.id, me.id));
    const send = async (billing_reason: string) => {
      const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: "event", type: "invoice.paid", data: { object: { id: "in_1", object: "invoice", customer, billing_reason } } });
      return request(app).post("/api/stripe/webhook").set("Content-Type", "application/json")
        .set("stripe-signature", stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET })).send(body);
    };
    expect((await send("manual")).status).toBe(200);
    expect((await usedOf(me.id)).u).toBe(200);
    expect((await me.agent.get("/api/subscription")).body.creditState).toBe("out");
    expect((await send("subscription_cycle")).status).toBe(200);
    expect(await usedOf(me.id)).toEqual({ u: 0, t: "starter" });
    expect((await me.agent.get("/api/subscription")).body).toMatchObject({ creditsRemaining: 200, creditState: "ok" });
  });

  const signed = (type: string, object: Record<string, unknown>) => {
    const body = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: "event", type, data: { object } });
    return request(app).post("/api/stripe/webhook").set("Content-Type", "application/json")
      .set("stripe-signature", stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET })).send(body);
  };
  const subscriber = async (tier = "builder") => {
    const me = await builder(app);
    const customer = `cus_billing_${Date.now()}_${n}`;
    await db.update(users).set({ stripeCustomerId: customer, stripeSubscriptionId: "sub_billing_1", subscriptionTier: tier, creditsUsed: 300, creditsResetAt: new Date() }).where(eq(users.id, me.id));
    return { ...me, customer };
  };

  it("a failed subscription payment is kept on the account until a payment goes through", async () => {
    const me = await subscriber();
    // A one-off invoice failing isn't a subscription problem.
    expect((await signed("invoice.payment_failed", { id: "in_x", object: "invoice", customer: me.customer, billing_reason: "manual" })).status).toBe(200);
    expect((await me.agent.get("/api/subscription")).body.billingIssue).toBeNull();

    expect((await signed("invoice.payment_failed", { id: "in_1", object: "invoice", customer: me.customer, billing_reason: "subscription_cycle", parent: { subscription_details: { subscription: "sub_billing_1" } } })).status).toBe(200);
    const failing = (await me.agent.get("/api/subscription")).body;
    expect(failing.billingIssue).toMatchObject({ kind: "payment_failed", message: expect.any(String) });
    expect(failing.tier).toBe("builder"); // the tier follows the subscription's status event, not this

    expect((await signed("invoice.paid", { id: "in_2", object: "invoice", customer: me.customer, billing_reason: "subscription_cycle", subscription: "sub_billing_1" })).status).toBe(200);
    expect((await me.agent.get("/api/subscription")).body).toMatchObject({ billingIssue: null, tier: "builder", creditsUsed: 0 });
  });

  it("a subscription payment refunded in full takes the plan until an invoice is paid again; a partial refund doesn't", async () => {
    const me = await subscriber();
    expect((await signed("charge.refunded", { id: "ch_part", object: "charge", customer: me.customer, invoice: "in_1", refunded: false, amount_refunded: 500 })).status).toBe(200);
    expect((await usedOf(me.id)).t).toBe("builder");

    expect((await signed("charge.refunded", { id: "ch_full", object: "charge", customer: me.customer, invoice: "in_1", refunded: true, amount_refunded: 1699 })).status).toBe(200);
    expect((await me.agent.get("/api/subscription")).body).toMatchObject({ tier: "free", billingIssue: { kind: "refunded" } });

    // A subscription event still saying "active" (a card change, say) doesn't hand it back.
    expect(await applyTier(me.id, "builder", "sub_billing_1")).toEqual({ refilled: false, heldByRefund: true });
    expect((await usedOf(me.id)).t).toBe("free");

    // Paying again does: the tier is read from the subscription, and the allowance refills.
    expect((await signed("invoice.paid", { id: "in_3", object: "invoice", customer: me.customer, billing_reason: "subscription_cycle", subscription: "sub_billing_1" })).status).toBe(200);
    expect((await me.agent.get("/api/subscription")).body).toMatchObject({ tier: "builder", billingIssue: null, creditsRemaining: 750 });
  });

  it("a refund for someone with no subscription changes no plan", async () => {
    const me = await builder(app);
    const customer = `cus_free_${Date.now()}`;
    await db.update(users).set({ stripeCustomerId: customer }).where(eq(users.id, me.id));
    expect((await signed("charge.refunded", { id: "ch_free", object: "charge", customer, invoice: "in_9", refunded: true, amount_refunded: 100 })).status).toBe(200);
    expect((await usedOf(me.id)).t).toBe("free");
    expect((await me.agent.get("/api/subscription")).body.billingIssue).toBeNull();
  });
});
