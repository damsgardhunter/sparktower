/**
 * The project's own AI writes, on the success path.
 *
 * `ai-metering-sweep.test.ts` drives every AI route with a model that throws,
 * answers nothing, or answers prose, and proves nothing is charged. It is thorough
 * and it never sees one of them succeed — so a route broken on a *good* answer
 * passes it, and these four were named by no other test at all.
 *
 * Two things here are the inverse of what the sweep proves, and both are worth
 * having:
 *
 *  - **A success is billed.** The sweep proves a failure is not charged. Nothing
 *    proved the other direction, and a route that forgot to deduct would spend
 *    real money on every call and bill nobody — a leak that gets louder with use
 *    and that no error ever reports.
 *  - **A success is kept.** A generated persona that is not stored is a dollar
 *    spent on something that vanishes when the page reloads.
 *
 * The model is mocked throughout. Nothing here reaches OpenAI or spends anything.
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

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.200.${20 + (n++ % 200)}`;

async function person(app: any, tag: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `pai-${tag}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "Testpass123!", firstName: `P${n}` });
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  await verifyEmail(app, email, ip());
  return { agent, id: res.body.id as string };
}

async function aProject(agent: any) {
  const res = await agent.post("/api/projects").send({
    title: "Generated", description: "A project used to drive its AI writes.",
    oneLiner: "Deposit-backed bookings for restaurants.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  return res.body.id as string;
}

const creditsUsed = async (agent: any) => (await agent.get("/api/subscription")).body.creditsUsed as number;

/** Each route, a believable answer, and what it needs sent. */
const ROUTES = [
  {
    path: "ai/detect-gaps",
    good: JSON.stringify({ gaps: [{ category: "risk", title: "No tests", description: "Nothing is tested.", severity: "high" }] }),
    body: {},
  },
  {
    path: "ai/summarize-progress",
    good: JSON.stringify({ summary: "Two tasks done, the rest open.", highlights: ["Brief written"], concerns: ["No traction"] }),
    body: {},
  },
  {
    path: "personas/generate",
    good: JSON.stringify({
      name: "Rushed Restaurateur", role: "Owner-operator", age: 41,
      goals: ["Fill tables"], frustrations: ["No-shows"], behaviors: ["Checks bookings at 5pm"],
      quote: "Every empty table is money.",
    }),
    body: {},
  },
] as const;

describe("a project's AI writes, when the model answers", () => {
  for (const route of ROUTES) {
    it(`${route.path}: answers, and charges for it`, async () => {
      /*
       * The billing direction nothing else covers. A route that forgot to deduct
       * would spend money on every call and bill nobody.
       */
      const app = await getTestApp();
      const owner = await person(app, "own");
      const projectId = await aProject(owner.agent);
      answer = route.good;
      calls = 0;

      const before = await creditsUsed(owner.agent);
      const res = await owner.agent.post(`/api/projects/${projectId}/${route.path}`)
        .set("x-forwarded-for", ip()).send(route.body);
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
      expect(calls, "the model should have been asked").toBeGreaterThan(0);
      expect(
        await creditsUsed(owner.agent) - before,
        `${route.path} answered successfully and charged nothing`,
      ).toBeGreaterThan(0);
    });

    it(`${route.path}: is closed to somebody not on the project`, async () => {
      const app = await getTestApp();
      const owner = await person(app, "own");
      const stranger = await person(app, "str");
      const projectId = await aProject(owner.agent);
      answer = route.good;

      const before = await creditsUsed(stranger.agent);
      const res = await stranger.agent.post(`/api/projects/${projectId}/${route.path}`)
        .set("x-forwarded-for", ip()).send(route.body);
      expect([403, 404], `a stranger got ${res.status}`).toContain(res.status);
      /* And a refusal costs them nothing, which is the rule everywhere else too. */
      expect(await creditsUsed(stranger.agent)).toBe(before);
    });
  }
});

describe("a generated persona", () => {
  it("is stored, so the dollar buys something that survives a reload", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own");
    const projectId = await aProject(owner.agent);
    answer = ROUTES.find((r) => r.path === "personas/generate")!.good;

    const before = (await owner.agent.get(`/api/projects/${projectId}/personas`).expect(200)).body as any[];
    await owner.agent.post(`/api/projects/${projectId}/personas/generate`)
      .set("x-forwarded-for", ip()).send({}).expect(200);

    const after = (await owner.agent.get(`/api/projects/${projectId}/personas`).expect(200)).body as any[];
    expect(after.length, "a generated persona that is not stored is a dollar for nothing").toBe(before.length + 1);
    expect(after.some((p) => String(p.name).includes("Restaurateur"))).toBe(true);
  });
});

describe("next actions", () => {
  it("answers and charges, on the roadmap a project already has", async () => {
    /*
     * This started as a test that it refuses without a roadmap — "Build a roadmap
     * first, then Nova can tell you what's next" — on the assumption that a new
     * project has none. It has: `GET /api/projects/:id/roadmap` answers 200 with no
     * phases, so that branch is not reachable by creating a project, and the
     * premise was mine rather than the route's.
     *
     * What is worth holding is the same thing as the others: it answers, and the
     * answer is billed.
     */
    const app = await getTestApp();
    const owner = await person(app, "own");
    const projectId = await aProject(owner.agent);
    answer = JSON.stringify({ actions: [{ title: "Name the buyer", why: "Nothing else can be sized without it" }] });
    calls = 0;

    const before = await creditsUsed(owner.agent);
    const res = await owner.agent.post(`/api/projects/${projectId}/roadmap/next-actions`)
      .set("x-forwarded-for", ip()).send({});
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
    expect(calls).toBeGreaterThan(0);
    expect(await creditsUsed(owner.agent) - before, "answered and charged nothing").toBeGreaterThan(0);
  });

  it("is closed to somebody not on the project", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own");
    const stranger = await person(app, "str");
    const projectId = await aProject(owner.agent);
    const res = await stranger.agent.post(`/api/projects/${projectId}/roadmap/next-actions`)
      .set("x-forwarded-for", ip()).send({});
    expect([403, 404]).toContain(res.status);
  });
});

describe("an unreadable answer", () => {
  /**
   * Only for the routes whose answer is *data*. `ai/summarize-progress` asks the
   * model for markdown prose and returns it, so arbitrary text is a correct answer
   * there and billing it is honest — expecting a 502 from it was my mistake, not
   * the route's.
   */
  const JSON_ROUTES = ROUTES.filter((r) => r.path !== "ai/summarize-progress");

  it("is a 502 that costs nothing, on each route whose answer is data", async () => {
    const app = await getTestApp();
    const owner = await person(app, "own");
    const projectId = await aProject(owner.agent);
    answer = "I'm afraid I can't help with that.";

    for (const route of JSON_ROUTES) {
      const before = await creditsUsed(owner.agent);
      const res = await owner.agent.post(`/api/projects/${projectId}/${route.path}`)
        .set("x-forwarded-for", ip()).send(route.body);
      expect(res.status, `${route.path} answered ${res.status} to prose`).toBe(502);
      expect(res.body.code, `${route.path} should say why`).toBe("model_unreadable");
      expect(await creditsUsed(owner.agent) - before, `${route.path} charged for an unreadable answer`).toBe(0);
    }
  });

  it("is prose, and billed, where prose is what was asked for", async () => {
    /*
     * The honest other half. A progress summary is markdown by design, so there is
     * no such thing as an unreadable one short of silence — and silence is what the
     * existing sweep covers.
     */
    const app = await getTestApp();
    const owner = await person(app, "own");
    const projectId = await aProject(owner.agent);
    answer = "## This week\n\n- Wrote the brief\n- Nothing shipped";

    const before = await creditsUsed(owner.agent);
    const res = await owner.agent.post(`/api/projects/${projectId}/ai/summarize-progress`)
      .set("x-forwarded-for", ip()).send({});
    expect(res.status).toBeLessThan(300);
    expect(await creditsUsed(owner.agent) - before).toBeGreaterThan(0);
  });
});
