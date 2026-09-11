/**
 * The owner's view of whether Stripe is reaching the app: what's configured,
 * and what the event ledger has seen. Nobody else can find it.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { stripeEvents } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

describe("Stripe health", () => {
  it("tells the owner whether events are arriving, and what failed; nobody else sees it", async () => {
    const app = await getTestApp();
    const owner = request.agent(app);
    expect((await owner.post("/api/auth/register").set("x-forwarded-for", "198.51.100.61").send({ email: "owner@test.local", password: "Testpass123!" })).status).toBe(201);
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
  });
});
