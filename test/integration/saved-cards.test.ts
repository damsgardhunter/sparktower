/**
 * Cards kept on file, and paying with one.
 *
 * Every purchase used to be a Stripe Checkout redirect. Saving a card means
 * the server can charge it later, which is a power worth testing properly:
 * three of the tests below are about somebody *else's* card, and one is about
 * a balance that must not move until Stripe says the money arrived.
 *
 * Stripe itself is faked. What is being tested is this product's rules — whose
 * card may be charged, what the webhook credits, what the amount may be — not
 * that Stripe can take a payment.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import { FAKE_STRIPE_TEST_KEY, fakeWebhookSecret } from "../helpers/fake-secrets";

const WEBHOOK_SECRET = fakeWebhookSecret("saved-cards");
const signer = new Stripe(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });
/*
 * No `process.env.STRIPE_WEBHOOK_SECRET` here, deliberately.
 *
 * The suite runs single-fork, so every test file shares one process and one
 * `process.env`. Setting the secret at module scope leaked into
 * `stripe-webhook.test.ts`, whose whole subject is what happens when no secret
 * is configured — it started passing a case it exists to fail. The verification
 * is mocked below instead, which is what the other Stripe suites do.
 */

/**
 * The fake Stripe.
 *
 * `attached` is the truth about who owns which card, which is what the
 * ownership tests turn on. `intents` records every charge so a test can see
 * what was asked for, including the idempotency key.
 */
const attached = new Map<string, string>();   // paymentMethodId -> customerId
const defaults = new Map<string, string>();   // customerId -> paymentMethodId
const intents: any[] = [];
const setups: any[] = [];
let nextCustomer = 0;
/** Set by a test to make the next confirm fail the way Stripe would. */
let failNextConfirm: null | "authentication_required" | "card_declined" = null;

vi.mock("../../server/stripeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/stripeClient")>();
  const StripeCtor = (await import("stripe")).default;
  const real = new StripeCtor(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });
  const fake: any = {
    customers: {
      create: async () => ({ id: `cus_${++nextCustomer}` }),
      retrieve: async (id: string) => ({
        id, deleted: false,
        invoice_settings: { default_payment_method: defaults.get(id) ?? null },
      }),
      update: async (id: string, args: any) => {
        const pm = args?.invoice_settings?.default_payment_method;
        if (pm) defaults.set(id, pm);
        return { id };
      },
    },
    setupIntents: {
      create: async (args: any) => {
        setups.push(args);
        return { id: `seti_${setups.length}`, client_secret: `seti_${setups.length}_secret_abc` };
      },
    },
    paymentMethods: {
      list: async ({ customer }: any) => ({
        data: [...attached.entries()]
          .filter(([, c]) => c === customer)
          .map(([id]) => ({ id, type: "card", customer, card: { brand: "visa", last4: id.slice(-4), exp_month: 12, exp_year: 2030 } })),
      }),
      retrieve: async (id: string) => {
        const customer = attached.get(id);
        if (!customer) throw Object.assign(new Error("No such PaymentMethod"), { statusCode: 404 });
        return { id, type: "card", customer, card: { brand: "visa", last4: id.slice(-4), exp_month: 12, exp_year: 2030 } };
      },
      detach: async (id: string) => { attached.delete(id); return { id, customer: null }; },
    },
    paymentIntents: {
      create: async (args: any, opts: any) => {
        intents.push({ args, opts });
        if (failNextConfirm === "authentication_required") {
          failNextConfirm = null;
          throw Object.assign(new Error("needs auth"), {
            code: "authentication_required",
            raw: { payment_intent: { id: "pi_needs_auth", client_secret: "pi_needs_auth_secret_x" } },
          });
        }
        if (failNextConfirm === "card_declined") {
          failNextConfirm = null;
          throw Object.assign(new Error("Your card has insufficient funds."), {
            type: "StripeCardError", code: "card_declined", decline_code: "insufficient_funds",
          });
        }
        return { id: `pi_${intents.length}`, status: "succeeded", amount_received: args.amount };
      },
    },
    subscriptions: { list: async () => ({ data: [] }) },
    prices: { list: async () => ({ data: [] }) },
    checkout: { sessions: { create: async () => ({ id: "cs_x", url: "https://checkout.stripe.test/cs_x" }) } },
    webhooks: real.webhooks,
  };
  return {
    ...actual,
    isStripeConfigured: () => true,
    getUncachableStripeClient: async () => fake,
    getStripeSync: async () => ({
      processWebhook: async (payload: Buffer, signature: string) => {
        real.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET);
      },
    }),
  };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { verifyEmail } = await import("../helpers/verify-email");
const { TOP_UP_CENTS } = await import("@shared/plans");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  n += 1;
  const email = `cards-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const ip = `203.0.117.${(n % 200) + 20}`;
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: "Pat" });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  await verifyEmail(app, email, ip);
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  /* The customer id the routes will settle on, so a test can attach a card to it. */
  await agent.get("/api/payment-methods");
  const [row] = await db.select({ c: users.stripeCustomerId }).from(users).where(eq(users.id, reg.body.id));
  return { agent, userId: reg.body.id as string, customerId: row.c as string };
}

const balanceOf = async (userId: string) =>
  (await db.select({ b: users.balanceCents }).from(users).where(eq(users.id, userId)))[0].b;

const deliver = (app: any, event: unknown) => {
  const body = JSON.stringify(event);
  return request(app).post("/api/stripe/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signer.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET }))
    .send(body);
};

const succeeded = (id: string, userId: string, amountCents: number, extra: Record<string, unknown> = {}) => ({
  id: `evt_${id}`, type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000),
  data: { object: { id, amount_received: amountCents, metadata: { type: "topup", userId, amountCents: String(amountCents) }, ...extra } },
});

describe("saving a card", () => {
  it("hands back a setup intent meant for later charges", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const res = await me.agent.post("/api/payment-methods/setup-intent").send({});
    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toMatch(/^seti_/);
    const asked = setups[setups.length - 1];
    /*
     * `off_session` is what tells the bank at setup time that this card will be
     * charged when the customer is not there. Without it the later charges are
     * the ones that get challenged and fail.
     */
    expect(asked.usage).toBe("off_session");
    expect(asked.customer).toBe(me.customerId);
  });

  it("lists the cards on file, and says which is the default", async () => {
    const app = await getTestApp();
    const me = await person(app);
    attached.set("pm_aaaa1111", me.customerId);
    attached.set("pm_bbbb2222", me.customerId);
    defaults.set(me.customerId, "pm_bbbb2222");

    const res = await me.agent.get("/api/payment-methods");
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(2);
    /* Default first — the order somebody scans for "the one I use". */
    expect(res.body.cards[0].id).toBe("pm_bbbb2222");
    expect(res.body.cards[0].isDefault).toBe(true);
    expect(res.body.cards[0].last4).toBe("2222");
    expect(res.body.cards[1].isDefault).toBe(false);
  });

  it("never returns anything that could reconstruct the card", async () => {
    const app = await getTestApp();
    const me = await person(app);
    attached.set("pm_cccc3333", me.customerId);
    const res = await me.agent.get("/api/payment-methods");
    const json = JSON.stringify(res.body);
    for (const leak of ["number", "cvc", "cvv", "fingerprint"]) {
      expect(json, `a card payload should not carry ${leak}`).not.toContain(leak);
    }
  });
});

/**
 * The part that matters most.
 *
 * A `pm_…` id is a bearer-ish string that arrives from a client, and the
 * routes that name one must prove it belongs to the account asking. Without
 * that, "charge pm_X" is an API for billing other people's cards.
 */
describe("somebody else's card", () => {
  it("cannot be charged", async () => {
    const app = await getTestApp();
    const victim = await person(app);
    const attacker = await person(app);
    attached.set("pm_victim0001", victim.customerId);

    const before = intents.length;
    const res = await attacker.agent.post("/api/wallet/topup/saved-card")
      .send({ amountCents: 1000, paymentMethodId: "pm_victim0001" });

    expect(res.status).toBe(404);
    expect(intents.length, "no charge should have been attempted at all").toBe(before);
  });

  it("cannot be made somebody's default", async () => {
    const app = await getTestApp();
    const victim = await person(app);
    const attacker = await person(app);
    attached.set("pm_victim0002", victim.customerId);

    const res = await attacker.agent.post("/api/payment-methods/pm_victim0002/default").send({});
    expect(res.status).toBe(404);
    expect(defaults.get(attacker.customerId)).toBeUndefined();
  });

  it("cannot be detached", async () => {
    const app = await getTestApp();
    const victim = await person(app);
    const attacker = await person(app);
    attached.set("pm_victim0003", victim.customerId);

    const res = await attacker.agent.delete("/api/payment-methods/pm_victim0003");
    expect(res.status).toBe(404);
    expect(attached.has("pm_victim0003"), "the victim still has their card").toBe(true);
  });

  it("answers 404 rather than 403, so the reply says nothing about what exists", async () => {
    const app = await getTestApp();
    const victim = await person(app);
    const attacker = await person(app);
    attached.set("pm_victim0004", victim.customerId);

    const theirs = await attacker.agent.delete("/api/payment-methods/pm_victim0004");
    const nothing = await attacker.agent.delete("/api/payment-methods/pm_doesnotexist9");
    expect(theirs.status).toBe(nothing.status);
  });
});

describe("paying with a saved card", () => {
  it("charges off-session, and says it is a top-up", async () => {
    const app = await getTestApp();
    const me = await person(app);
    attached.set("pm_pay000001", me.customerId);
    defaults.set(me.customerId, "pm_pay000001");

    const res = await me.agent.post("/api/wallet/topup/saved-card").send({ amountCents: 1000 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { args, opts } = intents[intents.length - 1];
    expect(args.off_session).toBe(true);
    expect(args.confirm).toBe(true);
    expect(args.customer).toBe(me.customerId);
    expect(args.payment_method).toBe("pm_pay000001");
    expect(args.amount).toBe(1000);
    /* The webhook reads these to know whose balance to move. */
    expect(args.metadata).toMatchObject({ type: "topup", userId: me.userId, amountCents: "1000" });
    expect(opts?.idempotencyKey, "a double tap must charge once").toBeTruthy();
  });

  it("uses the default card when none is named", async () => {
    const app = await getTestApp();
    const me = await person(app);
    attached.set("pm_def00001", me.customerId);
    defaults.set(me.customerId, "pm_def00001");

    const res = await me.agent.post("/api/wallet/topup/saved-card").send({ amountCents: 500 });
    expect(res.status).toBe(200);
    expect(intents[intents.length - 1].args.payment_method).toBe("pm_def00001");
  });

  it("refuses when there is no card at all, rather than charging nothing", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const res = await me.agent.post("/api/wallet/topup/saved-card").send({ amountCents: 500 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("no_saved_card");
  });

  it("takes only the amounts the hosted checkout takes", async () => {
    const app = await getTestApp();
    const me = await person(app);
    attached.set("pm_amt00001", me.customerId);
    defaults.set(me.customerId, "pm_amt00001");

    /*
     * The two ways of buying the same thing must agree about the price. A free
     * amount here would be a way to buy $100 of balance for a cent.
     */
    for (const bad of [1, 99, 123456, -1000, 0]) {
      const res = await me.agent.post("/api/wallet/topup/saved-card").send({ amountCents: bad });
      expect(res.status, `${bad} should be refused`).toBe(400);
      expect(res.body.code).toBe("invalid_amount");
    }
    const ok = await me.agent.post("/api/wallet/topup/saved-card").send({ amountCents: TOP_UP_CENTS[0] });
    expect(ok.status).toBe(200);
  });

  /*
   * The bank wants the customer. This is not a decline: the card is fine and
   * the person is right there, having just tapped a button. Reporting it as a
   * decline is how somebody with a working card is told their card is broken.
   */
  it("hands back a client secret when the bank wants a challenge", async () => {
    const app = await getTestApp();
    const me = await person(app);
    attached.set("pm_sca00001", me.customerId);
    defaults.set(me.customerId, "pm_sca00001");
    failNextConfirm = "authentication_required";

    const res = await me.agent.post("/api/wallet/topup/saved-card").send({ amountCents: 1000 });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("authentication_required");
    expect(res.body.clientSecret).toBe("pi_needs_auth_secret_x");
    expect(res.body.message).not.toMatch(/declin/i);
  });

  it("passes Stripe's own words through on a decline", async () => {
    const app = await getTestApp();
    const me = await person(app);
    attached.set("pm_dec00001", me.customerId);
    defaults.set(me.customerId, "pm_dec00001");
    failNextConfirm = "card_declined";

    const res = await me.agent.post("/api/wallet/topup/saved-card").send({ amountCents: 1000 });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("card_declined");
    /* "insufficient funds" is more use than anything this product could write. */
    expect(res.body.message).toMatch(/insufficient funds/i);
    expect(res.body.declineCode).toBe("insufficient_funds");
  });

  it("moves no money of its own", async () => {
    const app = await getTestApp();
    const me = await person(app);
    attached.set("pm_bal00001", me.customerId);
    defaults.set(me.customerId, "pm_bal00001");

    const before = await balanceOf(me.userId);
    const res = await me.agent.post("/api/wallet/topup/saved-card").send({ amountCents: 2000 });
    expect(res.status).toBe(200);
    /*
     * The whole point. The API response says what Stripe thought at that
     * instant; the webhook is what says the money arrived. A balance credited
     * here would survive a payment that later failed.
     */
    expect(await balanceOf(me.userId), "the balance must wait for the webhook").toBe(before);
  });
});

describe("the webhook is what credits the balance", () => {
  it("credits a saved-card top-up on payment_intent.succeeded", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const before = await balanceOf(me.userId);

    const res = await deliver(app, succeeded("pi_credit_1", me.userId, 2000));
    expect(res.status).toBe(200);
    expect(await balanceOf(me.userId)).toBe(before + 2000);
  });

  it("credits once however many times Stripe redelivers", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const before = await balanceOf(me.userId);

    /* Same intent, two different event ids — a genuine Stripe redelivery. */
    await deliver(app, { ...succeeded("pi_credit_2", me.userId, 1000), id: "evt_dup_a" });
    await deliver(app, { ...succeeded("pi_credit_2", me.userId, 1000), id: "evt_dup_b" });
    expect(await balanceOf(me.userId)).toBe(before + 1000);
  });

  it("credits what arrived, not what was asked for", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const before = await balanceOf(me.userId);
    /*
     * A balance larger than the money behind it is the one arithmetic error
     * that cannot be argued with.
     */
    await deliver(app, {
      id: "evt_partial", type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000),
      data: { object: { id: "pi_partial_1", amount_received: 500, metadata: { type: "topup", userId: me.userId, amountCents: "5000" } } },
    });
    expect(await balanceOf(me.userId)).toBe(before + 500);
  });

  it("ignores a payment intent this product did not make", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const before = await balanceOf(me.userId);
    /*
     * Any PaymentIntent in the account raises this event — a subscription
     * invoice, a Connect charge, something added next year. Only the ones
     * marked as a top-up may credit a wallet.
     */
    await deliver(app, {
      id: "evt_other", type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000),
      data: { object: { id: "pi_other_1", amount_received: 9999, metadata: { userId: me.userId } } },
    });
    expect(await balanceOf(me.userId)).toBe(before);
  });

  it("ignores one that names no account", async () => {
    const app = await getTestApp();
    await person(app);
    const res = await deliver(app, {
      id: "evt_nouser", type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000),
      data: { object: { id: "pi_nouser_1", amount_received: 1000, metadata: { type: "topup" } } },
    });
    /* Accepted and ignored: a 500 here would make Stripe retry it for days. */
    expect(res.status).toBe(200);
  });
});
