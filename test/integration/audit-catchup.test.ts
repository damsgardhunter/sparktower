/**
 * An audit catching the whole project up with its code: the safe edits land on
 * their own, the rest wait by section, what the builder declines stays
 * declined, and the second audit knows what changed since the first.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

let reply: any = {};
const prompts: string[] = [];
vi.mock("openai", () => {
  class OpenAI {
    chat = {
      completions: {
        create: async (body: any) => {
          prompts.push(body.messages.map((m: any) => m.content).join("\n"));
          return { choices: [{ message: { content: JSON.stringify(reply) } }] };
        },
      },
    };
    responses = { create: async () => ({ output_text: JSON.stringify(reply), output: [] }) };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
afterAll(async () => { await closeTestApp(); });

const audit = (ops: any[], note = "You shipped post pages and comment threads.") => ({
  stage: "mvp", completionPercent: 60, summary: "An MVP with a feed.", stackSummary: "React and Express",
  capabilities: [], built: [], partial: [], missing: [], undocumented: [], risks: [],
  taskReconciliation: { looksDone: [], notStarted: [] }, milestones: [], loops: [], nextThreeThings: [],
  catchUpNote: note, operations: ops,
});

describe("an audit catches the project up", () => {
  it("applies what's safe, waits on the rest, remembers what was declined, and knows what changed", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const email = `catchup-${Date.now()}@example.test`;
    await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.230").send({ email, password: "Testpass123!", firstName: "Builder" });
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.email, email));
    const project = (await agent.post("/api/projects").send({ title: "Catch Up", description: "A meal planner that plans dinners from your fridge.", category: "saas", goal: "ship_mvp", subcategory: "saas", oneLiner: "Dinner plans" })).body;
    const open = (await agent.post(`/api/projects/${project.id}/kanban`).send({ title: "Build the post page with comments", status: "todo" })).body;
    const token = (await agent.post("/api/mcp-tokens").send({ label: "editor" })).body.token;
    const run = (files: { path: string; content: string }[]) =>
      request(app).post(`/api/mcp/projects/${project.id}/audit`).set("authorization", `Bearer ${token}`).send({ files, label: "tree" });
    const files = [
      { path: "package.json", content: JSON.stringify({ name: "catch-up", dependencies: { express: "4", react: "18" } }) },
      { path: "server/index.ts", content: "import express from 'express'; const app = express(); app.get('/api/posts/:id', (_q, r) => r.json({}));" },
      { path: "client/src/pages/post.tsx", content: "export default function Post() { return null; }" },
    ];

    reply = audit([
      { op: "create_task", title: "Post page with comments", status: "done", description: "client/src/pages/post.tsx" },
      { op: "create_task", title: "Comment reactions", status: "done", description: "server/index.ts" },
      { op: "complete_path_milestone", backboneId: "SHIP.M1.5", evidence: "server/index.ts runs an Express app" },
      { op: "complete_path_milestone", backboneId: "SHIP.NOPE", evidence: "a milestone this path doesn't have" },
      { op: "update_project", fields: { oneLiner: "Plan a week of dinners from what's in your fridge" } },
      { op: "create_loop", type: "growth", title: "Share a plan", steps: "1. Share 2. Friend lands 3. Signs up 4. Shares theirs", closes: "their share link" },
      { op: "create_task", title: "Add Stripe checkout", priority: "high" },
    ]);
    prompts.length = 0;
    const first = await run(files);
    expect(first.status, JSON.stringify(first.body).slice(0, 400)).toBe(200);
    expect(prompts[0]).toMatch(/first audit with a file record/);

    // Safe by default: shipped work recorded, the open card closed, the path milestone checked off.
    expect(first.body.autoApplied.changes).toEqual(expect.arrayContaining([
      expect.stringMatching(/Updated task "Build the post page with comments"/),
      expect.stringMatching(/Recorded finished work "Comment reactions"/),
      expect.stringMatching(/Checked off SHIP.M1.5/),
    ]));
    const board = (await agent.get(`/api/projects/${project.id}/kanban`)).body;
    expect(board.find((t: any) => t.id === open.id).status).toBe("done");
    expect(board.find((t: any) => t.title === "Comment reactions")).toMatchObject({ status: "done", tags: expect.arrayContaining(["from:audit"]) });
    expect(board.some((t: any) => t.title === "Post page with comments")).toBe(false);
    expect(board.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.5")).status).toBe("done");

    // An edit that didn't take is marked as such, with why — not counted as applied.
    const a1 = first.body.audit;
    expect(a1.operations.find((o: any) => o.backboneId === "SHIP.NOPE")).toMatchObject({ _status: "skipped", _reason: expect.stringMatching(/isn't open/) });
    expect(a1.findings.catchUp.skipped).toEqual([expect.stringMatching(/SHIP.NOPE.*isn't open/)]);
    expect(first.body.autoApplied.changes).toHaveLength(3);

    // The rest waits, by section.
    const pending = a1.operations.filter((o: any) => !o._status);
    expect(pending.map((o: any) => o._section).sort()).toEqual(["brief", "loops", "tasks"]);
    expect(a1.findings.catchUp).toMatchObject({ note: "You shipped post pages and comment threads.", applied: expect.any(Array) });
    expect((await agent.get(`/api/projects/${project.id}`)).body.oneLiner).toBe("Dinner plans");

    // Apply the brief only: the loop and the task are declined.
    const applied = await agent.post(`/api/code-audits/${a1.id}/apply`).send({ sections: ["brief"] });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect((await agent.get(`/api/projects/${project.id}`)).body.oneLiner).toBe("Plan a week of dinners from what's in your fridge");
    expect((await agent.post(`/api/code-audits/${a1.id}/apply`).send({})).status).toBe(409);

    // Second audit: one file changed. It knows, and it won't bring back what was declined.
    reply = audit([
      { op: "create_task", title: "Add Stripe checkout", priority: "high" },
      { op: "create_task", title: "Comment reactions", status: "done" },
      { op: "update_project", fields: { oneLiner: "Plan a week of dinners from what's in your fridge" } },
    ], "Small change since last time.");
    prompts.length = 0;
    const second = await run([...files.slice(0, 2), { path: "client/src/pages/post.tsx", content: "export default function Post() { return 'changed'; }" }]);
    expect(second.status).toBe(200);
    expect(prompts[0]).toMatch(/WHAT CHANGED SINCE THE LAST AUDIT \(\d{4}-\d{2}-\d{2}\) — 0 added, 1 modified, 0 removed/);
    expect(prompts[0]).toMatch(/DECLINED LAST TIME[\s\S]*Add task: Add Stripe checkout/);
    expect(second.body.audit.operations).toEqual([]);
    expect(second.body.audit.findings.catchUp.dropped).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "declined last time", count: 1 }),
      { reason: "already on the board", count: 1, items: ['Record shipped: Comment reactions (matches "Comment reactions", done)'] },
      expect.objectContaining({ reason: "changes nothing", count: 1 }),
    ]));
    expect(second.body.autoApplied).toBeNull();

    // Ask first: nothing lands on its own.
    await agent.put(`/api/projects/${project.id}/audit-settings`).send({ autoApply: "off" }).expect(200);
    expect((await agent.put(`/api/projects/${project.id}/audit-settings`).send({ autoApply: "sometimes" })).status).toBe(400);
    reply = audit([{ op: "create_task", title: "Weekly digest email", status: "done" }]);
    const third = await run(files);
    expect(third.body.autoApplied).toBeNull();
    expect(third.body.audit.operations).toEqual([expect.objectContaining({ title: "Weekly digest email", _section: "shipped" })]);
  });

  it("keeps the dashboard's path true and changes the core loops when the product has moved", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const email = `catchup-path-${Date.now()}@example.test`;
    await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.231").send({ email, password: "Testpass123!", firstName: "Builder" });
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.email, email));
    const project = (await agent.post("/api/projects").send({ title: "Path Keeper", description: "A project whose path should follow its code.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const path = async () => (await agent.get(`/api/projects/${project.id}/path`)).body;

    // A written product loop with one step, a second product loop, and a loop the builder removed.
    const seeded = (await path()).loopTree.loops;
    const productLoop = seeded.find((l: any) => l.type === "product");
    await agent.patch(`/api/kanban/${productLoop.taskId}`).send({ title: "Weekly check-in", description: "1. Post a check-in 2. Get comments 3. Post again", status: "done" });
    const { createExpansion } = await import("../../server/phase-trees");
    const { created } = await createExpansion(project.id, "SHIP.M2.1", [{ title: "Check-in composer", description: "" }], { loopTaskId: productLoop.taskId });
    const feed = (await agent.post(`/api/projects/${project.id}/path/loops`).send({ backboneId: "SHIP.M1.2", title: "Browse the feed", description: "1. Open feed 2. React", type: "product" })).body;
    const dropped = (await agent.post(`/api/projects/${project.id}/path/loops`).send({ backboneId: "SHIP.M1.2", title: "Leaderboard hunting", type: "product" })).body;
    await agent.delete(`/api/projects/${project.id}/path/loops/${dropped.id}`).expect(200);

    const token = (await agent.post("/api/mcp-tokens").send({ label: "editor" })).body.token;
    reply = audit([
      { op: "update_task", id: created[0].id, status: "done" },
      { op: "add_loop_steps", loopId: productLoop.taskId, steps: [{ title: "Check-in composer", done: true }, { title: "Comment threads", done: true }] },
      { op: "update_loop", id: productLoop.taskId, title: "Ship a progress post", steps: "1. Post an update with asks 2. Get feedback 3. Turn it into tasks 4. Credit it in the next update" },
      { op: "retire_loop", id: feed.id, reason: "The feed is now part of the progress-post loop" },
      { op: "create_loop", type: "product", title: "Leaderboard hunting", steps: "1. a 2. b 3. c" },
    ], "Check-ins became progress posts.");
    prompts.length = 0;
    const res = await request(app).post(`/api/mcp/projects/${project.id}/audit`).set("authorization", `Bearer ${token}`)
      .send({ files: [{ path: "server/index.ts", content: "export {}" }], label: "tree" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);

    // The audit saw the path: where it is, the step ids, and what the builder removed.
    expect(prompts[0]).toMatch(/THE PATH — /);
    expect(prompts[0]).toContain(`step id=${created[0].id} [todo] Check-in composer`);
    expect(prompts[0]).toMatch(/REMOVED BY THE BUILDER[^\n]*Leaderboard hunting/);

    // Progress on the path applied by itself; the new step that's already built too, without repeating the one that exists.
    const auditRow = res.body.audit;
    expect(auditRow.findings.catchUp.dropped).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "removed by you before", count: 1 })]));
    const addSteps = auditRow.operations.find((o: any) => o.op === "add_loop_steps");
    expect(addSteps).toMatchObject({ _section: "path", _status: "applied", steps: [{ title: "Comment threads", done: true }] });
    let status = await path();
    const loopNode = status.loopTree.loops.find((l: any) => l.taskId === productLoop.taskId);
    expect(loopNode.steps.map((st: any) => [st.title, st.status])).toEqual([["Check-in composer", "done"], ["Comment threads", "done"]]);
    expect(loopNode.state).toBe("built");

    // The direction change waits, and the dashboard says so.
    expect(status.auditUpdate).toMatchObject({ auditId: auditRow.id, pendingCount: 2 });
    expect(status.auditUpdate.pendingLoops).toEqual(["Rewrite loop: Ship a progress post", "Retire loop: Browse the feed"]);
    expect(status.loopTree.loops.find((l: any) => l.taskId === productLoop.taskId).title).toBe("Weekly check-in");

    await agent.post(`/api/code-audits/${auditRow.id}/apply`).send({ sections: ["loops"] }).expect(200);
    status = await path();
    expect(status.loopTree.loops.find((l: any) => l.taskId === productLoop.taskId)).toMatchObject({ title: "Ship a progress post", description: expect.stringMatching(/Credit it in the next update/) });
    expect(status.loopTree.loops.some((l: any) => l.taskId === feed.id)).toBe(false);
    expect(status.auditUpdate.pendingCount).toBe(0);
    expect(status.auditUpdate.applied).toEqual(expect.arrayContaining([expect.stringMatching(/Rewrote the loop/), expect.stringMatching(/Retired the loop "Browse the feed"/)]));
  });
});
