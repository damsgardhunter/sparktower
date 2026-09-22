/**
 * What the Stripe webhook does with a pledge's money when things go wrong
 * after checkout.
 *
 *   - A chargeback: the bank has taken the money back, so neither payout
 *     release nor the refund sweep may act on the pledge until it's settled —
 *     won puts it back to held, lost refunds it.
 *   - A checkout paid after the campaign closed (rejected, switched off, the
 *     project or its creator gone), or for a limited tier that sold out while
 *     the page was open: refunded straight away, never recorded as held.
 *   - A checkout that completed without being paid (a delayed method): not a
 *     pledge until the money arrives.
 *
 * Deliveries are signed for real and verified with a real secret; Stripe's API
 * is a fake that remembers refunds and transfers.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { FAKE_STRIPE_TEST_KEY, fakeWebhookSecret } from "../helpers/fake-secrets";
import request from "supertest";
import Stripe from "stripe";

const WEBHOOK_SECRET = fakeWebhookSecret("backing-webhook");
const signer = new Stripe(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });

const S = {
  refunds: [] as { payment_intent: string; key?: string }[],
  transfers: [] as { id: string; transfer_group: string; metadata: Record<string, string>; reversed: boolean }[],
};

vi.mock("../../server/stripeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/stripeClient")>();
  const StripeCtor = (await import("stripe")).default;
  const real = new StripeCtor(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });
  const fake: any = {
    refunds: {
      create: async ({ payment_intent }: { payment_intent: string }, opts?: { idempotencyKey?: string }) => {
        // Stripe's idempotency: the same key returns the same refund.
        const seen = S.refunds.findIndex((r) => opts?.idempotencyKey && r.key === opts.idempotencyKey);
        if (seen >= 0) return { id: `re_${seen + 1}` };
        S.refunds.push({ payment_intent, key: opts?.idempotencyKey });
        return { id: `re_${S.refunds.length}` };
      },
    },
    transfers: {
      list: async ({ transfer_group }: { transfer_group: string }) => ({ data: S.transfers.filter((t) => t.transfer_group === transfer_group), has_more: false }),
      create: async (params: any) => {
        const t = { ...params, id: `tr_${S.transfers.length + 1}`, reversed: false };
        S.transfers.push(t);
        return t;
      },
    },
    subscriptions: { list: async () => ({ data: [] }) },
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
const { passMfa } = await import("../helpers/mfa");
const { db } = await import("../../server/db");
const { users, projects, projectBackings, projectBackingCampaigns, projectBackerTiers } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { runRefundSweep } = await import("../../server/backing-jobs");

afterAll(async () => { await closeTestApp(); });
beforeEach(() => { S.refunds = []; S.transfers = []; });

let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
async function account(role?: "reviewer") {
  const app = await getTestApp();
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.190.${20 + (n % 200)}`)
    .send({ email: `bw-${uid()}@example.test`, password: "Testpass123!", firstName: "Backer" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  if (role) await db.update(users).set({ platformRole: role }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string };
}

async function openCampaign(review: "pending" | "approved" = "pending") {
  const creator = await account();
  await db.update(users).set({ stripeConnectAccountId: "acct_creator" }).where(eq(users.id, creator.id));
  const [project] = await db.insert(projects).values({ title: "Backed thing", description: "Something people pay toward.", category: "saas", ownerId: creator.id } as any).returning();
  await db.insert(projectBackingCampaigns).values({ projectId: project.id, enabled: true, reviewStatus: review } as any);
  return { projectId: project.id, creatorId: creator.id };
}

const deliver = async (event: Record<string, unknown>) => {
  const app = await getTestApp();
  const body = JSON.stringify({ id: `evt_${uid()}`, object: "event", created: Math.floor(Date.now() / 1000), ...event });
  return request(app).post("/api/stripe/webhook").set("Content-Type", "application/json")
    .set("stripe-signature", signer.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET })).send(body);
};

/** A pledge checkout, as checkout.session.completed carries it. */
const pledgeSession = (projectId: string, backerId: string, extra: Record<string, unknown> = {}, meta: Record<string, string> = {}) => {
  const id = `cs_${uid()}`;
  return {
    id, object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: `pi_${id}`,
    metadata: { type: "backing", projectId, backerId, amountCents: "2500", tipCents: "0", tierId: "", tierName: "", message: "", isAnonymous: "0", unclaimedPreference: "refund", ...meta },
    ...extra,
  };
};
const completed = (session: unknown) => deliver({ type: "checkout.session.completed", data: { object: session } });
const backingsFor = (session: { id: string }) => db.select().from(projectBackings).where(eq(projectBackings.stripeCheckoutSessionId, session.id));
const totalOf = async (projectId: string) => (await db.select().from(projects).where(eq(projects.id, projectId)))[0].totalDonations;

describe("a pledge paid after the campaign stopped taking them", () => {
  it("records a pledge to an open campaign as held", async () => {
    const { projectId } = await openCampaign();
    const backer = await account();
    const session = pledgeSession(projectId, backer.id);
    expect((await completed(session)).status).toBe(200);
    expect((await backingsFor(session))[0]).toMatchObject({ status: "held", stripePaymentIntentId: session.payment_intent });
    expect(S.refunds).toEqual([]);
  });

  it("refunds it, once, when the campaign was rejected, switched off, or its creator suspended — and records nothing", async () => {
    const backer = await account();
    const cases: [string, (p: { projectId: string; creatorId: string }) => Promise<unknown>][] = [
      ["rejected", (p) => db.update(projectBackingCampaigns).set({ reviewStatus: "rejected" }).where(eq(projectBackingCampaigns.projectId, p.projectId))],
      ["switched off", (p) => db.update(projectBackingCampaigns).set({ enabled: false }).where(eq(projectBackingCampaigns.projectId, p.projectId))],
      ["creator suspended", (p) => db.update(users).set({ suspendedAt: new Date(), suspendedReason: "fraud" }).where(eq(users.id, p.creatorId))],
    ];
    for (const [label, close] of cases) {
      S.refunds = [];
      const p = await openCampaign();
      const session = pledgeSession(p.projectId, backer.id);
      await close(p);
      expect((await completed(session)).status, label).toBe(200);
      expect(await backingsFor(session), label).toEqual([]);
      expect(await totalOf(p.projectId), label).toBe(0);
      expect(S.refunds, label).toEqual([{ payment_intent: session.payment_intent, key: `backing_refund_${session.id}` }]);
      // The same completion again under a new event id: refunded once, still nothing recorded.
      await completed(session);
      expect(S.refunds.length, label).toBe(1);
      expect(await backingsFor(session), label).toEqual([]);
    }
  });

  it("refunds it when the project no longer exists", async () => {
    const backer = await account();
    const session = pledgeSession("00000000-0000-0000-0000-000000000000", backer.id);
    expect((await completed(session)).status).toBe(200);
    expect(S.refunds.map((r) => r.payment_intent)).toEqual([session.payment_intent]);
  });

  it("refunds the one past a limited tier's last slot", async () => {
    const { projectId } = await openCampaign();
    const [tier] = await db.insert(projectBackerTiers).values({ projectId, name: "Founding 1", amountCents: 2500, maxBackers: 1, isActive: true } as any).returning();
    const first = await account();
    const second = await account();
    // Both had the checkout page open while one slot was left.
    const a = pledgeSession(projectId, first.id, {}, { tierId: tier.id, tierName: tier.name });
    const b = pledgeSession(projectId, second.id, {}, { tierId: tier.id, tierName: tier.name });
    await Promise.all([completed(a), completed(b)]);
    const recorded = [...(await backingsFor(a)), ...(await backingsFor(b))];
    expect(recorded.length, "one slot, one pledge").toBe(1);
    expect(S.refunds.length).toBe(1);
    expect(await totalOf(projectId)).toBe(2500);
  });
});

describe("a checkout that completed without being paid", () => {
  it("isn't a pledge until the money arrives", async () => {
    const { projectId } = await openCampaign();
    const backer = await account();
    const session = pledgeSession(projectId, backer.id, { payment_status: "unpaid" });
    expect((await completed(session)).status).toBe(200);
    expect(await backingsFor(session)).toEqual([]);
    expect(await totalOf(projectId)).toBe(0);

    // The delayed payment settles: now it's recorded.
    expect((await deliver({ type: "checkout.session.async_payment_succeeded", data: { object: { ...session, payment_status: "paid" } } })).status).toBe(200);
    expect((await backingsFor(session))[0]).toMatchObject({ status: "held" });
    expect(await totalOf(projectId)).toBe(2500);
  });
});

describe("a chargeback on a held pledge", () => {
  const dispute = (type: string, pi: string, status: string) => deliver({
    type, data: { object: { id: `dp_${pi}`, object: "dispute", charge: `ch_${pi}`, payment_intent: pi, amount: 2500, status } },
  });

  async function heldPledge(review: "pending" | "approved") {
    const { projectId } = await openCampaign(review);
    const backer = await account();
    const session = pledgeSession(projectId, backer.id);
    await completed(session);
    const [backing] = await backingsFor(session);
    await db.update(projectBackings).set({ refundDueAt: new Date(Date.now() - 60_000) }).where(eq(projectBackings.id, backing.id));
    return { projectId, backing, pi: session.payment_intent };
  }
  const now = async (id: string) => (await db.select().from(projectBackings).where(eq(projectBackings.id, id)))[0];

  it("is skipped by the refund sweep while open, and refunded by the bank if lost", async () => {
    const { projectId, backing, pi } = await heldPledge("pending");
    expect((await dispute("charge.dispute.created", pi, "needs_response")).status).toBe(200);
    expect((await now(backing.id)).disputedAt).toBeTruthy();

    await runRefundSweep();
    expect(S.refunds, "the bank already took it back; refunding too would return it twice").toEqual([]);
    expect((await now(backing.id)).status).toBe("held");

    expect((await dispute("charge.dispute.closed", pi, "lost")).status).toBe(200);
    expect(await now(backing.id)).toMatchObject({ status: "refunded" });
    expect(await totalOf(projectId)).toBe(0);
    await runRefundSweep();
    expect(S.refunds).toEqual([]);
  });

  it("is skipped by payout release while open, and paid out once the dispute is won", async () => {
    const { backing, pi, projectId } = await heldPledge("approved");
    const reviewer = await account("reviewer");
    await passMfa(reviewer.agent);
    await dispute("charge.dispute.created", pi, "needs_response");

    const blocked = await reviewer.agent.post(`/api/admin/backing/${projectId}/release`).send({});
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(200);
    expect(blocked.body.released).toBe(0);
    expect(S.transfers).toEqual([]);

    expect((await dispute("charge.dispute.closed", pi, "won")).status).toBe(200);
    expect(await now(backing.id)).toMatchObject({ status: "held", disputedAt: null });
    expect(await totalOf(projectId)).toBe(2500);

    const paid = await reviewer.agent.post(`/api/admin/backing/${projectId}/release`).send({});
    expect(paid.body.released).toBe(1);
    expect(S.transfers.map((t) => t.metadata.backingId)).toEqual([backing.id]);
  });
});
