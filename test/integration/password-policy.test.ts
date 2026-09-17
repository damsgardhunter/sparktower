/**
 * What this product will accept as a password.
 *
 * Two different failures live here. The first is a password anyone would
 * guess — short, or "password123", or the account's own email address with a
 * digit on it. The second is subtler and is how accounts are actually lost: a
 * password that looks fine and is already in a credential dump, so it is on
 * the list a stuffing script tries on its first pass. Without these tests the
 * first check is untested policy and the second is a network call nobody ever
 * watched make a decision.
 *
 * The breach check is stubbed rather than called for real: a test suite that
 * depends on someone else's service is a test suite that fails when their
 * service does. What is NOT stubbed is the thing worth proving — that only a
 * five-character hash prefix leaves this process, never the password.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createHash } from "crypto";
import { getTestApp, closeTestApp } from "../helpers/app";
import { resetBreachCache, BREACHED_MESSAGE } from "../../server/password-breach";
import { PASSWORD_MIN } from "@shared/passwords";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const freshEmail = () => `pp-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
const ip = () => `198.51.106.${(n % 200) + 20}`;

const register = (app: any, body: Record<string, unknown>) =>
  request(app).post("/api/auth/register").set("x-forwarded-for", ip()).send({ firstName: "Pat", ...body });

/** The corpus's own format: SHA-1, uppercase hex, split after five characters. */
function hibp(password: string) {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  return { prefix: hash.slice(0, 5), suffix: hash.slice(5) };
}

/**
 * Stands in for api.pwnedpasswords.com, and records what it was asked. Answers
 * with a handful of unrelated suffixes plus, when the password is meant to be
 * breached, the real one — the same shape the service returns, so the parsing
 * is exercised rather than bypassed.
 */
function stubRange(breached: string[], opts: { fail?: boolean } = {}) {
  const asked: string[] = [];
  const known = breached.map(hibp);
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(String(url));
    if (opts.fail) throw new Error("connect ECONNREFUSED");
    const prefix = String(url).split("/").pop()!.toUpperCase();
    const lines = [
      "0000000000000000000000000000000000A:0",  // padding, as the real service sends
      "1111111111111111111111111111111111B:42",
      ...known.filter((k) => k.prefix === prefix).map((k) => `${k.suffix}:9312`),
    ];
    return { ok: true, status: 200, text: async () => lines.join("\r\n") } as any;
  });
  return { asked };
}

beforeEach(() => {
  // On for these tests only: it's off under NODE_ENV=test so the rest of the
  // suite doesn't queue up a network timeout per account it creates.
  process.env.PASSWORD_BREACH_CHECK = "on";
  resetBreachCache();
});

afterEach(() => {
  delete process.env.PASSWORD_BREACH_CHECK;
  vi.unstubAllGlobals();
  resetBreachCache();
});

describe("passwords nobody should be allowed to set", () => {
  it("refuses the short, the common, and the ones made of your own address", async () => {
    const app = await getTestApp();
    stubRange([]);
    // Each case registers with its own address, and the last two derive the
    // password from THAT address — the rule compares the two in one request,
    // so testing it against some other account's email proves nothing.
    const cases: { email: string; password: string; why: string }[] = [
      { email: freshEmail(), password: "a".repeat(PASSWORD_MIN - 1), why: "under the minimum length" },
      { email: freshEmail(), password: "password123", why: "top of every guessing list" },
      { email: freshEmail(), password: "qwerty123", why: "a keyboard walk" },
      ...[freshEmail(), freshEmail()].map((email, i) => ({
        email,
        password: i === 0 ? email.split("@")[0] : `${email.split("@")[0]}1`,
        why: i === 0 ? "the local part of the address being registered" : "that address with a digit stuck on",
      })),
    ];

    for (const { email, password, why } of cases) {
      const res = await register(app, { email, password });
      expect(res.status, `should have refused ${why}: ${password}`).toBe(400);
      expect(res.body.code).toBe("invalid_input");
      expect(res.body.field).toBe("password");
    }
  }, 60_000);

  it("accepts a long passphrase with no digits or symbols in it at all", async () => {
    // The policy deliberately has no composition rules: length is the thing
    // that makes guessing expensive, and "must contain a symbol" is what
    // produces Pa$$w0rd1.
    const app = await getTestApp();
    stubRange([]);
    const res = await register(app, { email: freshEmail(), password: "correct horse battery staple" });
    expect(res.status).toBe(201);
  }, 30_000);
});

describe("a password that has already leaked", () => {
  const leaked = "Tr0ub4dor&3-quarterly-ledger";

  it("is refused when registering, however strong it looks", async () => {
    const app = await getTestApp();
    stubRange([leaked]);

    const res = await register(app, { email: freshEmail(), password: leaked });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("breached_password");
    expect(res.body.message).toBe(BREACHED_MESSAGE);

    // The same shape of password, not in the corpus, is fine — so what was
    // refused was its presence in the dump, not some incidental property.
    expect((await register(app, { email: freshEmail(), password: "Tr0ub4dor&3-monthly-ledger" })).status).toBe(201);
  }, 30_000);

  it("is refused on mobile too, where a separate route does its own checking", async () => {
    const app = await getTestApp();
    stubRange([leaked]);
    const res = await request(app).post("/api/auth/mobile/register")
      .set("x-forwarded-for", ip())
      .send({ email: freshEmail(), password: leaked, firstName: "Pat", device: "test" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("breached_password");
  }, 30_000);

  it("cannot be changed TO, which is when someone is most likely to try", async () => {
    const app = await getTestApp();
    stubRange([leaked]);
    const agent = request.agent(app);
    const email = freshEmail();
    const password = "first-good-passphrase-here";
    expect((await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email, password, firstName: "Pat" })).status).toBe(201);

    const res = await agent.post("/api/auth/change-password").send({ currentPassword: password, newPassword: leaked });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("breached_password");
    expect(res.body.field).toBe("newPassword");

    // And the account still has the password it started with.
    expect((await request(app).post("/api/auth/login").set("x-forwarded-for", ip()).send({ email, password })).status).toBe(200);
  }, 30_000);
});

describe("what the breach check sends", () => {
  it("sends five characters of a hash and nothing else — not the password, not the full hash", async () => {
    const app = await getTestApp();
    const password = "a-careful-unique-passphrase";
    const { prefix, suffix } = hibp(password);
    const { asked } = stubRange([]);

    expect((await register(app, { email: freshEmail(), password })).status).toBe(201);
    expect(asked).toHaveLength(1);

    const sent = asked[0];
    expect(sent).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(sent).not.toContain(password);
    expect(sent.toUpperCase()).not.toContain(suffix);
  }, 30_000);

  it("asks once per prefix, not once per signup", async () => {
    const app = await getTestApp();
    const password = "another-careful-passphrase";
    const { asked } = stubRange([]);

    for (let i = 0; i < 3; i++) {
      expect((await register(app, { email: freshEmail(), password })).status).toBe(201);
    }
    expect(asked).toHaveLength(1);
  }, 45_000);
});

describe("when the breach service is unreachable", () => {
  it("lets the signup through rather than taking the product down with it", async () => {
    // Fail-open is the deliberate choice: somebody else's outage must not stop
    // people creating accounts. The cost is one unchecked password; the cost of
    // the alternative is every account.
    const app = await getTestApp();
    stubRange([], { fail: true });

    const res = await register(app, { email: freshEmail(), password: "yet-another-good-passphrase" });
    expect(res.status).toBe(201);
  }, 30_000);

  it("still applies the checks that don't need a network", async () => {
    const app = await getTestApp();
    stubRange([], { fail: true });
    const res = await register(app, { email: freshEmail(), password: "password123" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_input");
  }, 30_000);
});
