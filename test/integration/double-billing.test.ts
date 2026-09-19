/**
 * Nobody pays for two plans.
 *
 * /api/checkout started a new subscription for anybody who asked, including
 * people already paying. The likeliest person to ask was a Builder member who
 * ran out of credits: the prompt says "upgrade", the button opened a checkout,
 * and from then on Builder and Pro both billed every month. The webhook then
 * made it worse — it treated each event as describing *the* subscription, so
 * the old one's renewal set the plan back to Builder, and cancelling either
 * one set it to Free while the other kept charging.
 *
 * Stripe here is a fake that holds any number of subscriptions per customer,
 * because a customer holding more than one is the whole bug.
 */
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";

const PRICES: Record<string, string> = { price_builder: "builder", price_pro: "pro" };
type FakeSub = { id: string; customer: string; status: string; created: number; items: { data: { id: string; price: { id: string } }[] } };
const S = {
  subs: new Map<string, FakeSub>(),
  updates: [] as { id: string; price: string }[],
  expired: [] as string[],
  openSessions: [] as { id: string; mode: string }[],
  checkoutsCreated: 0,
  nextCustomer: 1,
};

vi.mock("../../server/stripeClient", () => ({
  getUncachableStripeClient: async () => ({
    customers: { create: async () => ({ id: `cus_new_${S.nextCustomer++}` }) },
    prices: {
      list: async () => ({
        data: Object.entries(PRICES).map(([id, tier]) => ({ id, recurring: { interval: "month" }, metadata: { tier }, product: { active: true, metadata: {} } })),
      }),
      retrieve: async (id: string) => ({ id, metadata: { tier: PRICES[id] }, product: { metadata: {} } }),
    },
    subscriptions: {
      list: async ({ customer }: { customer: string }) => ({ data: [...S.subs.values()].filter((s) => s.customer === customer) }),
      retrieve: async (id: string) => S.subs.get(id),
      update: async (id: string, { items }: { items: { price: string }[] }) => {
        const sub = S.subs.get(id)!;
        sub.items.data[0].price = { id: items[0].price };
        S.updates.push({ id, price: items[0].price });
        return sub;
      },
    },
    checkout: {
      sessions: {
        list: async () => ({ data: S.openSessions }),
        expire: async (id: string) => { S.expired.push(id); return { id, status: "expired" }; },
        create: async () => { S.checkoutsCreated += 1; return { id: "cs_new", url: "https://checkout.stripe.test/cs_new" }; },
      },
    },
  }),
  getStripeSync: async () => ({}),
}));

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { WebhookHandlers } = await import("../../server/webhookHandlers");

afterAll(async () => { await closeTestApp(); });
beforeEach(() => {
  S.subs.clear(); S.updates = []; S.expired = []; S.openSessions = []; S.checkoutsCreated = 0;
});

let n = 0;
const sub = (id: string, customer: string, price: string, created: number, status = "active") =>
  S.subs.set(id, { id, customer, status, created, items: { data: [{ id: `si_${id}`, price: { id: price } }] } });

async function payingMember(customer: string, tier: string, subscriptionId: string | null) {
  const app = await getTestApp();
  n += 1;
  const agent = request.agent(app);
  const email = `double-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.170.${20 + n}`)
    .send({ email, password: "Testpass123!", firstName: "Paying" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await db.update(users).set({ stripeCustomerId: customer, subscriptionTier: tier, stripeSubscriptionId: subscriptionId }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string };
}

const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

let clock = Math.floor(Date.now() / 1000);
const event = (type: string, object: FakeSub) => ({ id: `evt_${++clock}`, type, created: clock, data: { object: { ...object } } });

describe("checking out when you already pay", () => {
  it("changes the plan on the subscription you have, and never starts a second one", async () => {
    sub("sub_builder", "cus_up", "price_builder", 1);
    const m = await payingMember("cus_up", "builder", "sub_builder");

    const res = await m.agent.post("/api/checkout").send({ priceId: "price_pro" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ switched: true, tier: "pro" });
    expect(S.updates).toEqual([{ id: "sub_builder", price: "price_pro" }]);
    expect(S.checkoutsCreated, "no second subscription").toBe(0);
    expect((await row(m.id)).subscriptionTier).toBe("pro");
  });

  it("refuses the plan you're already on", async () => {
    sub("sub_same", "cus_same", "price_builder", 1);
    const m = await payingMember("cus_same", "builder", "sub_same");
    const res = await m.agent.post("/api/checkout").send({ priceId: "price_builder" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("already_subscribed");
    expect(S.updates).toEqual([]);
    expect(S.checkoutsCreated).toBe(0);
  });

  it("lets only the newest of two open checkouts complete", async () => {
    // A checkout left open in another tab, and an unrelated one-off payment.
    S.openSessions = [{ id: "cs_other_tab", mode: "subscription" }, { id: "cs_donation", mode: "payment" }];
    const m = await payingMember("cus_fresh", "free", null);
    const res = await m.agent.post("/api/checkout").send({ priceId: "price_builder" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(S.expired, "the other tab's checkout can no longer become a second subscription").toEqual(["cs_other_tab"]);
    expect(S.checkoutsCreated).toBe(1);
  });
});

describe("a customer who already holds two subscriptions", () => {
  it("keeps the plan they pay most for when the other one renews, and says they're being charged twice", async () => {
    sub("sub_old_builder", "cus_two", "price_builder", 1);
    sub("sub_new_pro", "cus_two", "price_pro", 2);
    const m = await payingMember("cus_two", "pro", "sub_new_pro");
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: any[]) => { logged.push(a.join(" ")); });
    try {
      // The old Builder subscription renews — which used to set them back to Builder.
      await WebhookHandlers.handleSubscriptionEvent(event("customer.subscription.updated", S.subs.get("sub_old_builder")!));
    } finally { spy.mockRestore(); }

    const after = await row(m.id);
    expect(after.subscriptionTier, "a renewal of the smaller plan doesn't downgrade them").toBe("pro");
    expect(after.stripeSubscriptionId).toBe("sub_new_pro");
    expect(logged.join("\n"), "somebody paying twice is reported for a refund").toMatch(/Charged twice: customer cus_two has 2 paid subscriptions/);
  });

  it("stays on the plan the other one pays for when one is cancelled, and goes to Free only when both are", async () => {
    sub("sub_keep_pro", "cus_cancel", "price_pro", 2);
    sub("sub_drop_builder", "cus_cancel", "price_builder", 1);
    const m = await payingMember("cus_cancel", "pro", "sub_keep_pro");

    S.subs.get("sub_drop_builder")!.status = "canceled";
    await WebhookHandlers.handleSubscriptionEvent(event("customer.subscription.deleted", S.subs.get("sub_drop_builder")!));
    expect((await row(m.id)).subscriptionTier, "cancelling one of two used to drop them to Free").toBe("pro");

    S.subs.get("sub_keep_pro")!.status = "canceled";
    await WebhookHandlers.handleSubscriptionEvent(event("customer.subscription.deleted", S.subs.get("sub_keep_pro")!));
    const after = await row(m.id);
    expect(after.subscriptionTier).toBe("free");
    expect(after.stripeSubscriptionId).toBeNull();
  });
});
