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
    // An image model that fails the same three ways: it throws, or it answers with no image in it.
    images = {
      generate: async () => { calls++; if (mode === "throw") throw new Error("no images in tests"); return { data: [{}] }; },
      edit: async () => { calls++; if (mode === "throw") throw new Error("no images in tests"); return { data: [{}] }; },
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
/**
 * A builder with money on the account and a day pass running, so that neither
 * the month's allowance nor an empty balance stops a route before the model —
 * what this sweep is about is what a *model* failure costs, and a 402 would
 * hide it. The balance is asserted whole again at the end.
 */
async function builder(app: any) {
  n += 1;
  const email = `sweep-${Date.now()}-${n}@example.test`;
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${70 + n}`).send({ email, password: "Testpass123!" });
  expect(reg.status).toBe(201);
  await db.update(users).set({
    balanceCents: SWEEP_BALANCE_CENTS,
    dayPassUntil: new Date(Date.now() + 6 * 60 * 60 * 1000),
  }).where(eq(users.email, email));
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  const project = await agent.post("/api/projects").send({ title: "Sweep", description: "A project every AI route is called against, with a failing model.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
  const path = await agent.get(`/api/projects/${project.body.id}/path`);
  const token = (await agent.post("/api/mcp-tokens").send({ label: "Sweep" })).body.token as string | undefined;
  return { agent, userId: reg.body.id as string, projectId: project.body.id as string, taskId: (path.body?.next?.workTaskId ?? "no-such-task") as string, token };
}
const creditsUsed = async (agent: any) => (await agent.get("/api/subscription")).body.creditsUsed as number;
/** Far more than the dearest thing the sweep can buy, so nothing is refused for being short. */
const SWEEP_BALANCE_CENTS = 100_000;
const balanceOf = async (userId: string) =>
  (await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, userId)))[0].balanceCents;

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

    const results: { route: string; mode: string; status: number; reachedModel: boolean; charged: number; code: string | null }[] = [];
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
        results.push({
          route: `${r.method} ${r.path}`, mode: m, status: res.status, reachedModel: calls > callsBefore,
          charged: (await creditsUsed(b.agent)) - before, code: res.body?.code ?? null,
        });
      }
    }

    const reached = [...new Set(results.filter((x) => x.reachedModel).map((x) => x.route))];
    console.log(`[sweep] ${routes.length} AI routes; ${reached.length} reached the model:\n  ${results.map((x) => `${x.mode.padEnd(7)} ${String(x.status).padEnd(4)} ${x.reachedModel ? "model" : "     "} charged=${x.charged}  ${x.route}`).join("\n  ")}`);

    // A thrown call or an empty answer is never a success; an error answer is never billed.
    const billedFailures = results.filter((x) => x.charged !== 0 && (x.mode === "throw" || x.mode === "empty" || x.status >= 400));
    expect(billedFailures, "charged for a failed model call or an error answer").toEqual([]);
    expect(reached.length).toBeGreaterThanOrEqual(MIN_ROUTES_REACHING_THE_MODEL);

    /*
     * And the money. A priced outcome — a roadmap, a document, an audit — takes
     * its dollars before the model runs, so "nothing was charged" has to be
     * true of the balance too, not just of the month's allowance. Every one of
     * those calls failed; every dollar came back.
     */
    expect(await balanceOf(b.userId), "a failed priced outcome must refund").toBe(SWEEP_BALANCE_CENTS);

    /*
     * What the answer says when the model answered, badly. The route scan
     * records which routes *should* answer 502 model_unreadable; this is the
     * same claim made at runtime, per route, which is the part a reader can't
     * take on trust from the source.
     */
    const unreadable = results.filter((x) => x.reachedModel && (x.mode === "empty" || x.mode === "garbage"));
    const wrongError = unreadable.filter((x) => x.status >= 500 && !(x.status === 502 && x.code === "model_unreadable"));
    expect(wrongError, "an unreadable model answer must be 502 model_unreadable, never a generic 5xx").toEqual([]);

    /*
     * Prose can be a route's answer — a chat reply, a verdict, a summary — so
     * answering 2xx to garbage and charging for it is honest there. Nothing is
     * ever a valid answer: a route that returns 2xx when the model said nothing
     * is answering with something that isn't Nova's, and must say so by being a
     * known fallback, and must not charge.
     */
    const saidNothing = results.filter((x) => x.reachedModel && x.mode === "empty");
    const fallbacks = [...new Set(saidNothing.filter((x) => x.status < 400).map((x) => x.route))].sort();
    expect(fallbacks, "a route that answers 2xx when the model said nothing must be a known, unbilled fallback").toEqual(UNBILLED_FALLBACKS);
    expect(saidNothing.filter((x) => x.charged !== 0), "charged when the model said nothing").toEqual([]);
  }, 300_000);
});

/**
 * Routes that answer 2xx when the model's answer is unreadable, because they
 * have something sensible to fall back to — and charge nothing for it. Adding
 * to this list is a decision: it means the person gets an answer that isn't
 * Nova's without being told.
 */
const UNBILLED_FALLBACKS = [
  // The storyboard falls back to generic scenes; only Nova's scenes are billed (server/routes.ts).
  "POST /api/projects/:id/generate-video",
  /*
   * A season from a project falls back to the nearest of the seven catalogue
   * markets when Nova can't write one, because somebody who pressed the button
   * should get a season either way (server/project-simulation-routes.ts).
   *
   * It meets the bar this list sets, on both halves. It does not charge — the
   * deduction is under `if (!fellBack)`, so the hold is released untouched.
   * And the person is told rather than left to assume: the response carries
   * `fellBack`, and the market it hands back is marked `written: false`, which
   * is what the page reads to say the market isn't theirs.
   */
  "POST /api/projects/:id/simulation",
  /*
   * Reputation used to be here: the route asked Nova for the strategic pillar
   * and answered anyway when the model said nothing. It no longer reaches a
   * model at all — the weekly job does that (server/reputation-jobs.ts) — so
   * it is not an unbilled fallback, it is an ordinary route.
   */
];

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
