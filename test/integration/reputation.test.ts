/**
 * The builder index, from the database up.
 *
 * The formula has its own tests (test/unit/reputation.test.ts). These are
 * about the half that used to be wrong for a different reason: what the score
 * is built from, and who builds it. Specifically —
 *
 *   - execution reads work that is actually finished, and a board card being
 *     deleted afterwards does not un-finish it;
 *   - contribution can tell a task done on somebody else's project from one
 *     done on your own, which the old score could not see at all;
 *   - the index is brought up to date by the hourly pass rather than by the
 *     person whose score it is, and a stale row is picked up without anybody
 *     pressing anything;
 *   - the manual route is still there for impatience, and no longer bills
 *     anybody, because it no longer asks Nova.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import {
  projects, projectMembers, projectMilestones, projectKanbanTasks, projectTaskCompletions,
  userReputationScores, users,
} from "@shared/schema";
import { refreshReputation } from "../../server/reputation";
import { refreshDueIndexes } from "../../server/reputation-jobs";
import { usersDue } from "../../server/reputation-inputs";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.190.${(n % 200) + 20}`;
  const email = `rep-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `B${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, email };
}

async function project(ownerId: string, title = "A thing being built") {
  const [row] = await db.insert(projects).values({
    ownerId, title, description: "Something being built.", category: "saas",
  } as any).returning();
  return row;
}

/** A task finished by `who` on `projectId`, as the completion log records it. */
async function finishTask(projectId: string, who: string, opts: { onTime?: boolean; at?: Date } = {}) {
  const [task] = await db.insert(projectKanbanTasks).values({
    projectId, title: "A piece of work", status: "done", assigneeId: who,
  } as any).returning();
  await db.insert(projectTaskCompletions).values({
    projectId, taskId: task.id, completedById: who, title: task.title,
    onTime: opts.onTime ?? true, completedAt: opts.at ?? new Date(),
  } as any);
  return task;
}

async function finishMilestone(projectId: string, who: string, opts: { onTime?: boolean } = {}) {
  const target = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db.insert(projectMilestones).values({
    projectId, title: "A milestone", status: "completed", targetDate: target,
    completedAt: opts.onTime === false ? new Date() : new Date(target.getTime() - 60_000),
    completedById: who,
  } as any).returning();
  return row;
}

const scoreOf = async (userId: string) =>
  (await db.select().from(userReputationScores).where(eq(userReputationScores.userId, userId)))[0];

describe("what execution counts", () => {
  it("counts work that was finished, even after the board card is gone", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const mine = await project(me.id);
    const tasks = [];
    for (let i = 0; i < 12; i++) tasks.push(await finishTask(mine.id, me.id));
    for (let i = 0; i < 4; i++) await finishMilestone(mine.id, me.id);

    const before = await refreshReputation(me.id, { skipAi: true });
    expect(before.executionScore, "a dozen tasks and four milestones is a record").toBeGreaterThan(30);

    // Tidying the board is not undoing the work.
    await db.delete(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, mine.id));
    const after = await refreshReputation(me.id, { skipAi: true });
    expect(after.executionScore).toBe(before.executionScore);
  }, 120_000);

  it("reads milestones as things finished rather than as a ratio", async () => {
    const app = await getTestApp();
    const beginner = await builder(app);
    const veteran = await builder(app);
    const one = await project(beginner.id);
    const many = await project(veteran.id);

    // One milestone, nothing outstanding: the old score called this a perfect record.
    await finishMilestone(one.id, beginner.id);
    for (let i = 0; i < 15; i++) await finishMilestone(many.id, veteran.id);
    await db.insert(projectMilestones).values(
      Array.from({ length: 10 }, () => ({ projectId: many.id, title: "Still to do", status: "planned" })) as any,
    );

    const first = await refreshReputation(beginner.id, { skipAi: true });
    const second = await refreshReputation(veteran.id, { skipAi: true });
    expect(second.executionScore, "fifteen finished beats one finished, with ten still open").toBeGreaterThan(first.executionScore);
  }, 120_000);

  it("keeps the punctuality it has evidence for", async () => {
    const app = await getTestApp();
    const punctual = await builder(app);
    const late = await builder(app);
    const a = await project(punctual.id);
    const b = await project(late.id);
    for (let i = 0; i < 6; i++) await finishMilestone(a.id, punctual.id, { onTime: true });
    for (let i = 0; i < 6; i++) await finishMilestone(b.id, late.id, { onTime: false });

    const good = await refreshReputation(punctual.id, { skipAi: true });
    const bad = await refreshReputation(late.id, { skipAi: true });
    expect(good.executionScore).toBeGreaterThan(bad.executionScore);
    expect((good.details as any).execution.milestoneOnTimeRate).toBe(100);
    expect((bad.details as any).execution.milestoneOnTimeRate).toBe(0);
  }, 120_000);
});

describe("what contribution counts", () => {
  it("knows the difference between your project and somebody else's", async () => {
    const app = await getTestApp();
    const helper = await builder(app);
    const soloist = await builder(app);
    const owner = await builder(app);

    const theirs = await project(owner.id, "Somebody else's");
    await db.insert(projectMembers).values({ projectId: theirs.id, userId: helper.id, role: "member" } as any);
    const own = await project(soloist.id, "My own");

    // The same amount of work, on different people's projects.
    for (let i = 0; i < 10; i++) await finishTask(theirs.id, helper.id);
    for (let i = 0; i < 10; i++) await finishTask(own.id, soloist.id);

    const helped = await refreshReputation(helper.id, { skipAi: true });
    const alone = await refreshReputation(soloist.id, { skipAi: true });
    expect(helped.contributionScore, "helping somebody else is the pillar's whole point").toBeGreaterThan(alone.contributionScore);
    expect((helped.details as any).contribution.tasksForOthers).toBe(10);
    expect((alone.details as any).contribution.tasksForOthers).toBe(0);
  }, 120_000);

  it("does not pay for following things", async () => {
    const app = await getTestApp();
    const follower = await builder(app);
    const before = await refreshReputation(follower.id, { skipAi: true });
    const owner = await builder(app);
    const theirs = await project(owner.id);
    await follower.agent.post(`/api/projects/${theirs.id}/follow`).send({}).catch(() => {});
    const after = await refreshReputation(follower.id, { skipAi: true });
    expect(after.contributionScore).toBe(before.contributionScore);
  }, 120_000);
});

describe("the hourly pass", () => {
  it("works out a score nobody asked for, and says when it did", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const mine = await project(me.id);
    await finishTask(mine.id, me.id);

    expect(await scoreOf(me.id), "nothing until something runs").toBeUndefined();
    expect(await usersDue(500), "a builder who has done something is due").toContain(me.id);

    await refreshDueIndexes(500);
    const row = await scoreOf(me.id);
    expect(row, "the pass wrote a score without anybody pressing anything").toBeTruthy();
    expect(row.lastCalculatedAt).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - row.lastCalculatedAt.getTime()), "stamped now, not five hours ago").toBeLessThan(60_000);
  }, 180_000);

  it("leaves alone a builder whose work hasn't moved, and picks them up when it does", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const mine = await project(me.id);
    await finishTask(mine.id, me.id);
    await refreshDueIndexes(500);

    expect(await usersDue(500), "nothing has happened since").not.toContain(me.id);

    await finishTask(mine.id, me.id);
    expect(await usersDue(500), "and now something has").toContain(me.id);
  }, 180_000);

  it("never asks Nova on the hour — that is the weekly pass's business", async () => {
    const app = await getTestApp();
    const ai = await import("../../server/reputation-ai");
    const spy = vi.spyOn(ai, "strategyRead");
    const me = await builder(app);
    await project(me.id);
    await refreshDueIndexes(500);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }, 120_000);
});

describe("asking for it by hand", () => {
  it("still works, and costs nothing", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const mine = await project(me.id);
    await finishTask(mine.id, me.id);

    const [before] = await db.select({ used: users.creditsUsed }).from(users).where(eq(users.id, me.id));
    const res = await me.agent.post("/api/reputation/calculate").send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.builderIndex).toBeGreaterThanOrEqual(0);
    const [after] = await db.select({ used: users.creditsUsed }).from(users).where(eq(users.id, me.id));
    expect(after.used, "a number that is rebuilt hourly anyway is not worth charging for").toBe(before.used);
  }, 120_000);

  it("shows anybody a builder's index, because it is on their profile", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const stranger = await builder(app);
    const mine = await project(me.id);
    await finishMilestone(mine.id, me.id);
    await refreshReputation(me.id, { skipAi: true });

    const res = await stranger.agent.get(`/api/reputation/${me.id}`);
    expect(res.status).toBe(200);
    expect(res.body.builderIndex).toBeGreaterThan(0);
    expect(res.body.details.execution.milestonesCompleted).toBe(1);
  }, 120_000);
});
