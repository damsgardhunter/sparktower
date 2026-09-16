/**
 * What can change a plan, and what a caller is allowed to say about it.
 *
 * One route accepts data from Stripe — POST /api/stripe/webhook — and it is
 * verified by signature before anything is parsed (test/integration/
 * stripe-webhook.test.ts). The risk this file is about is the other shape of
 * the same mistake: a route that takes Stripe's word second-hand from the
 * client, "I paid, here's the session id", and upgrades an account on it.
 *
 * So: the only route that reads a Stripe signature is the webhook, and the
 * route that syncs a plan ignores everything in the request but who is asking.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  n += 1;
  const agent = request.agent(app);
  const email = `inbound-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.112.${20 + n}`).send({ email, password: "Testpass123!" });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string, email };
}

describe("what may come in from Stripe", () => {
  it("reads a Stripe signature in exactly one place", () => {
    const root = join(__dirname, "..", "..", "server");
    const walk = (d: string, out: string[] = []): string[] => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        statSync(p).isDirectory() ? walk(p, out) : /\.ts$/.test(name) && out.push(p);
      }
      return out;
    };
    const readers = walk(root)
      .map((path) => ({ path, content: readFileSync(path, "utf8") }))
      .filter((f) => /stripe-signature|constructEvent\s*\(/i.test(f.content))
      .map((f) => f.path.slice(root.length + 1));
    /*
     * One place takes the header: the webhook route in app.ts. It hands the
     * raw bytes and that header to the sync client, which verifies them
     * (server/webhookHandlers.ts wraps the call and turns a failure into the
     * 400). A second file appearing here means something else is reading
     * Stripe's payloads, and would need the same treatment.
     */
    expect(readers.sort()).toEqual(["app.ts"]);
  });

  it("won't take the client's word for which customer or subscription to read", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const someoneElse = await person(app);
    // Someone else really is a paying customer, so the ids below are real ones — just not the caller's.
    await db.update(users).set({ stripeCustomerId: "cus_theirs", stripeSubscriptionId: "sub_theirs", subscriptionTier: "pro" })
      .where(eq(users.id, someoneElse.id));

    // Every shape of "I paid, take my word for it".
    for (const body of [
      { customerId: "cus_theirs" },
      { stripeCustomerId: "cus_theirs", stripeSubscriptionId: "sub_theirs" },
      { subscriptionId: "sub_theirs", tier: "pro" },
      { sessionId: "cs_test_anything", priceId: "price_pro" },
      { userId: someoneElse.id, tier: "pro" },
    ]) {
      const res = await me.agent.post("/api/stripe/sync-subscription").set("x-forwarded-for", "198.51.112.10").send(body);
      expect(res.status, JSON.stringify(body)).toBe(200);
      // No customer of their own: free, whatever they sent.
      expect(res.body, JSON.stringify(body)).toMatchObject({ tier: "free" });
      const [row] = await db.select().from(users).where(eq(users.id, me.id));
      expect(row.subscriptionTier, JSON.stringify(body)).toBe("free");
      expect(row.stripeCustomerId, JSON.stringify(body)).toBeNull();
    }

    // And the account they were pointing at is untouched.
    const [them] = await db.select().from(users).where(eq(users.id, someoneElse.id));
    expect(them.subscriptionTier).toBe("pro");
    expect(them.stripeCustomerId).toBe("cus_theirs");
  });

  it("won't let a signed-out caller sync anything at all", async () => {
    const app = await getTestApp();
    expect((await request(app).post("/api/stripe/sync-subscription").send({ customerId: "cus_theirs" })).status).toBe(401);
  });
});
