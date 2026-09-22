/**
 * Nova auditing the five loops against the competition.
 *
 * Only once every kind is written; charged once, only for a readable answer
 * that says something about the loops it was given; kept on the path so the
 * tree shows the scores, and marked stale when the loops change under it.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

let reply = "";
const prompts: string[] = [];
vi.mock("openai", () => {
  class OpenAI {
    chat = {
      completions: {
        create: async (body: any) => {
          prompts.push(body.messages.map((m: any) => m.content).join("\n"));
          return { choices: [{ message: { content: reply } }] };
        },
      },
    };
    responses = { create: async () => ({ output_text: reply, output: [] }) };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { CREDIT_COSTS } = await import("@shared/plans");
afterAll(async () => { await closeTestApp(); });

let address = 120;
async function project(app: any) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email: `loops-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`, password: "Testpass123!" });
  const created = await agent.post("/api/projects").send({
    title: "Loop Audit", description: "A meal planner that plans a week of dinners from what's in the fridge.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  return { agent, id: created.body.id as string };
}
const creditsUsed = async (agent: any) => (await agent.get("/api/subscription")).body.creditsUsed as number;
const tree = async (agent: any, id: string) => (await agent.get(`/api/projects/${id}/path`)).body.loopTree;

describe("the competitive loop audit", () => {
  it("waits for all five loops, then scores each against named competitors, charged once", async () => {
    const app = await getTestApp();
    const { agent, id } = await project(app);

    const early = await agent.post(`/api/projects/${id}/path/loops/audit`).send({});
    expect(early.status).toBe(400);
    expect(early.body).toMatchObject({ code: "loops_incomplete", unwritten: ["product", "growth", "retention", "revenue", "referral"] });

    for (const l of (await tree(agent, id)).loops) {
      await agent.patch(`/api/kanban/${l.taskId}`).send({ status: "done", description: `1. ${l.type} starts 2. something happens 3. back to 1` });
    }
    const loops = (await tree(agent, id)).loops;
    expect((await tree(agent, id)).competitionDue).toBe(true);

    reply = JSON.stringify({
      competitors: [{ name: "Mealime", why: "free, fast weekly plans" }],
      summary: "The product loop is sharp; referral is thin.",
      loops: [
        { key: "L1", score: 72, competitors: [{ name: "Mealime", howTheirLoopWorks: "Plan → shop list → cook → rate → better plan." }], advantage: "Starts from the fridge", gap: "", breakRisk: "Scanning", recommendation: "Barcode scan" },
        { key: "L5", score: 20, gap: "No reason to invite anyone", breakRisk: "Invite", recommendation: "Shared household plans" },
        { key: "L99", score: 100 },
      ],
    });
    prompts.length = 0;
    const before = await creditsUsed(agent);
    const res = await agent.post(`/api/projects/${id}/path/loops/audit`).send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    // A loop audit is a small Nova action: one off the month's allowance.
    expect(res.body.creditsCharged).toBe(1);
    expect((await creditsUsed(agent)) - before).toBe(1);
    // The prompt hands every loop over by key, with its kind and what closing it means.
    expect(prompts[0]).toMatch(/\[L1\] Product loop/);
    expect(prompts[0]).toMatch(/\[L5\] Referral loop[\s\S]*Closes when:/);

    const after = await tree(agent, id);
    expect(after.competitionDue).toBe(false);
    expect(after.competition).toMatchObject({ stale: false, audit: { overallScore: 46, weakestLoopTaskId: loops[4].taskId } });
    expect(after.competition.audit.loops.map((r: any) => [r.type, r.score, r.verdict])).toEqual([["product", 72, "strong"], ["referral", 20, "weak"]]);
    // Kept apart from the milestone's own work: the core-loops task shows no packet because of it.
    expect((await agent.get(`/api/projects/${id}/path/work/${loops[0].taskId}`)).body.work).toBeNull();

    // Rewriting a loop makes the read stale, and the audit due again; so does a new loop.
    await agent.patch(`/api/kanban/${loops[1].taskId}`).send({ description: "1. share a plan 2. friend lands on it 3. signs up 4. shares theirs" });
    expect((await tree(agent, id)).competition.stale).toBe(true);
    await agent.post(`/api/projects/${id}/path/loops`).send({ backboneId: "SHIP.M1.2", title: "Leftovers", description: "cook → leftovers logged → tomorrow's plan uses them", type: "product" });
    const changed = await tree(agent, id);
    expect(changed.competition.stale).toBe(true);
    expect(changed.competitionDue).toBe(true);
  });

  it("charges nothing for an answer it can't read, or one about none of the loops", async () => {
    const app = await getTestApp();
    const { agent, id } = await project(app);
    for (const l of (await tree(agent, id)).loops) await agent.patch(`/api/kanban/${l.taskId}`).send({ status: "done", description: "1. a 2. b 3. back to a" });
    const before = await creditsUsed(agent);

    reply = "Here's what I think about your loops!";
    const prose = await agent.post(`/api/projects/${id}/path/loops/audit`).send({});
    expect(prose.status).toBe(502);
    expect(prose.body.code).toBe("model_unreadable");

    reply = JSON.stringify({ summary: "fine", loops: [{ key: "L42", score: 90 }] });
    const offTarget = await agent.post(`/api/projects/${id}/path/loops/audit`).send({});
    expect(offTarget.status).toBe(502);

    expect(await creditsUsed(agent)).toBe(before);
    expect((await tree(agent, id)).competition).toBeNull();
  });
});

describe("Nova writing the loops for the builder", () => {
  it("writes one loop when asked, fills the rest on request, and never touches one the builder wrote", async () => {
    const app = await getTestApp();
    const { agent, id } = await project(app);
    const start = (await tree(agent, id)).loops;
    const [product, growth] = start;
    await agent.patch(`/api/kanban/${growth.taskId}`).send({ description: "1. mine 2. mine 3. back to 1" });

    // Just the product loop: its placeholder name gives way to Nova's.
    reply = JSON.stringify({ loops: [
      { key: "L1", type: "growth", title: "Plan the week", steps: "1. Scan fridge 2. Get plan 3. Cook 4. Leftovers feed next plan", closes: "leftovers logged" },
      { key: "L3", type: "retention", title: "Sneaky extra", steps: "1. a 2. b" },
    ] });
    prompts.length = 0;
    const before = await creditsUsed(agent);
    const one = await agent.post(`/api/projects/${id}/path/loops/write`).send({ loopTaskIds: [product.taskId] });
    expect(one.status, JSON.stringify(one.body).slice(0, 300)).toBe(200);
    expect(one.body.written).toEqual([product.taskId]);
    expect(one.body.skipped.map((x: any) => x.title)).toEqual(["Sneaky extra"]);
    expect((await creditsUsed(agent)) - before).toBe(1);
    expect(prompts[0]).toMatch(/the loop at L1/);
    let t = await tree(agent, id);
    // The key wins over whatever kind the model said: L1 is the product loop.
    expect(t.loops.find((l: any) => l.taskId === product.taskId)).toMatchObject({ title: "Plan the week", type: "product", status: "done" });
    expect(t.loops.find((l: any) => l.taskId === product.taskId).description).toMatch(/Closes when: leftovers logged/);

    // Asking again for a written loop costs nothing and says so.
    expect((await agent.post(`/api/projects/${id}/path/loops/write`).send({ loopTaskIds: [product.taskId] })).body.code).toBe("nothing_to_write");

    // The rest: every unwritten loop, and the builder's growth loop is left as they wrote it.
    reply = JSON.stringify({ loops: [
      { type: "growth", title: "Overwrite attempt", steps: "1. x 2. y" },
      { key: "L3", type: "retention", title: "Sunday reminder", steps: "1. Sunday email 2. Open plan 3. Cook", closes: "next Sunday's email" },
      { key: "L4", type: "revenue", title: "Go premium", steps: "1. Hit plan limit 2. Upgrade 3. Plan more", closes: "renewal" },
      { key: "L5", type: "referral", title: "Share a plan", steps: "1. Share 2. Friend joins 3. Friend shares", closes: "friend's own share link" },
    ] });
    const rest = await agent.post(`/api/projects/${id}/path/loops/write`).send({});
    expect(rest.status).toBe(200);
    expect(rest.body.written).toHaveLength(3);
    expect(rest.body.skipped).toEqual([{ title: "Overwrite attempt", reason: "the growth loop is already written" }]);
    t = await tree(agent, id);
    expect(t.coverage.complete).toBe(true);
    expect(t.loops.find((l: any) => l.taskId === growth.taskId)).toMatchObject({ title: "Growth loop", description: "1. mine 2. mine 3. back to 1" });
    expect((await agent.post(`/api/projects/${id}/path/loops/write`).send({})).body.code).toBe("nothing_to_write");
  });

  it("writes a missing referral loop for a project with more product loops than today's cap — and says why when it can't add one", async () => {
    const app = await getTestApp();
    const { agent, id } = await project(app);
    const { db } = await import("../../server/db");
    const { projectKanbanTasks } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    // A project like one from before the product-loop cap: five product loops, growth, retention and
    // revenue written, and no referral loop at all — eight loops, the whole cap, without the one it needs.
    const start = (await tree(agent, id)).loops as any[];
    const referral = start.find((l) => l.type === "referral");
    await db.delete(projectKanbanTasks).where(eq(projectKanbanTasks.id, referral.taskId));
    for (const l of start.filter((x) => x.type !== "referral")) await agent.patch(`/api/kanban/${l.taskId}`).send({ description: `1. ${l.type} 2. step 3. back to 1`, status: "done" });
    const [product] = start;
    const [legacy] = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.id, product.taskId));
    for (let i = 0; i < 4; i++) {
      await db.insert(projectKanbanTasks).values({ projectId: id, milestoneId: legacy.milestoneId, title: `Old product loop ${i}`, description: "1. a 2. b 3. back", status: "done", priority: "medium", order: 50 + i, tags: (legacy.tags ?? []).filter((t) => !t.startsWith("loop-type:")) } as any);
    }
    let t = await tree(agent, id);
    expect(t.loops).toHaveLength(8);
    expect(t.coverage.missing).toEqual(["referral"]);

    // Nova's draft is only for a kind that's taken: nothing can be added, and the answer says why — not "unreadable" — and costs nothing.
    reply = JSON.stringify({ loops: [{ type: "growth", title: "Another growth loop", steps: "1. x 2. y 3. back" }] });
    const before = await creditsUsed(agent);
    const refused = await agent.post(`/api/projects/${id}/path/loops/write`).send({});
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body).toMatchObject({ code: "loops_not_added", message: expect.stringContaining("the growth loop is already written") });
    expect(await creditsUsed(agent)).toBe(before);

    // Nova writes the referral loop: added, even with the project over today's product-loop cap.
    reply = JSON.stringify({ loops: [{ type: "referral", title: "Invite a cofounder", steps: "1. Invite a builder 2. They join your project 3. They invite theirs", closes: "the invitee gets their own invite link" }] });
    const wrote = await agent.post(`/api/projects/${id}/path/loops/write`).send({});
    expect(wrote.status, JSON.stringify(wrote.body)).toBe(200);
    expect(wrote.body.created).toHaveLength(1);
    t = await tree(agent, id);
    expect(t.coverage.complete).toBe(true);
    expect(t.loops.find((l: any) => l.type === "referral")).toMatchObject({ title: "Invite a cofounder", status: "done" });
    // A fifth-plus product loop is still refused.
    expect((await agent.post(`/api/projects/${id}/path/loops`).send({ title: "Yet another", type: "product" })).body.code).toBe("loop_cap");
  });

  it("writes loops from Nova chat with the write_loops action", async () => {
    const app = await getTestApp();
    const { agent, id } = await project(app);
    reply = `Done — wrote your growth and referral loops.
<nova_action>{"type": "write_loops", "data": {"loops": [
  {"type": "growth", "title": "Public meal plans", "steps": "1. Publish a plan 2. Indexed 3. Stranger lands 4. Signs up and publishes", "closes": "their plan is public too"},
  {"type": "referral", "title": "Cook together", "steps": "1. Invite a housemate 2. They join 3. They invite", "closes": "invitee gets invites"},
  {"type": "product", "title": "Second product loop", "steps": "1. Rate a dinner 2. Better plan 3. Rate again"}
]}}</nova_action>`;
    prompts.length = 0;
    const res = await agent.post(`/api/projects/${id}/nova-guide`).send({ message: "Write my growth and referral loops", currentTab: "setup" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    // Nova chat sees the loops and what's still to write.
    expect(prompts[0]).toMatch(/THE BUSINESS'S LOOPS[\s\S]*Still to write: product, growth, retention, revenue, referral/);
    const action = res.body.actionsTaken.find((a: any) => a.type === "write_loops");
    expect(action.data).toMatchObject({ count: 3 });
    const t = await tree(agent, id);
    expect(t.loops.filter((l: any) => l.written).map((l: any) => [l.type, l.title])).toEqual([
      ["product", "Second product loop"], ["growth", "Public meal plans"], ["referral", "Cook together"],
    ]);
    expect(t.coverage.unwritten).toEqual(["retention", "revenue"]);
  });
});
