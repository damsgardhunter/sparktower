/**
 * Getting back into an account without the password.
 *
 * This flow hands out something that IS the account: anyone holding the link
 * can take it over. So the tests are mostly about the ways that goes wrong —
 * a link that works twice, a link that outlives its window, a link that keeps
 * working after a newer one is issued, a reset that leaves the intruder's
 * session alive, and a form that will happily tell a stranger which addresses
 * have accounts here.
 *
 * The last one is the quiet failure. A reset form that answers differently for
 * a known and an unknown address is an enumeration oracle anyone can query,
 * and nothing about it looks broken.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { passwordResetTokens, users, rateLimitHits } from "@shared/schema";
import { RESET_TTL_MINUTES } from "@shared/password-reset";
import { RATE_LIMITS } from "@shared/moderation";

afterAll(async () => { await closeTestApp(); });

const PASSWORD = "first-good-passphrase";
const NEXT = "a-different-good-passphrase";

let n = 0;
const ip = () => `203.0.114.${(++n % 200) + 20}`;

async function account(app: any): Promise<{ email: string; id: string; agent: any }> {
  const agent = request.agent(app);
  const email = `pr-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: PASSWORD, firstName: "Robin" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { email, id: res.body.id, agent };
}

/** Asks for a link and returns the token from it. Development hands it back in the response. */
async function requestLink(app: any, email: string): Promise<string> {
  const res = await request(app).post("/api/auth/forgot-password").set("x-forwarded-for", ip()).send({ email });
  expect(res.status).toBe(200);
  expect(res.body.devToken, "no token came back — the send failed").toBeTruthy();
  return res.body.devToken as string;
}

const signIn = (app: any, email: string, password: string) =>
  request(app).post("/api/auth/login").set("x-forwarded-for", ip()).send({ email, password });

const reset = (app: any, token: string, password: string) =>
  request(app).post("/api/auth/reset-password").set("x-forwarded-for", ip()).send({ token, password });

describe("asking for a reset link", () => {
  it("answers a stranger's address exactly as it answers a real one", async () => {
    const app = await getTestApp();
    const real = await account(app);

    const known = await request(app).post("/api/auth/forgot-password").set("x-forwarded-for", ip()).send({ email: real.email });
    const unknown = await request(app).post("/api/auth/forgot-password").set("x-forwarded-for", ip())
      .send({ email: `nobody-${Date.now()}@example.test` });

    expect(known.status).toBe(unknown.status);
    expect(known.body.message).toBe(unknown.body.message);
    // Everything a caller can see must match. The development token is the one
    // exception and never exists in production.
    const visible = (body: any) => { const { devToken, ...rest } = body; return rest; };
    expect(visible(known.body)).toEqual(visible(unknown.body));
  }, 30_000);

  it("stores the link as a hash, never the link itself", async () => {
    const app = await getTestApp();
    const person = await account(app);
    const token = await requestLink(app, person.email);

    const rows = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, person.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    // The working credential is not in the database in any form you could use.
    expect(rows[0].tokenHash).not.toBe(token);
    expect(JSON.stringify(rows[0])).not.toContain(token);
  }, 30_000);

  it("won't be used to fill one person's inbox", async () => {
    const app = await getTestApp();
    const victim = await account(app);
    const max = RATE_LIMITS.passwordReset.max;

    // Each request from a different address, so only the per-account limit can
    // be what stops it — the point being that a botnet can't mailbomb someone.
    const statuses: number[] = [];
    for (let i = 0; i < max + 2; i++) {
      statuses.push((await request(app).post("/api/auth/forgot-password")
        .set("x-forwarded-for", `203.0.115.${i + 10}`).send({ email: victim.email })).status);
    }
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(max);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  }, 60_000);
});

describe("using a reset link", () => {
  it("sets the new password, retires the old one, and works exactly once", async () => {
    const app = await getTestApp();
    const person = await account(app);
    const token = await requestLink(app, person.email);

    const done = await reset(app, token, NEXT);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.email).toBe(person.email);

    expect((await signIn(app, person.email, NEXT)).status).toBe(200);
    expect((await signIn(app, person.email, PASSWORD)).status).toBe(401);

    // The same link again is dead, and says so as "invalid" rather than
    // "expired" — it wasn't too late, it was already spent.
    const again = await reset(app, token, "yet-another-good-passphrase");
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("invalid");
    // And the password it set is still the one that works.
    expect((await signIn(app, person.email, NEXT)).status).toBe(200);
  }, 60_000);

  it("signs out every session and every device, including the one resetting", async () => {
    const app = await getTestApp();
    const person = await account(app);

    // A second browser, and a phone, both signed in before the reset.
    const other = request.agent(app);
    expect((await other.post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: person.email, password: PASSWORD })).status).toBe(200);
    const mobile = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", ip())
      .send({ email: person.email, password: PASSWORD, device: "test-phone" });
    expect(mobile.status).toBe(200);
    const bearer = mobile.body.accessToken as string;

    // Both work right now, so the assertions after the reset mean something.
    expect((await other.get("/api/auth/user")).status).toBe(200);
    expect((await request(app).get("/api/auth/user").set("Authorization", `Bearer ${bearer}`)).status).toBe(200);

    const token = await requestLink(app, person.email);
    const done = await reset(app, token, NEXT);
    expect(done.status).toBe(200);
    expect(done.body.sessionsEnded).toBeGreaterThanOrEqual(2);
    expect(done.body.devicesSignedOut).toBeGreaterThanOrEqual(1);

    /*
     * The whole point of the flow for someone who has been compromised: the
     * intruder's session dies with the password. Unlike a password *change*,
     * no session is spared — a reset can't assume the person doing it is the
     * one holding any particular cookie.
     */
    expect((await other.get("/api/auth/user")).status).toBe(401);
    expect((await request(app).get("/api/auth/user").set("Authorization", `Bearer ${bearer}`)).status).toBe(401);
    expect((await person.agent.get("/api/auth/user")).status).toBe(401);
  }, 60_000);

  it("kills the other links that were outstanding", async () => {
    const app = await getTestApp();
    const person = await account(app);

    const first = await requestLink(app, person.email);
    const second = await requestLink(app, person.email);

    expect((await reset(app, second, NEXT)).status).toBe(200);
    // Asking twice and using one shouldn't leave a working key in the inbox.
    const stale = await reset(app, first, "third-good-passphrase");
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe("invalid");
  }, 60_000);

  it("refuses a link that has outlived its window", async () => {
    const app = await getTestApp();
    const person = await account(app);
    const token = await requestLink(app, person.email);

    // Aged in the database rather than by waiting an hour. The comparison the
    // route makes is against this column, so this is the real condition.
    await db.update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(passwordResetTokens.tokenHash, createHash("sha256").update(token).digest("hex")));

    const res = await reset(app, token, NEXT);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("expired");
    expect((await signIn(app, person.email, PASSWORD)).status).toBe(200);
  }, 30_000);

  it("refuses a token nobody issued, and an empty one", async () => {
    const app = await getTestApp();
    for (const token of ["not-a-real-token", "", "a".repeat(64)]) {
      const res = await reset(app, token, NEXT);
      expect(res.status, `token: ${JSON.stringify(token)}`).toBe(400);
      expect(res.body.code).toBe("invalid");
    }
  }, 30_000);

  it("holds the new password to the same rules as everywhere else, without burning the link", async () => {
    const app = await getTestApp();
    const person = await account(app);
    const token = await requestLink(app, person.email);

    const weak = await reset(app, token, "password123");
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe("invalid_input");
    expect(weak.body.field).toBe("password");

    /*
     * And the link still works. Spending it on a refused attempt would send
     * someone who mistyped back to their inbox for another — the moment a
     * recovery flow most often loses people.
     */
    const good = await reset(app, token, NEXT);
    expect(good.status).toBe(200);
  }, 30_000);
});

describe("the path a flustered person actually takes", () => {
  it("survives asking twice, then mistyping the new password", async () => {
    const app = await getTestApp();
    const person = await account(app);

    // The first link didn't arrive, or went to spam, so they ask again.
    await requestLink(app, person.email);
    const token = await requestLink(app, person.email);

    // Then they pick something the policy refuses.
    const weak = await reset(app, token, "password123");
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe("invalid_input");

    /*
     * And the retry goes through. This spent four requests against the reset
     * budget of three: sharing one limit between asking for links and spending
     * them meant the last step of getting back into an account answered "try
     * again in 14 minutes" — refusing the person at the exact moment they had
     * done everything right.
     */
    const good = await reset(app, token, NEXT);
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    expect((await signIn(app, person.email, NEXT)).status).toBe(200);
  }, 60_000);
});

describe("a reset by someone who was locked out", () => {
  it("clears the sign-in lock, so the attack doesn't keep the owner out", async () => {
    const app = await getTestApp();
    const person = await account(app);

    // Guessed at until the account locks.
    for (let i = 0; i < RATE_LIMITS.loginAccount.max; i++) {
      await request(app).post("/api/auth/login")
        .set("x-forwarded-for", `203.0.116.${(i % 20) + 10}`)
        .send({ email: person.email, password: `wrong-${i}` });
    }
    const locked = await signIn(app, person.email, PASSWORD);
    expect(locked.status).toBe(429);

    const token = await requestLink(app, person.email);
    expect((await reset(app, token, NEXT)).status).toBe(200);

    // Proving they read the account's mail should not leave them serving out
    // the attacker's lockout.
    expect((await signIn(app, person.email, NEXT)).status).toBe(200);
    const [row] = await db.select().from(rateLimitHits)
      .where(and(eq(rateLimitHits.userId, `account:${person.email}`), eq(rateLimitHits.action, "loginAccount")));
    expect(row).toBeUndefined();
  }, 90_000);
});

describe("a reset link's side effects on the account", () => {
  it("confirms the address, because opening the link proved they can read it", async () => {
    const app = await getTestApp();
    const person = await account(app);
    await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, person.id));

    const token = await requestLink(app, person.email);
    expect((await reset(app, token, NEXT)).status).toBe(200);

    const [after] = await db.select({ verifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, person.id));
    expect(after.verifiedAt).toBeTruthy();
  }, 30_000);

  it("stops working if the account's address changes after the link goes out", async () => {
    const app = await getTestApp();
    const person = await account(app);
    const token = await requestLink(app, person.email);

    // The link belongs to the address it was sent to. Whoever still holds that
    // inbox is no longer this account's owner.
    await db.update(users).set({ email: `moved-${Date.now()}@example.test` }).where(eq(users.id, person.id));

    const res = await reset(app, token, NEXT);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid");
  }, 30_000);

  it("issues links that expire within the advertised window", async () => {
    const app = await getTestApp();
    const person = await account(app);
    const before = Date.now();
    await requestLink(app, person.email);

    const [row] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.userId, person.id));
    const lifetimeMinutes = (row.expiresAt.getTime() - before) / 60_000;
    expect(lifetimeMinutes).toBeGreaterThan(0);
    // The number the pages promise people comes from the same constant.
    expect(lifetimeMinutes).toBeLessThanOrEqual(RESET_TTL_MINUTES + 1);
  }, 30_000);
});
