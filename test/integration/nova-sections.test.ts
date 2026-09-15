/**
 * Nova in the project manager answers for the section the builder is in: the
 * prompt names it, carries that section's path, and lists all three with
 * their progress — so "what's next" in Raise funds is Raise's next step.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

const prompts: string[] = [];
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async (body: any) => { prompts.push(body.messages.map((m: any) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n")); return { choices: [{ message: { content: "Your next step is right there." } }] }; } } };
    responses = { create: async () => ({ output_text: "ok", output: [] }) };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
afterAll(async () => { await closeTestApp(); });

describe("Nova and sections", () => {
  it("answers for the open section, with all three in view", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.240").send({ email: `nova-sec-${Date.now()}@example.test`, password: "Testpass123!", firstName: "Nova" });
    const project = (await agent.post("/api/projects").send({ title: "Asks Nova", description: "A product that is also raising a small round.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    await agent.post(`/api/projects/${project.id}/tracks`).send({ goal: "raise_funding", subcategory: "startup_equity" }).expect(200);

    prompts.length = 0;
    const res = await agent.post(`/api/projects/${project.id}/nova-guide`).send({ message: "What's next?", currentTab: "nova", section: "raise_funding" });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const prompt = prompts.join("\n");
    expect(prompt).toMatch(/THE BUILDER IS IN: Raise funding/);
    expect(prompt).toMatch(/FUND\.C1\.1/);
    expect(prompt).toMatch(/- Ship an MVP \(primary\): 0\/\d+ milestones/);
    expect(prompt).toMatch(/- Systemize a business: not started/);

    prompts.length = 0;
    await agent.post(`/api/projects/${project.id}/nova-guide`).send({ message: "And now?", currentTab: "nova" }).expect(200);
    expect(prompts.join("\n")).toMatch(/THE BUILDER IS IN: Ship an MVP/);
    expect((await agent.post(`/api/projects/${project.id}/nova-guide`).send({ message: "x", section: "nonsense" })).status).toBe(200);
  });
});
