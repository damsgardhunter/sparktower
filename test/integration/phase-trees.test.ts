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
    expect(path.body.next).toMatchObject({ id: "SHIP.M1.1", actor: "novva-drafts", title: "Product statement" });
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
    expect(first.tags).toEqual(expect.arrayContaining(["actor:novva-drafts", "tier:artifact", "shared:SH-01"]));
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
