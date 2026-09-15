/**
 * Setting up a project with Nova: the builder renames it, and Nova has to
 * know. It's told what the form says now, and a field the builder edited
 * never comes back in Nova's update — so its suggested name can't overwrite
 * theirs.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

const sent: any[] = [];
let reply = "";
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async (args: any) => { sent.push(args); return { choices: [{ message: { content: reply } }] }; } } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});
const { getTestApp, closeTestApp } = await import("../helpers/app");
afterAll(async () => { await closeTestApp(); });

async function builder(app: any, ip: string) {
  const agent = request.agent(app);
  expect((await agent.post("/api/auth/register").set("x-forwarded-for", ip).send({ email: `setup-${Date.now()}-${ip}@example.test`, password: "Testpass123!" })).status).toBe(201);
  return agent;
}
const systemText = () => sent.at(-1).messages.filter((m: any) => m.role === "system").map((m: any) => m.content).join("\n");

describe("the setup chat", () => {
  it("tells Nova the name the builder chose, and never sends back a field they edited", async () => {
    const app = await getTestApp();
    const agent = await builder(app, "203.0.113.91");
    reply = `Love it — EdgeGrid will be great. <project_update>{"title": "EdgeGrid", "description": "EdgeGrid is a betting app.", "category": "saas"}</project_update>`;

    const res = await agent.post("/api/chat").send({
      message: "I renamed it.", history: [],
      currentProject: { title: "SaturdaySunday Sharp", description: "A betting app." },
      edited: ["title"],
    });
    expect(res.status).toBe(200);
    // The title is the builder's; Nova's other suggestions still come through.
    expect(res.body.projectUpdates).toEqual({ description: "EdgeGrid is a betting app.", category: "saas" });
    expect(systemText()).toContain('The project is called "SaturdaySunday Sharp"');
    expect(systemText()).toContain("The builder edited these themselves: title");
  });

  it("works as it did when there's no form to report", async () => {
    const app = await getTestApp();
    const agent = await builder(app, "203.0.113.92");
    reply = `Tell me more. <project_update>{"title": "EdgeGrid"}</project_update>`;
    const res = await agent.post("/api/chat").send({ message: "A betting app", history: [] });
    expect(res.status).toBe(200);
    expect(res.body.projectUpdates).toEqual({ title: "EdgeGrid" });
    expect(sent.at(-1).messages.filter((m: any) => m.role === "system")).toHaveLength(1);
  });
});

describe("what Nova reads about a renamed project", () => {
  it("names it by its title, above a description that still uses an older name", async () => {
    const app = await getTestApp();
    const agent = await builder(app, "203.0.113.93");
    const project = await agent.post("/api/projects").send({
      title: "SaturdaySunday Sharp", description: "EdgeGrid is a web-based football betting analytics app.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(project.status).toBeLessThan(300);
    const { buildOperableProjectState } = await import("../../server/project-operations");
    const state = await buildOperableProjectState(project.body.id, { includeIds: false, includeAudit: false });
    // Sections are separated by blank lines: the name comes straight after the title.
    expect(state.split("\n\n").slice(0, 2)).toEqual([
      "PROJECT: SaturdaySunday Sharp",
      'The product is called "SaturdaySunday Sharp". Use that name, even where older text below calls it something else.',
    ]);
  });
});
