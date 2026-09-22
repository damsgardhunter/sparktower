/**
 * The session id changes when you sign in — pinned, not assumed.
 *
 * Session fixation is the attack where somebody plants a session id in your
 * browser, waits for you to sign in on it, and finds their cookie is now your
 * account. The defence is renewing the id on authentication, and this app is
 * safe by way of Passport, which regenerates inside `req.login` (0.6 onwards,
 * and 0.7 here). That is a dependency's behaviour rather than this codebase's
 * decision: a major upgrade, a swap to another library, or one
 * `keepSessionInfo: true` would take it away silently, and nothing in the repo
 * would notice.
 *
 * So the attack is run here rather than the setting inspected — plant a real,
 * working session and check it never becomes somebody else's. Written after an
 * audit flagged the auth surface: the first version of this test passed with
 * and without the defence, because an anonymous visit is given no cookie at
 * all and there was nothing to plant. A security test that cannot fail is
 * worse than none, so it now proves the plant works before claiming anything
 * about what happens to it.
 *
 * Two of the audit's three points are answered here as well, and in both cases
 * the answer is "already true, and this is the proof": signing out is open on
 * purpose but refuses a cross-site caller, and the sign-in limit cannot be
 * dodged by retyping an address in a different case.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;

/** The session cookie's value, or null when the response didn't set one. */
function sessionId(res: request.Response): string | null {
  const raw = res.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const sid = cookies.find((c) => c.startsWith("connect.sid="));
  return sid ? sid.split(";")[0].slice("connect.sid=".length) : null;
}

async function account(app: any) {
  n += 1;
  const email = `fix-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const ip = `198.51.230.${(n % 200) + 20}`;
  const made = await request(app).post("/api/auth/register").set("x-forwarded-for", ip).send({ email, password });
  expect(made.status, `${made.status}: ${(made.text ?? "").slice(0, 200)}`).toBe(201);
  return { email, ip, registered: made };
}

describe("signing in renews the session", () => {
  /**
   * The attack, rather than a proxy for it.
   *
   * An anonymous visit here is given no cookie at all, so "the id you arrived
   * with" is usually nothing and a test built on that proves nothing — it
   * passed just as happily with the fix removed. The real move is the other
   * one: an attacker signs in as *themselves*, takes the session id they were
   * given, plants it in somebody else's browser, and waits for them to sign
   * in. If the id survives authentication, the attacker's cookie is now the
   * victim's session.
   */
  it("does not hand a planted session id the account that signs in on it", async () => {
    const app = await getTestApp();
    const attacker = await account(app);
    const victim = await account(app);

    const theirs = request.agent(app);
    const signedIn = await theirs.post("/api/auth/login").set("x-forwarded-for", attacker.ip)
      .send({ email: attacker.email, password });
    expect(signedIn.status).toBe(200);
    const planted = sessionId(signedIn);
    expect(planted, "the attacker has a real session id to plant").toBeTruthy();

    /*
     * The plant works, before anything is claimed about what happens next: a
     * request carrying nothing but that cookie is the attacker. Without this
     * the test can pass by the cookie being ignored, which proves nothing.
     */
    const asAttacker = await request(app).get("/api/auth/user")
      .set("x-forwarded-for", attacker.ip).set("Cookie", `connect.sid=${planted}`);
    expect(asAttacker.status, "the planted cookie is a working session").toBe(200);
    expect(asAttacker.body.email).toBe(attacker.email);

    // The victim's browser, carrying the planted cookie, signs in as themselves.
    const victimSignIn = await request(app).post("/api/auth/login")
      .set("x-forwarded-for", victim.ip)
      .set("Cookie", `connect.sid=${planted}`)
      .send({ email: victim.email, password });
    expect(victimSignIn.status).toBe(200);
    expect(victimSignIn.body.email).toBe(victim.email);

    const issued = sessionId(victimSignIn);
    expect(issued, "signing in issues a session id of its own").toBeTruthy();
    expect(issued, "and it is not the one that was planted").not.toBe(planted);

    /*
     * What the attacker's cookie is worth afterwards: their own session at
     * most, never the victim's. This is the assertion the whole thing is for.
     */
    const withPlanted = await request(app).get("/api/auth/user")
      .set("x-forwarded-for", attacker.ip)
      .set("Cookie", `connect.sid=${planted}`);
    if (withPlanted.status === 200) {
      expect(withPlanted.body.email, "the planted id never becomes the victim").toBe(attacker.email);
    } else {
      expect(withPlanted.status).toBe(401);
    }
  }, 120_000);

  it("renews on registration too, so a planted id cannot become a new account", async () => {
    const app = await getTestApp();
    const attacker = await account(app);
    const theirs = request.agent(app);
    const planted = sessionId(await theirs.post("/api/auth/login").set("x-forwarded-for", attacker.ip)
      .send({ email: attacker.email, password }));
    expect(planted).toBeTruthy();

    n += 1;
    const ip = `198.51.231.${(n % 200) + 20}`;
    const email = `fix-reg-${Date.now()}-${n}@example.test`;
    const made = await request(app).post("/api/auth/register")
      .set("x-forwarded-for", ip).set("Cookie", `connect.sid=${planted}`).send({ email, password });
    expect(made.status).toBe(201);
    expect(sessionId(made), "a new account gets a new session id").not.toBe(planted);

    const withPlanted = await request(app).get("/api/auth/user")
      .set("x-forwarded-for", attacker.ip).set("Cookie", `connect.sid=${planted}`);
    if (withPlanted.status === 200) expect(withPlanted.body.email).toBe(attacker.email);
  }, 120_000);
});

describe("the open endpoints the audit asked about", () => {
  it("signs out without an account, and refuses to be made to from another site", async () => {
    const app = await getTestApp();
    const { email, ip } = await account(app);
    const agent = request.agent(app);
    await agent.post("/api/auth/login").set("x-forwarded-for", ip).send({ email, password });
    expect((await agent.get("/api/auth/user").set("x-forwarded-for", ip)).status).toBe(200);

    /*
     * Another site cannot sign somebody out. Being open is deliberate — a
     * session that has expired must still be clearable — but "open" and "any
     * page on the internet can do it to you" are different things.
     */
    const cross = await agent.post("/api/logout").set("x-forwarded-for", ip).set("Origin", "https://evil.example");
    expect(cross.status).toBe(403);
    expect(cross.body.code).toBe("cross_site");
    expect((await agent.get("/api/auth/user").set("x-forwarded-for", ip)).status, "still signed in").toBe(200);

    expect((await agent.post("/api/logout").set("x-forwarded-for", ip)).status).toBe(200);
    expect((await agent.get("/api/auth/user").set("x-forwarded-for", ip)).status).toBe(401);
  }, 120_000);

  it("counts a wrong password against the account however the address is typed", async () => {
    const app = await getTestApp();
    const { email, ip } = await account(app);
    const { accountKey } = await import("../../server/moderation");

    /*
     * The limit is keyed on the address, and the key is what an attacker would
     * vary to get a fresh budget: upper case, padding, both. All one key, and
     * the same key the lookup uses, so a thousand addresses trying one account
     * still meet one limit.
     */
    const forms = [email, email.toUpperCase(), `  ${email}  `, ` ${email.toUpperCase()}`];
    const keys = new Set(forms.map((f) => accountKey(f)));
    expect(keys.size, "one account, one key").toBe(1);

    // And the lookup agrees: a differently-typed address is the same account.
    const upper = await request(app).post("/api/auth/login").set("x-forwarded-for", ip)
      .send({ email: email.toUpperCase(), password });
    expect(upper.status, "signs in, so it is the same account to the lookup too").toBe(200);
  }, 120_000);
});
