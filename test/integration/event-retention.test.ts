/**
 * The behaviour stream expires: activity events after RETENTION_DAYS.
 * Creator-defined metrics (project_analytics_events) aren't a stream and are
 * never swept.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { activityEvents, projectAnalyticsEvents } from "@shared/schema";
import { RETENTION_DAYS } from "@shared/analytics";
import { sweepExpiredEvents } from "../../server/analytics";

afterAll(async () => { await closeTestApp(); });
const ago = (days: number) => sql`now() - interval '${sql.raw(String(days))} days'`;

describe("event retention", () => {
  it("sweeps the stream past its window, keeps what's inside it, and never touches creator-defined metrics", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/register").set("x-forwarded-for", "198.51.103.10").send({ email: `retention-${Date.now()}@example.test`, password: "Testpass123!" }).expect(201);
    const project = (await agent.post("/api/projects").send({ title: "Retained", description: "A project whose metric definitions must outlive every sweep.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const [definition] = await db.insert(projectAnalyticsEvents).values({ projectId: project.id, eventName: "signup_completed", createdAt: ago(RETENTION_DAYS * 4) } as any).returning();

    const activity = await db.insert(activityEvents).values([
      { name: "api.write", visitorId: "v-old", sessionId: "s-old", path: "/api/x", pattern: "/api/x", createdAt: ago(RETENTION_DAYS + 1) },
      { name: "api.write", visitorId: "v-new", sessionId: "s-new", path: "/api/x", pattern: "/api/x", createdAt: ago(RETENTION_DAYS - 1) },
    ] as any).returning({ id: activityEvents.id });

    const swept = await sweepExpiredEvents();
    expect(swept.activity).toBeGreaterThanOrEqual(1);
    expect((await db.select({ id: activityEvents.id }).from(activityEvents).where(inArray(activityEvents.id, activity.map((a) => a.id)))).map((r) => r.id)).toEqual([activity[1].id]);
    expect(await db.select().from(projectAnalyticsEvents).where(eq(projectAnalyticsEvents.id, definition.id))).toHaveLength(1);
  });
});
