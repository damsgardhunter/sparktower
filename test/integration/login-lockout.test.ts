/**
 * Repeated sign-in failures lock the ACCOUNT, not just the address.
 *
 * Without this test, the site could keep only the per-address limit and look
 * protected. It wouldn't be: credential stuffing arrives from thousands of
 * addresses making two or three attempts each, and every one of them stays
 * under an 8-per-15-minutes IP budget forever. The per-account counter is the
 * only thing that sees that shape, and it is invisible from any single
 * request — the 429 it produces looks exactly like the IP one. So the test has
 * to do the thing an attacker does (spread the guesses across addresses) and
 * then show the lock followed the account.
 *
 * The second assertion is the one that carries the meaning: an unrelated
 * account signing in fine from an address that just failed a dozen times. An
 * implementation that had quietly regressed to banning the IP would pass every
 * other check in this file and fail that one.
 */
import { describe, it, expect, afterAll } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { RATE_LIMITS, RATE_LIMITED } from "@shared/moderation";
import { db } from "../../server/db";
import { rateLimitHits } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";

afterAll(async () => { await closeTestApp(); });

const PASSWORD = "Testpass123!";
const WRONG = "Wrongpass123!";

/** Read from the policy rather than written down here, so the test moves when the limit does. */
const PER_ACCOUNT = RATE_LIMITS.loginAccount.max;
const PER_IP = RATE_LIMITS.login.max;

/**
 * How many guesses one address contributes.
 *
 * Half its budget, so that the address still has room afterwards for the
 * attempts that prove the point — the locked account's correct password, and
 * the unrelated account's successful sign-in. Registration and every refused
 * attempt also spend from this budget, which is why it isn't simply `PER_IP`.
 */
const PER_ADDRESS = Math.max(1, Math.floor(PER_IP / 2));

/** Addresses the guesses come from. Enough of them to carry PER_ACCOUNT guesses at PER_ADDRESS each. */
const attackerIps = Array.from(
  { length: Math.ceil(PER_ACCOUNT / PER_ADDRESS) },
  (_, i) => `192.0.2.${10 + i}`,
);

/**
 * Waits until the account's failures have actually been recorded.
 *
 * The attempt is reserved before the password is checked, so by the time a
 * 401 comes back the row is committed and this returns immediately. It used to
 * be load-bearing, when failures were counted after the response with a
 * fire-and-forget write and the next request could beat the write into the
 * counter. It stays as a barrier rather than an assertion: it asks for the
 * state the next assertion is about instead of assuming it, and it is what
 * fails loudly if counting ever goes back to being asynchronous.
 */
async function recordedFailures(email: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(rateLimitHits)
    .where(and(eq(rateLimitHits.userId, `account:${email}`), eq(rateLimitHits.action, "loginAccount")));
  return Number(row?.n ?? 0);
}

async function awaitFailureCount(email: string, wanted: number): Promise<void> {
  for (let tries = 0; tries < 100; tries++) {
    if (await recordedFailures(email) >= wanted) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(await recordedFailures(email), "failures never reached the limiter").toBeGreaterThanOrEqual(wanted);
}

async function register(app: Express, email: string, ip: string): Promise<void> {
  const res = await request(app).post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: PASSWORD, firstName: "Sam" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

describe("failed sign-ins against one account", () => {
  it("lock that account even from a fresh address, and leave other accounts on those addresses alone", async () => {
    const app = await getTestApp();
    const victim = `lockout-victim-${Date.now()}@example.test`;
    const bystander = `lockout-bystander-${Date.now()}@example.test`;
    // Registered from their own addresses, so neither sign-up spends the budget the guesses need.
    await register(app, victim, "192.0.2.1");
    await register(app, bystander, "192.0.2.2");

    for (let attempt = 0; attempt < PER_ACCOUNT; attempt++) {
      // Rotating the address is the whole premise: no single one gets close to
      // its own limit, so anything that refuses later did it on the account.
      const ip = attackerIps[attempt % attackerIps.length];
      const failed = await request(app).post("/api/auth/login")
        .set("x-forwarded-for", ip).send({ email: victim, password: WRONG });
      expect(failed.status, `attempt ${attempt} from ${ip}`).toBe(401);
    }
    await awaitFailureCount(victim, PER_ACCOUNT);

    /*
     * The correct password, from an address with budget to spare. A password
     * that works and is still refused is the lock: nothing else in the stack
     * can produce this.
     */
    const locked = await request(app).post("/api/auth/login")
      .set("x-forwarded-for", attackerIps[0]).send({ email: victim, password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ code: RATE_LIMITED, action: "loginAccount" });
    expect(locked.headers["retry-after"]).toBeTruthy();

    // And the point of a per-account lock: the address is not banned. Somebody
    // else behind the same NAT, café wifi or phone carrier signs in normally.
    const unaffected = await request(app).post("/api/auth/login")
      .set("x-forwarded-for", attackerIps[0]).send({ email: bystander, password: PASSWORD });
    expect(unaffected.status, JSON.stringify(unaffected.body)).toBe(200);
  }, 60_000);
});

describe("a burst of sign-ins from one address", () => {
  // Its own address, and its own test: the counters live in one table keyed by
  // address, so sharing either with the case above would make each one's
  // refusal ambiguous.
  it("trips the per-address limit even though no single account is being guessed at", async () => {
    const app = await getTestApp();
    const ip = "192.0.2.200";

    let last = await request(app).post("/api/auth/login").set("x-forwarded-for", ip)
      .send({ email: `burst-0-${Date.now()}@example.test`, password: WRONG });
    for (let attempt = 1; attempt <= PER_IP; attempt++) {
      // A different account every time, so the per-account counter never gets
      // above one and can't be what refuses.
      last = await request(app).post("/api/auth/login").set("x-forwarded-for", ip)
        .send({ email: `burst-${attempt}-${Date.now()}@example.test`, password: WRONG });
    }

    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({ code: RATE_LIMITED, action: "login" });
  }, 60_000);
});

/**
 * The attack the per-account limit exists to stop doesn't queue politely.
 *
 * A credential-stuffing script opens many connections at once. While the limit
 * was "read the count, then record the failure", every request in a burst read
 * the same pre-burst count, found room under the maximum, and got a guess — a
 * limit of twelve let through as many guesses as the attacker opened sockets.
 * The attempt is reserved before the password is checked now, and refunded
 * when it turns out to be right.
 */
describe("a burst of simultaneous guesses", () => {
  it("spends the account's budget once, not once per connection", async () => {
    const app = await getTestApp();
    const victim = `burst-victim-${Date.now()}@example.test`;
    await register(app, victim, "192.0.2.90");

    // Comfortably more attempts than the limit, all in flight together, spread
    // across addresses so the per-IP limit isn't what refuses them.
    const burst = PER_ACCOUNT + 6;
    const results = await Promise.all(
      Array.from({ length: burst }, (_, i) =>
        request(app).post("/api/auth/login")
          .set("x-forwarded-for", `192.0.2.${100 + (i % 20)}`)
          .send({ email: victim, password: `wrong-guess-${i}` })
          .then((r) => r.status)),
    );

    const allowedThrough = results.filter((s) => s === 401).length;
    const refused = results.filter((s) => s === 429).length;

    expect(allowedThrough + refused).toBe(burst);
    // The budget, and not a guess more, however many arrived at once.
    expect(allowedThrough).toBeLessThanOrEqual(PER_ACCOUNT);
    expect(refused).toBeGreaterThan(0);

    // And the correct password is refused too: the account is locked, not the guesses.
    const after = await request(app).post("/api/auth/login")
      .set("x-forwarded-for", "192.0.2.150")
      .send({ email: victim, password: PASSWORD });
    expect(after.status).toBe(429);
  }, 120_000);
});
