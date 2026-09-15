/**
 * A post's own page, and the projects list that used to call every owner
 * "Anonymous".
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

let address = 190;
async function signUp(app: any, name: string) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email: `pp-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: name });
  return agent;
}

describe("a post's own page", () => {
  it("returns the post and who reacted, and keeps a private project's post to its team", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Owner");
    const reader = await signUp(app, "Reader");
    const pub = (await owner.post("/api/projects").send({ title: "Open Project", description: "A project anyone can see and follow along with.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const post = (await owner.post("/api/feed").send({ postType: "project_update", projectId: pub.id, content: "Shipped the thing." })).body;

    await reader.post(`/api/feed/${post.id}/react`).send({ reaction: "celebrate" }).expect(200);
    await reader.post(`/api/feed/${post.id}/comments`).send({ content: "Nice work" }).expect(200);

    const page = await request(app).get(`/api/feed/${post.id}`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ id: post.id, content: "Shipped the thing.", commentCount: 1, reactionCount: 1, project: { id: pub.id } });
    const reactions = (await request(app).get(`/api/feed/${post.id}/reactions`)).body;
    expect(reactions).toEqual([expect.objectContaining({ reaction: "celebrate", name: "Reader" })]);
    expect((await request(app).get("/api/feed/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    // The named routes under /api/feed still answer as themselves.
    expect((await request(app).get("/api/feed/config")).body.postTypes).toBeTruthy();

    const secret = (await owner.post("/api/projects").send({ title: "Quiet Project", description: "Nobody outside the team should see this project.", category: "saas", goal: "ship_mvp", subcategory: "saas", isPrivate: true })).body;
    if (secret.isPrivate) {
      const hidden = (await owner.post("/api/feed").send({ postType: "project_update", projectId: secret.id, content: "Private progress." })).body;
      expect((await owner.get(`/api/feed/${hidden.id}`)).status).toBe(200);
      expect((await reader.get(`/api/feed/${hidden.id}`)).status).toBe(404);
      expect((await reader.get(`/api/feed/${hidden.id}/reactions`)).status).toBe(404);
    }
  });

  it("names the owner on my projects", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Grace");
    await owner.post("/api/projects").send({ title: "Mine", description: "A project of my own, to see on my projects page.", category: "saas", goal: "ship_mvp", subcategory: "saas" }).expect(200);
    const mine = (await owner.get("/api/user/projects")).body;
    expect(mine[0]).toMatchObject({ title: "Mine", owner: expect.objectContaining({ firstName: "Grace" }) });
    expect(mine[0].owner.passwordHash).toBeUndefined();
  });

  it("reports a post in a couple of clicks: a reason, a detail that fits it, recorded with its project", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Author");
    const reader = await signUp(app, "Flagger");
    const project = (await owner.post("/api/projects").send({ title: "Reported Project", description: "A project with a post someone will report.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const post = (await owner.post("/api/feed").send({ postType: "project_update", projectId: project.id, content: "Buy followers at my site." })).body;

    expect((await reader.post("/api/reports").send({ targetType: "feed_post", targetId: post.id, reason: "spam", detail: "targets_me" })).status).toBe(400);
    expect((await owner.post("/api/reports").send({ targetType: "feed_post", targetId: post.id, reason: "spam", detail: "selling" })).status).toBe(400);
    const sent = await reader.post("/api/reports").send({ targetType: "feed_post", targetId: post.id, reason: "spam", detail: "selling", note: "links to a follower shop" });
    expect(sent.status).toBe(200);
    expect(sent.body.received).toBe(true);
    // Twice is once, and the answer doesn't say so.
    expect((await reader.post("/api/reports").send({ targetType: "feed_post", targetId: post.id, reason: "abuse", detail: "hate" })).body).toMatchObject({ received: true, id: null });

    const { db } = await import("../../server/db");
    const { contentReports } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(contentReports).where(eq(contentReports.targetId, post.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "spam", projectId: project.id, note: "Selling or advertising something — links to a follower shop" });
  });

  it("caps reports per day as well as per hour", async () => {
    const app = await getTestApp();
    const owner = await signUp(app, "Poster");
    const reader = await signUp(app, "Busy");
    const post = (await owner.post("/api/feed").send({ postType: "project_update", content: "Something to report." })).body;
    const { db } = await import("../../server/db");
    const { contentReports, users } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    const { RATE_LIMITS } = await import("@shared/moderation");
    const me = (await reader.get("/api/auth/user")).body;
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, me.id));
    // A day's worth, sent hours ago: under the hourly limit, at the daily one.
    // The time is set by the database's clock, as the limiter reads it — a JS Date lands hours off.
    const earlier = sql`now() - interval '3 hours'`;
    await db.insert(contentReports).values(Array.from({ length: RATE_LIMITS.reportDaily.max }, (_, i) => ({
      reporterId: row.id, targetType: "user", targetId: `someone-${i}`, reason: "spam", createdAt: earlier,
    })) as any);
    const refused = await reader.post("/api/reports").send({ targetType: "feed_post", targetId: post.id, reason: "spam", detail: "selling" });
    expect(refused.status).toBe(429);
    expect(refused.body).toMatchObject({ action: "reportDaily", message: RATE_LIMITS.reportDaily.message });
  });
});
