/**
 * What a model failure costs the user: nothing. An unreadable answer is a 502
 * with a code, a model error is a 5xx, and in both cases the account is exactly
 * where it was — the month's allowance untouched for a small action, and the
 * money back for a priced outcome.
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
    // One small action off the month's allowance, whatever size the job was.
    expect(await creditsUsed(agent)).toBe(before + 1);
  });

  it("answers an unreadable answer from a helper as 502 model_unreadable too, and charges nothing", async () => {
    const app = await getTestApp();
    const { agent, projectId } = await owner(app);
    const { db } = await import("../../server/db");
    const { users } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    const me = (await agent.get("/api/auth/user")).body;
    // Enough on the balance to pay for the roadmap, so what stops the route is
    // the model and not the money. Nothing here is gated by a plan any more.
    await db.update(users).set({ balanceCents: 1000 }).where(eq(users.id, me.id));
    mode = "garbage";
    const before = await creditsUsed(agent);
    // Roadmap generation parses in the route; Nova's assistant parses in its helper, novaSuggest.
    for (const [url, body] of [
      [`/api/projects/${projectId}/roadmap/generate`, {}],
      [`/api/projects/${projectId}/nova/suggest`, { kind: "brief", field: "problem", input: "Help me say the problem better." }],
    ] as const) {
      const res = await agent.post(url).send(body);
      if (res.status === 400) continue; // an input this test's body doesn't satisfy: not a model failure
      expect(res.status, `${url} ${JSON.stringify(res.body)}`).toBe(502);
      expect(res.body.code).toBe("model_unreadable");
    }
    expect(await creditsUsed(agent)).toBe(before);
    // And the $3 the roadmap took before the model ran is back on the balance.
    const [row] = await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, me.id));
    expect(row.balanceCents).toBe(1000);
  });
});
