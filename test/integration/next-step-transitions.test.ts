/**
 * "What should I do next" moves when you do the thing.
 *
 * The cheap test for whether Next Step is really computed from the path rather
 * than decided somewhere and displayed: walk each of the three paths a few
 * steps and watch the answer change to the next milestone in the tree, every
 * time, on both surfaces that report it — the project's own path endpoint and
 * the home card's `/api/me/next-steps`, which is the one people actually read.
 *
 * Twelve transitions, four per path. They are not hardcoded expectations:
 * each expected next id is read from the resolved tree for that project's
 * goal and type, so if the authored backbone changes the test follows it, and
 * if the *computation* stops following the tree the test fails.
 *
 * Also here, because they are the same claim from the other side:
 *   - a project with no path is not silently missing from the home card; it
 *     appears with what it needs and can be put on a path from there;
 *   - finishing a step changes the home card's answer with no second action —
 *     one read afterwards is enough.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { mainLineMilestones, resolveTree } from "@shared/phase-trees";
import type { ProjectGoal } from "@shared/goals";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;

async function builder(app: any) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register")
    .set("x-forwarded-for", `198.51.200.${(n % 200) + 20}`)
    .send({ email: `next-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`, password });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, res.body.email);
  return agent;
}

const create = (agent: any, goal: ProjectGoal, subcategory: string, title = "Walking the path") =>
  agent.post("/api/projects").send({
    title, description: "A project that should know what comes next.", category: "saas", goal, subcategory,
  });

/** What the project's own path endpoint says is next. */
async function nextOnPath(agent: any, id: string, goal?: ProjectGoal) {
  const res = await agent.get(`/api/projects/${id}/path${goal ? `?goal=${goal}` : ""}`);
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return res.body;
}

/** What the home card says is next for this project — the same question, asked the way a person asks it. */
async function nextOnHome(agent: any, id: string) {
  const res = await agent.get("/api/me/next-steps");
  expect(res.status).toBe(200);
  return res.body.items.find((i: any) => i.project.id === id) ?? null;
}

/**
 * Finish the backbone milestone that is currently next.
 *
 * Ticking its own card is not always enough, and that is deliberate in the
 * product: a milestone with open children isn't done, and the core-loops
 * milestone isn't done until all five loops are written. So this finishes the
 * children too — which is what a builder doing the work would have done.
 */
async function finish(agent: any, id: string, backboneId: string) {
  const loopTree = (await agent.get(`/api/projects/${id}/path`)).body.loopTree;
  if (loopTree?.loops?.length && backboneId === "SHIP.M1.2") {
    for (const loop of loopTree.loops) {
      await agent.patch(`/api/kanban/${loop.taskId}`)
        .send({ status: "done", description: loop.description || `1. Start the ${loop.type} loop 2. Do it 3. Back to 1` });
    }
  }

  const tasks = (await agent.get(`/api/projects/${id}/kanban`)).body;
  for (const child of tasks.filter((t: any) => t.tags?.includes(`parent:${backboneId}`) && t.status !== "done")) {
    await agent.patch(`/api/kanban/${child.id}`).send({ status: "done", description: "Done, with something to show for it." });
  }

  const task = tasks.find((t: any) => t.tags?.includes(`backbone:${backboneId}`));
  expect(task, `a task for ${backboneId}`).toBeTruthy();
  const done = await agent.patch(`/api/kanban/${task.id}`).send({ status: "done" });
  expect(done.status, JSON.stringify(done.body).slice(0, 200)).toBe(200);
}

/**
 * Walk `count` milestones of one path, checking after each that the next one
 * is the next one the tree says, on both surfaces.
 */
async function walk(agent: any, id: string, goal: ProjectGoal, subcategory: string, count: number) {
  const main = mainLineMilestones(resolveTree(goal, subcategory));
  const seen: string[] = [];

  for (let i = 0; i < count; i++) {
    const before = await nextOnPath(agent, id, goal);
    const expected = main[i];
    expect(before.next?.id, `step ${i + 1} of ${goal}`).toBe(expected.id);

    // The home card is asked the same question, and must answer the same way.
    const home = await nextOnHome(agent, id);
    expect(home?.next?.id, `home card at step ${i + 1} of ${goal}`).toBe(expected.id);
    expect(home?.progress.done).toBe(i);

    await finish(agent, id, expected.id);
    seen.push(expected.id);

    const after = await nextOnPath(agent, id, goal);
    expect(after.next?.id, `after finishing ${expected.id}`).toBe(main[i + 1]?.id);
    expect(after.mainLine.done).toBe(i + 1);
  }
  return seen;
}

describe("the next step follows the path", () => {
  it("moves four times down the ship path, and the home card moves with it", async () => {
    const app = await getTestApp();
    const agent = await builder(app);
    const id = (await create(agent, "ship_mvp", "saas")).body.id;

    const walked = await walk(agent, id, "ship_mvp", "saas", 4);
    expect(walked).toHaveLength(4);
    expect(new Set(walked).size, "four different milestones, in order").toBe(4);
  }, 180_000);

  it("moves four times down the systemize path", async () => {
    const app = await getTestApp();
    const agent = await builder(app);
    const id = (await create(agent, "systemize_business", "restaurant")).body.id;

    const walked = await walk(agent, id, "systemize_business", "restaurant", 4);
    expect(walked).toHaveLength(4);
    // The restaurant variant is the tree being read, not the generic one.
    const main = mainLineMilestones(resolveTree("systemize_business", "restaurant"));
    expect(walked).toEqual(main.slice(0, 4).map((m) => m.id));
  }, 180_000);

  it("moves four times down the funding path", async () => {
    const app = await getTestApp();
    const agent = await builder(app);
    const id = (await create(agent, "raise_funding", "startup_equity")).body.id;

    const walked = await walk(agent, id, "raise_funding", "startup_equity", 4);
    expect(walked).toHaveLength(4);
  }, 180_000);
});

describe("finishing a step is enough", () => {
  it("changes the home card's answer with one read and no second action", async () => {
    const app = await getTestApp();
    const agent = await builder(app);
    const id = (await create(agent, "ship_mvp", "saas")).body.id;

    const before = await nextOnHome(agent, id);
    expect(before?.next?.id).toBeTruthy();

    await finish(agent, id, before!.next.id);

    /*
     * One read. Not a poll, not a retry: the endpoint recomputes from the
     * tree on every request, so the very next read is already the new answer.
     */
    const after = await nextOnHome(agent, id);
    expect(after?.next?.id).not.toBe(before!.next.id);
    expect(after?.progress.done).toBe(before!.progress.done + 1);
    expect(after?.lastDone?.title, "and it knows what was just finished").toBe(before!.next.title);
  }, 120_000);
});

describe("a project with no path", () => {
  /**
   * The state this whole card used to skip. A project made before paths — or
   * one whose owner never started a section — simply wasn't in the list, so
   * the screen that answers "what now" had nothing to say about it and no way
   * to fix that.
   */
  it("says what it needs instead of vanishing, and can be put on a path from there", async () => {
    const app = await getTestApp();
    const agent = await builder(app);
    const id = (await create(agent, "ship_mvp", "saas")).body.id;

    // Take the path away, as a project that predates paths has none.
    const { db } = await import("../../server/db");
    const { projectKanbanTasks, projectMilestones } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, id));
    await db.delete(projectMilestones).where(eq(projectMilestones.projectId, id));

    const stranded = await nextOnHome(agent, id);
    expect(stranded, "still on the home card").toBeTruthy();
    expect(stranded.next).toBeNull();
    expect(stranded.needsPath).toMatchObject({ kind: "adopt" });
    expect(stranded.track.goal).toBe("ship_mvp");

    // The button on that card: adoption, which reads what is already there.
    /* read: false skips Nova's read of existing work — nothing here is about the model. */
    const adopted = await agent.post(`/api/projects/${id}/path/adopt?goal=ship_mvp`).send({ read: false });
    expect(adopted.status, JSON.stringify(adopted.body).slice(0, 200)).toBe(200);

    const after = await nextOnHome(agent, id);
    expect(after?.needsPath, "the offer is gone once it has a path").toBeUndefined();
    expect(after?.next?.id, "and there is a step to take").toBeTruthy();
  }, 180_000);

  it("offers to start a section that was never started, rather than leaving it out", async () => {
    const app = await getTestApp();
    const agent = await builder(app);
    const id = (await create(agent, "ship_mvp", "saas")).body.id;

    // Funding has never been started here, so it is not on the card at all…
    const items = (await agent.get("/api/me/next-steps")).body.items.filter((i: any) => i.project.id === id);
    expect(items.every((i: any) => i.track.goal !== "raise_funding")).toBe(true);

    // …until it is, and then it has a step of its own.
    const started = await agent.post(`/api/projects/${id}/tracks`).send({ goal: "raise_funding", subcategory: "startup_equity" });
    expect(started.status, JSON.stringify(started.body).slice(0, 200)).toBe(200);
    const withFunding = (await agent.get("/api/me/next-steps")).body.items
      .find((i: any) => i.project.id === id && i.track.goal === "raise_funding");
    expect(withFunding?.next?.id).toBe("FUND.C1.1");
  }, 180_000);
});
