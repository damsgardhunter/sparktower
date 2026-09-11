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
import { users, projects, donations, stripeEvents, projectBackings } from "@shared/schema";

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
        // The library's own words when it has no secret to check against.
        if (signature === "no-secret-configured") throw new Error("No webhook secret provided. Either create a managed webhook or configure stripeWebhookSecret.");
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
    expect(res.body).toMatchObject({ received: true, duplicate: false });

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

/** Signs and delivers one event the way Stripe would. */
async function deliver(app: any, event: unknown) {
  const body = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET });
  return request(app).post("/api/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", signature).send(body);
}

async function aProjectWithDonor() {
  const { user } = await aPaidUser();
  const [project] = await db.insert(projects).values({ ownerId: user.id, title: "Donate", description: "A project that receives donations through Stripe.", category: "saas", goal: "ship_mvp", subcategory: "saas" } as any).returning();
  return { donor: user, project };
}
const totalOf = async (id: string) => (await db.select({ t: projects.totalDonations }).from(projects).where(eq(projects.id, id)))[0].t;

describe("idempotency and retry", () => {
  it("records a donation once however many times the event arrives, and once per session even under a new event id", async () => {
    const app = await getTestApp();
    const { donor, project } = await aProjectWithDonor();
    const session = { id: "cs_test_once", object: "checkout.session", mode: "payment", payment_intent: "pi_test_once", customer: donor.stripeCustomerId, metadata: { type: "donation", projectId: project.id, donorId: donor.id, amount: "2500" } };
    const event = { id: "evt_once", object: "event", type: "checkout.session.completed", data: { object: session } };

    expect((await deliver(app, event)).body).toMatchObject({ received: true, duplicate: false });
    expect((await deliver(app, event)).body).toMatchObject({ received: true, duplicate: true });
    expect((await deliver(app, { ...event, id: "evt_once_redelivered_under_new_id" })).status).toBe(200);

    const rows = await db.select().from(donations).where(eq(donations.projectId, project.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 2500, stripeSessionId: "cs_test_once", stripePaymentIntentId: "pi_test_once" });
    expect(await totalOf(project.id)).toBe(2500);
    const [ledger] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, "evt_once"));
    expect(ledger).toMatchObject({ type: "checkout.session.completed", status: "processed" });
    expect(ledger.processedAt).toBeTruthy();
  });

  it("answers 500 when a handler fails so Stripe retries, records the failure, and processes the retry", async () => {
    const app = await getTestApp();
    const { donor } = await aProjectWithDonor();
    // A donation to a project that doesn't exist fails at the database: that is our fault, not Stripe's.
    const bad = { id: "evt_fails", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_test_fail", mode: "payment", metadata: { type: "donation", projectId: "00000000-0000-0000-0000-000000000000", donorId: donor.id, amount: "100" } } } };
    const first = await deliver(app, bad);
    expect(first.status).toBe(500);
    const [after] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, "evt_fails"));
    expect(after.status).toBe("failed");
    expect(after.error).toBeTruthy();
    // The retry is not treated as a duplicate: it runs again (and fails again here, honestly).
    expect((await deliver(app, bad)).status).toBe(500);
    // A bad signature never reaches the ledger.
    const res = await request(app).post("/api/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", "t=1,v1=bad").send(JSON.stringify({ id: "evt_unsigned", type: "checkout.session.completed", data: { object: {} } }));
    expect(res.status).toBe(400);
    expect(await db.select().from(stripeEvents).where(eq(stripeEvents.id, "evt_unsigned"))).toHaveLength(0);
  });
});

describe("refunds", () => {
  it("marks a refunded donation and lowers the project total once", async () => {
    const app = await getTestApp();
    const { donor, project } = await aProjectWithDonor();
    await deliver(app, { id: "evt_pay", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_test_refund", mode: "payment", payment_intent: "pi_test_refund", metadata: { type: "donation", projectId: project.id, donorId: donor.id, amount: "4000" } } } });
    expect(await totalOf(project.id)).toBe(4000);

    const refund = { id: "evt_refund", object: "event", type: "charge.refunded", data: { object: { id: "ch_test_refund", object: "charge", payment_intent: "pi_test_refund", refunds: { data: [{ id: "re_test_1" }] } } } };
    expect((await deliver(app, refund)).status).toBe(200);
    expect(await totalOf(project.id)).toBe(0);
    const [d] = await db.select().from(donations).where(eq(donations.stripeSessionId, "cs_test_refund"));
    expect(d.refundedAt).toBeTruthy();
    expect(d.stripeChargeId).toBe("ch_test_refund");
    // Delivered again (new id, same charge): nothing changes and nothing goes negative.
    expect((await deliver(app, { ...refund, id: "evt_refund_again" })).status).toBe(200);
    expect(await totalOf(project.id)).toBe(0);
  });

  it("acknowledges a failed payment without touching the tier — the subscription status event does that", async () => {
    const app = await getTestApp();
    const { user, customerId } = await aPaidUser();
    expect((await deliver(app, { id: "evt_pf", object: "event", type: "invoice.payment_failed", data: { object: { id: "in_1", customer: customerId, last_payment_error: { message: "card declined" } } } })).status).toBe(200);
    expect(await tierOf(user.id)).toBe("pro");
    expect((await deliver(app, { id: "evt_pastdue", object: "event", type: "customer.subscription.updated", data: { object: { id: "sub_test_123", customer: customerId, status: "past_due" } } })).status).toBe(200);
    expect(await tierOf(user.id)).toBe("free");
  });
});

describe("partial refunds, and refunds from outside the platform", () => {
  /** Stripe's charge.refunded: the charge's running refunded total, and whether that's all of it. */
  const refunded = (id: string, pi: string, amountRefunded: number, inFull: boolean, refundId: string) => ({
    id, object: "event", type: "charge.refunded",
    data: { object: { id: `ch_${pi}`, object: "charge", payment_intent: pi, amount_refunded: amountRefunded, refunded: inFull, refunds: { data: [{ id: refundId }] } } },
  });
  const donationFor = async (session: string) => (await db.select().from(donations).where(eq(donations.stripeSessionId, session)))[0];

  it("lowers a donation's total by what went back — once per refund, whatever the event id — and the rest when it's refunded in full", async () => {
    const app = await getTestApp();
    const { donor, project } = await aProjectWithDonor();
    // Other money already counted, so a second subtraction couldn't hide behind zero.
    await db.update(projects).set({ totalDonations: 1000 }).where(eq(projects.id, project.id));
    await deliver(app, { id: "evt_part_pay", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_part", mode: "payment", payment_intent: "pi_part", metadata: { type: "donation", projectId: project.id, donorId: donor.id, amount: "4000" } } } });
    expect(await totalOf(project.id)).toBe(5000);

    expect((await deliver(app, refunded("evt_part_1", "pi_part", 1500, false, "re_1"))).status).toBe(200);
    expect(await totalOf(project.id)).toBe(3500);
    expect(await donationFor("cs_part")).toMatchObject({ refundedAmount: 1500, refundedAt: null });

    // The same refund again under a new event id: nothing moves.
    await deliver(app, refunded("evt_part_1_again", "pi_part", 1500, false, "re_1"));
    expect(await totalOf(project.id)).toBe(3500);

    // The rest, refunded: the remaining 2500 comes off, and the donation is marked.
    await deliver(app, refunded("evt_part_2", "pi_part", 4000, true, "re_2"));
    expect(await totalOf(project.id)).toBe(1000);
    const full = await donationFor("cs_part");
    expect(full.refundedAmount).toBe(4000);
    expect(full.refundedAt).toBeTruthy();
    await deliver(app, refunded("evt_part_2_again", "pi_part", 4000, true, "re_2"));
    expect(await totalOf(project.id)).toBe(1000);
  });

  it("gives a backing refunded from the Stripe dashboard back to the project's total once; a partial refund leaves it held", async () => {
    const app = await getTestApp();
    const { donor, project } = await aProjectWithDonor();
    await db.update(projects).set({ totalDonations: 8000 }).where(eq(projects.id, project.id));
    const [backing] = await db.insert(projectBackings).values({
      projectId: project.id, backerId: donor.id, amountCents: 5000, status: "held", stripePaymentIntentId: "pi_back",
    } as any).returning();
    const backingNow = async () => (await db.select().from(projectBackings).where(eq(projectBackings.id, backing.id)))[0];

    await deliver(app, refunded("evt_back_partial", "pi_back", 2000, false, "re_b1"));
    expect((await backingNow()).status).toBe("held");
    expect(await totalOf(project.id)).toBe(8000);

    await deliver(app, refunded("evt_back_full", "pi_back", 5000, true, "re_b2"));
    expect(await backingNow()).toMatchObject({ status: "refunded", stripeRefundId: "re_b2" });
    expect(await totalOf(project.id)).toBe(3000);

    await deliver(app, refunded("evt_back_full_again", "pi_back", 5000, true, "re_b2"));
    expect(await totalOf(project.id)).toBe(3000);
  });
});

describe("a webhook that arrives before a signing secret is configured", () => {
  it("answers 500 — so Stripe retries — rather than a 400 that drops the event for good", async () => {
    const app = await getTestApp();
    const res = await request(app).post("/api/stripe/webhook").set("Content-Type", "application/json")
      .set("stripe-signature", "no-secret-configured").send(JSON.stringify(cancellationEvent("cus_nobody")));
    expect(res.status).toBe(500);
    expect(await db.select().from(stripeEvents)).toHaveLength(0);
  });
});
