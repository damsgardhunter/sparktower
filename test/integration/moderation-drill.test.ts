/**
 * The moderation drill, end to end: someone is reported, a reviewer acts, the
 * account is stopped, the reviewer relents, and the log tells the whole story
 * in order. Plus the sign-in limiter, which is the one that guards the door
 * before there is an account to key on.
 *
 * Run as a drill rather than as unit checks because the failure that matters
 * is a seam: a suspension that doesn't actually block, a reinstatement that
 * doesn't actually unblock, a log entry with the wrong actor. None of those
 * show up in a test of one route.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users, moderationLog, contentReports } from "@shared/schema";
import { RATE_LIMITS } from "@shared/moderation";
import { passMfa } from "../helpers/mfa";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
const newEmail = () => `drill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

async function signedIn(app: any, first: string) {
  const agent = request.agent(app);
  const email = newEmail();
  const res = await agent.post("/api/auth/register").send({ email, password, firstName: first, lastName: "Drill" });
  expect(res.status).toBe(201);
  return { agent, email, userId: res.body.id as string };
}

/** Roles come from the environment at boot; tests grant one directly. */
async function reviewer(app: any) {
  const r = await signedIn(app, "Reviewer");
  await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, r.userId));
  // Review tools need a second factor on the session (server/mfa.ts).
  await passMfa(r.agent);
  return r;
}

describe("moderation drill", () => {
  it("report → suspend → blocked → reinstate → resolve, with an honest log", async () => {
    const app = await getTestApp();
    const author = await signedIn(app, "Author");
    const reporter = await signedIn(app, "Reporter");
    const mod = await reviewer(app);

    const project = await author.agent.post("/api/projects").send({
      title: "Spammy Thing", description: "Buy now buy now buy now.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(project.status).toBe(200);

    // 1. Reported.
    const filed = await reporter.agent.post("/api/reports").send({
      targetType: "project", targetId: project.body.id, reason: "spam", note: "Every post is an ad.",
    });
    expect(filed.status).toBe(200);
    expect(filed.body.id).toBeTruthy();

    // 2. In the queue, with the evidence and the author attached.
    const queue = await mod.agent.get("/api/admin/reports?status=open");
    expect(queue.status).toBe(200);
    const report = queue.body.find((r: any) => r.id === filed.body.id);
    expect(report).toBeTruthy();
    expect(report.ownerId).toBe(author.userId);
    expect(report.snapshot).toContain("Spammy Thing");

    // 3. Suspended — and the suspension actually holds.
    const suspend = await mod.agent.post(`/api/admin/users/${author.userId}/suspend`)
      .send({ suspended: true, reason: "Advertising in every post" });
    expect(suspend.status).toBe(200);
    expect(suspend.body.suspended).toBe(true);

    expect((await author.agent.get("/api/user/projects")).status).toBe(200);   // can still read
    const blocked = await author.agent.post("/api/projects").send({
      title: "Another", description: "More of the same thing again.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(blocked.status).toBe(403);                                           // cannot write
    expect(blocked.body.code).toBe("account_suspended");
    expect(blocked.body.message).toContain("Advertising in every post");

    // 4. Reinstated — and the reinstatement actually holds.
    const reinstate = await mod.agent.post(`/api/admin/users/${author.userId}/suspend`).send({ suspended: false });
    expect(reinstate.body.suspended).toBe(false);
    const unblocked = await author.agent.post("/api/projects").send({
      title: "Reformed", description: "Something genuinely useful this time.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(unblocked.status).toBe(200);

    // 5. Resolved.
    const resolved = await mod.agent.patch(`/api/admin/reports/${filed.body.id}`)
      .send({ status: "actioned", note: "Suspended for a week, then reinstated." });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe("actioned");

    // 6. The log tells that story, in that order, with the right people on it.
    const log = await mod.agent.get("/api/admin/moderation-log");
    expect(log.status).toBe(200);
    const mine = (log.body as any[])
      .filter((e) => e.actorId === mod.userId)
      .reverse();                                   // newest-first → chronological
    expect(mine.map((e) => e.action)).toEqual(["suspend", "reinstate", "report_actioned"]);
    expect(mine[0].targetUserId).toBe(author.userId);
    expect(mine[0].reason).toBe("Advertising in every post");
    expect(mine[2].targetId).toBe(filed.body.id);
    expect(mine[2].targetUserId).toBe(author.userId);

    // Immutable by construction: nothing exposes an update or delete.
    expect((await mod.agent.delete(`/api/admin/moderation-log/${mine[0].id}`)).status).toBe(404);
    expect((await mod.agent.patch(`/api/admin/moderation-log/${mine[0].id}`).send({ action: "x" })).status).toBe(404);
    const [row] = await db.select().from(moderationLog).where(eq(moderationLog.id, mine[0].id));
    expect(row.action).toBe("suspend");
  });

  it("keeps the log away from non-reviewers, and hides that it exists", async () => {
    const app = await getTestApp();
    const someone = await signedIn(app, "Nobody");
    expect((await someone.agent.get("/api/admin/moderation-log")).status).toBe(404);
    expect((await request(app).get("/api/admin/moderation-log")).status).toBe(401);
  });
});

describe("sign-in limiter", () => {
  it("locks out an address after repeated failures, durably", async () => {
    const app = await getTestApp();
    const victim = await signedIn(app, "Victim");
    const { max } = RATE_LIMITS.login;

    // Registration now counts against the same per-address budget, so the
    // attacker gets their own address: the test is about the attempts.
    const attacker = "198.51.100.44";
    for (let i = 0; i < max; i++) {
      const r = await request(app).post("/api/auth/login").set("x-forwarded-for", attacker).send({ email: victim.email, password: "wrong" });
      expect(r.status).toBe(401);
    }
    const locked = await request(app).post("/api/auth/login").set("x-forwarded-for", attacker).send({ email: victim.email, password: "wrong" });
    expect(locked.status).toBe(429);
    expect(locked.body.action).toBe("login");

    // The right password is refused too — the limit is on attempts, not on
    // wrong ones, or the ninth guess would be the free one.
    expect((await request(app).post("/api/auth/login").set("x-forwarded-for", attacker).send({ email: victim.email, password })).status).toBe(429);

    // Durable: a fresh app instance, same address, still locked.
    await closeTestApp();
    const fresh = await getTestApp();
    expect((await request(fresh).post("/api/auth/login").set("x-forwarded-for", attacker).send({ email: victim.email, password })).status).toBe(429);
  });
});

describe("takedown", () => {
  it("hides reported content from every read for everyone but its author, logs it, and restores", async () => {
    const app = await getTestApp();
    const author = await signedIn(app, "Author");
    const stranger = await signedIn(app, "Stranger");
    const mod = await reviewer(app);

    const project = await author.agent.post("/api/projects").send({ title: "Takedown", description: "A project whose update will be taken down and restored.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    const post = await author.agent.post("/api/feed").send({ postType: "project_update", projectId: project.body.id, content: "Shipped it, honestly. Tell people about the thing." });
    expect(post.status).toBe(200);
    const id = post.body.id;
    const listedFor = async (who: any) => ((await who.get(`/api/feed?projectId=${project.body.id}`)).body.posts as any[]).some((p) => p.id === id);
    expect((await stranger.agent.get(`/api/feed/${id}`)).status).toBe(200);
    expect(await listedFor(request(app))).toBe(true);

    await stranger.agent.post("/api/reports").send({ targetType: "feed_post", targetId: id, reason: "spam", note: "Not a real update" }).expect(200);
    const queue = (await mod.agent.get("/api/admin/reports")).body;
    const report = queue.find((r: any) => r.targetId === id);
    expect(report.targetHidden).toBe(false);

    // Needs a reason; a wrong kind of target is refused plainly.
    expect((await mod.agent.post(`/api/admin/content/feed_post/${id}/hide`).send({})).body.code).toBe("invalid_input");
    expect((await mod.agent.post(`/api/admin/content/user/${author.userId}/hide`).send({ reason: "x" })).body.code).toBe("not_takedownable");
    expect((await stranger.agent.post(`/api/admin/content/feed_post/${id}/hide`).send({ reason: "x" })).status).toBe(404);

    const hide = await mod.agent.post(`/api/admin/content/feed_post/${id}/hide`).send({ reason: "Spam" });
    expect(hide.status).toBe(200);
    // Gone from its page and the project's feed for a stranger; the author still sees it.
    expect((await stranger.agent.get(`/api/feed/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/feed/${id}`)).status).toBe(404);
    expect(await listedFor(stranger.agent)).toBe(false);
    expect(await listedFor(request(app))).toBe(false);
    expect((await author.agent.get(`/api/feed/${id}`)).status).toBe(200);
    expect((await mod.agent.get("/api/admin/reports")).body.find((r: any) => r.targetId === id).targetHidden).toBe(true);

    const restore = await mod.agent.post(`/api/admin/content/feed_post/${id}/restore`).send({});
    expect(restore.status).toBe(200);
    expect((await stranger.agent.get(`/api/feed/${id}`)).status).toBe(200);

    const log = (await mod.agent.get("/api/admin/moderation-log")).body;
    const actions = (Array.isArray(log) ? log : log.entries ?? []).filter((e: any) => e.targetId === id).map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["content_hidden", "content_restored"]));
  });
});

describe("retired check-ins", () => {
  it("still lists reports filed against a check-in, but takes no new reports or comments on one", async () => {
    const app = await getTestApp();
    const author = await signedIn(app, "Author");
    const stranger = await signedIn(app, "Stranger");
    const mod = await reviewer(app);
    const project = await author.agent.post("/api/projects").send({ title: "Retired", description: "A project from before check-ins were retired.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    const projectId = project.body.id as string;

    // A report from before the retirement, as it sits in the table.
    const legacyId = `legacy-${Date.now()}`;
    const [legacy] = await db.insert(contentReports).values({
      reporterId: stranger.userId, targetType: "check_in", targetId: legacyId, targetOwnerId: author.userId,
      projectId, reason: "spam", snapshot: "Goal: ship\n\nProof: shipped",
    } as any).returning();

    const all = await mod.agent.get("/api/admin/reports");
    expect(all.status).toBe(200);
    expect(all.body.find((r: any) => r.id === legacy.id)).toMatchObject({ targetType: "check_in", snapshot: "Goal: ship\n\nProof: shipped" });
    const onlyRetired = await mod.agent.get("/api/admin/reports?type=check_in");
    expect(onlyRetired.status).toBe(200);
    expect((onlyRetired.body as any[]).map((r) => r.targetType)).toEqual(expect.arrayContaining(["check_in"]));
    expect((onlyRetired.body as any[]).every((r) => r.targetType === "check_in")).toBe(true);
    // Its content can't be taken down any more (there's nothing left that shows it), but the report can still be closed.
    expect((await mod.agent.post(`/api/admin/content/check_in/${legacyId}/hide`).send({ reason: "Spam" })).body.code).toBe("not_takedownable");

    const newReport = await stranger.agent.post("/api/reports").send({ targetType: "check_in", targetId: "anything", reason: "spam" });
    expect(newReport.status).toBe(400);
    const comment = await stranger.agent.post(`/api/projects/${projectId}/comments`).send({ targetType: "check_in", targetId: "anything", content: "Late to the party." });
    expect(comment.status).toBe(400);
    // The check-in routes themselves are gone.
    expect((await request(app).get("/api/check-ins/queue/needs-feedback")).status).toBe(404);
    expect((await author.agent.post(`/api/projects/${projectId}/check-ins`).send({ goal: "x", proof: "y", nextStep: "z" })).status).toBe(404);
  });
});
