/**
 * The owner can take the analytics out and take a person's out of it: an
 * export of the retention window (CSV, safe to open in a spreadsheet, or
 * JSON), and erasing one account's activity — rows recorded while signed in
 * as them and from the browsers they used. Nobody else can reach either. And
 * the tables that grow on their own are swept: limiter hits past the longest
 * window, activity and finished audit runs past retention.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { activityEvents, codeAuditRuns, rateLimitHits, projects } from "@shared/schema";
import { sweepExpiredEvents } from "../../server/analytics";
import { sweepRateLimitHits, RATE_LIMIT_HIT_RETENTION_HOURS } from "../../server/moderation";

const savedOwner = process.env.PLATFORM_OWNER_EMAIL;
afterEach(() => { process.env.PLATFORM_OWNER_EMAIL = savedOwner; });
afterAll(async () => { await closeTestApp(); });

async function person(app: any, tag: string, ip: string) {
  const agent = request.agent(app);
  const email = `an-${tag}-${Date.now()}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip).send({ email, password: "Testpass123!", firstName: tag });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string, email };
}
const event = (over: Record<string, unknown>) => ({ name: "api.write", visitorId: "v-x", sessionId: "s-x", path: "/api/x", pattern: "/api/x", ...over });

describe("analytics data", () => {
  it("exports for the owner only, CSV safe for spreadsheets, and erases one person's activity", async () => {
    const app = await getTestApp();
    const owner = await person(app, "owner", "203.0.113.160");
    const subject = await person(app, "subject", "203.0.113.161");
    const bystander = await person(app, "bystander", "203.0.113.162");
    process.env.PLATFORM_OWNER_EMAIL = owner.email;

    await db.insert(activityEvents).values([
      event({ userId: subject.id, visitorId: "v-subject", path: "/api/feed", referrer: "=HYPERLINK(\"http://evil\")" }),
      event({ userId: null, visitorId: "v-subject", path: "/signed-out-page", name: "page.view" }),
      event({ userId: bystander.id, visitorId: "v-bystander", path: "/api/projects" }),
    ] as any);

    // Not the owner: not found, for both.
    expect((await bystander.agent.get("/api/admin/analytics/export")).status).toBe(404);
    expect((await bystander.agent.delete(`/api/admin/analytics/people/${subject.id}`)).status).toBe(404);

    const csv = await owner.agent.get("/api/admin/analytics/export?days=7");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.headers["content-disposition"]).toMatch(/sparktower-activity-last-7-days\.csv/);
    expect(csv.text.split("\n")[0]).toBe("createdAt,name,userId,visitorId,sessionId,method,path,pattern,status,durationMs,projectId,referrer");
    // A formula in a cell is neutralised, and quoted because it has a comma/quote.
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    const json = (await owner.agent.get("/api/admin/analytics/export?days=7&format=json")).body;
    expect(json).toMatchObject({ days: 7, truncated: false });
    expect(json.rows.some((r: any) => r.visitorId === "v-bystander")).toBe(true);
    expect((await owner.agent.get("/api/admin/analytics/export?days=9999&format=json")).body.days).toBe(90);

    // Erase: the account's rows and its browser's signed-out rows; the bystander's stay.
    const erased = await owner.agent.delete(`/api/admin/analytics/people/${encodeURIComponent(subject.email.toUpperCase())}`);
    expect(erased.status).toBe(200);
    expect(erased.body.erased).toBeGreaterThanOrEqual(2);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.visitorId, "v-subject"))).toHaveLength(0);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.userId, subject.id))).toHaveLength(0);
    expect((await db.select().from(activityEvents).where(eq(activityEvents.visitorId, "v-bystander"))).length).toBeGreaterThan(0);
    expect((await owner.agent.delete("/api/admin/analytics/people/not-a-user")).status).toBe(404);
  });

  it("sweeps limiter hits past the longest window, and activity and finished audit runs past retention", async () => {
    const app = await getTestApp();
    const someone = await person(app, "sweep", "203.0.113.163");
    const key = `sweep-${Date.now()}`;
    await db.insert(rateLimitHits).values([
      { userId: key, action: "write", createdAt: sql`now() - make_interval(hours => ${RATE_LIMIT_HIT_RETENTION_HOURS + 1})` },
      { userId: key, action: "write", createdAt: sql`now() - interval '1 hour'` },
    ] as any);
    await sweepRateLimitHits();
    expect(await db.select().from(rateLimitHits).where(eq(rateLimitHits.userId, key))).toHaveLength(1);

    const project = (await someone.agent.post("/api/projects").send({ title: "Sweep Me", description: "A project whose old audit runs should be swept.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    await db.insert(codeAuditRuns).values([
      { projectId: project.id, startedById: someone.id, source: "old-finished", startedAt: sql`now() - interval '120 days'`, finishedAt: sql`now() - interval '120 days'` },
      { projectId: project.id, startedById: someone.id, source: "recent-finished", finishedAt: sql`now()` },
    ] as any);
    await db.insert(activityEvents).values([
      event({ visitorId: "v-old", createdAt: sql`now() - interval '120 days'` }),
      event({ visitorId: "v-new" }),
    ] as any);
    const swept = await sweepExpiredEvents();
    expect(swept.auditRuns).toBeGreaterThanOrEqual(1);
    const runs = await db.select({ source: codeAuditRuns.source }).from(codeAuditRuns).where(eq(codeAuditRuns.projectId, project.id));
    expect(runs.map((r) => r.source)).toEqual(["recent-finished"]);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.visitorId, "v-old"))).toHaveLength(0);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.visitorId, "v-new"))).toHaveLength(1);
    void projects;
  });
});
