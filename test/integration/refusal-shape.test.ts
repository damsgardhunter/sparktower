/**
 * Every refusal looks the same, and says when to come back.
 *
 * There are five ways to be refused here — the middleware, the global write
 * floor, the in-handler check, the atomic reservation, and the failures-only
 * limiter — plus a handful of places that count something themselves: invites
 * per project per day, live verification links, a month's fair-use ceiling. A
 * client can only have one piece of code for "you are being told to wait" if
 * being told to wait is one thing, and the field that says *how long* is the
 * one that was most often missing: the hand-rolled ones sent a status and a
 * sentence and nothing else.
 *
 * So this asks every path the same questions from the outside: the status, the
 * fields, and the `Retry-After` header — which is what an app, a script or a
 * queue actually reads.
 *
 * The documented exception is 409 duplicate content, which deliberately has no
 * Retry-After: waiting changes nothing, because the same text sent again in a
 * minute is still the same text.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { rateLimitHits, users } from "@shared/schema";
import { RATE_LIMITED, RATE_LIMITS, type RateLimitAction } from "@shared/moderation";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;

async function builder(app: any) {
  const agent = request.agent(app);
  n += 1;
  const email = `refuse-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const ip = `198.51.240.${(n % 200) + 20}`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip).send({ email, password });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, email, ip };
}

/** Fill an action's window for a key, so the next request through it is refused. */
async function fillLimit(key: string, action: RateLimitAction) {
  const { max } = RATE_LIMITS[action];
  await db.insert(rateLimitHits).values(
    Array.from({ length: max + 2 }, () => ({ userId: key, action, createdAt: new Date() })) as any,
  );
}

/**
 * What every refusal has to carry.
 *
 * `code` is allowed to be more specific than "rate_limited" — the fair-use
 * ceiling keeps its own, because the phone sends that one to the pricing
 * screen rather than to a clock — but the shape around it is fixed.
 */
function expectRefusal(res: request.Response, where: string, opts: { code?: string } = {}) {
  expect([429, 503], `${where} refuses with a waiting status`).toContain(res.status);
  expect(res.body.message, `${where} says something a person can read`).toBeTruthy();
  expect(typeof res.body.message).toBe("string");
  expect(res.body.code, `${where} carries a machine-readable code`).toBeTruthy();
  if (opts.code) expect(res.body.code, `${where} keeps its own code`).toBe(opts.code);
  expect(res.body.action, `${where} says which limit`).toBeTruthy();

  expect(typeof res.body.retryAfterSeconds, `${where} says how long in seconds`).toBe("number");
  expect(res.body.retryAfterSeconds).toBeGreaterThan(0);

  const header = res.headers["retry-after"];
  expect(header, `${where} sets the Retry-After header — the thing a client actually reads`).toBeTruthy();
  expect(Number(header), `${where}'s header agrees with its body`).toBe(res.body.retryAfterSeconds);
}

describe("the shape of being refused", () => {
  it("from the middleware on a route", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    /*
     * A hit-counted action, so filling the table is enough to fill the window.
     * The content-counted limits — projects, posts, comments — are counted
     * from the rows they create, and would need the rows themselves; those are
     * covered by the suites for each of those features.
     */
    await fillLimit(me.id, "workspace");
    const res = await me.agent.post("/api/reputation/calculate").send({});
    expectRefusal(res, "the middleware", { code: RATE_LIMITED });
    expect(res.body.action).toBe("workspace");
    expect(typeof res.body.retryAfterMinutes, "and in minutes, for anything that only speaks minutes").toBe("number");
  }, 120_000);

  it("from the global write floor, which catches everything without its own limit", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    await fillLimit(me.id, "write");
    const res = await me.agent.patch("/api/profile").send({ headline: "Anything at all" });
    expectRefusal(res, "the write floor", { code: RATE_LIMITED });
    expect(res.body.action).toBe("write");
  }, 120_000);

  it("from a check inside a handler", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    await fillLimit(me.id, "session");
    // Any route whose handler calls enforceRateLimit(… "session") itself.
    const res = await me.agent.post("/api/auth/mfa/setup").send({});
    expectRefusal(res, "an in-handler check", { code: RATE_LIMITED });
    expect(res.body.action).toBe("session");
  }, 120_000);

  it("from the reservation that sign-in takes atomically", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    await fillLimit(`account:${me.email.toLowerCase()}`, "loginAccount");
    const res = await request(app).post("/api/auth/login")
      .set("x-forwarded-for", `198.51.241.${(n % 200) + 20}`)
      .send({ email: me.email, password });
    expectRefusal(res, "the sign-in reservation", { code: RATE_LIMITED });
    expect(res.body.action).toBe("loginAccount");
  }, 120_000);

  it("from a limit that counts failures only", async () => {
    const app = await getTestApp();
    const ip = `198.51.242.${(n++ % 200) + 20}`;
    await fillLimit(`ip:${ip}`, "webhookReject");
    const res = await request(app).post("/api/stripe/webhook")
      .set("x-forwarded-for", ip).set("stripe-signature", "nonsense").send({});
    expectRefusal(res, "the failures-only limiter", { code: RATE_LIMITED });
  }, 120_000);

  it("from a cap a handler counts for itself", async () => {
    const app = await getTestApp();
    /*
     * Unverified on purpose: the route answers "already verified" to anybody
     * whose address is confirmed, and the cap under test is on how many live
     * links one account may have at once.
     */
    n += 1;
    const agent = request.agent(app);
    const email = `refuse-links-${Date.now()}-${n}@example.test`;
    const made = await agent.post("/api/auth/register")
      .set("x-forwarded-for", `198.51.243.${(n % 200) + 20}`).send({ email, password });
    expect(made.status).toBe(201);
    const me = { agent };
    /*
     * Five live verification links: the sixth is refused by the route's own
     * count rather than by any limiter, and used to answer with a status, a
     * sentence, and nothing a client could act on.
     */
    for (let i = 0; i < 6; i++) {
      const res = await me.agent.post("/api/auth/verify-email/send").send({});
      if (res.status === 429) {
        expectRefusal(res, "a hand-counted cap", { code: "too_many_links" });
        expect(res.body.action, "it names a limit, so a client can group it with the rest").toBeTruthy();
        return;
      }
    }
    throw new Error("the verification-link cap never fired");
  }, 180_000);
});

describe("the exception, on purpose", () => {
  it("says 409 with no Retry-After when waiting would change nothing", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const content = `The same words, twice. ${Date.now()}`;

    const first = await me.agent.post("/api/feed").send({ postType: "project_update", content });
    expect(first.status, JSON.stringify(first.body).slice(0, 200)).toBe(200);
    const again = await me.agent.post("/api/feed").send({ postType: "project_update", content });

    expect(again.status, "a duplicate is not a wait").toBe(409);
    expect(again.body.code).toBe("duplicate_content");
    expect(again.headers["retry-after"], "no Retry-After, because a minute later it is still the same text").toBeUndefined();
  }, 120_000);
});

describe("when the counter itself is down", () => {
  it("refuses the actions that must not run unmetered, in the same shape", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const { withinRateLimit } = await import("../../server/moderation");
    expect(typeof withinRateLimit).toBe("function");

    /*
     * Asked of the module rather than staged by breaking the database: the
     * 503 path is the same `refuse`, and what matters here is that it carries
     * the same fields and header as the 429 one.
     */
    const check = { ok: false as const, exempt: false, unavailable: true, used: 0, max: 0, retryAfterSeconds: 30 };
    const sent: any = { headers: {} as Record<string, string>, statusCode: 0, body: null, req: { path: "/x", method: "POST" } };
    sent.setHeader = (k: string, v: string) => { sent.headers[k] = v; };
    sent.status = (code: number) => { sent.statusCode = code; return sent; };
    sent.json = (body: any) => { sent.body = body; return sent; };

    const { refuseForTest } = await import("../../server/moderation");
    refuseForTest(sent, "key", "ai", check);
    expect(sent.statusCode).toBe(503);
    expect(sent.body.code).toBe("limit_unavailable");
    expect(sent.body.retryAfterSeconds).toBe(30);
    expect(sent.headers["Retry-After"]).toBe("30");
  }, 60_000);
});
