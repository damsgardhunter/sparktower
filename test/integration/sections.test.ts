/**
 * A project works its three sections side by side — Ship an MVP, Systemize
 * the business (which now holds the funding routes), Run the company.
 * Starting one builds its path without touching the others; each section's status, progress, route, pace and next step are
 * its own; files and tracked events can belong to a section or be shared; and
 * the home card offers the next step on every section someone has started.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { projects } from "@shared/schema";
import { goalOfBackboneId } from "@shared/goals";

afterAll(async () => { await closeTestApp(); });

async function founder(app: any) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").send({ email: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: "Sections" });
  expect(res.status).toBe(201);
  const project = (await agent.post("/api/projects").send({ title: "Three Ways", description: "A product that also wants to run as a business and raise money.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
  return { agent, userId: res.body.id as string, projectId: project.id as string };
}
const board = async (agent: any, id: string) => (await agent.get(`/api/projects/${id}/kanban`)).body as any[];
const taskFor = async (agent: any, id: string, backbone: string) => (await board(agent, id)).find((t) => t.tags?.includes(`backbone:${backbone}`));

describe("sections", () => {
  it("start without touching each other, and keep their own progress, route and next step", async () => {
    const app = await getTestApp();
    const { agent, projectId } = await founder(app);

    let sections = (await agent.get(`/api/projects/${projectId}/tracks`)).body;
    expect(sections.primary).toBe("ship_mvp");
    expect(sections.tracks.map((s: any) => [s.goal, s.started])).toEqual([["ship_mvp", true], ["systemize_business", false], ["run_company", false]]);

    const shipBefore = (await agent.get(`/api/projects/${projectId}/path`)).body;
    expect((await agent.get(`/api/projects/${projectId}/path?goal=systemize_business`)).body).toMatchObject({ adopted: false, started: false, goal: "systemize_business" });
    expect((await agent.get(`/api/projects/${projectId}/path?goal=nonsense`)).status).toBe(400);

    // Starting: the kind must fit the section.
    expect((await agent.post(`/api/projects/${projectId}/tracks`).send({ goal: "systemize_business", subcategory: "saas" })).body.code).toBe("subcategory_mismatch");
    const started = await agent.post(`/api/projects/${projectId}/tracks`).send({ goal: "systemize_business", subcategory: "service" });
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ started: true, goal: "systemize_business", created: true });
    expect((await agent.post(`/api/projects/${projectId}/tracks`).send({ goal: "systemize_business", subcategory: "service" })).body.started).toBe(false);

    // Ship is exactly as it was: nothing archived, same next step. The project's primary path hasn't moved.
    const shipAfter = (await agent.get(`/api/projects/${projectId}/path`)).body;
    expect(shipAfter.goal).toBe("ship_mvp");
    expect(shipAfter.next.id).toBe(shipBefore.next.id);
    expect(shipAfter.mainLine).toEqual(shipBefore.mainLine);
    expect((await board(agent, projectId)).filter((t) => t.tags?.some((x: string) => x.startsWith("archived:"))).length).toBe(0);
    const [row] = await db.select({ goal: projects.goal, capitalRoute: projects.capitalRoute }).from(projects).where(eq(projects.id, projectId));
    expect(row.goal).toBe("ship_mvp");

    // Systemize has its own tree and next step. Its funding milestones kept
    // their FUND. ids, so "its own" means every id reads as Systemize's.
    let sys = (await agent.get(`/api/projects/${projectId}/path?goal=systemize_business`)).body;
    /*
     * A link or an older client still asking for the retired funding section
     * gets Systemize — which holds the funding routes now — rather than a 400
     * for a name the product used to hand out itself.
     */
    const legacy = await agent.get(`/api/projects/${projectId}/path?goal=raise_funding`);
    expect(legacy.status).toBe(200);
    expect(legacy.body.goal).toBe("systemize_business");
    expect(sys).toMatchObject({ adopted: true, started: true, primary: false, goal: "systemize_business" });
    expect(sys.next.id).toBe("SYS.F1.1");
    const sysIds: string[] = sys.phases.flatMap((p: any) => p.milestones.map((m: any) => m.id));
    expect(sysIds.every((id) => goalOfBackboneId(id) === "systemize_business")).toBe(true);
    expect(sysIds).toContain("FUND.C2.2");

    // Finishing a step on Systemize moves Systemize, not Ship; its pace is its own.
    await agent.patch(`/api/kanban/${(await taskFor(agent, projectId, "SYS.F1.1")).id}`).send({ status: "done" }).expect(200);
    sys = (await agent.get(`/api/projects/${projectId}/path?goal=systemize_business`)).body;
    expect(sys.mainLine.done).toBe(1);
    expect(sys.events.map((e: any) => e.backboneId)).toEqual(["SYS.F1.1"]);
    const ship = (await agent.get(`/api/projects/${projectId}/path`)).body;
    expect(ship.mainLine.done).toBe(0);
    expect(ship.events).toEqual([]);
    // The capital profile is Systemize's, not something every section carries.
    expect(ship.capital).toBeNull();

    // A funding route chosen on Systemize is Systemize's, kept on its section, not on the project.
    for (const id of [
      "SYS.F1.2", "SYS.F1.3", "SYS.F1.4", "SYS.F1.5", "SYS.F1.6", "SYS.F2.1", "SYS.F2.2", "SYS.F2.3", "SYS.F2.4", "SYS.F3.1", "SYS.F3.2", "SYS.F3.3",
      "FUND.C1.1", "FUND.C1.2", "FUND.C1.3", "FUND.C1.4", "FUND.C1.5", "FUND.C1.6", "FUND.C2.1",
    ]) {
      const t = await taskFor(agent, projectId, id);
      if (t) await agent.patch(`/api/kanban/${t.id}`).send({ status: "done" }).expect(200);
    }
    const routeTask = (await taskFor(agent, projectId, "FUND.C2.2")).id;
    expect((await agent.post(`/api/projects/${projectId}/path/intake`).send({ taskId: routeTask, answers: { route: "seller" } })).body.route).toBe("seller");
    sys = (await agent.get(`/api/projects/${projectId}/path?goal=systemize_business`)).body;
    expect(sys.capital.route).toBe("seller");
    expect(sys.next.id).toBe("FUND.S1.1");
    const [after] = await db.select({ capitalRoute: projects.capitalRoute }).from(projects).where(eq(projects.id, projectId));
    expect(after.capitalRoute).toBeNull();

    // Every section, with its progress, for the section buttons.
    sections = (await agent.get(`/api/projects/${projectId}/tracks`)).body;
    expect(sections.tracks.find((s: any) => s.goal === "systemize_business")).toMatchObject({ started: true, primary: false, subcategory: "service" });
    expect(sections.tracks.find((s: any) => s.goal === "systemize_business").done).toBeGreaterThan(0);
    expect(sections.tracks.find((s: any) => s.goal === "ship_mvp")).toMatchObject({ started: true, primary: true, done: 0 });
    expect(sections.tracks.find((s: any) => s.goal === "run_company")).toMatchObject({ started: false });

    /*
     * The home card: one row for the project, on the section it is furthest
     * along — Systemize here, which has a step done, against Ship's none. The
     * sections themselves are unaffected and still keep their own progress;
     * it is the cross-project list that answers once per company rather than
     * once per section somebody has open.
     */
    const home = (await agent.get("/api/me/next-steps")).body.items.filter((i: any) => i.project.id === projectId);
    expect(home).toHaveLength(1);
    expect(home[0].track.goal).toBe("systemize_business");
  });

  it("keeps files and tracked events per section, with shared ones everywhere", async () => {
    const app = await getTestApp();
    const { agent, userId, projectId } = await founder(app);
    await agent.post(`/api/projects/${projectId}/files`).send({ name: "shared.pdf", url: "https://example.com/shared.pdf", track: null }).expect(200);
    await agent.post(`/api/projects/${projectId}/files`).send({ name: "deck.pdf", url: "https://example.com/deck.pdf", track: "systemize_business" }).expect(200);
    await agent.post(`/api/projects/${projectId}/files`).send({ name: "spec.md", url: "https://example.com/spec.md", track: "ship_mvp" }).expect(200);
    const names = async (q: string) => (await agent.get(`/api/projects/${projectId}/files${q}`)).body.map((f: any) => f.name).sort();
    expect(await names("?track=systemize_business")).toEqual(["deck.pdf", "shared.pdf"]);
    expect(await names("?track=ship_mvp")).toEqual(["shared.pdf", "spec.md"]);
    expect(await names("")).toEqual(["deck.pdf", "shared.pdf", "spec.md"]);

    // Analytics needs a plan; the section filter is what's under test.
    await db.execute(`update users set subscription_tier = 'builder' where id = '${userId}'` as any);
    await agent.post(`/api/projects/${projectId}/analytics-events`).send({ eventName: "signup", track: "ship_mvp" }).expect(200);
    await agent.post(`/api/projects/${projectId}/analytics-events`).send({ eventName: "investor_intro", track: "systemize_business" }).expect(200);
    const events = (await agent.get(`/api/projects/${projectId}/analytics-events?track=systemize_business`)).body.map((e: any) => e.eventName);
    expect(events).toEqual(["investor_intro"]);
  });

  it("clears one section's own cards, never another's, the shared ones, or the path", async () => {
    const app = await getTestApp();
    const { agent, projectId } = await founder(app);
    const add = (title: string, tags: string[], status = "todo") => agent.post(`/api/projects/${projectId}/kanban`).send({ title, tags, status }).expect(200);
    await add("Ship card", ["track:ship_mvp"]);
    await add("Ship done card", ["track:ship_mvp"], "done");
    await add("Systemize card", ["track:systemize_business"]);
    await add("Shared card", []);
    const pathTasks = (await board(agent, projectId)).filter((t) => t.tags?.some((x: string) => x.startsWith("backbone:"))).length;

    expect((await agent.delete(`/api/projects/${projectId}/kanban?track=elsewhere`)).status).toBe(400);
    expect((await agent.delete(`/api/projects/${projectId}/kanban?track=ship_mvp&status=done`)).body.removed).toBe(1);
    expect((await agent.delete(`/api/projects/${projectId}/kanban?track=ship_mvp`)).body.removed).toBe(1);
    const left = await board(agent, projectId);
    expect(left.map((t) => t.title)).toEqual(expect.arrayContaining(["Systemize card", "Shared card"]));
    expect(left.some((t) => t.title.startsWith("Ship"))).toBe(false);
    expect(left.filter((t) => t.tags?.some((x: string) => x.startsWith("backbone:"))).length).toBe(pathTasks);
  });

  it("brings back a section left by an old path switch instead of building it twice", async () => {
    const app = await getTestApp();
    const { agent, projectId } = await founder(app);
    await agent.patch(`/api/kanban/${(await taskFor(agent, projectId, "SHIP.M1.1")).id}`).send({ status: "done" }).expect(200);
    expect((await agent.post(`/api/projects/${projectId}/path/switch`).send({ goal: "systemize_business", subcategory: "service" })).status).toBe(200);
    // Ship was left: its tasks are archived. Starting it as a section restores them as they were.
    const restored = await agent.post(`/api/projects/${projectId}/tracks`).send({ goal: "ship_mvp", subcategory: "saas" });
    expect(restored.body.restored).toBeGreaterThan(20);
    const ship = (await agent.get(`/api/projects/${projectId}/path?goal=ship_mvp`)).body;
    expect(ship.adopted).toBe(true);
    expect(ship.phases[0].milestones[0]).toMatchObject({ id: "SHIP.M1.1", done: true });
    const shipIds = (await board(agent, projectId)).filter((t) => t.tags?.some((x: string) => x.startsWith("backbone:SHIP."))).map((t) => t.tags.find((x: string) => x.startsWith("backbone:")));
    expect(new Set(shipIds).size).toBe(shipIds.length); // not built twice
    expect((await agent.get(`/api/projects/${projectId}/path`)).body.goal).toBe("systemize_business");
  });
});
