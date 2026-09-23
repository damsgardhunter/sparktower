/**
 * The screen that says where the AI money went.
 *
 * Two claims. It answers — a console nobody drives is a 500 waiting for the
 * morning something goes wrong, which is the morning you need it. And it is
 * the owner's alone: it names people, what they spent and what they pay, which
 * is not a thing to hand to anyone who finds the URL.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { passMfa } from "../helpers/mfa";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { aiSpend } from "@shared/schema";
import { forgetPlatformSpend } from "../../server/ai-spend";
import { ENTITLEMENTS } from "@shared/plans";
import { forgetAiSettings } from "../../server/ai-settings";

let ownerEmail = "";
const previousOwner = process.env.PLATFORM_OWNER_EMAIL;
beforeAll(() => { ownerEmail = `spend-owner-${Date.now()}@example.test`; process.env.PLATFORM_OWNER_EMAIL = ownerEmail; });

const written: string[] = [];
afterAll(async () => {
  if (written.length) await db.delete(aiSpend).where(inArray(aiSpend.id, written));
  if (previousOwner === undefined) delete process.env.PLATFORM_OWNER_EMAIL;
  else process.env.PLATFORM_OWNER_EMAIL = previousOwner;
  await closeTestApp();
});

let n = 0;
const ip = () => `198.51.118.${20 + (n++ % 200)}`;

async function person(app: any, first: string, email?: string) {
  n += 1;
  const agent = request.agent(app);
  const address = email ?? `spend-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  expect((await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email: address, password: "Testpass123!", firstName: first })).status).toBe(201);
  await verifyEmail(app, address, ip());
  return { agent, email: address, id: "" };
}

const SCREENS = ["today", "daily", "sections", "people", "free-tier", "settings"];

describe("the AI spend console", () => {
  it("answers on every screen, and counts what was actually spent", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner", ownerEmail);
    await passMfa(owner.agent);

    // A day's worth of spend, from two people on two different things.
    const me = await person(app, "Spender");
    const [a, b] = await db.insert(aiSpend).values([
      { userId: `spend-a-${Date.now()}`, action: "codeAudit", credits: 8, promptTokens: 300_000, cachedTokens: 150_000, completionTokens: 900, model: "gpt-5.2" },
      { userId: `spend-b-${Date.now()}`, action: "novaChat", credits: 1, promptTokens: 5_000, cachedTokens: 4_000, completionTokens: 300, model: "gpt-5.2" },
    ]).returning({ id: aiSpend.id });
    written.push(a.id, b.id);
    forgetPlatformSpend();

    for (const screen of SCREENS) {
      const res = await owner.agent.get(`/api/admin/ai-spend/${screen}`);
      expect(res.status, `${screen}: ${res.text?.slice(0, 200)}`).toBe(200);
    }

    // The dearest section first, with the context each call carries.
    const sections = (await owner.agent.get("/api/admin/ai-spend/sections?days=1")).body;
    const audit = sections.rows.find((r: any) => r.action === "codeAudit");
    expect(audit, "the audit shows up").toBeTruthy();
    expect(audit.credits).toBeGreaterThanOrEqual(8);
    expect(audit.tokensPerCall, "the context it carries, which is why it is dear").toBeGreaterThan(100_000);
    expect(audit.cacheRate, "half its prompt came from cache").toBe(50);
    expect(sections.rows[0].action, "sorted by what it cost, not how often it ran").toBe("codeAudit");

    // The day, against the brake.
    const today = (await owner.agent.get("/api/admin/ai-spend/today")).body;
    expect(today.spentUsd).toBeGreaterThan(0);
    expect(today.ceilingUsd).toBeGreaterThan(0);
    expect(today.freeCutoffUsd).toBeLessThan(today.ceilingUsd);

    // Who spent it, and how far through their month they are.
    const people = (await owner.agent.get("/api/admin/ai-spend/people?days=1")).body;
    const top = people.rows[0];
    expect(top.credits, "the biggest spender first").toBeGreaterThanOrEqual(8);
    expect(top.tier).toBe("free");
    expect(top.monthlyAllowance).toBe(ENTITLEMENTS.free.credits);
    expect(top.allowanceUsed, "eight of twenty free credits").toBe(40);

    // And the free tier as a block, which is the launch-day exposure.
    const free = (await owner.agent.get("/api/admin/ai-spend/free-tier?days=1")).body;
    expect(free.allowance).toBe(ENTITLEMENTS.free.credits);
    expect(free.people).toBeGreaterThanOrEqual(2);
    expect(free.ifAllExhaustedUsd).toBeGreaterThan(free.costUsd);
    void me;
  }, 120_000);

  it("tells anyone else it does not exist", async () => {
    const app = await getTestApp();
    const nosy = await person(app, "Nosy");
    for (const screen of SCREENS) {
      const res = await nosy.agent.get(`/api/admin/ai-spend/${screen}`);
      expect(res.status, `${screen} must not answer a stranger`).toBe(404);
    }
    // And signed out entirely.
    const app2 = await getTestApp();
    for (const screen of SCREENS) {
      expect((await request(app2).get(`/api/admin/ai-spend/${screen}`)).status).toBe(401);
    }
  }, 120_000);
});

/**
 * The two numbers everything derives from, changed from the console rather
 * than from a deploy. Cost per credit has been measured at four cents and at
 * two and both were right, so it has to be a setting.
 */
describe("tuning the economics", () => {
  it("re-costs the whole ladder when the cost per credit changes", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Tuner", ownerEmail);
    await passMfa(owner.agent);

    const dear = await owner.agent.put("/api/admin/ai-spend/settings")
      .send({ costPerCreditUsd: 0.04, dailySpendCapUsd: 250 });
    expect(dear.status, dear.text?.slice(0, 200)).toBe(200);
    const atFour = dear.body.ladder;

    const cheap = await owner.agent.put("/api/admin/ai-spend/settings")
      .send({ costPerCreditUsd: 0.02, dailySpendCapUsd: 250 });
    expect(cheap.status).toBe(200);
    const atTwo = cheap.body.ladder;

    // Halving the cost doubles what every price can carry.
    for (let i = 0; i < atTwo.length; i++) {
      expect(atTwo[i].capPerDay, `${atTwo[i].name} carries more`).toBeGreaterThan(atFour[i].capPerDay);
      expect(atTwo[i].profit).toBeGreaterThan(atFour[i].profit);
    }
    // And every tier still clears its own user's use.
    for (const rung of atTwo) {
      expect(rung.profit, `${rung.name} is profitable on the builder it is for`).toBeGreaterThan(0);
      expect(rung.worstMonth, `${rung.name} cannot lose money in its worst month`)
        .toBeLessThanOrEqual(rung.priceMonthly);
    }
  }, 120_000);

  it("changes what the day's ceiling actually is, not just what it says", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Braker", ownerEmail);
    await passMfa(owner.agent);

    await owner.agent.put("/api/admin/ai-spend/settings").send({ costPerCreditUsd: 0.02, dailySpendCapUsd: 42 });
    forgetAiSettings();
    const today = (await owner.agent.get("/api/admin/ai-spend/today")).body;
    expect(today.ceilingUsd).toBe(42);
    expect(today.costPerCredit).toBe(0.02);
    expect(today.freeCutoffUsd).toBeLessThan(42);
  }, 120_000);

  it("refuses a number that would switch the economics off", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Fatfinger", ownerEmail);
    await passMfa(owner.agent);

    for (const body of [
      { costPerCreditUsd: 0, dailySpendCapUsd: 250 },
      { costPerCreditUsd: -1, dailySpendCapUsd: 250 },
      { costPerCreditUsd: 5, dailySpendCapUsd: 250 },
      { costPerCreditUsd: "nonsense", dailySpendCapUsd: 250 },
      { costPerCreditUsd: 0.02, dailySpendCapUsd: -5 },
      { costPerCreditUsd: 0.02, dailySpendCapUsd: 10_000_000 },
    ]) {
      const res = await owner.agent.put("/api/admin/ai-spend/settings").send(body);
      expect(res.status, `${JSON.stringify(body)} should be refused`).toBe(400);
      expect(res.body.code).toBe("invalid_input");
    }
  }, 120_000);

  it("is the owner's alone to change", async () => {
    const app = await getTestApp();
    const nosy = await person(app, "Nosy2");
    expect((await nosy.agent.put("/api/admin/ai-spend/settings")
      .send({ costPerCreditUsd: 0.000001, dailySpendCapUsd: 0 })).status).toBe(404);
  }, 120_000);
});
