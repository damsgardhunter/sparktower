/**
 * Every AI route, on the running app, with a model that fails.
 *
 * The unit test reads the order of check, model call and charge from the
 * source. This runs it: the model is replaced by one that throws, then one
 * that answers with prose where JSON was expected, and every AI route is
 * called. The rule it holds each one to:
 *
 * - When the model throws, or answers with nothing, nothing is charged —
 *   whatever the route answers. (A route that catches the failure and returns
 *   a fallback must not bill the fallback.)
 * - When a route answers with an error, nothing is charged.
 *
 * Routes whose fixtures this can't build (a sprint, a document) answer 404
 * before the model; they're still held to the rule, and the count of routes
 * that genuinely reached the model is asserted so the sweep can't go hollow.
 * Plus the chat routes' empty and malformed answers, and the interview
 * verdict that runs once.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { vi } from "vitest";

let mode: "throw" | "garbage" | "empty" | "chat-malformed" | "verdict" = "throw";
let calls = 0;
vi.mock("openai", () => {
  const answer = () => {
    calls++;
    if (mode === "throw") throw new Error("model exploded");
    if (mode === "empty") return "";
    if (mode === "chat-malformed") return `Here's a thought about your project. <project_update>{"title": oops}</project_update>`;
    if (mode === "verdict") return "I'd take a second meeting.";
    return "I'm sorry, I can't produce that right now.";
  };
  class OpenAI {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: answer() } }] }) } };
    responses = { create: async () => ({ output_text: answer(), output: [] }) };
    images = {
      generate: async () => { calls++; throw new Error("no images in tests"); },
      edit: async () => { calls++; throw new Error("no images in tests"); },
    };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { eq } = await import("drizzle-orm");
const { users, mockInterviews, mockInterviewTurns } = await import("@shared/schema");
const { buildRouteCoverage } = await import("../../server/route-coverage");
const { CREDIT_COSTS } = await import("@shared/plans");

afterAll(async () => { await closeTestApp(); delete process.env.RATE_LIMIT_EXEMPT_EMAILS; });

/** The AI routes, from the same scan the audit and the unit test use. */
function aiRoutes() {
  const root = join(__dirname, "..", "..");
  const walk = (d: string, out: string[] = []): string[] => {
    for (const n of readdirSync(d)) {
      if (["node_modules", ".git", "dist", "test-results", ".cache", ".local", "local_objects", "client", "mobile", "test", "e2e", "packages"].includes(n)) continue;
      const p = join(d, n);
      statSync(p).isDirectory() ? walk(p, out) : out.push(p);
    }
    return out;
  };
  const files = walk(root).filter((p) => /\.(ts|js)$/.test(p)).map((p) => ({ path: p.slice(root.length + 1), size: 0, content: readFileSync(p, "utf8") }));
  return buildRouteCoverage(files).rows.filter((r) => r.mounted && r.cost && r.write);
}

let n = 0;
/** A builder on the top tier (so no feature gate stops a route before the model), exempt from limits for the sweep. */
async function builder(app: any) {
  n += 1;
  const email = `sweep-${Date.now()}-${n}@example.test`;
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${70 + n}`).send({ email, password: "Testpass123!" });
  expect(reg.status).toBe(201);
  await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.email, email));
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  const project = await agent.post("/api/projects").send({ title: "Sweep", description: "A project every AI route is called against, with a failing model.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
  const path = await agent.get(`/api/projects/${project.body.id}/path`);
  const token = (await agent.post("/api/mcp-tokens").send({ label: "Sweep" })).body.token as string | undefined;
  return { agent, userId: reg.body.id as string, projectId: project.body.id as string, taskId: (path.body?.next?.workTaskId ?? "no-such-task") as string, token };
}
const creditsUsed = async (agent: any) => (await agent.get("/api/subscription")).body.creditsUsed as number;

const BODY = {
  message: "Help me plan the next step.", taskId: undefined as string | undefined, answer: "A thoughtful answer.",
  prompt: "A short launch video", style: "cinematic", useAiImages: false, text: "Some text to work with.",
  content: "Some content.", input: "A request for Nova.", goal: "ship_mvp", history: [],
};

describe("every AI route, with a model that fails", () => {
  it("charges nothing when the model errors, and nothing when a route answers with an error", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    const routes = aiRoutes();
    expect(routes.length).toBeGreaterThan(40);

    const results: { route: string; mode: string; status: number; reachedModel: boolean; charged: number }[] = [];
    for (const m of ["throw", "garbage", "empty"] as const) {
      mode = m;
      for (const r of routes) {
        const url = r.path
          .replace(":projectId", b.projectId)
          .replace(":taskId", b.taskId)
          .replace(/:id\b/, r.path.startsWith("/api/projects/") ? b.projectId : "no-such-id")
          .replace(/:\w+/g, "no-such-id");
        const before = await creditsUsed(b.agent);
        const callsBefore = calls;
        const call = r.path.startsWith("/api/mcp/")
          ? (request(app) as any)[r.method.toLowerCase()](url).set("authorization", `Bearer ${b.token}`)
          : (b.agent as any)[r.method.toLowerCase()](url);
        const res = await call.send({ ...BODY, taskId: b.taskId });
        results.push({ route: `${r.method} ${r.path}`, mode: m, status: res.status, reachedModel: calls > callsBefore, charged: (await creditsUsed(b.agent)) - before });
      }
    }

    const reached = [...new Set(results.filter((x) => x.reachedModel).map((x) => x.route))];
    console.log(`[sweep] ${routes.length} AI routes; ${reached.length} reached the model:\n  ${results.map((x) => `${x.mode.padEnd(7)} ${String(x.status).padEnd(4)} ${x.reachedModel ? "model" : "     "} charged=${x.charged}  ${x.route}`).join("\n  ")}`);

    // A thrown call or an empty answer is never a success; an error answer is never billed.
    const billedFailures = results.filter((x) => x.charged !== 0 && (x.mode === "throw" || x.mode === "empty" || x.status >= 400));
    expect(billedFailures, "charged for a failed model call or an error answer").toEqual([]);
    expect(reached.length).toBeGreaterThanOrEqual(MIN_ROUTES_REACHING_THE_MODEL);
  }, 300_000);
});

/** Routes the sweep drives all the way to the model; raise it when fixtures reach more, never lower it. */
const MIN_ROUTES_REACHING_THE_MODEL = 26;

describe("the chat routes' answers", () => {
  it("/api/chat: an empty answer is a 502 that costs nothing; a malformed update block keeps the reply, drops the tag, and costs the chat", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    mode = "empty";
    const before = await creditsUsed(b.agent);
    const empty = await b.agent.post("/api/chat").send({ message: "Hello" });
    expect(empty.status).toBe(502);
    expect(empty.body.code).toBe("model_unreadable");
    expect(await creditsUsed(b.agent)).toBe(before);

    mode = "chat-malformed";
    const ok = await b.agent.post("/api/chat").send({ message: "Hello" });
    expect(ok.status).toBe(200);
    expect(ok.body.reply).toBe("Here's a thought about your project.");
    expect(ok.body.projectUpdates).toBeNull();
    expect(await creditsUsed(b.agent)).toBe(before + CREDIT_COSTS.novaChat);
  });

  it("project chat: an empty answer is a 502, not a stored apology, and costs nothing", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    mode = "empty";
    const before = await creditsUsed(b.agent);
    const res = await b.agent.post(`/api/projects/${b.projectId}/chat`).send({ message: "Hello" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("model_unreadable");
    expect(await creditsUsed(b.agent)).toBe(before);
  });
});

describe("the interview verdict", () => {
  it("runs once; finishing again returns the stored verdict without calling the model", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    const [interview] = await db.insert(mockInterviews).values({ projectId: b.projectId, userId: b.userId, persona: "any", status: "active" } as any).returning();
    await db.insert(mockInterviewTurns).values({ interviewId: interview.id, order: 0, question: "Why now?", answer: "Because the market moved.", score: 70 } as any);

    mode = "verdict";
    const start = calls;
    const first = await b.agent.post(`/api/mock-interviews/${interview.id}/finish`).send({});
    expect(first.status).toBe(200);
    expect(first.body.interview.verdict).toBe("I'd take a second meeting.");
    expect(calls - start).toBe(1);

    const again = await b.agent.post(`/api/mock-interviews/${interview.id}/finish`).send({});
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ alreadyFinished: true, interview: { verdict: "I'd take a second meeting." } });
    expect(calls - start).toBe(1);
  });
});
