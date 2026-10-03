/**
 * The four investor artifacts, on the success path — and with a hostile model.
 *
 * `ai-metering-sweep.test.ts` drives every AI route with a model that throws,
 * answers nothing, or answers prose, and proves nothing is charged. It never sees
 * one succeed. So the whole success path of these four was untested: a route that
 * 500s on a *good* answer is invisible to that sweep, and these are the routes
 * somebody pays a dollar for.
 *
 * The second half matters more. Each of these takes a JSON object from the model and
 * writes parts of it to the database, and each clamps what it takes — a score to
 * 0–100, a verdict to four known words, a list to eight, a string to five hundred
 * characters. A model is an untrusted input: it is the one source in this product
 * that can say `"overall": 5000` or hand over ten thousand characters where a
 * sentence was asked for, and not because anybody attacked it. Nothing tested a
 * single one of those clamps.
 *
 * The model is mocked. Nothing here reaches OpenAI or spends anything.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

/** What the mocked model says next. Set per test. */
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

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.190.${20 + (n++ % 200)}`;

async function person(app: any, tag: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `inv-${tag}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "Testpass123!", firstName: `I${n}` });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  await verifyEmail(app, email, ip());
  return { agent, id: res.body.id as string };
}

async function aProject(agent: any) {
  const res = await agent.post("/api/projects").send({
    title: "Raising", description: "A project used to drive the investor artifacts.",
    oneLiner: "Bookings for restaurants that hate no-shows.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.id as string;
}

/** The list route answers `{ artifacts, interviews, costs }`, not a bare array. */
const artifacts = async (agent: any, projectId: string) =>
  (await agent.get(`/api/projects/${projectId}/investor-artifacts`).expect(200)).body.artifacts as any[];

/** A believable answer for each route, in the shape its prompt asks for. */
const GOOD: Record<string, string> = {
  "readiness-score": JSON.stringify({
    overall: 42, verdict: "early", summary: "Honest start, thin evidence.",
    categories: [{ name: "Problem clarity", score: 60, finding: "Clear enough.", toImprove: "Name the buyer." }],
    blockers: ["No traction yet"],
  }),
  "pitch-deck": JSON.stringify({
    summary: "A deck about covers lost to no-shows.",
    slides: [
      { number: 1, purpose: "Title", headline: "Bookings that turn up", bullets: ["Deposits, not reminders"], speakerNotes: "Open with the number." },
      { number: 2, purpose: "Problem", headline: "Empty tables", bullets: ["12% no-show rate"], speakerNotes: "Name the cost." },
    ],
  }),
  "pitch-critique": JSON.stringify({
    verdict: "needs work", summary: "The ask is buried.",
    strengths: ["Clear problem"], weaknesses: ["No numbers"],
    questions: ["What does a cover cost you?"],
  }),
  "pricing-analysis": JSON.stringify({
    summary: "Under-priced for the value.",
    recommendation: "Raise to £49", tiers: [{ name: "Pro", price: 49, rationale: "Covers support" }],
  }),
};

/** What each route needs sent with it. `pitch-critique` refuses an empty one. */
const BODY: Record<string, Record<string, unknown>> = {
  "pitch-critique": { pitch: "We sell deposit-backed bookings to restaurants that lose covers to no-shows." },
};

const ROUTES = ["readiness-score", "pitch-deck", "pitch-critique", "pricing-analysis"] as const;

describe("generating an investor artifact", () => {
  for (const route of ROUTES) {
    it(`${route}: answers, stores something, and the list shows it`, async () => {
      /*
       * The success path, which the failing-model sweep cannot see. A route that
       * throws on a good answer would pass every existing test.
       */
      const app = await getTestApp();
      const owner = await person(app, "own");
      const projectId = await aProject(owner.agent);
      answer = GOOD[route];
      calls = 0;

      const before = await artifacts(owner.agent, projectId);
      const res = await owner.agent.post(`/api/projects/${projectId}/${route}`).set("x-forwarded-for", ip()).send(BODY[route] ?? {});
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(calls, "the model should have been asked").toBeGreaterThan(0);

      const after = await artifacts(owner.agent, projectId);
      expect(after.length, "a generated artifact should be readable afterwards").toBe(before.length + 1);
    });

    it(`${route}: is closed to somebody not on the project`, async () => {
      const app = await getTestApp();
      const owner = await person(app, "own");
      const stranger = await person(app, "str");
      const projectId = await aProject(owner.agent);
      answer = GOOD[route];

      const res = await stranger.agent.post(`/api/projects/${projectId}/${route}`).set("x-forwarded-for", ip()).send(BODY[route] ?? {});
      expect([403, 404], `a stranger got ${res.status}`).toContain(res.status);
    });
  }
});

describe("a model that answers absurdly", () => {
  /**
   * Not an attack — a model does this on its own. These are the clamps each route
   * applies to what it was given, and every one of them was untested.
   */
  it("clamps a readiness score to the range it promises", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own");
    const projectId = await aProject(owner.agent);

    answer = JSON.stringify({
      overall: 5000,
      verdict: "stupendous",
      summary: "x".repeat(5000),
      categories: Array.from({ length: 40 }, (_, i) => ({
        name: `Category ${i} ${"n".repeat(200)}`, score: -999, finding: "f".repeat(2000), toImprove: "t".repeat(2000),
      })),
      blockers: Array.from({ length: 30 }, (_, i) => `blocker ${i}`),
    });

    const res = await owner.agent.post(`/api/projects/${projectId}/readiness-score`).set("x-forwarded-for", ip()).send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);

    const [stored] = await artifacts(owner.agent, projectId);
    expect(stored.score, "a score of 5000 must be clamped to 100").toBeLessThanOrEqual(100);
    expect(stored.score).toBeGreaterThanOrEqual(0);

    const content = stored.content ?? {};
    expect(["not-ready", "early", "getting-close", "ready"], "an invented verdict must fall back to a known one")
      .toContain(content.verdict);
    expect(content.categories.length, "forty categories must be cut to eight").toBeLessThanOrEqual(8);
    for (const category of content.categories) {
      expect(category.score, "a negative score must be clamped to 0").toBeGreaterThanOrEqual(0);
      expect(category.score).toBeLessThanOrEqual(100);
      expect(category.name.length, "a name has a bound").toBeLessThanOrEqual(60);
      expect(category.finding.length).toBeLessThanOrEqual(500);
      expect(category.toImprove.length).toBeLessThanOrEqual(500);
    }
    expect(content.blockers.length, "thirty blockers must be cut to five").toBeLessThanOrEqual(5);
  });

  it("refuses an unreadable answer with 502 rather than storing nothing quietly", async () => {
    /*
     * The sweep proves nothing is charged for this. What it does not say is that
     * the route answers 502 `model_unreadable` and writes no artifact — a 200 with
     * an empty artifact would look to a client like a result.
     */
    const app = await getTestApp();
    const owner = await person(app, "own");
    const projectId = await aProject(owner.agent);
    answer = "Sorry, I can't do that right now.";

    const before = await artifacts(owner.agent, projectId);
    const res = await owner.agent.post(`/api/projects/${projectId}/readiness-score`).set("x-forwarded-for", ip()).send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("model_unreadable");
    expect(await artifacts(owner.agent, projectId), "nothing should have been stored").toHaveLength(before.length);
  });
});
