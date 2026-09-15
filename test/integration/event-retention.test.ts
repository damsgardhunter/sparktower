/**
 * Both event streams expire: activity events after RETENTION_DAYS, loop events
 * after LOOP_EVENTS_RETENTION_DAYS — which outlasts the widest window the loop
 * metrics page can ask for, so every figure it shows is computed from rows
 * that still exist. Creator-defined metrics (project_analytics_events) aren't
 * a stream and are never swept.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { activityEvents, loopEvents, projectAnalyticsEvents } from "@shared/schema";
import { RETENTION_DAYS } from "@shared/analytics";
import { LOOP_EVENTS, LOOP_EVENTS_RETENTION_DAYS, LOOP_METRICS_MAX_DAYS } from "@shared/loop-events";
import { sweepExpiredEvents } from "../../server/analytics";

afterAll(async () => { await closeTestApp(); });
const ago = (days: number) => sql`now() - interval '${sql.raw(String(days))} days'`;

describe("event retention", () => {
  it("keeps loop events for longer than any metrics window plus its D30 cohort", () => {
    expect(LOOP_EVENTS_RETENTION_DAYS).toBeGreaterThanOrEqual(LOOP_METRICS_MAX_DAYS + 30);
  });

  it("sweeps each stream past its own window, keeps what's inside it, and never touches creator-defined metrics", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/register").set("x-forwarded-for", "198.51.103.10").send({ email: `retention-${Date.now()}@example.test`, password: "Testpass123!" }).expect(201);
    const project = (await agent.post("/api/projects").send({ title: "Retained", description: "A project whose metric definitions must outlive every sweep.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const [definition] = await db.insert(projectAnalyticsEvents).values({ projectId: project.id, eventName: "signup_completed", createdAt: ago(LOOP_EVENTS_RETENTION_DAYS * 2) } as any).returning();

    const activity = await db.insert(activityEvents).values([
      { name: "api.write", visitorId: "v-old", sessionId: "s-old", path: "/api/x", pattern: "/api/x", createdAt: ago(RETENTION_DAYS + 1) },
      { name: "api.write", visitorId: "v-new", sessionId: "s-new", path: "/api/x", pattern: "/api/x", createdAt: ago(RETENTION_DAYS - 1) },
    ] as any).returning({ id: activityEvents.id });
    const loop = await db.insert(loopEvents).values([
      { name: LOOP_EVENTS.checkInStarted, sessionId: "old", createdAt: ago(LOOP_EVENTS_RETENTION_DAYS + 1) },
      // Past activity retention, inside loop retention: a year-wide metric still needs it.
      { name: LOOP_EVENTS.checkInStarted, sessionId: "year", createdAt: ago(LOOP_METRICS_MAX_DAYS) },
    ] as any).returning({ id: loopEvents.id });

    const swept = await sweepExpiredEvents();
    expect(swept.activity).toBeGreaterThanOrEqual(1);
    expect(swept.loop).toBeGreaterThanOrEqual(1);
    expect((await db.select({ id: activityEvents.id }).from(activityEvents).where(inArray(activityEvents.id, activity.map((a) => a.id)))).map((r) => r.id)).toEqual([activity[1].id]);
    expect((await db.select({ id: loopEvents.id }).from(loopEvents).where(inArray(loopEvents.id, loop.map((a) => a.id)))).map((r) => r.id)).toEqual([loop[1].id]);
    expect(await db.select().from(projectAnalyticsEvents).where(eq(projectAnalyticsEvents.id, definition.id))).toHaveLength(1);
  });
});
