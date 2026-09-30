/**
 * The two links that lead to somebody's money.
 *
 * `GET /api/stripe/connect-onboarding` and `GET /api/stripe/connect-dashboard`
 * had no test between them. Neither takes an account id — each looks up the
 * caller's own — and that is the whole of their security: there is no
 * parameter to tamper with, so the only way to hand someone a link into
 * another person's Stripe account is for the lookup to stop being "mine".
 * Asserted here directly, because "there is no id in the URL" is a property of
 * today's code rather than a law.
 *
 * The onboarding link's return address is the other thing worth pinning, and
 * it is pinned because it was wrong once. The route's own comment records it:
 * the link used to return to `/profile`, from the days when the only way in
 * was a project's backing setup, which left somebody who had just finished
 * Stripe's form on a page that said nothing about whether it had worked. A
 * return URL is easy to change and nothing downstream complains — the flow
 * still "works", it just abandons people at the end of it.
 *
 * Stripe is faked, and what is faked is only the API call. The lookup, the
 * refusals and the URLs handed to Stripe are the route's own.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

/** Everything the routes asked Stripe to do, in order. */
const asked: { kind: "accountLink" | "loginLink"; account: string; refresh_url?: string; return_url?: string }[] = [];

vi.mock("../../server/stripeClient", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    isStripeConfigured: () => true,
    getUncachableStripeClient: async () => ({
      accountLinks: {
        create: async (p: { account: string; refresh_url: string; return_url: string }) => {
          asked.push({ kind: "accountLink", account: p.account, refresh_url: p.refresh_url, return_url: p.return_url });
          return { url: `https://connect.stripe.test/onboard/${p.account}` };
        },
      },
      accounts: {
        create: async () => ({ id: `acct_made_${asked.length}` }),
        createLoginLink: async (account: string) => {
          asked.push({ kind: "loginLink", account });
          return { url: `https://connect.stripe.test/dashboard/${account}` };
        },
      },
    }),
  };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, opts: { connected?: boolean } = {}) {
  n += 1;
  const agent = request.agent(app);
  const email = `connect-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.194.${(n % 200) + 20}`)
    .send({ email, password: "a-good-passphrase-here", firstName: `C${n}` });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  const id = res.body.id as string;
  const accountId = `acct_${id.slice(0, 10)}`;
  if (opts.connected) await db.update(users).set({ stripeConnectAccountId: accountId } as any).where(eq(users.id, id));
  return { agent, id, accountId };
}

describe("the link into Stripe's onboarding", () => {
  it("is made for the caller's own account, and comes back to the page with the answer on it", async () => {
    const app = await getTestApp();
    const me = await person(app, { connected: true });
    asked.length = 0;

    const res = await me.agent.get("/api/stripe/connect-onboarding");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.url).toContain("connect.stripe.test");

    expect(asked.length).toBe(1);
    expect(asked[0].account, "the link is for my account, and there is no way to name another").toBe(me.accountId);
    /*
     * Both halves of the round trip. `return_url` is where Stripe sends
     * somebody who finished, and `?connected=1` is what the earnings page
     * reads to tell them it worked.
     */
    expect(asked[0].return_url).toMatch(/\/earnings\?connected=1$/);
    expect(asked[0].refresh_url, "and an abandoned form comes back to the same place").toMatch(/\/earnings$/);
  }, 180_000);

  it("refuses before it asks Stripe for anything, when there is no account yet", async () => {
    const app = await getTestApp();
    const me = await person(app);
    asked.length = 0;

    const res = await me.agent.get("/api/stripe/connect-onboarding");
    expect(res.status).toBe(400);
    expect(asked, "no link was minted for an account that does not exist").toEqual([]);
  }, 180_000);
});

describe("the link into someone's Stripe dashboard", () => {
  it("is a login link for the caller's own account", async () => {
    const app = await getTestApp();
    const me = await person(app, { connected: true });
    asked.length = 0;

    const res = await me.agent.get("/api/stripe/connect-dashboard");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.url).toContain("connect.stripe.test");
    expect(asked).toEqual([{ kind: "loginLink", account: me.accountId }]);
  }, 180_000);

  it("refuses without asking Stripe, when there is no account", async () => {
    const app = await getTestApp();
    const me = await person(app);
    asked.length = 0;
    expect((await me.agent.get("/api/stripe/connect-dashboard")).status).toBe(400);
    expect(asked).toEqual([]);
  }, 180_000);
});

describe("two people with accounts of their own", () => {
  /*
   * The property the absence of a URL parameter is standing in for. If the
   * lookup ever stopped being "the caller's", this is the test that would say
   * so — and what it would be saying is that one person can open another
   * person's payout dashboard.
   */
  it("each get links into their own, and never into each other's", async () => {
    const app = await getTestApp();
    const a = await person(app, { connected: true });
    const b = await person(app, { connected: true });
    expect(a.accountId).not.toBe(b.accountId);

    asked.length = 0;
    await a.agent.get("/api/stripe/connect-dashboard");
    await b.agent.get("/api/stripe/connect-dashboard");
    await a.agent.get("/api/stripe/connect-onboarding");

    expect(asked.map((x) => x.account)).toEqual([a.accountId, b.accountId, a.accountId]);
  }, 180_000);

  it("are both refused when nobody is signed in", async () => {
    const app = await getTestApp();
    asked.length = 0;
    for (const path of ["/api/stripe/connect-onboarding", "/api/stripe/connect-dashboard"]) {
      const res = await request(app).get(path).set("x-forwarded-for", "198.51.194.250");
      expect(res.status, `${path} needs an account`).toBe(401);
    }
    expect(asked, "and a signed-out caller reached Stripe with nothing").toEqual([]);
  }, 180_000);
});
