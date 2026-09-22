/**
 * The revenue loop, now that there is nothing to subscribe to.
 *
 * Generating on the path spends one small Nova action; running low shows in
 * what the client reads; running out refuses the generate — before any model
 * call — with everything a dialog needs to offer the way on; topping up and
 * buying the $1 day pass lets the same generate through; and the day pass is
 * unlimited for its window rather than a bigger bucket.
 *
 * What this file used to test was the other loop: run out of credits, upgrade
 * to Builder, get 750 a month. There is no Builder. The subscription machinery
 * it exercised (applyTier, invoice-paid refills, a refund taking the plan away)
 * is still in server/billing-credits.ts to wind down the subscriptions that
 * exist, and the last test here holds it to the one promise that still matters:
 * whatever an old subscription event says, it never changes what anybody can
 * do, because nothing is sold any more.
 *
 * E2E: e2e/revenue-loop.spec.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { FAKE_STRIPE_TEST_KEY, fakeWebhookSecret } from "../helpers/fake-secrets";
import request from "supertest";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { users } from "@shared/schema";
import { MONTHLY_SMALL_ACTIONS, OUTCOME_PRICE_CENTS } from "@shared/plans";

const WEBHOOK_SECRET = fakeWebhookSecret("revenue-loop");

vi.mock("../../server/stripeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/stripeClient")>();
  const StripeCtor = (await import("stripe")).default;
  const client: any = new StripeCtor(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });
  client.subscriptions.retrieve = async (id: string) => ({ id, status: "active", items: { data: [{ price: { id: "price_builder_test" } }] } });
  client.subscriptions.list = async () => ({ data: [] });
  client.prices.retrieve = async () => ({ id: "price_builder_test", metadata: { tier: "builder" } });
  client.customers.create = async () => ({ id: `cus_revenue_${Date.now()}` });
  client.checkout = { sessions: { list: async () => ({ data: [] }), expire: async (id: string) => ({ id }), create: async () => ({ id: "cs_revenue", url: "https://checkout.stripe.test/cs_revenue" }) } };
  return {
    ...actual,
    getUncachableStripeClient: async () => client,
    getStripeSync: async () => ({ processWebhook: async (payload: Buffer, signature: string) => { client.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET); } }),
  };
});

// Nova's model is never reached: a refused generate stops before it, and an
// allowed one only has to get past the money to prove the point.
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
const rowOf = async (id: string) =>
  (await db.select({ u: users.creditsUsed, t: users.subscriptionTier, b: users.balanceCents }).from(users).where(eq(users.id, id)))[0];

describe("running out of the month's free Nova", () => {
  let app: any;
  beforeEach(async () => { app = await getTestApp(); });

  it("warns when low, refuses at zero with the day pass to offer, and the pass lets generating go on", async () => {
    const me = await builder(app);
    const project = (await me.agent.post("/api/projects").send({ title: "Paying Path", description: "A project that runs out of free Nova actions on its path.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const tasks = (await me.agent.get(`/api/projects/${project.id}/kanban`)).body;
    const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.3")) ?? tasks.find((t: any) => (t.tags ?? []).some((x: string) => x.startsWith("backbone:")));

    expect((await me.agent.get("/api/subscription")).body).toMatchObject({
      creditsLimit: MONTHLY_SMALL_ACTIONS, creditsRemaining: MONTHLY_SMALL_ACTIONS, creditState: "ok",
    });
    await setUsed(me.id, MONTHLY_SMALL_ACTIONS - 2);
    expect((await me.agent.get("/api/subscription")).body).toMatchObject({ creditsRemaining: 2, creditState: "low" });

    // Out: the path generate is refused before the model, with everything the
    // dialog needs — the price, the balance, and the one thing to do about it.
    await setUsed(me.id, MONTHLY_SMALL_ACTIONS);
    expect((await me.agent.get("/api/subscription")).body.creditState).toBe("out");
    const refused = await me.agent.post(`/api/projects/${project.id}/path/work`).send({ taskId: step.id });
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({
      code: "payment_required", outcome: "dayPass",
      price: { cents: OUTCOME_PRICE_CENTS.dayPass, display: "$1" },
      remedy: "top_up",
      endpoints: { dayPass: "/api/nova/day-pass", topUp: "/api/nova/top-up" },
    });
    const loops = await me.agent.post(`/api/projects/${project.id}/path/loops/write`).send({});
    expect(loops.body.code).toBe("payment_required");
    // Nothing was taken on the way to being refused.
    expect((await rowOf(me.id)).u).toBe(MONTHLY_SMALL_ACTIONS);

    // Money on the account, and the pass is one tap rather than a redirect.
    await db.update(users).set({ balanceCents: 500 }).where(eq(users.id, me.id));
    const nudged = await me.agent.post(`/api/projects/${project.id}/path/work`).send({ taskId: step.id });
    expect(nudged.body.remedy, "with money there, the dialog offers the pass itself").toBe("buy_day_pass");

    const pass = await me.agent.post("/api/nova/day-pass").send({});
    expect(pass.status, JSON.stringify(pass.body)).toBe(200);
    expect(pass.body.wallet.balanceCents).toBe(500 - OUTCOME_PRICE_CENTS.dayPass);

    // And generating goes on — unlimited for the window, not a bigger bucket:
    // the month's allowance is still spent and stays spent.
    const again = await me.agent.post(`/api/projects/${project.id}/path/loops/write`).send({});
    expect(again.body.code).not.toBe("payment_required");
    expect((await rowOf(me.id)).u).toBe(MONTHLY_SMALL_ACTIONS);
  });

  it("offers a top-up when there isn't even a dollar there, and takes nothing until Stripe says it was paid", async () => {
    const me = await builder(app);
    await setUsed(me.id, MONTHLY_SMALL_ACTIONS);

    const wallet = (await me.agent.get("/api/nova/wallet")).body;
    expect(wallet.wallet).toMatchObject({ balanceCents: 0, allowanceRemaining: 0, dayPassActive: false });
    // The price list travels with it, so a dialog never hard-codes a price.
    expect(wallet.prices.outcomes.find((o: any) => o.id === "dayPass")).toMatchObject({ cents: 100, display: "$1" });

    const started = await me.agent.post("/api/nova/top-up").send({ amountCents: 500 });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect((await rowOf(me.id)).b, "the balance follows the payment, not the intent").toBe(0);
  });

  it("never lets an old subscription event change what anybody can do", async () => {
    const me = await builder(app);
    await setUsed(me.id, 10);

    /*
     * applyTier still runs for subscriptions being wound down, and still
     * refills the month on a first payment — harmless, and one fewer thing to
     * unpick while money is still moving. What it must not do any more is
     * change an entitlement, because entitlements are not for sale.
     */
    const { tier: _wasTier, ...free } = (await me.agent.get("/api/subscription")).body.entitlements;
    await applyTier(me.id, "builder", "sub_revenue_legacy");
    const afterPaying = (await me.agent.get("/api/subscription")).body;
    // The tier string on the row moves, because Stripe still says so. Nothing
    // that string decides moves, because it no longer decides anything.
    const { tier, ...nowGets } = afterPaying.entitlements;
    expect(tier).toBe("builder");
    expect(nowGets).toEqual(free);
    expect(afterPaying.creditsLimit).toBe(MONTHLY_SMALL_ACTIONS);

    // And the plan catalog has nothing to sell: every plan is free.
    const plans = (await request(app).get("/api/plans")).body;
    for (const p of plans.plans) expect(p.price).toBe(0);
    expect(plans.pricing.outcomes.map((o: any) => o.id)).toContain("dayPass");
  });
});
