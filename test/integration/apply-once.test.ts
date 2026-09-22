/**
 * Doing a thing once.
 *
 * Every "apply what was proposed" path in the app used to be replayable: an
 * audit's catch-up, Nova's suggestions, the task planner. A double click, a
 * client retry or a crash mid-run applied the whole batch a second time. The
 * path's own sync had the same shape — a read-modify-write from a plain GET —
 * so two tabs could each insert the same milestone, leaving a phantom nobody
 * could finish. And work closed by an audit or by Nova never reached the pace
 * log, so a milestone finished that way could never afterwards be shared.
 *
 * This is the regression test for all of that, plus the guards on marking
 * milestones done by hand and the way back from a wrong mark.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

let reply: any = {};
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) } };
    responses = { create: async () => ({ output_text: JSON.stringify(reply), output: [] }) };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { verifyEmail } = await import("../helpers/verify-email");
const { db } = await import("../../server/db");
const { users, projectKanbanTasks } = await import("@shared/schema");
const { and, eq } = await import("drizzle-orm");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any, name: string) {
  const agent = request.agent(app);
  n += 1;
  const email = `once-${name}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${20 + (n % 200)}`)
    .send({ email, password: "Testpass123!", firstName: name });
  expect(res.status).toBe(201);
  await verifyEmail(app, email, `203.0.114.${20 + (n % 200)}`);
  await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string, email };
}

const project = async (agent: any, title: string) => (await agent.post("/api/projects").send({
  title, description: "A meal planner that plans dinners from what's in your fridge.",
  category: "saas", goal: "ship_mvp", subcategory: "saas", oneLiner: "Dinner plans",
})).body;

const settle = () => new Promise((r) => setTimeout(r, 400));

describe("applying a batch of operations", () => {
  it("applies an audit's catch-up once, however many times it is asked", async () => {
    const app = await getTestApp();
    const me = await builder(app, "Auditor");
    const p = await project(me.agent, "Applied Once");
    await me.agent.put(`/api/projects/${p.id}/audit-settings`).send({ autoApply: "off" }).expect(200);

    const token = (await me.agent.post("/api/mcp-tokens").send({ label: "editor" })).body.token;
    reply = {
      stage: "mvp", completionPercent: 60, summary: "An MVP with a feed.", stackSummary: "React and Express",
      capabilities: [], built: [], partial: [], missing: [], undocumented: [], risks: [],
      taskReconciliation: { looksDone: [], notStarted: [] }, milestones: [], loops: [], nextThreeThings: [],
      catchUpNote: "You shipped the post page.",
      operations: [
        { op: "create_task", title: "Post page with comments", status: "done", description: "client/src/pages/post.tsx" },
        { op: "create_task", title: "Comment reactions", status: "done", description: "server/index.ts" },
        { op: "create_task", title: "Add Stripe checkout", priority: "high" },
      ],
    };
    const audited = await request(app).post(`/api/mcp/projects/${p.id}/audit`).set("authorization", `Bearer ${token}`).send({
      files: [
        { path: "package.json", content: JSON.stringify({ name: "once", dependencies: { express: "4", react: "18" } }) },
        { path: "server/index.ts", content: "import express from 'express'; const app = express(); app.get('/api/posts/:id', (_q, r) => r.json({}));" },
        { path: "client/src/pages/post.tsx", content: "export default function Post() { return null; }" },
      ],
      label: "tree",
    });
    expect(audited.status, JSON.stringify(audited.body).slice(0, 400)).toBe(200);
    const auditId = audited.body.audit.id as string;
    expect(audited.body.audit.operations.length).toBeGreaterThan(0);

    const before = (await me.agent.get(`/api/projects/${p.id}/kanban`)).body.length;

    // The double click: two applies of the same audit, in flight together.
    const [a, b] = await Promise.all([
      me.agent.post(`/api/code-audits/${auditId}/apply`).send({}),
      me.agent.post(`/api/code-audits/${auditId}/apply`).send({}),
    ]);
    const codes = [a.status, b.status].sort();
    expect(codes[0], `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`).toBe(200);
    expect(codes[1]).toBe(409);

    // A third, long after: still nothing waiting.
    expect((await me.agent.post(`/api/code-audits/${auditId}/apply`).send({})).status).toBe(409);

    const board = (await me.agent.get(`/api/projects/${p.id}/kanban`)).body;
    expect(board.filter((t: any) => t.title === "Post page with comments")).toHaveLength(1);
    expect(board.filter((t: any) => t.title === "Add Stripe checkout")).toHaveLength(1);
    expect(board.length).toBeGreaterThan(before);

    // Every operation carries the outcome it actually had, saved as it happened.
    const saved = (await me.agent.get(`/api/code-audits/${auditId}`)).body;
    expect(saved.operations.every((o: any) => ["applied", "skipped", "declined"].includes(o._status))).toBe(true);
  });

  it("applies Nova's suggestion once, and merges the scope rather than overwriting it", async () => {
    const app = await getTestApp();
    const me = await builder(app, "Nova");
    const p = await project(me.agent, "Applied Twice");

    const operations = [{ op: "create_task", title: "Wire up the fridge scanner", priority: "high" }];
    const [a, b] = await Promise.all([
      me.agent.post(`/api/projects/${p.id}/nova/apply`).send({ operations }),
      me.agent.post(`/api/projects/${p.id}/nova/apply`).send({ operations }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const board = (await me.agent.get(`/api/projects/${p.id}/kanban`)).body;
    expect(board.filter((t: any) => t.title === "Wire up the fridge scanner")).toHaveLength(1);

    // The scope: a proposal adds to a bucket, it does not replace what's there.
    await me.agent.post(`/api/projects/${p.id}/nova/apply`).send({ operations: [{ op: "update_scope", mvp: ["Fridge scan"] }] }).expect(200);
    await me.agent.patch(`/api/projects/${p.id}`).send({ scope: { mvp: ["Fridge scan", "Written by hand"], niceToHave: [] } }).expect(200);
    await me.agent.post(`/api/projects/${p.id}/nova/apply`).send({ operations: [{ op: "update_scope", mvp: ["Fridge scan", "Weekly plan"] }] }).expect(200);
    const scope = (await me.agent.get(`/api/projects/${p.id}`)).body.scope;
    expect(scope.mvp).toEqual(expect.arrayContaining(["Fridge scan", "Written by hand", "Weekly plan"]));

    // Replacing is possible, but only against the bucket as it really is.
    const stale = await me.agent.post(`/api/projects/${p.id}/nova/apply`)
      .send({ operations: [{ op: "update_scope", mvp: ["Fridge scan"], replace: true, expect: { mvp: ["Fridge scan"] } }] });
    expect(stale.status).toBe(422);
    expect(JSON.stringify(stale.body.skipped)).toMatch(/has changed since/);
    expect((await me.agent.get(`/api/projects/${p.id}`)).body.scope.mvp).toContain("Written by hand");
  });
});

describe("the path's tree, read by two tabs at once", () => {
  it("never grows a second copy of a milestone, and a plain GET of the home card creates nothing", async () => {
    const app = await getTestApp();
    const me = await builder(app, "Reader");
    const p = await project(me.agent, "One Tree");
    await me.agent.get(`/api/projects/${p.id}/path`).expect(200);

    // A milestone goes missing (a path that grew, a half-written adoption).
    const tasks = (await me.agent.get(`/api/projects/${p.id}/kanban`)).body;
    const gone = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.5"));
    expect(gone).toBeTruthy();
    await db.delete(projectKanbanTasks).where(eq(projectKanbanTasks.id, gone.id));

    // The home screen only reads: it must not put it back, and must not double it.
    await me.agent.get("/api/me/next-steps").expect(200);
    const afterRead = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, p.id));
    expect(afterRead.some((t) => (t.tags ?? []).includes("backbone:SHIP.M1.5"))).toBe(false);

    // Six tabs asking for the path at once put it back exactly once.
    await Promise.all(Array.from({ length: 6 }, () => me.agent.get(`/api/projects/${p.id}/path`)));
    const after = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, p.id));
    expect(after.filter((t) => (t.tags ?? []).includes("backbone:SHIP.M1.5"))).toHaveLength(1);
    // And nothing else was doubled either.
    const backbones = after.map((t) => (t.tags ?? []).find((x) => x.startsWith("backbone:"))).filter(Boolean);
    expect(new Set(backbones).size).toBe(backbones.length);
  });
});

describe("work finished by something other than the board", () => {
  it("moves the path, so it can be shared afterwards", async () => {
    const app = await getTestApp();
    const me = await builder(app, "Closer");
    const mate = await builder(app, "Mate");
    const p = await project(me.agent, "Closed Elsewhere");
    await me.agent.post(`/api/projects/${p.id}/team`).send({ userId: mate.id, role: "Engineer" }).catch(() => {});

    const tasks = (await me.agent.get(`/api/projects/${p.id}/kanban`)).body;
    const statement = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));

    // Closed by Nova's operations, not by the task board's own route.
    const applied = await me.agent.post(`/api/projects/${p.id}/nova/apply`).send({
      operations: [{ op: "update_task", id: statement.id, status: "done", description: "Plan a week of dinners from your fridge." }],
    });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    await settle();

    // The pace log heard about it — which is what makes it shareable.
    const path = (await me.agent.get(`/api/projects/${p.id}/path`)).body;
    expect(path.lastDone).toMatchObject({ taskId: statement.id, title: "Product statement" });

    const post = await me.agent.post("/api/feed").send({ postType: "project_update", projectId: p.id, content: "Wrote the product statement.", pathTaskId: statement.id });
    expect([200, 201]).toContain(post.status);
    expect(post.body.pathStep).toMatchObject({ taskId: statement.id });
  });

  it("does the same when a milestone is marked done by hand", async () => {
    const app = await getTestApp();
    const me = await builder(app, "Marker");
    const p = await project(me.agent, "Marked By Hand");
    await me.agent.post(`/api/projects/${p.id}/path/mark`).send({ ids: ["SHIP.M1.1"], evidence: "The product statement is in the README already." }).expect(200);
    await settle();
    const path = (await me.agent.get(`/api/projects/${p.id}/path`)).body;
    expect(path.lastDone?.title).toBe("Product statement");
  });
});

describe("marking milestones done by hand", () => {
  it("is capped, needs a line of evidence, and can be taken back", async () => {
    const app = await getTestApp();
    const me = await builder(app, "Ticker");
    const p = await project(me.agent, "Ticked");

    // No evidence: refused, rather than filed under a canned sentence.
    const bare = await me.agent.post(`/api/projects/${p.id}/path/mark`).send({ ids: ["SHIP.M1.1"] });
    expect(bare.status).toBe(400);
    expect(bare.body.field).toBe("evidence");
    expect((await me.agent.post(`/api/projects/${p.id}/path/mark`).send({ ids: ["SHIP.M1.1"], evidence: "done" })).status).toBe(400);

    // A whole path in one call: refused.
    const flood = await me.agent.post(`/api/projects/${p.id}/path/mark`)
      .send({ ids: Array.from({ length: 41 }, (_, i) => `SHIP.M1.${i}`), evidence: "All of it was done last summer." });
    expect(flood.status).toBe(400);
    expect(flood.body.field).toBe("ids");

    const marked = await me.agent.post(`/api/projects/${p.id}/path/mark`)
      .send({ ids: ["SHIP.M1.1"], evidence: "The product statement is in the README already." });
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    expect(marked.body.marked).toEqual(["SHIP.M1.1"]);

    const [task] = await db.select().from(projectKanbanTasks)
      .where(and(eq(projectKanbanTasks.projectId, p.id), eq(projectKanbanTasks.status, "done")));
    expect(task.description).toContain("The product statement is in the README already.");

    // The way back from a wrong tick.
    const undone = await me.agent.post(`/api/projects/${p.id}/path/unmark`).send({ ids: ["SHIP.M1.1"] });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.unmarked).toEqual(["SHIP.M1.1"]);
    const rows = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.id, task.id));
    expect(rows[0].status).toBe("todo");
    expect(rows[0].description).not.toContain("Marked done by you");
    expect((rows[0].tags ?? []).some((t) => t.startsWith("carried:"))).toBe(false);

    // Twice is not an error, and work really finished is not reversible here.
    expect((await me.agent.post(`/api/projects/${p.id}/path/unmark`).send({ ids: ["SHIP.M1.1"] })).body.unmarked).toEqual([]);
  });
});
