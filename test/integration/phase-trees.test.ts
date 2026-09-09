/**
 * A project is born with its path. The backbone is data, so what is tested is
 * the instantiation and the adaptation: the right tree for the goal, the
 * right variant text for the type, skipped milestones actually skipped, and
 * the status endpoint answering "where am I, what's next, who acts".
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { resolveTree, mainLineMilestones, PATH_TREES } from "@shared/phase-trees";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
async function owner(app: any) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").send({ email: `pt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password });
  return agent;
}
const create = (agent: any, goal: string, subcategory: string, title = "Tree Test") =>
  agent.post("/api/projects").send({ title, description: "A project that should be born with a path to walk.", category: "saas", goal, subcategory });

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
    const loan = mainLineMilestones(resolveTree("raise_funding", "loan_grant"));
    expect(loan.find((m) => m.id === "FUND.M1.2")!.description).toMatch(/counts backward/);
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
    const first = tasks.find((t: any) => t.tags?.includes("backbone:SYS.M1.1"));

    await agent.patch(`/api/kanban/${first.id}`).send({ status: "done" }).expect(200);

    const path = await agent.get(`/api/projects/${id}/path`);
    expect(path.body.current).toMatchObject({ id: "week-1", step: 2, of: 5 });
    expect(path.body.next.id).toBe("SYS.M1.2");
    expect(path.body.next.description).toMatch(/recipe consistency/);
    expect(path.body.mainLine.done).toBe(1);
  });

  it("does not build a second tree if creation is retried", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "raise_funding", "startup_equity")).body.id;
    const { instantiatePathTree } = await import("../../server/phase-trees");
    const again = await instantiatePathTree(id, "raise_funding", "startup_equity");
    expect(again.created).toBe(false);
    const path = await agent.get(`/api/projects/${id}/path`);
    expect(path.body.mainLine.total).toBe(mainLineMilestones(resolveTree("raise_funding", "startup_equity")).length);
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
    expect(res.body.message).toMatch(/core loop/i);
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

  it("injected tasks are capped per phase and must name an artifact", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "systemize_business", "service", "Inject Test")).body.id;
    // Nothing to ground in yet.
    const empty = await agent.post(`/api/projects/${id}/path/inject`).send({ phaseId: "week-1" });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("no_artifacts");

    const { createInjections } = await import("../../server/phase-trees");
    const artifacts = [{ label: "check-in:x", kind: "check-in" as const, text: "Shipped the intake form" }];
    const r = await createInjections(id, "week-1", [
      { title: "Wire intake to the CRM", description: "", artifact: "check-in:x", estimateHours: 2 },
      { title: "Ungrounded", description: "", artifact: "nope" },
      { title: "Two", description: "", artifact: "check-in:x" },
      { title: "Three", description: "", artifact: "check-in:x" },
      { title: "Four", description: "", artifact: "check-in:x" },
    ], artifacts);
    expect(r.created.map((t: any) => t.title)).toEqual(["Wire intake to the CRM", "Two", "Three"]);
    expect(r.dropped).toEqual([{ title: "Ungrounded", reason: "no artifact named" }, { title: "Four", reason: "phase is at its cap" }]);
    expect(r.created[0].tags).toEqual(expect.arrayContaining(["injected:week-1", "artifact:check-in:x"]));

    const status = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(status.phases[0].injected).toHaveLength(3);
    expect(status.phases[0].injectRoom).toBe(0);
    const full = await agent.post(`/api/projects/${id}/path/inject`).send({ phaseId: "week-1" });
    expect(full.status).toBe(409);
    expect(full.body.code).toBe("phase_at_cap");
  });

  it("switching paths carries shared milestones across and keeps the old work visible", async () => {
    const app = await getTestApp();
    const agent = await owner(app);
    const id = (await create(agent, "ship_mvp", "saas", "Switch Test")).body.id;
    const tasks = (await agent.get(`/api/projects/${id}/kanban`)).body;
    // Product statement is SH-01, shared with the raise path.
    const positioning = tasks.find((t: any) => t.tags?.includes("shared:SH-01"));
    await agent.patch(`/api/kanban/${positioning.id}`).send({ status: "done", description: "For founders who cook: a planner that reads the fridge." }).expect(200);

    const bad = await agent.post(`/api/projects/${id}/path/switch`).send({ goal: "raise_funding", subcategory: "restaurant" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("subcategory_mismatch");

    const res = await agent.post(`/api/projects/${id}/path/switch`).send({ goal: "raise_funding", subcategory: "startup_equity" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: { goal: "ship_mvp" }, to: { goal: "raise_funding" }, carried: 1 });

    const project = (await agent.get(`/api/projects/${id}`)).body;
    expect(project.goal).toBe("raise_funding");
    const path = (await agent.get(`/api/projects/${id}/path`)).body;
    expect(path.goal).toBe("raise_funding");
    expect(path.phases[0].milestones[0].id).toBe("FUND.M1.1");
    // Positioning (SH-01) arrives done; the tier 0 research (SH-06) wasn't done, so it doesn't.
    const all = path.phases.flatMap((p: any) => p.milestones);
    expect(all.filter((m: any) => m.done).map((m: any) => m.id)).toEqual(["FUND.M1.7"]);
    const carriedTask = (await agent.get(`/api/projects/${id}/kanban`)).body.find((t: any) => t.tags?.includes("carried:ship_mvp"));
    expect(carriedTask.status).toBe("done");
    expect(carriedTask.description).toMatch(/Carried over from Ship an MVP/);
    // The old path's tasks are still on the board, marked, and out of the maths.
    const archived = (await agent.get(`/api/projects/${id}/kanban`)).body.filter((t: any) => t.tags?.includes("archived:ship_mvp"));
    expect(archived.length).toBeGreaterThan(20);
    expect(path.mainLine.done).toBe(1);
    // Pace starts fresh, but the log of what they did before stays visible.
    expect(path.pace.multiplier).toBeNull();
    expect(path.events.map((e: any) => e.backboneId)).toEqual(["SHIP.M1.1"]);
  });
});
