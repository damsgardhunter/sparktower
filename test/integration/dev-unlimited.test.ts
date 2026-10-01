/**
 * The developer's switch, and the two gates that keep it out of production.
 *
 * This replaced a dropdown of four tiers that were all free — a leftover from
 * when the product sold subscriptions, which could not do the one thing it
 * existed for. What is guarded here is not really the convenience; it is that
 * a column which turns off billing cannot be reached, or honoured, on a
 * production server.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users } from "@shared/schema";
import { MONTHLY_SMALL_ACTIONS } from "@shared/plans";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function dev(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `203.0.117.${(n % 200) + 20}`;
  const email = `dev-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: "Dee" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, ip);
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  return { agent, id: res.body.id as string };
}

const walletOf = async (agent: any) => (await agent.get("/api/nova/wallet")).body.wallet;

describe("the developer switch", () => {
  it("is off to begin with, and says so in the wallet", async () => {
    const app = await getTestApp();
    const me = await dev(app);
    expect((await walletOf(me.agent)).devUnlimited).toBe(false);
  });

  it("stops the allowance moving, so the same action can be run all day", async () => {
    /*
     * The thing the tier dropdown could not do. Twenty-five small actions a
     * month runs out halfway through testing a flow, and before this the only
     * way on was to buy a pack with money that also had to be faked.
     */
    const app = await getTestApp();
    const me = await dev(app);
    await db.update(users).set({ creditsUsed: MONTHLY_SMALL_ACTIONS - 3, creditsResetAt: new Date() })
      .where(eq(users.id, me.id));

    const on = await me.agent.post("/api/dev/unlimited").send({ on: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.devUnlimited).toBe(true);
    expect((await walletOf(me.agent)).devUnlimited).toBe(true);

    const before = (await walletOf(me.agent)).allowanceRemaining;
    const project = (await me.agent.post("/api/projects").send({
      title: "Dev Loop", description: "A project for running the same small action more than twenty-five times.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    for (let i = 0; i < 5; i += 1) {
      const res = await me.agent.post(`/api/projects/${project.id}/nova-guide`).send({ message: "again" });
      expect(res.status, `run ${i + 1}: ${JSON.stringify(res.body)}`).not.toBe(402);
    }
    expect((await walletOf(me.agent)).allowanceRemaining, "the allowance never moved").toBe(before);
  });

  it("goes back to charging when it is turned off", async () => {
    const app = await getTestApp();
    const me = await dev(app);
    await me.agent.post("/api/dev/unlimited").send({ on: true });
    const off = await me.agent.post("/api/dev/unlimited").send({ on: false });
    expect(off.body.devUnlimited).toBe(false);
    expect((await walletOf(me.agent)).devUnlimited).toBe(false);
  });

  it("is never on in production, whatever the column says", async () => {
    /*
     * The second gate, and the one that matters. The route is unreachable in
     * production; this is about a row that got there another way — restored
     * from a development dump, say. The wallet must not report it, and
     * requireCredits must not honour it.
     */
    const app = await getTestApp();
    const me = await dev(app);
    await db.update(users).set({ devUnlimited: true }).where(eq(users.id, me.id));
    expect((await walletOf(me.agent)).devUnlimited, "on in development").toBe(true);

    const was = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect((await walletOf(me.agent)).devUnlimited, "and never in production").toBe(false);
    } finally {
      process.env.NODE_ENV = was;
    }
  });
});

describe("un-buying a project", () => {
  it("refuses a project that isn't yours", async () => {
    const app = await getTestApp();
    const mine = await dev(app);
    const theirs = await dev(app);
    const project = (await mine.agent.post("/api/projects").send({
      title: "Not Yours", description: "A project belonging to somebody else entirely, for the guard.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    const res = await theirs.agent.post("/api/dev/forget-purchases").send({ projectId: project.id });
    expect(res.status).toBe(403);
  });

  it("says what it removed, and nothing when there was nothing", async () => {
    const app = await getTestApp();
    const me = await dev(app);
    const project = (await me.agent.post("/api/projects").send({
      title: "Nothing Bought", description: "A project that has never bought anything at all, for the empty case.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    const res = await me.agent.post("/api/dev/forget-purchases").send({ projectId: project.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.forgotten).toMatchObject({ buildPasses: 0, scenarios: 0, outlooks: 0, schemes: 0 });
  });

  it("takes the build pass back, so the card can be bought again", async () => {
    /*
     * The reason this exists. Buying the whole-business build writes a pass,
     * the card reads the pass, and there was no way to un-write it — so
     * testing the purchase was one shot per project and the way to do it twice
     * was to make another project.
     */
    const app = await getTestApp();
    const me = await dev(app);
    const project = (await me.agent.post("/api/projects").send({
      title: "Buy It Twice", description: "A project for buying the whole-business build more than once.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    await db.update(users).set({ balanceCents: 10_000 }).where(eq(users.id, me.id));

    const bought = await me.agent.post("/api/nova/build-my-business").send({ projectId: project.id });
    expect(bought.status, JSON.stringify(bought.body)).toBe(201);
    expect((await me.agent.get("/api/nova/wallet")).body.buildPasses).toContain(project.id);

    const forgot = await me.agent.post("/api/dev/forget-purchases").send({ projectId: project.id });
    expect(forgot.status).toBe(200);
    expect(forgot.body.forgotten.buildPasses).toBe(1);
    expect((await me.agent.get("/api/nova/wallet")).body.buildPasses, "the pass is gone").not.toContain(project.id);
  }, 120_000);
});

/**
 * And the half of the switch that was missing: what the *screen* is told.
 *
 * `requireCredits` has honoured the flag for a while, so nothing was ever billed
 * on these accounts — but `GET /api/subscription` worked its answer out from the
 * month's allowance alone, and every piece of client credit state derives from
 * that answer: `creditState`, the "out of credits" dialog `queryClient` raises
 * globally for any route, the upgrade nag, the low-credit warning. So once the
 * allowance ran out the interface said "out of credits" and offered to sell more
 * of something already free, while the server would have served the request
 * perfectly well had anything asked it.
 *
 * That is the worst shape a bypass can have: working, and looking broken. The
 * account it was reported on had 1068 actions against an allowance of 25.
 */
describe("what the developer switch tells the client", () => {
  /** Spent well past the month's allowance, which is where this became visible. */
  const spendEverything = (userId: string) =>
    db.update(users)
      /*
       * `creditsResetAt` as well as the count: `getUserSubscription` calls
       * `resetCreditsIfNeeded` first, which zeroes the counter whenever that date
       * is null or in an earlier month — so on a freshly registered account,
       * setting `creditsUsed` alone is undone before anything reads it.
       */
      .set({ creditsUsed: MONTHLY_SMALL_ACTIONS * 40, creditsResetAt: new Date() })
      .where(eq(users.id, userId));

  it("reads as out of credits without it, which is what everybody else gets", async () => {
    const app = await getTestApp();
    const me = await dev(app);
    await spendEverything(me.id);

    const res = await me.agent.get("/api/subscription");
    expect(res.status).toBe(200);
    expect(res.body.unlimited).toBe(false);
    expect(res.body.creditsRemaining).toBe(0);
    expect(res.body.creditState, "an ordinary account really is out").toBe("out");
  });

  /*
   * The regression. Each of these is read by something that puts a wall in front
   * of the person, so each has to agree with the charge that will never happen.
   */
  it("reads as unlimited with it, so nothing offers to sell it anything", async () => {
    const app = await getTestApp();
    const me = await dev(app);
    await spendEverything(me.id);
    expect((await me.agent.post("/api/dev/unlimited").send({ on: true })).status).toBe(200);

    const res = await me.agent.get("/api/subscription");
    expect(res.body.unlimited, "the flag has to reach the client").toBe(true);
    expect(res.body.devUnlimited, "and say why, so the UI can label it").toBe(true);
    expect(res.body.creditsRemaining, "-1 is the client's Infinity").toBe(-1);
    expect(res.body.creditsLimit).toBe(-1);
    expect(res.body.creditState, "never 'out', whatever the allowance says").toBe("ok");
    expect(res.body.lowCreditsAt, "and no low-credit warning either").toBeNull();
  });

  /* The same second gate the charge has: a flag in a production database is ignored. */
  it("still reads as out in production, however the column got there", async () => {
    const app = await getTestApp();
    const me = await dev(app);
    await spendEverything(me.id);
    await db.update(users).set({ devUnlimited: true }).where(eq(users.id, me.id));

    const was = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await me.agent.get("/api/subscription");
      expect(res.body.unlimited).toBe(false);
      expect(res.body.creditState).toBe("out");
    } finally {
      process.env.NODE_ENV = was;
    }
  });
});
