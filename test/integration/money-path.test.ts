/**
 * The money-first systemize path, through the API:
 *
 *   a new systemize project opens on "Where you stand" → answered by tapping,
 *   free, done → the next step reads those answers → Nova builds a plan from
 *   them → accepting it writes the answer the later steps read → its actions
 *   go onto the board, once → a project from before the money weeks gets them.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";

const prompts: string[] = [];
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async (args: any) => {
      prompts.push(args.messages.map((m: any) => m.content).join("\n"));
      return { choices: [{ message: { content: JSON.stringify({
        summary: "Opening costs about $185k; with $0 in, the raise is the whole amount and the equity gap is $19k–$37k.",
        figures: [{ label: "Total to open", value: "$185,000" }, { label: "Working capital", value: "$45,000", note: "4 months of fixed costs" }],
        tables: [{ title: "Sources and uses", columns: ["Use", "Amount"], rows: [["Kitchen equipment", "$60,000"], ["Build-out", "$50,000"]] }],
        sections: [{ heading: "How the number was built", body: "$60k + $50k + $30k + $45k = $185k" }],
        assumptions: ["1,800 sq ft leased space"],
        gaps: ["No cash for the 10–20% equity injection"],
        actions: [
          { title: "Pull all three credit reports", detail: "annualcreditreport.com, dispute errors", when: "this week", moves: "credit known" },
          { title: "Open a separate savings account", detail: "Auto-transfer $200 a month", when: "week 1", moves: "+$2.4k equity a year" },
        ],
        verifyWith: "An SBA-preferred lender and a restaurant CPA",
      }) } }] };
    } } };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { projectKanbanTasks } = await import("@shared/schema");
afterAll(async () => { await closeTestApp(); });

let address = 70;
async function founder(app: any) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email: `money-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!" });
  const project = await agent.post("/api/projects").send({
    title: "Corner Bistro", description: "A neighbourhood bistro, starting from nothing but a plan and a lot of nerve.",
    category: "food", goal: "systemize_business", subcategory: "restaurant",
  });
  expect(project.status).toBe(200);
  return { agent, projectId: project.body.id as string };
}
const creditsUsed = async (agent: any) => (await agent.get("/api/subscription")).body.creditsUsed as number;

describe("the money path", () => {
  it("asks where you stand by tapping, builds a plan from the answers, and puts its actions on the board", async () => {
    const app = await getTestApp();
    const { agent, projectId } = await founder(app);

    // 1. It opens on "Where you stand", answered by choosing.
    let path = (await agent.get(`/api/projects/${projectId}/path`)).body;
    expect(path.promise).toMatch(/money right first/);
    expect(path.current).toMatchObject({ id: "money-1", step: 1, of: 6 });
    expect(path.next).toMatchObject({ id: "SYS.F1.1", title: "Where you stand", workKind: "intake" });
    expect(path.next.intake.map((q: any) => q.id)).toEqual(["cash", "monthly", "credit", "situation", "experience", "assets"]);
    const standTask = path.next.workTaskId;

    // Nova doesn't "work" a tapped step, and a bad answer is refused with the question named.
    expect((await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId: standTask })).status).toBe(400);
    const bad = await agent.post(`/api/projects/${projectId}/path/intake`).send({ taskId: standTask, answers: { cash: "zero" } });
    expect(bad.status).toBe(400);
    expect(bad.body.field).toBe("monthly");

    // 2. Answered: free, done, and written as the step's answer.
    const before = await creditsUsed(agent);
    const saved = await agent.post(`/api/projects/${projectId}/path/intake`).send({
      taskId: standTask,
      answers: { cash: "zero", monthly: "under_250", credit: "unknown", situation: "starting", experience: "none", assets: ["family"] },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.summary).toMatch(/How much could you put into this business today\? \$0 — starting from nothing/);
    expect(await creditsUsed(agent)).toBe(before);

    path = (await agent.get(`/api/projects/${projectId}/path`)).body;
    expect(path.next.id).toBe("SYS.F1.2");
    expect(path.mainLine.done).toBe(1);

    // Changing an answer keeps it done and rewrites what's written.
    await agent.post(`/api/projects/${projectId}/path/intake`).send({
      taskId: standTask,
      answers: { cash: "under_5k", monthly: "under_250", credit: "580_669", situation: "starting", experience: "none" },
    }).expect(200);
    const standRow = (await agent.get(`/api/projects/${projectId}/kanban`)).body.find((t: any) => t.id === standTask);
    expect(standRow.status).toBe("done");
    expect(standRow.description).toMatch(/Under \$5k/);
    expect(standRow.description).toMatch(/Anything else that could back a loan\? Not sure yet/);

    // 3. "How much you need": don't know.
    await agent.post(`/api/projects/${projectId}/path/intake`).send({ taskId: path.next.workTaskId, answers: { raise: "unknown", when: "6_12" } }).expect(200);

    // 4. Nova builds the startup-cost plan, from those answers, for the route's price.
    path = (await agent.get(`/api/projects/${projectId}/path`)).body;
    expect(path.next).toMatchObject({ id: "SYS.F1.3", workKind: "plan" });
    prompts.length = 0;
    const work = await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId: path.next.workTaskId });
    expect(work.status).toBe(200);
    expect(work.body.kind).toBe("plan");
    expect(work.body.payload.figures[0]).toEqual({ label: "Total to open", value: "$185,000" });
    expect(prompts[0]).toMatch(/Under \$5k/);
    expect(prompts[0]).toMatch(/I don't know — work it out for me/);
    expect(prompts[0]).toMatch(/never use the words "guaranteed"/);
    const { CREDIT_COSTS } = await import("@shared/plans");
    expect(await creditsUsed(agent)).toBe(before + CREDIT_COSTS.taskAssist);

    // 5. Its actions onto the board — once, however many times it's asked.
    const added = await agent.post(`/api/projects/${projectId}/path/work/${work.body.id}/tasks`).send({});
    expect(added.body).toEqual({ created: ["Pull all three credit reports", "Open a separate savings account"], skipped: 0 });
    expect((await agent.post(`/api/projects/${projectId}/path/work/${work.body.id}/tasks`).send({})).body).toEqual({ created: [], skipped: 2 });
    const board = (await agent.get(`/api/projects/${projectId}/kanban`)).body;
    expect(board.find((t: any) => t.title === "Open a separate savings account").description).toMatch(/When: week 1\nMoves: \+\$2\.4k equity a year/);

    // 6. Planning on it finishes the step, and what's written is what later steps read.
    const chose = await agent.post(`/api/projects/${projectId}/path/work/${work.body.id}/choose`).send({});
    expect(chose.status).toBe(200);
    expect(chose.body.answer).toMatch(/^Opening costs about \$185k/);
    expect(chose.body.answer).toMatch(/Actions: \[this week\] Pull all three credit reports/);
    path = (await agent.get(`/api/projects/${projectId}/path`)).body;
    expect(path.next.id).toBe("SYS.F1.4");
    expect(path.mainLine.done).toBe(3);
  });

  it("gives a project from before the money weeks its money steps, without touching what it had", async () => {
    const app = await getTestApp();
    const { agent, projectId } = await founder(app);
    // Make it look like an older project: none of the money tasks exist, and it had finished its first old step.
    await db.delete(projectKanbanTasks).where(and(eq(projectKanbanTasks.projectId, projectId), sql`array_to_string(${projectKanbanTasks.tags}, ',') LIKE '%backbone:SYS.F%'`));
    const old = (await agent.get(`/api/projects/${projectId}/kanban`)).body;
    expect(old.some((t: any) => t.tags?.some((x: string) => x.startsWith("backbone:SYS.F")))).toBe(false);
    const timeCapture = old.find((t: any) => t.tags?.includes("backbone:SYS.M1.1"));
    await agent.patch(`/api/kanban/${timeCapture.id}`).send({ status: "done" }).expect(200);

    const path = (await agent.get(`/api/projects/${projectId}/path`)).body;
    expect(path.next.id).toBe("SYS.F1.1");
    expect(path.next.workTaskId).toBeTruthy();
    const after = (await agent.get(`/api/projects/${projectId}/kanban`)).body;
    expect(after.filter((t: any) => t.tags?.some((x: string) => x.startsWith("backbone:SYS.F")))).toHaveLength(16);
    expect(after.find((t: any) => t.id === timeCapture.id).status).toBe("done");

    // Reading again adds nothing more.
    await agent.get(`/api/projects/${projectId}/path`);
    expect((await agent.get(`/api/projects/${projectId}/kanban`)).body.length).toBe(after.length);
  });

  it("keeps a plan's actions to plans, and to the project's own members", async () => {
    const app = await getTestApp();
    const { agent, projectId } = await founder(app);
    const stranger = (await founder(app)).agent;
    const path = (await agent.get(`/api/projects/${projectId}/path`)).body;
    expect((await stranger.post(`/api/projects/${projectId}/path/intake`).send({ taskId: path.next.workTaskId, answers: {} })).status).toBe(403);
    expect((await agent.post(`/api/projects/${projectId}/path/work/not-a-work-row/tasks`).send({})).status).toBe(404);
  });
});
