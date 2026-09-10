/**
 * What a model failure costs the user: nothing. An unreadable answer is a
 * 502 with a code, a model error is a 5xx, and in both cases the credit
 * count is exactly what it was.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

let mode: "garbage" | "throw" | "ok" = "garbage";
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async () => {
      if (mode === "throw") throw new Error("model exploded");
      const content = mode === "garbage" ? "I'm sorry, I can't produce that right now." : JSON.stringify({ kind: "options", existing: "nothing yet", intro: "Three ways.", options: [{ title: "A", body: "Statement A.", why: "" }, { title: "B", body: "Statement B.", why: "" }, { title: "C", body: "Statement C.", why: "" }] });
      return { choices: [{ message: { content } }] };
    } } };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
afterAll(async () => { await closeTestApp(); });

async function owner(app: any) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.60").send({ email: `ai-${Date.now()}@example.test`, password: "Testpass123!" });
  const project = await agent.post("/api/projects").send({ title: "AI Fail", description: "A project used to check that a failed model call is not charged.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
  const path = await agent.get(`/api/projects/${project.body.id}/path`);
  return { agent, projectId: project.body.id as string, taskId: path.body.next.workTaskId as string };
}
const creditsUsed = async (agent: any) => (await agent.get("/api/subscription")).body.creditsUsed as number;

describe("a model that fails", () => {
  it("answers 502 model_unreadable for prose where JSON was expected, and charges nothing", async () => {
    const app = await getTestApp();
    const { agent, projectId, taskId } = await owner(app);
    const before = await creditsUsed(agent);
    mode = "garbage";
    const res = await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("model_unreadable");
    expect(res.body.message).toMatch(/unreadable/i);
    expect(await creditsUsed(agent)).toBe(before);
  });

  it("answers 5xx when the model errors, charges nothing, and charges exactly the route's cost on success", async () => {
    const app = await getTestApp();
    const { agent, projectId, taskId } = await owner(app);
    const before = await creditsUsed(agent);
    mode = "throw";
    const res = await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await creditsUsed(agent)).toBe(before);
    mode = "ok";
    const ok = await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId });
    expect(ok.status).toBe(200);
    expect(ok.body.payload.options).toHaveLength(3);
    const { CREDIT_COSTS } = await import("@shared/plans");
    expect(await creditsUsed(agent)).toBe(before + CREDIT_COSTS.taskAssist);
  });
});
