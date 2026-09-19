/**
 * A project is born with its path. The backbone is data, so what is tested is
 * the instantiation and the adaptation: the right tree for the goal, the
 * right variant text for the type, skipped milestones actually skipped, and
 * the status endpoint answering "where am I, what's next, who acts".
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { resolveTree, mainLineMilestones, PATH_TREES } from "@shared/phase-trees";
import { normaliseGoal, goalOfBackboneId, sectionOfTask } from "@shared/goals";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
async function owner(app: any) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ email: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password });
  await verifyEmail(app, res.body.email);
  return agent;
}
const create = (agent: any, goal: string, subcategory: string, title = "Tree Test") =>
  agent.post("/api/projects").send({ title, description: "A project that should be born with a path to walk.", category: "saas", goal, subcategory });
/** Writes every loop on the project, so the core-loop milestone can be done. */
async function writeLoops(agent: any, id: string) {
  const tree = (await agent.get(`/api/projects/${id}/path`)).body.loopTree;
  for (const l of tree.loops) await agent.patch(`/api/kanban/${l.taskId}`).send({ status: "done", description: l.description || `1. Start the ${l.type} loop 2. Finish it 3. Back to 1` });
}

describe("the backbone, as data", () => {
  it("has three paths, each with a unique id on every milestone", () => {
    for (const tree of Object.values(PATH_TREES)) {
      const ids = tree.phases.flatMap((p) => p.milestones.map((m) => m.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThan(15);
    }
  });

  it("applies the variant for the type and skips what doesn't apply", () => {
    const game = mainLineMilestones(resolveTree("ship_mvp", "game"));
    const saas = mainLineMilestones(resolveTree("ship_mvp", "saas"));
    const website = mainLineMilestones(resolveTree("ship_mvp", "website"));

    // A game gets the feel checkpoint; software doesn't.
    expect(game.some((m) => m.id === "SHIP.M2.2")).toBe(true);
    expect(saas.some((m) => m.id === "SHIP.M2.2")).toBe(false);
    // A website skips persistence and auth.
    expect(website.some((m) => m.id === "SHIP.M2.4")).toBe(false);
    // Variant text lands where it exists, universal text elsewhere.
    expect(game.find((m) => m.id === "SHIP.M1.2")!.description).toMatch(/moment-to-moment/);
    expect(saas.find((m) => m.id === "SHIP.M1.2")!.description).toMatch(/3–5 step/);
    expect(saas.find((m) => m.id === "SHIP.M1.2")!.variantApplied).toBe(false);

    const restaurant = mainLineMilestones(resolveTree("systemize_business", "restaurant"));
    expect(restaurant.find((m) => m.id === "SYS.M2.1")!.description).toMatch(/Recipes as specs/);
    // Systemize's funding weeks show a route's phases only once that route is
    // chosen, and only that route's — slotted in after the route choice, ahead
    // of the roadmap week.
    const operating = ["money-4", "week-1", "week-2", "week-3", "week-4"];
    const noRoute = resolveTree("systemize_business", "other");
    expect(noRoute.map((p) => p.id)).toEqual(["money-1", "money-2", "money-3", "capital-1", "capital-2", ...operating]);
    expect(resolveTree("systemize_business", "other", "seller").map((p) => p.id))
      .toEqual(["money-1", "money-2", "money-3", "capital-1", "capital-2", "seller-1", "seller-2", "seller-3", "seller-4", ...operating]);
  });

  it("carries anything still naming the retired funding path to Systemize", () => {
    // Raise funding's work moved into Systemize. A stored goal, a link's
    // section, a card's track tag or a milestone id that still says "raise"
    // has to land on Systemize, not on nothing — and not be offered as a path.
    expect(Object.keys(PATH_TREES)).not.toContain("raise_funding");
    expect(normaliseGoal("raise_funding")).toBe("systemize_business");
    expect(sectionOfTask(["track:raise_funding"], "ship_mvp")).toBe("systemize_business");
    expect(goalOfBackboneId("FUND.C1.1")).toBe("systemize_business");
    expect(sectionOfTask(["backbone:FUND.S1.1"], "ship_mvp")).toBe("systemize_business");
    expect(normaliseGoal("nonsense")).toBeNull();
  });

  it("marks every user-does milestone as something only a human can do", () => {
    const human = /\b(you|your|yourself|human|someone else)\b/i;
    for (const tree of Object.values(PATH_TREES)) {
      for (const m of tree.phases.flatMap((p) => p.milestones)) {
        if (m.actor === "user-does") expect(m.description, m.id).toMatch(human);
      }
    }
  });
});

describe("a new project is born with its path", () => {
  it("instantiates the tree onto the roadmap, milestones and tasks", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const project = await create(agent, "ship_mvp", "game");
    expect(project.status).toBe(200);
    const id = project.body.id;

    const path = await agent.get(`/api/projects/${id}/path`);
    expect(path.status).toBe(200);
    expect(path.body.goal).toBe("ship_mvp");
    expect(path.body.promise).toMatch(/first version in front of real people/);
    expect(path.body.phases.map((p: any) => p.id)).toEqual(["week-1", "week-2", "branch-build", "week-3", "week-4"]);
    expect(path.body.current).toMatchObject({ id: "week-1", step: 1, of: 8 });
    expect(path.body.next).toMatchObject({ id: "SHIP.M1.1", actor: "nova-drafts", title: "Product statement" });
    expect(path.body.mainLine.done).toBe(0);
    // The game variant is what got instantiated.
    const feel = path.body.phases[1].milestones.find((m: any) => m.id === "SHIP.M2.2");
    expect(feel).toBeTruthy();

    // And it's on the surfaces the manager already renders.
    const milestones = await agent.get(`/api/projects/${id}/milestones`);
    expect(milestones.status).toBe(200);
    expect(milestones.body.length).toBe(path.body.phases.reduce((n: number, p: any) => n + p.total, 0));
    const tasks = await agent.get(`/api/projects/${id}/kanban`);
    expect(tasks.status).toBe(200);
    const first = tasks.body.find((t: any) => t.tags?.includes("backbone:SHIP.M1.1"));
    expect(first).toBeTruthy();
    expect(first.tags).toEqual(expect.arrayContaining(["actor:nova-drafts", "tier:artifact", "shared:SH-01"]));
  });

  it("advances the step and the next action as tasks are done", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "systemize_business", "restaurant")).body.id;
    const tasks = (await agent.get(`/api/projects/${id}/kanban`)).body;
    const first = tasks.find((t: any) => t.tags?.includes("backbone:SYS.F1.1"));

    await agent.patch(`/api/kanban/${first.id}`).send({ status: "done" }).expect(200);

    const path = await agent.get(`/api/projects/${id}/path`);
    expect(path.body.current).toMatchObject({ id: "money-1", step: 2, of: 6 });
    expect(path.body.next.id).toBe("SYS.F1.2");
    const costs = path.body.phases[0].milestones.find((m: any) => m.id === "SYS.F1.3");
    expect(costs.description).toMatch(/kitchen equipment/);
    expect(path.body.mainLine.done).toBe(1);
  });

  it("does not build a second tree if creation is retried", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "systemize_business", "other")).body.id;
    const { instantiatePathTree } = await import("../../server/phase-trees");
    const again = await instantiatePathTree(id, "systemize_business", "other");
    expect(again.created).toBe(false);
    const path = await agent.get(`/api/projects/${id}/path`);
    expect(path.body.mainLine.total).toBe(mainLineMilestones(resolveTree("systemize_business", "other")).length);
  });
});

describe("the path adapts", () => {
  it("reads pace from finished work and logs the recalculation", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Pace Test")).body.id;
    const before = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(before.pace.mode).toBe("date");
    expect(before.pace.multiplier).toBeNull();
    expect(before.events).toEqual([]);

    const tasks = (await agent.get(`/api/projects/${id}/kanban`)).body;
    const first = tasks.find((t: any) => t.tags?.includes("backbone:SHIP.M1.1"));
    await agent.patch(`/api/kanban/${first.id}`).send({ status: "done" }).expect(200);

    const after = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(after.pace.multiplier).not.toBeNull();
    expect(after.events).toHaveLength(1);
    expect(after.events[0]).toMatchObject({ title: "Product statement", backboneId: "SHIP.M1.1" });
    // Effort never pushes the date out.
    expect(new Date(after.pace.projectedAt).getTime()).toBeLessThanOrEqual(new Date(before.pace.projectedAt).getTime());
  });

  it("refuses to expand a milestone with nothing written to expand from", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "app", "Expand Test")).body.id;
    const res = await agent.post(`/api/projects/${id}/path/expand`).send({ backboneId: "SHIP.M2.1" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("artifact_missing");
    expect(res.body.message).toMatch(/Nothing is written under "The core loops" yet/);
    expect(res.body.sourceTaskId).toBeTruthy();
    const wrong = await agent.post(`/api/projects/${id}/path/expand`).send({ backboneId: "SHIP.M1.1" });
    expect(wrong.body.code).toBe("not_expandable");
  });

  it("expansion steps roll up: the parent is done when every step is", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Rollup Test")).body.id;
    const { createExpansion } = await import("../../server/phase-trees");
    const { created } = await createExpansion(id, "SHIP.M2.1", [
      { title: "Capture the fridge", description: "", estimateHours: 2 },
      { title: "Plan the week", description: "", estimateHours: 3 },
    ]);
    expect(created).toHaveLength(2);
    expect(created[0].tags).toContain("parent:SHIP.M2.1");
    // Running it again does not duplicate.
    expect((await createExpansion(id, "SHIP.M2.1", [{ title: "Again", description: "" }])).created).toHaveLength(0);

    const week2 = (await agent.get(`/api/projects/${id}/path`)).body.phases[1];
    const loop = week2.milestones.find((m: any) => m.id === "SHIP.M2.1");
    expect(loop.steps).toEqual({ done: 0, total: 2 });
    expect(loop.done).toBe(false);
    for (const t of created) await agent.patch(`/api/kanban/${t.id}`).send({ status: "done" }).expect(200);
    const again = (await agent.get(`/api/projects/${id}/path`)).body.phases[1].milestones.find((m: any) => m.id === "SHIP.M2.1");
    expect(again.done).toBe(true);
    expect(again.steps).toEqual({ done: 2, total: 2 });
  });

  it("counts a project's update posts as activity and as artifacts Nova can ground in", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Update Test")).body.id;
    const { db } = await import("../../server/db");
    const { projects } = await import("@shared/schema");
    const { eq, sql } = await import("drizzle-orm");
    const { refreshPace, collectArtifacts } = await import("../../server/phase-trees");
    // A month with nothing: the path has gone quiet.
    await db.update(projects).set({ createdAt: sql`now() - interval '30 days'` } as any).where(eq(projects.id, id));
    expect((await refreshPace(id))!.state).toBe("dormant");
    expect((await collectArtifacts(id)).some((a) => a.kind === "update")).toBe(false);

    const post = await agent.post("/api/feed").send({ postType: "project_update", projectId: id, content: "Shipped the intake form to the first five customers." });
    expect(post.status).toBeLessThan(300);
    const postId = post.body.id ?? post.body.post?.id;
    expect(postId).toBeTruthy();

    // Posting an update is a sign of life, measured on the database's clock.
    const pace = (await refreshPace(id))!;
    expect(pace.state).toBe("active");
    expect(pace.daysSinceActivity).toBeLessThan(1);
    expect(await collectArtifacts(id)).toEqual(expect.arrayContaining([
      { label: `update:${postId}`, kind: "update", text: "Shipped the intake form to the first five customers." },
    ]));
  });

  it("injected tasks are capped per phase and must name an artifact", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "systemize_business", "service", "Inject Test")).body.id;
    // Nothing to ground in yet.
    const empty = await agent.post(`/api/projects/${id}/path/inject`).send({ phaseId: "week-1" });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("no_artifacts");

    const { createInjections } = await import("../../server/phase-trees");
    const artifacts = [{ label: "update:x", kind: "update" as const, text: "Shipped the intake form" }];
    const r = await createInjections(id, "week-1", [
      { title: "Wire intake to the CRM", description: "", artifact: "update:x", estimateHours: 2 },
      { title: "Ungrounded", description: "", artifact: "nope" },
      { title: "Two", description: "", artifact: "update:x" },
      { title: "Three", description: "", artifact: "update:x" },
      { title: "Four", description: "", artifact: "update:x" },
    ], artifacts);
    expect(r.created.map((t: any) => t.title)).toEqual(["Wire intake to the CRM", "Two", "Three"]);
    expect(r.dropped).toEqual([{ title: "Ungrounded", reason: "no artifact named" }, { title: "Four", reason: "phase is at its cap" }]);
    expect(r.created[0].tags).toEqual(expect.arrayContaining(["injected:week-1", "artifact:update:x"]));

    const status = (await agent.get(`/api/projects/${id}/path`)).body;
    const week1 = status.phases.find((p: any) => p.id === "week-1");
    expect(week1.injected).toHaveLength(3);
    expect(week1.injectRoom).toBe(0);
    const full = await agent.post(`/api/projects/${id}/path/inject`).send({ phaseId: "week-1" });
    expect(full.status).toBe(409);
    expect(full.body.code).toBe("phase_at_cap");
  });

  it("switching paths carries shared milestones across and keeps the old work visible", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Switch Test")).body.id;
    const tasks = (await agent.get(`/api/projects/${id}/kanban`)).body;
    // Pricing is SH-02, shared with the systemize path.
    const pricing = tasks.find((t: any) => t.tags?.includes("shared:SH-02"));
    await agent.patch(`/api/kanban/${pricing.id}`).send({ status: "done", description: "$12/month, one plan, free for the first ten." }).expect(200);

    const bad = await agent.post(`/api/projects/${id}/path/switch`).send({ goal: "systemize_business", subcategory: "startup_equity" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("subcategory_mismatch");

    const res = await agent.post(`/api/projects/${id}/path/switch`).send({ goal: "systemize_business", subcategory: "service" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: { goal: "ship_mvp" }, to: { goal: "systemize_business" }, carried: 1 });

    const project = (await agent.get(`/api/projects/${id}`)).body;
    expect(project.goal).toBe("systemize_business");
    const path = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(path.goal).toBe("systemize_business");
    expect(path.phases[0].milestones[0].id).toBe("SYS.F1.1");
    // Pricing (SH-02) arrives done; nothing else was shared and done, so nothing else does.
    const all = path.phases.flatMap((p: any) => p.milestones);
    expect(all.filter((m: any) => m.done).map((m: any) => m.id)).toEqual(["SYS.M4.3"]);
    const carriedTask = (await agent.get(`/api/projects/${id}/kanban`)).body.find((t: any) => t.tags?.includes("carried:ship_mvp"));
    expect(carriedTask.status).toBe("done");
    expect(carriedTask.description).toMatch(/Carried over from Ship an MVP/);
    // The old path's tasks are still on the board, marked, and out of the maths.
    const archived = (await agent.get(`/api/projects/${id}/kanban`)).body.filter((t: any) => t.tags?.includes("archived:ship_mvp"));
    expect(archived.length).toBeGreaterThan(20);
    expect(path.mainLine.done).toBe(1);
    // Pace starts fresh, but the log of what they did before stays visible.
    expect(path.pace.multiplier).toBeNull();
    expect(path.events.map((e: any) => e.backboneId)).toEqual(["SHIP.M3.7"]);
  });
});

describe("a project that predates paths", () => {
  it("is offered adoption, keeps its roadmap, and starts where the work already is", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Old Project")).body.id;
    // Simulate a pre-path project: strip the tree, keep an existing roadmap.
    const { db } = await import("../../server/db");
    const { projectKanbanTasks } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.delete(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, id));
    await agent.post(`/api/projects/${id}/kanban`).send({ title: "Deployed to production", status: "done" }).expect(200);

    const before = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(before.adopted).toBe(false);
    expect(before).toMatchObject({ existingTasks: 1, existingDone: 1 });

    // Adopt without Nova's read (no AI in tests); the tree is built around the existing roadmap.
    const res = await agent.post(`/api/projects/${id}/path/adopt`).send({ read: false });
    expect(res.status).toBe(200);
    expect(res.body.built).toBe(true);
    const roadmaps = await agent.get(`/api/projects/${id}/roadmap`);
    expect(roadmaps.status).toBe(200);

    // The builder catches up by hand from the map.
    const marked = await agent.post(`/api/projects/${id}/path/mark`).send({ ids: ["SHIP.M1.1", "SHIP.M1.5", "SHIP.M1.8"] });
    expect(marked.body.marked).toEqual(["SHIP.M1.1", "SHIP.M1.5", "SHIP.M1.8"]);
    const after = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(after.adopted).toBe(true);
    expect(after.mainLine.done).toBe(3);
    expect(after.next.id).toBe("SHIP.M1.2");
    // Caught-up work is progress, not pace.
    expect(after.pace.multiplier).toBeNull();
    // A second adopt is a no-op, not a second tree.
    expect((await agent.post(`/api/projects/${id}/path/adopt`).send({ read: false })).body.built).toBe(false);
    expect((await agent.get(`/api/projects/${id}/path`)).body.mainLine.total).toBe(after.mainLine.total);
  });
});

describe("Nova works the milestone", () => {
  it("choosing an option writes the answer and closes the task; a step becomes the next action", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Work Test")).body.id;
    const { saveWork, chooseWork, createExpansion } = await import("../../server/phase-trees");
    const before = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(before.next.workTaskId).toBe(before.next.taskId);
    expect(before.next.work).toBeNull();

    // Nova's options for the product statement (the AI call is stubbed by saving directly).
    const row = await saveWork(id, before.next.taskId, { kind: "options", intro: "Three emphases.", options: [
      { title: "Speed", body: "Plan a week of dinners in thirty seconds from what's already in your fridge." },
      { title: "Waste", body: "Stop throwing food away: dinners planned around what you already bought." },
      { title: "Family", body: "Weeknight dinners the whole table eats, planned from your fridge." },
    ] });
    const shown = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(shown.next.work.id).toBe(row.id);
    expect(shown.next.work.payload.options).toHaveLength(3);

    // Pick the second, with an edit. The edit wins, lands on the task, and the task is done.
    const res = await agent.post(`/api/projects/${id}/path/work/${row.id}/choose`).send({ index: 1, text: "Stop throwing food away. Dinners planned around what you already bought." });
    expect(res.status).toBe(200);
    expect(res.body.task.status).toBe("done");
    expect(res.body.task.description).toBe("Stop throwing food away. Dinners planned around what you already bought.");
    const after = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(after.next.id).toBe("SHIP.M1.2");
    expect(after.mainLine.done).toBe(1);
    // And that answer is now an artifact the rest of the path can read.
    const { collectArtifacts } = await import("../../server/phase-trees");
    expect((await collectArtifacts(id)).map((a) => a.label)).toContain("milestone:SHIP.M1.1");

    // A build accepted without text gets a summary of what was built as its answer.
    const build = await saveWork(id, after.next.taskId, { kind: "build", summary: "The loop, written down.", files: [{ path: "loop.md", language: "md", content: "1. Scan fridge" }], runSteps: [], verify: "It reads back.", assumptions: [] });
    const accepted = await chooseWork(id, build.id, {});
    expect(accepted.task.status).toBe("done");
    expect(accepted.answer).toMatch(/Files: loop.md/);
    expect(await (async () => { try { await chooseWork(id, "00000000-0000-0000-0000-000000000000", {}); return "ok"; } catch (e: any) { return e.status; } })()).toBe(404);

    // Break the loop steps into steps: the next action is now the first step, with its own task to work.
    const { created } = await createExpansion(id, "SHIP.M2.1", [{ title: "Scan the fridge", description: "Photo to inventory." }, { title: "Plan the week", description: "" }]);
    // The core loops aren't done by accepting a packet on the milestone: all five loops have to be written.
    expect((await agent.get(`/api/projects/${id}/path`)).body.next.id).toBe("SHIP.M1.2");
    await writeLoops(agent, id);
    for (const m of ["SHIP.M1.3", "SHIP.M1.4", "SHIP.M1.5", "SHIP.M1.6", "SHIP.M1.7", "SHIP.M1.8"]) {
      const marked = await agent.post(`/api/projects/${id}/path/mark`).send({ ids: [m] });
      expect(marked.status, `${m}: ${JSON.stringify(marked.body).slice(0, 200)}`).toBe(200);
    }
    const week2 = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(week2.next.id).toBe("SHIP.M2.1");
    expect(week2.next.step).toMatchObject({ taskId: created[0].id, title: "Scan the fridge" });
    expect(week2.next.workTaskId).toBe(created[0].id);
  });

  it("refuses work on a task that isn't on the path", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "run_company", "other", "Not On Path")).body.id;
    const res = await agent.post(`/api/projects/${id}/path/work`).send({ taskId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_on_path");
  });
});

describe("clicking into a step", () => {
  it("shows what it asks for, what's written, what Nova produced, how it got done, and its steps", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "game", "Detail Test")).body.id;
    const { saveWork, createExpansion } = await import("../../server/phase-trees");

    const fresh = (await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.1`)).body;
    expect(fresh.phase.id).toBe("week-1");
    expect(fresh.milestone.title).toBe("Product statement");
    expect(fresh.task).toMatchObject({ status: "todo", how: "not-done", answer: null, work: null, actor: "nova-drafts" });

    const row = await saveWork(id, fresh.task.taskId, { kind: "options", intro: "", options: [{ title: "A", body: "Players stack towers under pressure." }, { title: "B", body: "B" }, { title: "C", body: "C" }] });
    await agent.post(`/api/projects/${id}/path/work/${row.id}/choose`).send({ index: 0 }).expect(200);
    const done = (await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.1`)).body;
    expect(done.task).toMatchObject({ status: "done", how: "done", answer: "Players stack towers under pressure." });
    expect(done.task.work.chosenIndex).toBe(0);

    await agent.post(`/api/projects/${id}/path/mark`).send({ ids: ["SHIP.M1.4"] });
    expect((await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.4`)).body.task.how).toBe("you-marked");

    const { created } = await createExpansion(id, "SHIP.M2.1", [{ title: "Move", description: "" }, { title: "Stack", description: "" }]);
    await agent.patch(`/api/kanban/${created[0].id}`).send({ status: "done" }).expect(200);
    const loop = (await agent.get(`/api/projects/${id}/path/milestones/SHIP.M2.1`)).body;
    expect(loop.steps.map((s: any) => [s.title, s.status])).toEqual([["Move", "done"], ["Stack", "todo"]]);
    expect(loop.milestone.description).toMatch(/moment-to-moment/); // the game variant

    expect((await agent.get(`/api/projects/${id}/path/milestones/NOPE`)).status).toBe(404);
  });
});

describe("re-evaluating where the project is", () => {
  it("fills in what a done milestone says from the read, and never overwrites what the builder wrote", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Reeval Test")).body.id;
    const { reconcileMilestones } = await import("../../server/phase-trees");

    // A first read marks two done, one with content from the brief, one without.
    const first = await reconcileMilestones(id, [
      { id: "SHIP.M1.1", evidence: "one-liner in the brief", answer: "Plans a week of dinners from what is already in the fridge." },
      { id: "SHIP.M1.4", evidence: "audit shows Next.js + Postgres", answer: "" },
    ], "nova");
    expect(first).toEqual({ marked: ["SHIP.M1.1", "SHIP.M1.4"], filled: ["SHIP.M1.1"] });
    const stack = (await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.4`)).body.task;
    expect(stack).toMatchObject({ status: "done", how: "nova-recognised", answer: null });

    // A later read finds the stack in the audit: the empty one is filled, the written one is left alone.
    const second = await reconcileMilestones(id, [
      { id: "SHIP.M1.1", evidence: "brief", answer: "SOMETHING ELSE" },
      { id: "SHIP.M1.4", evidence: "audit", answer: "Next.js 14, Postgres via Drizzle, Vercel." },
    ], "nova");
    expect(second).toEqual({ marked: [], filled: ["SHIP.M1.4"] });
    expect((await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.1`)).body.task.answer).toBe("Plans a week of dinners from what is already in the fridge.");
    expect((await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.4`)).body.task.answer).toBe("Next.js 14, Postgres via Drizzle, Vercel.");
    // The filled answer is now an artifact for the rest of the path.
    const { collectArtifacts } = await import("../../server/phase-trees");
    expect((await collectArtifacts(id)).map((a) => a.label)).toEqual(expect.arrayContaining(["milestone:SHIP.M1.1", "milestone:SHIP.M1.4"]));
  });
});

describe("more than one loop", () => {
  it("starts with the five kinds, takes more product loops, and rolls the milestones up over all of them", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Loops Test")).body.id;
    const { createExpansion } = await import("../../server/phase-trees");

    // Born with a slot for each kind, product first.
    const seeded = (await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.2`)).body;
    expect(seeded.loops.map((l: any) => [l.title, l.type])).toEqual([
      ["Product loop", "product"], ["Growth loop", "growth"], ["Retention loop", "retention"], ["Revenue loop", "revenue"], ["Referral loop", "referral"],
    ]);

    const build = await agent.post(`/api/projects/${id}/path/loops`).send({ backboneId: "SHIP.M1.2", title: "Build", description: "1. Create project 2. Check in 3. Get feedback", type: "product" });
    expect(build.status).toBe(200);
    expect(build.body.tags).toEqual(expect.arrayContaining(["parent:SHIP.M1.2", "kind:loop", "loop-type:product"]));
    const feed = (await agent.post(`/api/projects/${id}/path/loops`).send({ backboneId: "SHIP.M1.2", title: "The feed" })).body;
    expect(feed.tags).toContain("loop-type:product");
    expect((await agent.post(`/api/projects/${id}/path/loops`).send({ backboneId: "SHIP.M1.2", title: "" })).status).toBe(400);
    const second = await agent.post(`/api/projects/${id}/path/loops`).send({ backboneId: "SHIP.M1.2", title: "Ads", type: "growth" });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("loop_type_taken");

    // Retyping holds to the same rule, and the last of a kind can't be retyped away or removed.
    const growthSlot = seeded.loops[1];
    expect((await agent.patch(`/api/projects/${id}/path/loops/${feed.id}`).send({ type: "growth" })).body.code).toBe("loop_type_taken");
    expect((await agent.patch(`/api/projects/${id}/path/loops/${growthSlot.taskId}`).send({ type: "product" })).body.code).toBe("loop_required");
    expect((await agent.delete(`/api/projects/${id}/path/loops/${growthSlot.taskId}`)).body.code).toBe("loop_required");

    // The core loops show every loop, and aren't done until each is written.
    const core = (await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.2`)).body;
    expect(core.isSource).toBe(true);
    expect(core.loops.map((l: any) => l.title)).toEqual(["Product loop", "Growth loop", "Retention loop", "Revenue loop", "Referral loop", "Build", "The feed"]);
    for (const m of ["SHIP.M1.1"]) await agent.post(`/api/projects/${id}/path/mark`).send({ ids: [m] });
    let status = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(status.next.id).toBe("SHIP.M1.2");
    expect(status.next.loops.map((l: any) => l.title)).toEqual(["Product loop", "Build", "The feed", "Growth loop", "Retention loop", "Revenue loop", "Referral loop"]);
    expect(status.next.missingLoopTypes).toEqual([]);
    expect(status.next.step).toMatchObject({ taskId: seeded.loops[0].taskId, isLoop: true });

    // Expanding without a write-up on the feed loop is refused; the build loop has one.
    const noText = await agent.post(`/api/projects/${id}/path/expand`).send({ backboneId: "SHIP.M2.1", loopTaskId: feed.id });
    expect(noText.status).toBe(400);
    expect(noText.body).toMatchObject({ code: "artifact_missing", sourceTitle: "The feed", sourceTaskId: feed.id });
    expect((await agent.post(`/api/projects/${id}/path/expand`).send({ backboneId: "SHIP.M2.1", loopTaskId: "nope" })).body.code).toBe("not_on_path");

    const a = await createExpansion(id, "SHIP.M2.1", [{ title: "Create project", description: "" }, { title: "Check in", description: "" }], { loopTaskId: build.body.id });
    const b = await createExpansion(id, "SHIP.M2.1", [{ title: "Open the feed", description: "" }], { loopTaskId: feed.id });
    expect(a.created).toHaveLength(2);
    expect(b.created).toHaveLength(1);
    expect(b.created[0].tags).toContain(`loop:${feed.id}`);
    // A second expansion of the same loop is a no-op; a manual step appends.
    expect((await createExpansion(id, "SHIP.M2.1", [{ title: "Again", description: "" }], { loopTaskId: build.body.id })).created).toHaveLength(0);
    const manual = await agent.post(`/api/projects/${id}/path/steps`).send({ backboneId: "SHIP.M2.1", loopTaskId: feed.id, title: "Reply to a check-in" });
    expect(manual.status).toBe(200);
    expect(manual.body.created[0].tags).toContain(`loop:${feed.id}`);

    const loopSteps = (await agent.get(`/api/projects/${id}/path/milestones/SHIP.M2.1`)).body;
    expect(loopSteps.sourceLoops.filter((l: any) => l.expanded).map((l: any) => l.title)).toEqual(["Build", "The feed"]);
    expect(loopSteps.steps.filter((s: any) => s.loopTaskId === feed.id).map((s: any) => s.title)).toEqual(["Open the feed", "Reply to a check-in"]);

    // Loop steps is done only when every step of every loop is done.
    for (const t of [...a.created, ...b.created]) await agent.patch(`/api/kanban/${t.id}`).send({ status: "done" });
    let m21 = (await agent.get(`/api/projects/${id}/path`)).body.phases[1].milestones.find((m: any) => m.id === "SHIP.M2.1");
    expect(m21.steps).toEqual({ done: 3, total: 4 });
    expect(m21.done).toBe(false);
    await agent.patch(`/api/kanban/${manual.body.created[0].id}`).send({ status: "done" });
    m21 = (await agent.get(`/api/projects/${id}/path`)).body.phases[1].milestones.find((m: any) => m.id === "SHIP.M2.1");
    expect(m21.done).toBe(true);
    // Writing the two product loops isn't enough: the core loops wait for all five kinds.
    for (const l of [build.body.id, feed.id]) await agent.patch(`/api/kanban/${l}`).send({ status: "done", description: "written" });
    status = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(status.phases[0].milestones.find((m: any) => m.id === "SHIP.M1.2").done).toBe(false);
    expect(status.loopTree.coverage.unwritten).toEqual(["growth", "retention", "revenue", "referral"]);
    await writeLoops(agent, id);
    status = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(status.phases[0].milestones.find((m: any) => m.id === "SHIP.M1.2").done).toBe(true);
    expect(status.loopTree).toMatchObject({ coverage: { complete: true }, competitionDue: true, competition: null });
    expect(status.next.id).toBe("SHIP.M1.3");
  });
});

describe("keep building", () => {
  it("is offered when week 2 is done, chosen explicitly, worked by Nova, extended again, and left explicitly", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Branch Test")).body.id;
    const week = (n: number) => (async () => (await agent.get(`/api/projects/${id}/path`)).body.phases.find((p: any) => p.id === `week-${n}`).milestones.map((m: any) => m.id))();
    await writeLoops(agent, id);

    await agent.post(`/api/projects/${id}/path/mark`).send({ ids: await week(1) });
    let s = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(s.offer).toBeNull();
    await agent.post(`/api/projects/${id}/path/mark`).send({ ids: await week(2) });
    s = (await agent.get(`/api/projects/${id}/path`)).body;
    // Week 2 done: week 3 would be next, and the extension is offered instead of skipped.
    expect(s.current.id).toBe("week-3");
    expect(s.offer).toMatchObject({ phaseId: "branch-build" });
    expect(s.branch).toBeNull();

    expect((await agent.post(`/api/projects/${id}/path/branch`).send({ phaseId: "week-3" })).status).toBe(400);
    const chosen = await agent.post(`/api/projects/${id}/path/branch`).send({ phaseId: "branch-build" });
    expect(chosen.status).toBe(200);
    s = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(s.current).toMatchObject({ id: "branch-build", optional: true, step: 1, of: 4 });
    expect(s.next.id).toBe("SHIP.B.1");
    expect(s.offer).toBeNull();
    expect(s.branch).toMatchObject({ phaseId: "branch-build", open: true, round: 1 });

    // Work through the round; branch work is pace.
    const beforeEvents = s.events.length;
    const kanban = await agent.get(`/api/projects/${id}/kanban`);
    expect(kanban.status, JSON.stringify(kanban.body).slice(0, 300)).toBe(200);
    const tasks = kanban.body;
    for (const b of ["SHIP.B.1", "SHIP.B.2", "SHIP.B.3"]) await agent.patch(`/api/kanban/${tasks.find((t: any) => t.tags?.includes(`backbone:${b}`)).id}`).send({ status: "done" });
    s = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(s.next.id).toBe("SHIP.B.4");
    // Writing the loops was already effort; the branch's own work adds to it.
    expect(s.events.length).toBeGreaterThan(beforeEvents);
    expect(s.pace.multiplier).not.toBeNull();

    // Extend again: the branch reopens as round 2.
    const again = await agent.post(`/api/projects/${id}/path/branch`).send({ phaseId: "branch-build", extend: true });
    expect(again.body.round).toBe(2);
    s = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(s.current).toMatchObject({ id: "branch-build", step: 1 });
    expect(s.branch.round).toBe(2);

    // Leave: back to the main line at week 3. Leaving sticks — no re-offer; the map has the way back.
    await agent.post(`/api/projects/${id}/path/branch`).send({ phaseId: null }).expect(200);
    s = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(s.current.id).toBe("week-3");
    expect(s.branch).toBeNull();
    expect(s.offer).toBeNull();
    await agent.post(`/api/projects/${id}/path/branch`).send({ phaseId: "branch-build" }).expect(200);
    expect((await agent.get(`/api/projects/${id}/path`)).body.current.id).toBe("branch-build");
  });
});

describe("the plan re-sizes for the loops you're going for", () => {
  it("fills the empty slots with the loops Nova found, marks built ones done, never duplicates, and stretches the plan per product loop", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Resize Test")).body.id;
    const { reconcileLoops } = await import("../../server/phase-trees");

    const five = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(five.plan).toMatchObject({ loops: 5, productLoops: 1, authoredDays: 28 });
    const baseTotal = five.plan.totalMinutes;

    await agent.post(`/api/projects/${id}/path/loops`).send({ backboneId: "SHIP.M1.2", title: "Build" });
    const r = await reconcileLoops(id, [
      { title: "build", steps: "create → check in → feedback", state: "built", evidence: "tasks done", type: "product" },
      { title: "The feed", steps: "open → read → react → follow", state: "partly", evidence: "feed routes exist", type: "product" },
      { title: "Backing", steps: "browse → back → get updates", state: "planned", evidence: "in scope", type: "product" },
      { title: "Public check-ins", steps: "post → indexed → stranger lands → signs up", state: "partly", evidence: "", type: "growth" },
      { title: "Paid ads", steps: "ad → click → sign up", state: "planned", evidence: "", type: "growth" },
    ]);
    expect(r.created).toHaveLength(1);       // Backing: the product slot went to The feed
    expect(r.updated).toHaveLength(4);       // build: steps and done; the product slot; the growth slot. Paid ads: growth is taken.
    const core = (await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.2`)).body;
    expect(core.loops.map((l: any) => [l.title, l.type, l.status])).toEqual([
      ["The feed", "product", "todo"], ["Public check-ins", "growth", "todo"], ["Retention loop", "retention", "todo"], ["Revenue loop", "revenue", "todo"], ["Referral loop", "referral", "todo"],
      ["Build", "product", "done"], ["Backing", "product", "todo"],
    ]);
    expect(core.loops[5].answer).toBe("create → check in → feedback");

    const seven = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(seven.plan).toMatchObject({ loops: 7, productLoops: 3, authoredDays: 42 });
    // Loop steps is now seven loops' worth: 2 × 3h more than the five-loop plan.
    expect(seven.plan.totalMinutes - baseTotal).toBe(2 * 180);
    // A second read of the same loops changes nothing.
    const again = await reconcileLoops(id, [{ title: "The Feed", steps: "x", state: "planned", evidence: "" }]);
    expect(again).toEqual({ created: [], updated: [] });
  });
});

describe("the loop tree", () => {
  it("shows each loop as a branch with its state and its steps, and any node's work is readable", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Tree Test")).body.id;
    const { createExpansion, reconcileLoops, saveWork } = await import("../../server/phase-trees");

    let tree = (await agent.get(`/api/projects/${id}/path`)).body.loopTree;
    expect(tree).toMatchObject({ sourceId: "SHIP.M1.2", fanOutId: "SHIP.M2.1", competitionDue: false, closureAuditAt: null });
    expect(tree.loops.map((l: any) => [l.type, l.state])).toEqual([["product", "unwritten"], ["growth", "unwritten"], ["retention", "unwritten"], ["revenue", "unwritten"], ["referral", "unwritten"]]);
    await reconcileLoops(id, [
      { title: "Build", steps: "create → check in → feedback", state: "built", evidence: "" },
      { title: "The feed", steps: "open → read → react", state: "partly", evidence: "" },
      { title: "Backing", steps: "", state: "planned", evidence: "" },
    ]);
    tree = (await agent.get(`/api/projects/${id}/path`)).body.loopTree;
    expect(tree.loops.slice(0, 3).map((l: any) => [l.title, l.state, l.written])).toEqual([["Build", "written", true], ["The feed", "written", true], ["Backing", "unwritten", false]]);

    const feed = tree.loops[1];
    const { created } = await createExpansion(id, "SHIP.M2.1", [{ title: "Open the feed", description: "" }, { title: "React", description: "" }], { loopTaskId: feed.taskId });
    tree = (await agent.get(`/api/projects/${id}/path`)).body.loopTree;
    expect(tree.loops[1]).toMatchObject({ state: "planned", done: 0, total: 2 });
    await agent.patch(`/api/kanban/${created[0].id}`).send({ status: "done" });
    tree = (await agent.get(`/api/projects/${id}/path`)).body.loopTree;
    expect(tree.loops[1]).toMatchObject({ state: "building", done: 1, total: 2 });
    expect(tree.loops[1].steps.map((s: any) => [s.title, s.status])).toEqual([["Open the feed", "done"], ["React", "todo"]]);
    await agent.patch(`/api/kanban/${created[1].id}`).send({ status: "done" });
    expect((await agent.get(`/api/projects/${id}/path`)).body.loopTree.loops[1].state).toBe("built");

    // Any node's work is readable on its own, for the tree to open lazily.
    expect((await agent.get(`/api/projects/${id}/path/work/${created[1].id}`)).body).toEqual({ work: null });
    const w = await saveWork(id, created[1].id, { kind: "template", intro: "", template: "x", whatNovaDid: "", whatIsLeft: "" });
    expect((await agent.get(`/api/projects/${id}/path/work/${created[1].id}`)).body.work.id).toBe(w.id);
    expect((await agent.get(`/api/projects/${id}/path/work/00000000-0000-0000-0000-000000000000`)).status).toBe(404);

    // The latest codebase audit's closure verdicts land on their loops.
    const { db } = await import("../../server/db");
    const { projectCodeAudits, projects } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const [proj] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, id));
    const build = tree.loops[0];
    await db.insert(projectCodeAudits).values({ projectId: id, createdById: proj.ownerId, source: "github:x/y@main", sourceKind: "github", findings: { loops: [
      { loopTaskId: build.taskId, title: "Build", type: "product", closure: "open", stages: [], returnPath: null, breaksAt: "Feedback never notifies the builder", fix: "Email on comment" },
    ] } as any } as any);
    tree = (await agent.get(`/api/projects/${id}/path`)).body.loopTree;
    expect(tree.closureAuditAt).toBeTruthy();
    expect(tree.loops[0].closure).toMatchObject({ closure: "open", breaksAt: "Feedback never notifies the builder" });
    expect(tree.loops[1].closure).toBeNull();
  });
});

describe("a wrong loop can be removed", () => {
  it("takes its unfinished steps with it and keeps finished work on the board", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Remove Test")).body.id;
    const { createExpansion, reconcileLoops } = await import("../../server/phase-trees");

    const r = await reconcileLoops(id, [
      { title: "Weekly check-in", steps: "post → get comments → post again", state: "built", evidence: "" },
      { title: "Explore the feed", steps: "open → read → react → follow", state: "partly", evidence: "" },
    ]);
    expect(r).toMatchObject({ created: [expect.any(String)], updated: expect.arrayContaining([expect.any(String)]) });
    const products = (t: any) => t.loops.filter((l: any) => l.type === "product").map((l: any) => l.title);
    let tree = (await agent.get(`/api/projects/${id}/path`)).body.loopTree;
    expect(products(tree)).toEqual(["Weekly check-in", "Explore the feed"]);

    // The second one was a feature after all. Give it steps, finish one, then remove it.
    const feed = tree.loops[1];
    const { created } = await createExpansion(id, "SHIP.M2.1", [{ title: "Open", description: "" }, { title: "React", description: "" }], { loopTaskId: feed.taskId });
    await agent.patch(`/api/kanban/${created[0].id}`).send({ status: "done" });
    const del = await agent.delete(`/api/projects/${id}/path/loops/${feed.taskId}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ removedSteps: 1, keptSteps: 1 });
    tree = (await agent.get(`/api/projects/${id}/path`)).body.loopTree;
    expect(products(tree)).toEqual(["Weekly check-in"]);
    expect(tree.unassigned.map((u: any) => u.title)).toEqual(["Open"]);
    expect((await agent.delete(`/api/projects/${id}/path/loops/${feed.taskId}`)).status).toBe(404);
    expect((await agent.get(`/api/projects/${id}/path`)).body.plan).toMatchObject({ loops: 5, productLoops: 1 });
    // The one product loop left can't go.
    expect((await agent.delete(`/api/projects/${id}/path/loops/${tree.loops[0].taskId}`)).body.code).toBe("loop_required");

    // Removed means removed: the next read can't bring it back, even renamed — until the builder adds it by hand.
    const { reconcileLoops: again } = await import("../../server/phase-trees");
    const back = await again(id, [
      { title: "Explore the feed and follow builders", steps: "open → follow", state: "built", evidence: "" },
      { title: "Back a project", steps: "browse → back → get updates", state: "planned", evidence: "" },
    ]);
    expect(back.created).toHaveLength(1);
    expect(products((await agent.get(`/api/projects/${id}/path`)).body.loopTree)).toEqual(["Weekly check-in", "Back a project"]);
    await agent.post(`/api/projects/${id}/path/loops`).send({ backboneId: "SHIP.M1.2", title: "Explore the feed" }).expect(200);
    expect((await agent.get(`/api/projects/${id}`)).body.rejectedLoops).toEqual([]);
  });
});

describe("telling Nova something durable", () => {
  it("keeps the builder's note on the project and puts it at the top of every Nova read", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Notes Test")).body.id;
    const res = await agent.put(`/api/projects/${id}/nova-notes`).send({ notes: "  Check-ins are being removed. My loops are the three paths.  " });
    expect(res.status).toBe(200);
    expect(res.body.notes).toBe("Check-ins are being removed. My loops are the three paths.");
    expect((await agent.get(`/api/projects/${id}/path`)).body.novaNotes).toBe("Check-ins are being removed. My loops are the three paths.");

    const { buildOperableProjectState } = await import("../../server/project-operations");
    const state = await buildOperableProjectState(id, { includeIds: false, includeAudit: false });
    const at = state.indexOf("THE BUILDER'S STANDING NOTES TO NOVA");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(state.indexOf("BRIEF FIELDS"));
    expect(state.slice(at)).toMatch(/Check-ins are being removed/);

    await agent.put(`/api/projects/${id}/nova-notes`).send({ notes: "" }).expect(200);
    expect((await buildOperableProjectState(id, { includeIds: false, includeAudit: false })).includes("STANDING NOTES")).toBe(false);
  });
});

describe("verified by the audit", () => {
  it("marks the milestones an audit can prove, stamps already-done ones, never undoes, and counts code movement as activity", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Verify Test")).body.id;
    const { verifyMilestonesFromAudit } = await import("../../server/phase-tree-verifiers");
    await agent.post(`/api/projects/${id}/path/mark`).send({ ids: ["SHIP.M3.5"] });

    const proof = {
      id: "audit-1",
      signals: { serverEntry: "server/app.ts", stack: [{ name: "Express", evidence: "package.json" }, { name: "Drizzle ORM", evidence: "package.json" }] },
      findings: { capabilities: [{ area: "auth", status: "built", summary: "", evidence: [] }, { area: "data", status: "built", summary: "", evidence: [] }, { area: "analytics", status: "built", summary: "", evidence: [] }] },
      runtime: { liveUrl: { url: "https://example.com/", ok: true, status: 200, ms: 120 }, health: null, surfaces: null, env: { referenced: 0, setThere: null, missingThere: null, note: "not checked" } },
    };
    const r = await verifyMilestonesFromAudit(id, proof as any);
    expect(r.marked.sort()).toEqual(["SHIP.M1.5", "SHIP.M1.8", "SHIP.M2.4"]);
    expect(r.verified.sort()).toEqual(["SHIP.M1.5", "SHIP.M1.8", "SHIP.M2.4", "SHIP.M3.5"]);
    const deploy = (await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.8`)).body.task;
    expect(deploy).toMatchObject({ status: "done", how: "verified" });
    expect(deploy.answer).toMatch(/Verified by the codebase audit: live URL answers 200/);
    expect((await agent.get(`/api/projects/${id}/path/milestones/SHIP.M3.5`)).body.task.how).toBe("verified");

    // A weaker audit later doesn't undo anything, and doesn't re-stamp.
    const weak = { id: "audit-2", signals: {}, findings: { capabilities: [] }, runtime: null };
    expect(await verifyMilestonesFromAudit(id, weak as any)).toEqual({ verified: [], marked: [] });
    expect((await agent.get(`/api/projects/${id}/path/milestones/SHIP.M1.8`)).body.task.status).toBe("done");

    // An audit whose delta says the code moved is a day of activity for pace.
    const { db } = await import("../../server/db");
    const { projectCodeAudits, projects } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const owner_ = (await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, id)))[0].ownerId;
    await db.update(projects).set({ createdAt: new Date(Date.now() - 20 * 86_400_000) }).where(eq(projects.id, id));
    await db.insert(projectCodeAudits).values({ projectId: id, createdById: owner_, source: "github:x/y@main", sourceKind: "github", delta: { changed: true } as any, createdAt: new Date(Date.now() - 2 * 86_400_000) } as any);
    // Reset pace so the recalculation reads activity fresh.
    const { pathPace } = await import("@shared/schema");
    await db.delete(pathPace).where(eq(pathPace.projectId, id));
    const s = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(s.pace.state).toBe("active");
  });
});
