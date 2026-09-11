/**
 * Which model writes Nova's code, and what happens when it can't.
 *
 * Build packets — complete files for someone's repository — go to the coding
 * model on the Responses API. Everything else stays on the general model. The
 * interesting cases are the failures: a coding model the account can't reach
 * must still produce a packet (from the general model, charged once), while an
 * unreadable answer must *not* be quietly retried on a second model — it's an
 * uncharged 502, like every other AI route, so the failure stays visible.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

type Mode = "ok" | "codex-down" | "codex-garbage" | "structured";
let mode: Mode = "ok";
const calls: { api: "responses" | "chat"; model: string; body: any }[] = [];

const BUILD = JSON.stringify({
  kind: "build", existing: "nothing yet", summary: "Adds the server scaffold.",
  files: [{ path: "server/index.ts", language: "ts", content: "export {};\n", purpose: "entry point" }],
  runSteps: ["npm run dev"], verify: "the server boots", assumptions: [],
});

/** The shape new packets are asked for: run steps grouped by where they run. */
const BUILD_GROUPS = JSON.stringify({
  kind: "build", existing: "nothing yet", summary: "Adds the server scaffold.",
  files: [{ path: "server/index.ts", language: "ts", content: "export {};\n", purpose: "entry point" }],
  runGroups: [
    { where: "terminal", label: "Install and start", commands: ["npm install", "npm run dev"], longRunning: true },
    { where: "terminal", label: "Check it answers", commands: ["curl -s localhost:5001/_health"], copy: "rm -rf ~ # a model's copy text is never used" },
  ],
  verify: "the server boots", assumptions: [],
});

vi.mock("openai", () => {
  class OpenAI {
    responses = {
      create: async (body: any) => {
        calls.push({ api: "responses", model: body.model, body });
        if (mode === "codex-down") throw Object.assign(new Error("The model does not exist or you do not have access to it."), { status: 404 });
        return { status: "completed", output_text: mode === "codex-garbage" ? "Sure! Here's the code you asked for." : mode === "structured" ? BUILD_GROUPS : BUILD };
      },
    };
    chat = {
      completions: {
        create: async (body: any) => {
          calls.push({ api: "chat", model: body.model, body });
          return { choices: [{ message: { content: BUILD } }] };
        },
      },
    };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { CODE_MODEL, TEXT_MODEL } = await import("../../server/aiModels");
const { CREDIT_COSTS } = await import("@shared/plans");
afterAll(async () => { await closeTestApp(); });

let address = 70;
/** A fresh project, and one of its milestones that Nova builds rather than drafts. */
async function project(app: any) {
  const agent = request.agent(app);
  await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email: `code-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`, password: "Testpass123!" });
  const created = await agent.post("/api/projects").send({
    title: "Code Model", description: "A project used to check which model writes Nova's build packets.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  const projectId = created.body.id as string;
  const tasks = (await agent.get(`/api/projects/${projectId}/kanban`)).body as any[];
  const build = tasks.find((t) => t.tags?.includes("actor:nova-builds") && t.tags.some((x: string) => x.startsWith("backbone:")));
  const draft = tasks.find((t) => t.tags?.includes("actor:nova-drafts") && t.tags.some((x: string) => x.startsWith("backbone:")));
  expect(build, "a nova-builds milestone on a new ship path").toBeTruthy();
  return { agent, projectId, buildTaskId: build.id as string, draftTaskId: draft?.id as string };
}
const creditsUsed = async (agent: any) => (await agent.get("/api/subscription")).body.creditsUsed as number;

describe("the coding model", () => {
  it("writes build packets, over the Responses API", async () => {
    const app = await getTestApp();
    const { agent, projectId, buildTaskId } = await project(app);
    mode = "ok"; calls.length = 0;

    const res = await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId: buildTaskId });

    expect(res.status).toBe(200);
    expect(res.body.payload.kind).toBe("build");
    // The packet says who wrote it, so the editor can too.
    expect(res.body.payload.model).toBe(CODE_MODEL);
    expect(calls.map((c) => c.api)).toEqual(["responses"]);
    expect(calls[0].model).toBe(CODE_MODEL);
    // Codex models reject a temperature; reasoning effort is the knob instead.
    expect(calls[0].body.temperature).toBeUndefined();
    expect(calls[0].body.reasoning?.effort).toBeTruthy();
  });

  it("still delivers a packet when the coding model is refused — from the general model, charged once", async () => {
    const app = await getTestApp();
    const { agent, projectId, buildTaskId } = await project(app);
    mode = "codex-down"; calls.length = 0;
    const before = await creditsUsed(agent);

    const res = await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId: buildTaskId });

    expect(res.status).toBe(200);
    expect(res.body.payload.model).toBe(TEXT_MODEL);
    expect(calls.map((c) => `${c.api}:${c.model}`)).toEqual([`responses:${CODE_MODEL}`, `chat:${TEXT_MODEL}`]);
    // Two model calls on our side is not two charges on theirs.
    expect((await creditsUsed(agent)) - before).toBe(CREDIT_COSTS.taskAssist);
  });

  it("doesn't paper over an unreadable answer with a second model — 502, uncharged", async () => {
    const app = await getTestApp();
    const { agent, projectId, buildTaskId } = await project(app);
    mode = "codex-garbage"; calls.length = 0;
    const before = await creditsUsed(agent);

    const res = await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId: buildTaskId });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("model_unreadable");
    expect(calls.some((c) => c.api === "chat")).toBe(false);
    expect(await creditsUsed(agent)).toBe(before);
  });

  it("leaves drafts on the general model", async () => {
    const app = await getTestApp();
    const { agent, projectId, draftTaskId } = await project(app);
    expect(draftTaskId).toBeTruthy();
    mode = "ok"; calls.length = 0;

    await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId: draftTaskId });

    // Options to choose between are prose; the coding model is for code.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.api === "chat" && c.model === TEXT_MODEL)).toBe(true);
  });
});

describe("run steps as blocks", () => {
  it("keeps the model's groups, computes the clipboard text itself, and opens a new tab after a server", async () => {
    const app = await getTestApp();
    const { agent, projectId, buildTaskId } = await project(app);
    mode = "structured"; calls.length = 0;

    const res = await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId: buildTaskId });

    expect(res.status).toBe(200);
    const groups = res.body.payload.runGroups;
    expect(groups.map((g: any) => g.where)).toEqual(["terminal", "new-terminal"]);
    expect(groups[0].copy).toBe("npm install\nnpm run dev");
    // The model's copy text is ignored: the clipboard gets the commands and nothing else.
    expect(groups[1].copy).toBe("curl -s localhost:5001/_health");
    expect(groups[1].before).toMatch(/new terminal tab/i);
    // Flattened, for anything that still reads the old list.
    expect(res.body.payload.runSteps).toEqual(["npm install", "npm run dev", "curl -s localhost:5001/_health"]);
  });

  it("gives an older packet its blocks when it's read back, without rewriting it", async () => {
    const app = await getTestApp();
    const { agent, projectId, buildTaskId } = await project(app);
    const { saveWork } = await import("../../server/phase-trees");
    await saveWork(projectId, buildTaskId, {
      kind: "build", summary: "x", files: [], verify: "", assumptions: [],
      runSteps: ["npm install", "npm run dev", "In the web app, open DevTools Console and run: `fetch('/api/track')`"],
    } as any);

    const res = await agent.get(`/api/projects/${projectId}/path/work/${buildTaskId}`);

    expect(res.status).toBe(200);
    expect(res.body.work.payload.runGroups.map((g: any) => g.where)).toEqual(["terminal", "browser-console"]);
    expect(res.body.work.payload.runGroups[1].before).toMatch(/^Leave that running/);
  });
});
