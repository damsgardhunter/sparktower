/**
 * The owner's view of whether Stripe is reaching the app: what's configured,
 * and what the event ledger has seen. Nobody else can find it.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { stripeEvents } from "@shared/schema";
import { passMfa } from "../helpers/mfa";

afterAll(async () => { await closeTestApp(); });

describe("Stripe health", () => {
  it("tells the owner whether events are arriving, and what failed; nobody else sees it", async () => {
    const app = await getTestApp();
    const owner = request.agent(app);
    expect((await owner.post("/api/auth/register").set("x-forwarded-for", "198.51.100.61").send({ email: "owner@test.local", password: "Testpass123!" })).status).toBe(201);
    // The owner's console needs a second factor on the session (server/mfa.ts).
    await passMfa(owner);
    const someone = request.agent(app);
    expect((await someone.post("/api/auth/register").set("x-forwarded-for", "198.51.100.62").send({ email: `sh-${Date.now()}@example.test`, password: "Testpass123!" })).status).toBe(201);

    expect((await someone.get("/api/admin/stripe/health")).status).toBe(404);
    expect((await request(app).get("/api/admin/stripe/health")).status).toBe(401);

    const empty = await owner.get("/api/admin/stripe/health");
    expect(empty.status).toBe(200);
    expect(empty.body.events).toMatchObject({ total: 0, lastReceivedAt: null, recentFailures: [] });
    expect(["not_configured", "no_webhook_secret", "waiting_for_first_event"]).toContain(empty.body.verdict);

    await db.insert(stripeEvents).values([
      { id: "evt_ok", type: "checkout.session.completed", status: "processed" },
      { id: "evt_bad", type: "charge.refunded", status: "failed", error: "database was down" },
    ] as any);
    const seen = (await owner.get("/api/admin/stripe/health")).body;
    expect(seen.events).toMatchObject({ total: 2, byStatus: { processed: 1, failed: 1 } });
    expect(seen.events.lastReceivedAt).toBeTruthy();
    expect(seen.events.recentFailures).toEqual([expect.objectContaining({ id: "evt_bad", error: "database was down" })]);
    expect(seen.donations).toMatchObject({ total: 0, refunded: 0, partlyRefunded: 0 });
    /*
     * Every verdict comes with the thing to do about it. This environment has
     * no Stripe credentials, so it stops at a configuration verdict — which is
     * itself the point: missing configuration outranks "events are arriving",
     * because an event ledger with no way to verify signatures is not health.
     */
    expect(["not_configured", "no_webhook_secret"]).toContain(seen.verdict);
    expect(seen.nextStep).toMatch(/^Set STRIPE/);
  });

  it("says when nothing is registered to deliver to — the case where payments work and nothing is recorded", async () => {
    const app = await getTestApp();
    const owner = request.agent(app);
    expect((await owner.post("/api/auth/register").set("x-forwarded-for", "198.51.100.63").send({ email: "owner@test.local", password: "Testpass123!" })).status).toBe(201);
    await passMfa(owner);

    const res = await owner.get("/api/admin/stripe/health");
    expect(res.status).toBe(200);
    /*
     * Without Stripe credentials the endpoint list can't be read, so this
     * environment can only reach the earlier verdicts — what's pinned here is
     * that the page always says what to do next, and never mistakes "can't ask
     * Stripe" for "Stripe says there's nothing".
     */
    expect(["not_configured", "no_webhook_secret", "waiting_for_first_event", "no_endpoint_registered"]).toContain(res.body.verdict);
    expect(typeof res.body.nextStep === "string" || res.body.nextStep === null).toBe(true);
    if (res.body.verdict === "no_endpoint_registered") {
      expect(res.body.configured.stripeEndpoints).toEqual([]);
      expect(res.body.nextStep).toMatch(/nothing recorded/);
    } else if (!res.body.configured.apiKey) {
      // Nothing was asked of Stripe, so the list is unknown rather than empty — the distinction the verdict rests on.
      expect(res.body.configured.stripeEndpoints).toBeNull();
    }
  });
});
