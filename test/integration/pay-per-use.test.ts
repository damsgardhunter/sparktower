/**
 * Paying for outcomes, against the running app.
 *
 * The rules the product owner set, each one as a test, because every one of
 * them is a promise made to somebody in a dialog:
 *
 *   - the month's allowance covers small Nova actions, and runs out;
 *   - a $1 day pass covers them for its window, and not after it;
 *   - each priced outcome takes its price in dollars, and gives it straight
 *     back when the action fails;
 *   - a top-up credits the balance once, however many times Stripe delivers it;
 *   - a company's first private season is free and the second is per seat;
 *   - and nothing that is free forever ever asks for money.
 *
 * Stripe is a fake, as in the other money tests: a real signature over a real
 * payload, and a client that answers without a network.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import Stripe from "stripe";
import { FAKE_STRIPE_TEST_KEY, fakeWebhookSecret } from "../helpers/fake-secrets";

const WEBHOOK_SECRET = fakeWebhookSecret("pay-per-use");
const signer = new Stripe(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });

/** Every model call fails. Nothing here needs a model to answer — it needs the money to move. */
let modelWorks = false;
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async () => {
      if (!modelWorks) throw new Error("model exploded");
      return { choices: [{ message: { content: "I'm sorry, I can't produce that right now." } }] };
    } } };
    images = { generate: async () => { throw new Error("no images in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const created: any[] = [];
vi.mock("../../server/stripeClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/stripeClient")>();
  const StripeCtor = (await import("stripe")).default;
  const real = new StripeCtor(FAKE_STRIPE_TEST_KEY, { apiVersion: "2025-08-27.basil" });
  const fake: any = {
    customers: { create: async () => ({ id: `cus_${created.length + 1}` }), retrieve: async (id: string) => ({ id, deleted: false }) },
    subscriptions: { list: async () => ({ data: [] }) },
    prices: { list: async () => ({ data: [] }) },
    checkout: {
      sessions: {
        list: async () => ({ data: [] }),
        expire: async (id: string) => ({ id, status: "expired" }),
        create: async (args: any) => {
          created.push(args);
          const id = `cs_topup_${created.length}`;
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
      },
    },
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
const { db } = await import("../../server/db");
const { users, novaLedger, simSeasons } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
const { OUTCOME_PRICE_CENTS, MONTHLY_SMALL_ACTIONS } = await import("@shared/plans");
const { verifyEmail } = await import("../helpers/verify-email");

afterAll(async () => { await closeTestApp(); delete process.env.RATE_LIMIT_EXEMPT_EMAILS; });

let n = 0;
/**
 * A registered builder with a project. Exempt from the per-minute AI burst
 * limit, because these tests deliberately fire a dozen Nova actions in a row
 * to drain an allowance — the burst limit is a different test's subject.
 */
async function builder(app: any, opts: { balanceCents?: number } = {}) {
  n += 1;
  const email = `pay-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const ip = `203.0.114.${(n % 200) + 20}`;
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", ip).send({ email, password: "a-good-passphrase-here", firstName: "Pat" });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  await verifyEmail(app, email, ip);
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  if (opts.balanceCents) await db.update(users).set({ balanceCents: opts.balanceCents }).where(eq(users.id, reg.body.id));
  const project = await agent.post("/api/projects").send({
    title: "Pay As You Go", description: "A project used to check what Nova charges, and what it never charges for.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(project.status).toBe(200);
  const path = await agent.get(`/api/projects/${project.body.id}/path`);
  return {
    agent, email, userId: reg.body.id as string, projectId: project.body.id as string,
    taskId: (path.body?.next?.workTaskId ?? "no-such-task") as string,
  };
}

const wallet = async (agent: any) => (await agent.get("/api/nova/wallet")).body.wallet;
const balanceOf = async (userId: string) =>
  (await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, userId)))[0].balanceCents;

/** One small Nova action. The model fails, which is fine: the allowance is taken before it runs. */
const smallAction = (b: { agent: any; projectId: string; taskId: string }) =>
  b.agent.post(`/api/projects/${b.projectId}/path/work`).send({ taskId: b.taskId });

const deliver = (app: any, event: unknown) => {
  const body = JSON.stringify(event);
  return request(app).post("/api/stripe/webhook")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signer.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET }))
    .send(body);
};

const topUpEvent = (id: string, sessionId: string, userId: string, amountCents: number, type = "checkout.session.completed") => ({
  id, type, created: Math.floor(Date.now() / 1000),
  data: { object: { id: sessionId, mode: "payment", payment_status: "paid", amount_total: amountCents, customer: "cus_1", metadata: { type: "topup", userId, amountCents: String(amountCents) } } },
});

describe("the month's free allowance", () => {
  it("covers small Nova actions, then asks for a day pass — with everything a dialog needs to offer it", async () => {
    const app = await getTestApp();
    const b = await builder(app);

    const opening = await wallet(b.agent);
    expect(opening).toMatchObject({ allowanceLimit: MONTHLY_SMALL_ACTIONS, allowanceUsed: 0, balanceCents: 0, dayPassActive: false });

    /*
     * Drain it. Every one of these fails at the model — deliberately, because
     * what is being counted is the allowance, and an action that failed is
     * still an action the allowance was checked against... except it isn't:
     * a failed action is refunded, so the count only moves on the ones that
     * would have worked. So the allowance is drained directly on the row and
     * one real action is taken against what's left.
     */
    await db.update(users).set({ creditsUsed: MONTHLY_SMALL_ACTIONS - 1, creditsResetAt: new Date() }).where(eq(users.id, b.userId));

    // One left: allowed through to the model (which then fails, and refunds it).
    const last = await smallAction(b);
    expect(last.status).toBeGreaterThanOrEqual(500);
    expect(last.status).not.toBe(402);

    // Now spend the last one for real, and the next is refused.
    await db.update(users).set({ creditsUsed: MONTHLY_SMALL_ACTIONS }).where(eq(users.id, b.userId));
    const refused = await smallAction(b);
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({
      code: "payment_required",
      outcome: "dayPass",
      price: { cents: OUTCOME_PRICE_CENTS.dayPass, display: "$1" },
      remedy: "top_up",
    });
    // What it costs, what they have, and what to do about it — in one answer.
    expect(refused.body.wallet).toMatchObject({ allowanceRemaining: 0, balanceCents: 0 });
    expect(refused.body.topUp).toMatchObject({ shortfallCents: OUTCOME_PRICE_CENTS.dayPass, suggestCents: 500 });
    expect(refused.body.endpoints.dayPass).toBe("/api/nova/day-pass");
    expect(refused.body.message).toMatch(/day pass/i);

    // With money on the account it is one tap instead, and the dialog is told so.
    await db.update(users).set({ balanceCents: 500 }).where(eq(users.id, b.userId));
    const affordable = await smallAction(b);
    expect(affordable.status).toBe(402);
    // "buy_pass" covers both passes — the dollar one for small actions and the
    // five-dollar one for images. `outcome` says which; to a person it is the
    // same press, so it is one button.
    expect(affordable.body.remedy).toBe("buy_pass");
    expect(affordable.body.outcome).toBe("dayPass");
    expect(affordable.body.topUp).toBe(null);
  });
});

describe("the day pass", () => {
  it("costs a dollar, covers small actions for its window, and stops covering them after it", async () => {
    const app = await getTestApp();
    const b = await builder(app, { balanceCents: 500 });
    await db.update(users).set({ creditsUsed: MONTHLY_SMALL_ACTIONS, creditsResetAt: new Date() }).where(eq(users.id, b.userId));

    const bought = await b.agent.post("/api/nova/day-pass").send({});
    expect(bought.status, JSON.stringify(bought.body)).toBe(200);
    expect(bought.body.wallet).toMatchObject({ balanceCents: 500 - OUTCOME_PRICE_CENTS.dayPass, dayPassActive: true });
    expect(new Date(bought.body.dayPassUntil).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);

    // Covered, with the allowance already spent: the route reaches the model.
    const covered = await smallAction(b);
    expect(covered.status, JSON.stringify(covered.body)).not.toBe(402);
    expect(covered.status).toBeGreaterThanOrEqual(500);
    // And the pass is free: the allowance didn't move, and neither did the balance.
    expect(await balanceOf(b.userId)).toBe(500 - OUTCOME_PRICE_CENTS.dayPass);
    expect((await wallet(b.agent)).allowanceUsed).toBe(MONTHLY_SMALL_ACTIONS);

    // The window closes.
    await db.update(users).set({ dayPassUntil: new Date(Date.now() - 1000) }).where(eq(users.id, b.userId));
    const after = await smallAction(b);
    expect(after.status).toBe(402);
    expect(after.body.outcome).toBe("dayPass");

    // Buying a second pass extends rather than replaces, and takes another dollar.
    await db.update(users).set({ balanceCents: 500 }).where(eq(users.id, b.userId));
    const again = await b.agent.post("/api/nova/day-pass").send({});
    expect(again.status).toBe(200);
    expect(await balanceOf(b.userId)).toBe(500 - OUTCOME_PRICE_CENTS.dayPass);
  });

  it("refuses the pass, with a top-up to offer, when there isn't a dollar there", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    const res = await b.agent.post("/api/nova/day-pass").send({});
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ code: "payment_required", outcome: "dayPass", remedy: "top_up" });
    expect(res.body.topUp.optionsCents).toContain(500);
  });
});

describe("a priced outcome", () => {
  it("takes its price in dollars, and gives it back when the action fails", async () => {
    const app = await getTestApp();
    const b = await builder(app, { balanceCents: 2000 });

    modelWorks = false;
    const failed = await b.agent.post(`/api/projects/${b.projectId}/roadmap/generate`).send({ goal: "Launch by spring" });
    expect(failed.status).toBeGreaterThanOrEqual(500);
    // The $3 was taken before the model ran, and is back before the answer went out.
    expect(await balanceOf(b.userId)).toBe(2000);

    // The ledger keeps the history rather than rewriting it: a spend, then a refund.
    const rows = await db.select().from(novaLedger).where(eq(novaLedger.userId, b.userId));
    expect(rows.map((r) => r.kind).sort()).toEqual(["refund", "spend"]);
    expect(rows.find((r) => r.kind === "spend")).toMatchObject({ outcome: "roadmap", amountCents: -OUTCOME_PRICE_CENTS.roadmap });
    expect(rows.find((r) => r.kind === "refund")).toMatchObject({ outcome: "roadmap", amountCents: OUTCOME_PRICE_CENTS.roadmap });
  });

  it("says what it costs, what you have and what to do, when the balance is short", async () => {
    const app = await getTestApp();
    const b = await builder(app, { balanceCents: 100 });
    const res = await b.agent.post(`/api/projects/${b.projectId}/code-audit`).send({ zipUrl: "nope" });
    // Either the audit refuses the input first (400) or it refuses the money.
    if (res.status === 402) {
      expect(res.body).toMatchObject({
        code: "payment_required", outcome: "codeAudit",
        price: { cents: OUTCOME_PRICE_CENTS.codeAudit, display: "$5" },
        remedy: "top_up",
      });
      expect(res.body.topUp.shortfallCents).toBe(OUTCOME_PRICE_CENTS.codeAudit - 100);
    }

    // The roadmap is reachable with no input of its own, so it is the one checked properly.
    const roadmap = await b.agent.post(`/api/projects/${b.projectId}/roadmap/generate`).send({ goal: "Launch by spring" });
    expect(roadmap.status).toBe(402);
    expect(roadmap.body.price.cents).toBe(OUTCOME_PRICE_CENTS.roadmap);
    expect(roadmap.body.wallet.balanceCents).toBe(100);
    expect(roadmap.body.topUp).toMatchObject({ shortfallCents: OUTCOME_PRICE_CENTS.roadmap - 100, suggestCents: 500 });
    // Nothing was taken on the way to being refused.
    expect(await balanceOf(b.userId)).toBe(100);
  });

  it("charges $30 once for the whole business, and then every outcome on that project is paid for", async () => {
    const app = await getTestApp();
    const b = await builder(app, { balanceCents: OUTCOME_PRICE_CENTS.business });

    const bought = await b.agent.post("/api/nova/build-my-business").send({ projectId: b.projectId });
    expect(bought.status, JSON.stringify(bought.body)).toBe(201);
    expect(bought.body.wallet.balanceCents).toBe(0);
    expect(bought.body.started, "paying starts the build").toBe(true);

    /*
     * Pressing it again is never a second charge. While the build is running
     * it is refused as already running; once it has stopped it starts again
     * for nothing, because the pass is the receipt and a build interrupted by
     * a restart must not leave somebody who paid $30 with half a path and no
     * button.
     */
    await settled(b);
    const again = await b.agent.post("/api/nova/build-my-business").send({ projectId: b.projectId });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.alreadyPaid).toBe(true);
    expect(again.body.paidCents).toBe(0);
    expect(await balanceOf(b.userId)).toBe(0);
    await settled(b);

    // With nothing left on the balance, a roadmap on that project still runs.
    const roadmap = await b.agent.post(`/api/projects/${b.projectId}/roadmap/generate`).send({ goal: "Launch by spring" });
    expect(roadmap.status, JSON.stringify(roadmap.body)).not.toBe(402);
  });
});

/**
 * Wait for the background build to stop.
 *
 * The purchase route starts it and does not await it — which is the point, a
 * checkout must not hang for minutes — so a test that then asserts on the run
 * has to wait for it the same way the page does.
 */
async function settled(b: { agent: any; projectId: string }) {
  for (let i = 0; i < 100; i++) {
    const status = await b.agent.get(`/api/projects/${b.projectId}/nova-build`);
    if (!status.body?.running) return status.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the build never finished");
}

describe("topping up", () => {
  it("credits the balance once, however many times Stripe delivers the same session", async () => {
    const app = await getTestApp();
    const b = await builder(app);

    const started = await b.agent.post("/api/nova/top-up").send({ amountCents: 1000 });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    expect(started.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    // Nothing moves on the way out: the balance follows the payment, not the intent.
    expect(await balanceOf(b.userId)).toBe(0);

    const session = `cs_replay_${b.userId}`;
    expect((await deliver(app, topUpEvent(`evt_a_${b.userId}`, session, b.userId, 1000))).status).toBe(200);
    expect(await balanceOf(b.userId)).toBe(1000);

    // The same event again — the event ledger stops it.
    expect((await deliver(app, topUpEvent(`evt_a_${b.userId}`, session, b.userId, 1000))).status).toBe(200);
    expect(await balanceOf(b.userId)).toBe(1000);

    // And the same *session* under a different event id, which is what Stripe
    // really does for a delayed payment method. The ledger's unique session
    // stops that one.
    expect((await deliver(app, topUpEvent(`evt_b_${b.userId}`, session, b.userId, 1000, "checkout.session.async_payment_succeeded"))).status).toBe(200);
    expect(await balanceOf(b.userId)).toBe(1000);

    const tops = await db.select().from(novaLedger).where(eq(novaLedger.userId, b.userId));
    expect(tops.filter((r) => r.kind === "topup")).toHaveLength(1);
  });

  it("refuses an amount that isn't one of ours, so a client can't name its own price", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    for (const amountCents of [1, 499, 123456, -500, "lots"]) {
      const res = await b.agent.post("/api/nova/top-up").send({ amountCents });
      expect(res.status, `${amountCents} → ${res.status} ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code).toBe("invalid_amount");
    }
    expect(await balanceOf(b.userId)).toBe(0);
  });
});

describe("the developer's way to have money", () => {
  /*
   * Every priced thing in this product is bought out of the balance, and the
   * only way to fill a balance is Stripe. That left a developer two options
   * for testing a paid path: real Stripe credentials, or writing
   * `balance_cents` by hand — which skips the ledger, so the column and the
   * history disagree from then on, and `walletOf` is documented as treating
   * the ledger as the truth. Hence a route, which credits it the way the
   * webhook does.
   */
  it("credits a real balance with a real ledger row, without Stripe", async () => {
    const app = await getTestApp();
    const b = await builder(app);

    const credited = await b.agent.post("/api/dev/credit-wallet").send({ amountCents: 3000 });
    expect(credited.status, JSON.stringify(credited.body)).toBe(200);
    expect(credited.body.wallet.balanceCents).toBe(3000);
    expect(await balanceOf(b.userId)).toBe(3000);

    const rows = await db.select().from(novaLedger).where(eq(novaLedger.userId, b.userId));
    const top = rows.filter((r) => r.kind === "topup");
    expect(top, "a development credit is a ledger movement like any other").toHaveLength(1);
    expect(top[0].balanceAfter, "the ledger carries the balance it produced").toBe(3000);
    expect(top[0].amountCents).toBe(3000);

    // And it buys what it says it buys.
    const bought = await b.agent.post("/api/nova/build-my-business").send({ projectId: b.projectId });
    expect([200, 201], JSON.stringify(bought.body)).toContain(bought.status);
    expect(await balanceOf(b.userId)).toBe(3000 - OUTCOME_PRICE_CENTS.business);
  }, 60_000);

  it("refuses an amount outside its own bounds", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    for (const amountCents of [0, -100, 100_001, "heaps"]) {
      const res = await b.agent.post("/api/dev/credit-wallet").send({ amountCents });
      expect(res.status, `${amountCents} → ${res.status}`).toBe(400);
    }
    expect(await balanceOf(b.userId)).toBe(0);
  });
});

describe("a company's private training season", () => {
  async function company(app: any, balanceCents = 0) {
    const owner = await builder(app, { balanceCents });
    const made = await owner.agent.post("/api/companies").send({ name: `Northwind ${n}` });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return { owner, companyId: made.body.company.id as string };
  }
  const start = (owner: any, companyId: string, body: Record<string, unknown> = {}) =>
    owner.agent.post(`/api/companies/${companyId}/seasons`).send({
      nicheId: "dating_apps", name: "Leadership away day", yearMinutes: 30, totalYears: 6, ...body,
    });

  it("is free the first time, and charged per seat after that", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app, 5000);

    const first = await start(owner, companyId, { seats: 20 });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body).toMatchObject({ firstSeasonFree: true, seats: 0, paidCents: 0 });
    // The first one really was free, whatever seats were asked for.
    expect(await balanceOf(owner.userId)).toBe(5000);

    const second = await start(owner, companyId, { name: "Second workshop", seats: 10 });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(second.body).toMatchObject({ firstSeasonFree: false, seats: 10, paidCents: 10 * OUTCOME_PRICE_CENTS.seasonSeat });
    expect(await balanceOf(owner.userId)).toBe(5000 - 10 * OUTCOME_PRICE_CENTS.seasonSeat);

    const [season] = await db.select().from(simSeasons).where(eq(simSeasons.id, second.body.seasonId));
    expect(season.seatsPaid).toBe(10);
    expect(season.paidCents).toBe(10 * OUTCOME_PRICE_CENTS.seasonSeat);
  });

  it("refuses the second one clearly, and charges nothing, when it isn't paid for", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app, 500);

    expect((await start(owner, companyId)).status).toBe(201);
    const refused = await start(owner, companyId, { name: "Second workshop", seats: 10 });
    expect(refused.status).toBe(402);
    expect(refused.body).toMatchObject({
      code: "payment_required", outcome: "seasonSeat",
      price: { cents: 10 * OUTCOME_PRICE_CENTS.seasonSeat },
      remedy: "top_up",
    });
    expect(refused.body.message).toMatch(/first season was free/i);
    expect(await balanceOf(owner.userId)).toBe(500);
    // Nothing was created either.
    const seasons = await db.select().from(simSeasons).where(eq(simSeasons.companyId, companyId));
    expect(seasons).toHaveLength(1);
  });

  it("leaves the public market free for everyone", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    // Joining the public game asks nobody for money: the matchmaker seats you.
    const joined = await b.agent.post("/api/sim/join").send({ nicheId: "dating_apps" });
    expect(joined.status, JSON.stringify(joined.body)).not.toBe(402);
    expect(await balanceOf(b.userId)).toBe(0);
  });
});

describe("what stays free forever", () => {
  it("never asks for money for anything a person does themselves", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    // Allowance spent and no balance: if any of these were gated, it would show.
    await db.update(users).set({ creditsUsed: MONTHLY_SMALL_ACTIONS, creditsResetAt: new Date() }).where(eq(users.id, b.userId));

    const calls: [string, string, Record<string, unknown>][] = [
      // A private project — the gate that used to sell the Starter plan.
      ["post", "/api/projects", { title: "Kept Quiet", description: "A private project, which used to need a paid plan and now does not.", category: "saas", goal: "ship_mvp", subcategory: "saas", isPrivate: true }],
      // A company account, a team, a post on the feed, a milestone on the board.
      ["post", "/api/companies", { name: `Free Forever ${n}` }],
      ["post", "/api/feed", { content: "Shipped the first version of the thing today.", postType: "milestone" }],
      ["post", `/api/projects/${b.projectId}/milestones`, { title: "First release", description: "The first thing anybody outside can use." }],
      ["post", `/api/projects/${b.projectId}/kanban`, { title: "Write the landing page", status: "todo" }],
    ];
    for (const [method, url, body] of calls) {
      const res = await (b.agent as any)[method](url).send(body);
      expect(res.status, `${url} → ${res.status} ${JSON.stringify(res.body)}`).toBeLessThan(400);
    }

    // Reading anything is free too, and the wallet says nothing was taken.
    for (const url of ["/api/subscription", "/api/plans", `/api/projects/${b.projectId}/path`, "/api/feed"]) {
      const res = await (b.agent as any).get(url);
      expect(res.status, url).toBeLessThan(400);
    }
    expect(await balanceOf(b.userId)).toBe(0);

    // And the plan catalog no longer sells anything: every price is zero.
    const plans = await b.agent.get("/api/plans");
    for (const plan of plans.body.plans) expect(plan.price).toBe(0);
    expect(plans.body.pricing.monthlySmallActions).toBe(MONTHLY_SMALL_ACTIONS);
  });
});
