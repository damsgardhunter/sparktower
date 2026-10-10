/**
 * Being able to stop taking money.
 *
 * Every route that charges a card sat behind no flag at all: a top-up, a credit
 * pack, an Apple purchase, a saved-card charge. `backing`'s note promises "turn
 * off here if the payment path misbehaves" and that was true of pledges and of
 * nothing else — a pricing bug, a double charge or a Stripe incident left no
 * control to reach for short of a deploy.
 *
 * The half that matters as much: turning it off must not take the product down
 * with it. A surface guard answers 404 for everything beneath its prefix,
 * reads included, so gating `/api/nova` or `/api/wallet` wholesale would blank
 * the balance on every screen and read as an outage rather than as "you can't
 * buy right now". The prefixes are therefore exact paths, and these tests are
 * what hold them to that.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";

afterAll(async () => { await closeTestApp(); });
afterEach(async () => {
  const { loadSurfaceFlags } = await import("../../server/surfaces");
  await loadSurfaceFlags();
});

async function setSurface(id: string, enabled: boolean) {
  const { db } = await import("../../server/db");
  const { surfaceFlags } = await import("@shared/schema");
  const { loadSurfaceFlags } = await import("../../server/surfaces");
  await db.insert(surfaceFlags).values({ surfaceId: id, enabled } as any)
    .onConflictDoUpdate({ target: surfaceFlags.surfaceId, set: { enabled } as any });
  await loadSurfaceFlags();
}

let n = 0;
async function person(app: any) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.131.${(n % 200) + 20}`;
  const email = `pay-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: "Payer" });
  expect(res.status).toBe(201);
  await verifyEmail(app, email, ip);
  return agent;
}

const CHARGING = [
  "/api/checkout",
  "/api/nova/top-up",
  "/api/nova/apple-purchase",
  "/api/wallet/topup/saved-card",
  "/api/stripe/sync-subscription",
];

describe("the payments switch", () => {
  it("closes every route that charges a card", async () => {
    const app = await getTestApp();
    await setSurface("payments", false);

    /*
     * Unauthenticated is enough: a surface that is off answers 404 before auth
     * is considered. Any other status means the guard never fired and the route
     * would still take somebody's money.
     */
    for (const path of CHARGING) {
      const res = await request(app).post(path).send({});
      expect(res.status, `${path} answered ${res.status} with payments switched off`).toBe(404);
    }
  }, 90_000);

  it("leaves the balance, the plan and the product itself alone", async () => {
    const app = await getTestApp();
    const agent = await person(app);
    await setSurface("payments", false);

    /*
     * The thing that makes this switch usable rather than a sledgehammer. If
     * these 404'd, every screen in the product would lose the number in its
     * corner and somebody would read a deliberate pause as a broken site.
     */
    for (const path of ["/api/nova/wallet", "/api/subscription"]) {
      const res = await agent.get(path);
      expect(res.status, `${path} went dark with the payments switch`).not.toBe(404);
    }
  }, 90_000);

  it("opens them again when it goes back on", async () => {
    const app = await getTestApp();
    await setSurface("payments", true);

    /*
     * 401, not 200: there is no session here. What matters is that it is not
     * the 404 of a closed surface — the routes exist again.
     */
    for (const path of CHARGING) {
      const res = await request(app).post(path).send({});
      expect(res.status, `${path} did not come back`).not.toBe(404);
    }
  }, 90_000);

  it("is independent of the surfaces that spend what was bought", async () => {
    const app = await getTestApp();
    await setSurface("payments", false);
    await setSurface("nova", true);

    /*
     * Stopping sales must not stop somebody using what they already paid for,
     * which is the whole reason this is its own switch and not folded into one
     * of the surfaces that spends.
     */
    expect((await request(app).post("/api/chat").send({ message: "hello" })).status,
      "Nova still answers for somebody who already has a balance").not.toBe(404);
  }, 90_000);
});
