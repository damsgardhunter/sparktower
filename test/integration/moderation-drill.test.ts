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
import { users, moderationLog } from "@shared/schema";
import { RATE_LIMITS } from "@shared/moderation";

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
  return r;
}

describe("moderation drill", () => {
  it("report → suspend → blocked → reinstate → resolve, with an honest log", async () => {
    const app = await getTestApp();
    const author = await signedIn(app, "Author");
    const reporter = await signedIn(app, "Reporter");
    const mod = await reviewer(app);

    const project = await author.agent.post("/api/projects").send({
      title: "Spammy Thing", description: "Buy now buy now buy now.", category: "saas", goal: "ship_mvp",
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
      title: "Another", description: "More of the same thing again.", category: "saas", goal: "ship_mvp",
    });
    expect(blocked.status).toBe(403);                                           // cannot write
    expect(blocked.body.code).toBe("account_suspended");
    expect(blocked.body.message).toContain("Advertising in every post");

    // 4. Reinstated — and the reinstatement actually holds.
    const reinstate = await mod.agent.post(`/api/admin/users/${author.userId}/suspend`).send({ suspended: false });
    expect(reinstate.body.suspended).toBe(false);
    const unblocked = await author.agent.post("/api/projects").send({
      title: "Reformed", description: "Something genuinely useful this time.", category: "saas", goal: "ship_mvp",
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

    for (let i = 0; i < max; i++) {
      const r = await request(app).post("/api/auth/login").send({ email: victim.email, password: "wrong" });
      expect(r.status).toBe(401);
    }
    const locked = await request(app).post("/api/auth/login").send({ email: victim.email, password: "wrong" });
    expect(locked.status).toBe(429);
    expect(locked.body.action).toBe("login");

    // The right password is refused too — the limit is on attempts, not on
    // wrong ones, or the ninth guess would be the free one.
    expect((await request(app).post("/api/auth/login").send({ email: victim.email, password })).status).toBe(429);

    // Durable: a fresh app instance, same address, still locked.
    await closeTestApp();
    const fresh = await getTestApp();
    expect((await request(fresh).post("/api/auth/login").send({ email: victim.email, password })).status).toBe(429);
  });
});
