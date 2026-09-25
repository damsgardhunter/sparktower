/**
 * The floor under the API.
 *
 * The per-action limits in server/moderation.ts count content by author, so
 * they have nothing to say about reading: somebody pulling `/api/feed` ten
 * thousand times an hour writes nothing and trips nothing. Seventy-five public
 * endpoints had no ceiling of any kind.
 *
 * What is worth holding here is not the exact number — that is a judgement
 * call and will move — but the properties: that it refuses eventually, that it
 * says so in a way a client can act on, that an anonymous caller and a signed
 * in one do not share an allowance, and that the three paths which must never
 * be refused never are.
 *
 * The limiter is off under test by default (the suite drives thousands of
 * requests from one address and would throttle itself), so this file turns it
 * on for its own requests and puts it back afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { SIGNED_OUT_A_MINUTE, limiterEnabled } from "../../server/api-rate-limit";

const was = process.env.API_RATE_LIMIT;
beforeAll(() => { process.env.API_RATE_LIMIT = "1"; });
afterAll(async () => {
  if (was === undefined) delete process.env.API_RATE_LIMIT; else process.env.API_RATE_LIMIT = was;
  await closeTestApp();
});

/** A distinct address per test, so one test's spending is not another's. */
let n = 0;
const anAddress = () => `198.51.160.${(n += 1) % 250}`;

describe("the floor under the API", () => {
  it("is off under test unless asked for, so the suite doesn't throttle itself", () => {
    process.env.API_RATE_LIMIT = "0";
    expect(limiterEnabled()).toBe(false);
    delete process.env.API_RATE_LIMIT;
    expect(limiterEnabled(), "NODE_ENV=test means off by default").toBe(false);
    process.env.API_RATE_LIMIT = "1";
    expect(limiterEnabled()).toBe(true);
  });

  it("eventually refuses an anonymous caller, and says why", async () => {
    const app = await getTestApp();
    const ip = anAddress();
    let refused: request.Response | null = null;

    /*
     * One past the ceiling. The route is a cheap public read; what is being
     * tested is the floor, not the route.
     */
    for (let i = 0; i < SIGNED_OUT_A_MINUTE + 5; i += 1) {
      const res = await request(app).get("/api/feed/config").set("x-forwarded-for", ip);
      if (res.status === 429) { refused = res; break; }
    }

    expect(refused, `never refused in ${SIGNED_OUT_A_MINUTE + 5} requests`).not.toBeNull();
    expect(refused!.body.code).toBe("rate_limited");
    /* A client has to be able to tell this apart from being logged out or blocked. */
    expect(refused!.body.message).toMatch(/minute/i);
  }, 120_000);

  /*
   * The three that must never be refused. A monitor being told 429 is exactly
   * what it reports as an outage, and Stripe being turned away is money
   * arriving late or not at all.
   */
  it("never refuses the health check, however hard it is asked", async () => {
    const app = await getTestApp();
    const ip = anAddress();
    for (let i = 0; i < SIGNED_OUT_A_MINUTE + 20; i += 1) {
      const res = await request(app).get("/_health").set("x-forwarded-for", ip);
      expect(res.status, `refused at request ${i}`).toBe(200);
    }
  }, 120_000);

  /*
   * The webhook must never be turned away by *this* limiter. It is not exempt
   * from limiting altogether: it carries its own rejection limiter, which
   * refuses an address whose deliveries keep failing signature verification,
   * and that one is right to fire — these requests are all unsigned.
   *
   * So the property is which limiter answers. The per-action limiter names the
   * action it refused; the floor does not. If the floor ever starts answering
   * here, Stripe's *valid* deliveries would be dropped on volume alone, which
   * is money arriving late or never.
   */
  it("leaves the Stripe webhook to its own signature limiter", async () => {
    const app = await getTestApp();
    const ip = anAddress();
    let refusal: request.Response | null = null;

    for (let i = 0; i < SIGNED_OUT_A_MINUTE + 20; i += 1) {
      const res = await request(app).post("/api/stripe/webhook")
        .set("x-forwarded-for", ip).set("content-type", "application/json").send("{}");
      if (res.status === 429) { refusal = res; break; }
      expect(res.status, "an unsigned delivery is refused for its signature, not its volume").toBe(400);
    }

    if (refusal) {
      expect(refusal.body.action, "the floor answered where the signature limiter should have").toBe("webhookReject");
    }
  }, 120_000);

  /*
   * Two addresses do not share a bucket. Without this, one busy office behind
   * one NAT address could lock out everybody else on the internet — which is
   * what a limiter keyed on something too coarse actually does.
   */
  it("spends one caller's allowance without spending another's", async () => {
    const app = await getTestApp();
    const loud = anAddress();
    const quiet = anAddress();

    let loudRefused = false;
    for (let i = 0; i < SIGNED_OUT_A_MINUTE + 5; i += 1) {
      const res = await request(app).get("/api/feed/config").set("x-forwarded-for", loud);
      if (res.status === 429) { loudRefused = true; break; }
    }
    expect(loudRefused).toBe(true);

    const other = await request(app).get("/api/feed/config").set("x-forwarded-for", quiet);
    expect(other.status, "a second address inherited the first one's spending").not.toBe(429);
  }, 180_000);
});
