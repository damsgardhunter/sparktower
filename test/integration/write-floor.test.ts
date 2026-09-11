/**
 * The write floor, checked on the running app rather than read from source.
 *
 * `limitWrites` limits every write under /api — but Express only runs
 * middleware for routes registered after it, so "is it mounted?" is really
 * "is it mounted before every write route?". This walks the real router and
 * answers that: every write sits behind it, except the Stripe webhook, which
 * is exempt by design (Stripe's signature is its credential, and refusing it
 * loses money). Then the two limits on top of the floor for reviewer actions.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { rateLimitHits, surfaceFlags, users } from "@shared/schema";
import { RATE_LIMITS, type RateLimitAction } from "@shared/moderation";
import { limitWrites, blockSuspended } from "../../server/moderation";
import { loadSurfaceFlags } from "../../server/surfaces";

afterAll(async () => { await closeTestApp(); });

const WRITE = ["post", "put", "patch", "delete"];

describe("the write floor on the running app", () => {
  it("sits in front of every write route, except the signed Stripe webhook", async () => {
    const app: any = await getTestApp();
    const stack: any[] = (app.router ?? app._router).stack;
    const floorAt = stack.findIndex((l) => l.handle === limitWrites);
    const suspendedAt = stack.findIndex((l) => l.handle === blockSuspended);
    expect(floorAt).toBeGreaterThan(-1);
    expect(suspendedAt).toBeGreaterThan(-1);

    const writes = stack
      .map((layer, i) => ({ layer, i }))
      .filter(({ layer }) => layer.route && WRITE.some((m) => layer.route.methods[m]))
      .map(({ layer, i }) => ({ i, label: `${WRITE.filter((m) => layer.route.methods[m]).join(",").toUpperCase()} ${layer.route.path}` }));
    expect(writes.length).toBeGreaterThan(200);
    expect(writes.filter((w) => w.i < floorAt).map((w) => w.label)).toEqual(["POST /api/stripe/webhook"]);
    // The suspension check runs for every write too.
    expect(writes.filter((w) => w.i < suspendedAt).map((w) => w.label)).toEqual(["POST /api/stripe/webhook"]);
  });
});

describe("limits on reviewer actions", () => {
  const seedHits = (key: string, action: RateLimitAction, count: number) =>
    db.insert(rateLimitHits).values(Array.from({ length: count }, () => ({ userId: key, action, createdAt: sql`now()` })) as any);

  it("refuses a reviewer past the review limit, and past the tighter money limit, with the shared contract", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/register").set("x-forwarded-for", "198.51.100.244")
      .send({ email: `wf-${Date.now()}@example.test`, password: "Testpass123!" });
    const id = res.body.id as string;
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, id));

    await seedHits(id, "review", RATE_LIMITS.review.max);
    const hide = await agent.post("/api/admin/content/comment/any-comment/hide").send({ reason: "Spam" });
    expect(hide.status).toBe(429);
    expect(hide.body).toMatchObject({ code: "rate_limited", action: "review" });
    expect(Number(hide.headers["retry-after"])).toBeGreaterThan(0);

    // Backing is off by default, and its kill switch answers before anything else:
    // the money routes can't be reached at all until someone turns it on.
    expect((await agent.post("/api/admin/backing/any-project/release").send({})).status).toBe(404);
    await db.insert(surfaceFlags).values({ surfaceId: "backing", enabled: true } as any)
      .onConflictDoUpdate({ target: surfaceFlags.surfaceId, set: { enabled: true } as any });
    await loadSurfaceFlags();

    await seedHits(id, "payout", RATE_LIMITS.payout.max);
    const release = await agent.post("/api/admin/backing/any-project/release").send({});
    expect(release.status).toBe(429);
    expect(release.body).toMatchObject({ code: "rate_limited", action: "payout" });

    // Someone who isn't a reviewer still gets "not found", never a hint that a limit exists.
    const stranger = request.agent(app);
    await stranger.post("/api/auth/register").set("x-forwarded-for", "198.51.100.245").send({ email: `wf2-${Date.now()}@example.test`, password: "Testpass123!" });
    expect((await stranger.post("/api/admin/backing/any-project/release").send({})).status).toBe(404);
  });
});
