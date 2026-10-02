/**
 * The last three AI writes nothing named: a mock interview, a résumé evaluation,
 * and the game's idea suggestions.
 *
 * With these the repository has no write route that no test names. The most valuable
 * of the three is the first, for a rule it states about itself:
 *
 *   // No first question, no interview: close it uncharged rather than
 *   // leave an empty one open claiming a credit it never took.
 *
 * That is an invariant with a database row behind it. If the model fails on the
 * opening question, an interview row has already been written — and left open it
 * would sit in somebody's list for ever, empty, looking like a thing they paid for.
 *
 * The model is mocked. Nothing here reaches OpenAI or spends anything.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

let answer = "{}";
let calls = 0;

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async () => { calls++; return { choices: [{ message: { content: answer } }] }; } } };
    responses = { create: async () => { calls++; return { output_text: answer, output: [] }; } };
    images = { generate: async () => ({ data: [{}] }), edit: async () => ({ data: [{}] }) };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { verifyEmail } = await import("../helpers/verify-email");
const { db } = await import("../../server/db");
const { eq } = await import("drizzle-orm");
const { mockInterviews } = await import("@shared/schema");

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.210.${20 + (n++ % 200)}`;

async function person(app: any, tag: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `last-${tag}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "Testpass123!", firstName: `L${n}` });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  await verifyEmail(app, email, ip());
  return { agent, id: res.body.id as string };
}

async function aProject(agent: any) {
  const res = await agent.post("/api/projects").send({
    title: "Interviewed", description: "A project used to drive a mock investor interview.",
    oneLiner: "Deposit-backed bookings.", category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.id as string;
}

const creditsUsed = async (agent: any) => (await agent.get("/api/subscription")).body.creditsUsed as number;
const openInterviews = async (projectId: string) =>
  db.select().from(mockInterviews).where(eq(mockInterviews.projectId, projectId));

describe("starting a mock investor interview", () => {
  it("opens one, asks the first question, and charges", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own");
    const projectId = await aProject(owner.agent);
    /* The question is prose by design: "Reply with the question text alone — no JSON, no quotes." */
    answer = "What does a no-show actually cost you, in pounds?";
    calls = 0;

    const before = await creditsUsed(owner.agent);
    const res = await owner.agent.post(`/api/projects/${projectId}/mock-interview`)
      .set("x-forwarded-for", ip()).send({ difficulty: "friendly" });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
    expect(calls).toBeGreaterThan(0);
    expect(await creditsUsed(owner.agent) - before, "a question was asked and nothing was charged").toBeGreaterThan(0);

    const rows = await openInterviews(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).not.toBe("completed");
  });

  it("leaves no empty interview behind when the first question fails", async () => {
    /*
     * The route's own rule. The interview row is written before the model is asked,
     * so a failure here would otherwise leave an open, empty interview in somebody's
     * list — looking like something they bought.
     */
    const app = await getTestApp();
    const owner = await person(app, "own");
    const projectId = await aProject(owner.agent);
    /*
     * Empty, not prose. Prose *is* a valid question here, so "I can't think of one"
     * would have become the question — which is what my first version of this test
     * asserted against, wrongly. Silence is the only failure.
     */
    answer = "";

    const before = await creditsUsed(owner.agent);
    const res = await owner.agent.post(`/api/projects/${projectId}/mock-interview`)
      .set("x-forwarded-for", ip()).send({ difficulty: "friendly" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("model_unreadable");

    const rows = await openInterviews(projectId);
    /*
     * The row may exist — it was written first — but it must be closed and must
     * claim nothing. An open one would be the bug.
     */
    for (const row of rows) {
      expect(row.status, "an interview with no question must not be left open").toBe("completed");
      expect(row.creditsCharged, "and must not claim a credit it never took").toBe(0);
    }
    expect(await creditsUsed(owner.agent), "nothing charged for a question that never came").toBe(before);
  });

  it("is closed to somebody not on the project", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own");
    const stranger = await person(app, "str");
    const projectId = await aProject(owner.agent);
    answer = "Anything you would like to tell me?";

    const res = await stranger.agent.post(`/api/projects/${projectId}/mock-interview`)
      .set("x-forwarded-for", ip()).send({});
    expect([403, 404], `a stranger got ${res.status}`).toContain(res.status);
    expect(await openInterviews(projectId), "and opened nothing").toHaveLength(0);
  });
});

describe("evaluating a résumé", () => {
  it("says so when there is nothing to read, rather than asking the model", async () => {
    const app = await getTestApp();
    const me = await person(app, "cv");
    calls = 0;

    const res = await me.agent.post("/api/profile/evaluate-resume").set("x-forwarded-for", ip()).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no résumé|upload/i);
    expect(calls, "it must not pay for reading nothing").toBe(0);
  });

  it("refuses one longer than it will read, and says the limit", async () => {
    /*
     * 20,000 characters. A cap that refuses without naming the number leaves
     * somebody guessing how much to cut.
     */
    const app = await getTestApp();
    const me = await person(app, "cv2");
    calls = 0;

    const res = await me.agent.post("/api/profile/evaluate-resume")
      .set("x-forwarded-for", ip()).send({ resumeText: "x".repeat(20_001) });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/20,000/);
    expect(calls).toBe(0);
  });

  it("reads one that is pasted in, and charges for it", async () => {
    const app = await getTestApp();
    const me = await person(app, "cv3");
    answer = JSON.stringify({
      skills: ["TypeScript", "Postgres"], headline: "Backend engineer, eight years",
      interests: ["fintech"], lookingFor: ["co-founder"], summary: "Solid backend history.",
    });
    calls = 0;

    const before = await creditsUsed(me.agent);
    const res = await me.agent.post("/api/profile/evaluate-resume").set("x-forwarded-for", ip())
      .send({ resumeText: "Eight years building payment systems in TypeScript and Postgres." });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
    expect(calls).toBeGreaterThan(0);
    expect(await creditsUsed(me.agent) - before).toBeGreaterThan(0);
  });
});

describe("the game's idea suggestions", () => {
  it("answers and charges", async () => {
    const app = await getTestApp();
    const me = await person(app, "idea");
    /* `ideas`, and each needs a name and a pitch or it is filtered out entirely. */
    answer = JSON.stringify({
      ideas: [
        { name: "Tablehold", tagline: "Bookings that turn up", pitch: "Deposits for bookings", twist: "The deposit buys a drink", whoItsFor: "Restaurants", vibe: "practical" },
        { name: "Covered", tagline: "No-show insurance", pitch: "Insure the covers", twist: "The restaurant never chases", whoItsFor: "Restaurants", vibe: "calm" },
      ],
    });
    calls = 0;

    const before = await creditsUsed(me.agent);
    const res = await me.agent.post("/api/games/idea-options").set("x-forwarded-for", ip())
      .send({ productStyle: "modern" });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
    expect(calls).toBeGreaterThan(0);
    expect(await creditsUsed(me.agent) - before).toBeGreaterThan(0);
  });

  it("needs a session", async () => {
    const app = await getTestApp();
    expect((await request(app).post("/api/games/idea-options").send({ productStyle: "modern" })).status).toBe(401);
  });
});
