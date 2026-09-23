/**
 * The decision simulator against a real database, with the model mocked.
 *
 * What is worth guarding here is not that Nova answers — it is that the answer
 * is the arithmetic's and not the model's. So the mock is deliberately a
 * flatterer: it reads every question as twelve wildly expensive hires and
 * writes glowing prose about them, and the tests check that the stored row
 * still says the business runs out of money. If the verdict ever starts coming
 * from the model, these fail.
 *
 * The rest: a project with no numbers is told what to fill in rather than sold
 * a projection of nothing; the simulator is bought once and every question
 * afterwards is free; a re-run with the owner's own numbers costs nothing and
 * changes the answer; the million has to go somewhere before anything is
 * valued; and a stranger gets the same 404 the rest of the Run path gives,
 * because what a company owes is the most private thing it keeps here.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

/*
 * Encouraging on purpose, and expensive on purpose: twelve people at $9,000 a
 * month, bringing in nothing, against a business taking $20,000. The verdict
 * must not be the model's to give.
 */
let mode: "decision" | "notADecision" | "garbage" = "decision";
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async ({ messages }: any) => {
      if (mode === "garbage") return { choices: [{ message: { content: "Go for it!" } }] };
      const system = String(messages?.[0]?.content ?? "");

      // The valuation prompt is the only one that asks for scores.
      if (system.includes('"scores"')) {
        return { choices: [{ message: { content: JSON.stringify({
          scores: { growth: 900, capital: 850, product: 880, acquisition: 870, risk: 100 },
          tenYear: 4_000_000_000, peak: 1_000, peakYear: 40,
          summary: "This is going to be enormous, obviously.",
          notes: { growth: "Huge.", capital: "Huge.", product: "Huge.", acquisition: "Huge.", risk: "None at all." },
          advice: ["Keep going!", "Do more of it!"],
        }) } }] };
      }

      // The narrative prompt asks for a headline and a body.
      if (system.includes('"headline"')) {
        return { choices: [{ message: { content: JSON.stringify({
          headline: "This is a fantastic idea and you should absolutely do it!",
          body: "Everything works out wonderfully. There is no downside here at all.",
          watchFor: ["Nothing, really"],
          alsoAsk: ["What if I hired twenty instead?"],
        }) } }] };
      }

      if (mode === "notADecision") {
        return { choices: [{ message: { content: JSON.stringify({
          levers: [], assumptions: [], cannotSimulate: "That isn't a question about money.", restated: "",
        }) } }] };
      }

      return { choices: [{ message: { content: JSON.stringify({
        levers: [{
          kind: "hire", label: "Twelve people", startMonth: 1,
          people: 12, monthlyCostEach: 9_000, monthlyRevenueEach: 0, rampMonths: 3,
        }],
        assumptions: ["Assumed $9,000 a month each, all in."],
        cannotSimulate: "",
        restated: "Hire twelve people now.",
      }) } }] };
    } } };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { verifyEmail } = await import("../helpers/verify-email");
const { db } = await import("../../server/db");
const { simulationBaselines, simulationScenarios, tenYearOutlooks, users } = await import("@shared/schema");
const { OUTCOME_PRICE_CENTS } = await import("@shared/plans");

afterAll(async () => { await closeTestApp(); });

/* A range no other spec registers from: sign-ups count against a per-address budget. */
let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.184.${(n % 200) + 20}`;
  const email = `dsim-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `D${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  await db.update(users).set({ balanceCents: OUTCOME_PRICE_CENTS.simulations * 4 }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string };
}

async function runProject(owner: { agent: any }, title = "Corner Café") {
  const res = await owner.agent.post("/api/projects").send({
    title, description: `${title}: trading for six years.`,
    category: "Other", goal: "run_company", subcategory: "restaurant",
  });
  expect(res.status, res.text).toBe(200);
  return res.body.id as string;
}

/** A business that covers its costs, saved as the owner's own figures. */
async function withNumbers(owner: { agent: any }, id: string, over: Record<string, number> = {}) {
  const numbers = {
    monthlyRevenue: 20_000, monthlyCosts: 16_000, cash: 30_000, debt: 0,
    interestRate: 0.1, debtRepayment: 0, growth: 0, grossMargin: 0.5, staff: 3, ...over,
  };
  const res = await owner.agent.put(`/api/projects/${id}/decision-sim/baseline`)
    .send({ numbers, overridden: Object.keys(numbers) });
  expect(res.status, res.text).toBe(200);
  return res.body;
}

const balanceOf = async (userId: string) =>
  (await db.select({ c: users.balanceCents }).from(users).where(eq(users.id, userId)))[0].c as number;

const ask = (owner: { agent: any }, id: string, question: string, months = 12) =>
  owner.agent.post(`/api/projects/${id}/decision-sim/scenarios`).send({ question, months });

describe("who can ask", () => {
  it("is members only, and a stranger is told the project doesn't exist", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const stranger = await person(app);
    const id = await runProject(owner);

    expect((await request(app).get(`/api/projects/${id}/decision-sim`)).status).toBe(401);
    expect((await stranger.agent.get(`/api/projects/${id}/decision-sim`)).status).toBe(404);
    expect((await ask(stranger, id, "What if I hire twelve people?")).status).toBe(404);
    expect((await stranger.agent.put(`/api/projects/${id}/decision-sim/baseline`).send({ numbers: {} })).status).toBe(404);
    expect((await owner.agent.get(`/api/projects/${id}/decision-sim`)).status).toBe(200);
  });
});

describe("before the business has said anything about itself", () => {
  it("says what to fill in rather than selling a projection of nothing", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);

    const before = await balanceOf(owner.id);
    const view = await owner.agent.get(`/api/projects/${id}/decision-sim`);
    expect(view.status).toBe(200);
    expect(view.body.notReady).toBeTruthy();
    expect(view.body.missing.length).toBeGreaterThan(0);

    const res = await ask(owner, id, "What happens if I hire twelve people right now?");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("no_numbers_yet");
    expect(await balanceOf(owner.id)).toBe(before);
  });
});

describe("the starting position", () => {
  it("keeps what the owner typed, and says which fields are theirs", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);

    const saved = await withNumbers(owner, id, { debt: 100_000, interestRate: 0.11, debtRepayment: 1_800 });
    expect(saved.baseline.debt).toBe(100_000);
    expect(saved.notReady).toBeNull();

    const view = await owner.agent.get(`/api/projects/${id}/decision-sim`);
    expect(view.body.baseline.debt).toBe(100_000);
    expect(view.body.overridden).toContain("debt");
    expect(view.body.baseline.monthlyCosts).toBe(16_000);

    // One row per project, edited in place: this describes the company, not an event.
    const rows = await db.select().from(simulationBaselines).where(eq(simulationBaselines.projectId, id));
    expect(rows).toHaveLength(1);
  });

  it("makes every number a number, whatever was sent", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);

    const res = await owner.agent.put(`/api/projects/${id}/decision-sim/baseline`)
      .send({ numbers: { monthlyRevenue: "loads", grossMargin: 7, staff: -4 }, overridden: ["monthlyRevenue", "nonsense"] });
    expect(res.status).toBe(200);
    expect(res.body.baseline.monthlyRevenue).toBe(0);
    expect(res.body.baseline.grossMargin).toBe(1);
    expect(res.body.baseline.staff).toBe(0);
    expect(res.body.overridden).toEqual(["monthlyRevenue"]);
  });
});

describe("asking a question", () => {
  it("keeps the arithmetic's verdict, however encouraging the model was", async () => {
    mode = "decision";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await withNumbers(owner, id);

    const res = await ask(owner, id, "What happens if I hire 12 people right now?");
    expect(res.status, res.text).toBe(200);

    const { scenario } = res.body;
    // The model said it was fantastic. Twelve people at $9,000 a month is not.
    expect(scenario.narrative.headline).toContain("fantastic");
    expect(scenario.result.verdict).toBe("it runs you out of money");
    expect(scenario.result.with.cautious.runsOutIn).not.toBeNull();
    // And the answer is measured against doing nothing, which is fine.
    expect(scenario.result.without.runsOutIn).toBeNull();
    expect(scenario.result.cashDifference).toBeLessThan(0);
    expect(scenario.levers[0].people).toBe(12);
    expect(scenario.assumptions.length).toBeGreaterThan(0);
  });

  it("charges once for the project and never again", async () => {
    mode = "decision";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await withNumbers(owner, id);

    const start = await balanceOf(owner.id);
    expect((await ask(owner, id, "What happens if I hire twelve people?")).status).toBe(200);
    const afterFirst = await balanceOf(owner.id);
    expect(start - afterFirst).toBe(OUTCOME_PRICE_CENTS.simulations);

    const second = await ask(owner, id, "And what if I hired two instead?");
    expect(second.status).toBe(200);
    expect(second.body.paidCents).toBe(0);
    expect(await balanceOf(owner.id)).toBe(afterFirst);

    // Both kept: comparing one decision with another is the whole feature.
    const rows = await db.select().from(simulationScenarios).where(eq(simulationScenarios.projectId, id));
    expect(rows).toHaveLength(2);
  });

  it("says so, and stores nothing, when the numbers cannot settle the question", async () => {
    mode = "notADecision";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await withNumbers(owner, id);

    const res = await ask(owner, id, "Should I be enjoying this more than I am?");
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("not_a_decision");
    expect(await db.select().from(simulationScenarios).where(eq(simulationScenarios.projectId, id))).toHaveLength(0);
    mode = "decision";
  });

  it("refuses a question too short to be one, before anything is charged", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await withNumbers(owner, id);

    const before = await balanceOf(owner.id);
    expect((await ask(owner, id, "hire?")).status).toBe(400);
    expect(await balanceOf(owner.id)).toBe(before);
  });
});

describe("re-running with the owner's own numbers", () => {
  it("costs nothing, keeps both, and changes the answer", async () => {
    mode = "decision";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await withNumbers(owner, id);

    const first = (await ask(owner, id, "What happens if I hire 12 people right now?")).body.scenario;
    expect(first.result.verdict).toBe("it runs you out of money");

    const paid = await balanceOf(owner.id);
    const res = await owner.agent.post(`/api/projects/${id}/decision-sim/scenarios/${first.id}/rerun`).send({
      // "Fine — but one person, and they bring something in."
      levers: [{ ...first.levers[0], people: 1, monthlyCostEach: 1_000, monthlyRevenueEach: 6_000 }],
      months: 12,
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.scenario.result.verdict).toBe("it pays for itself");
    expect(res.body.scenario.rerunOf).toBe(first.id);
    expect(res.body.scenario.question).toBe(first.question);
    expect(await balanceOf(owner.id)).toBe(paid);
  });

  it("belongs to the project it was run on", async () => {
    mode = "decision";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    const other = await runProject(owner, "A different business");
    await withNumbers(owner, id);
    await withNumbers(owner, other);

    const first = (await ask(owner, id, "What happens if I hire twelve people?")).body.scenario;
    const res = await owner.agent.post(`/api/projects/${other}/decision-sim/scenarios/${first.id}/rerun`).send({});
    expect(res.status).toBe(404);
  });
});

describe("ten years from now", () => {
  it("values the business on where the million goes, through the game's own cleaning", async () => {
    mode = "decision";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await withNumbers(owner, id);

    const res = await owner.agent.post(`/api/projects/${id}/decision-sim/ten-years`)
      .send({ allocation: { marketing: 300_000, "ops-hire": 200_000, runway: 500_000 } });
    expect(res.status, res.text).toBe(200);

    const { outlook } = res.body;
    // The model said the peak was $1,000 and the ten-year figure four billion,
    // and put the peak in year 40. cleanVerdict is the wall that stops both.
    expect(outlook.verdict.peak).toBeGreaterThanOrEqual(outlook.verdict.tenYear);
    expect(outlook.verdict.peakYear).toBeLessThanOrEqual(10);
    expect(outlook.overall).toBeGreaterThan(0);
    expect(outlook.band).toBeTruthy();
    expect(outlook.allocation.runway).toBe(500_000);
  });

  it("will not value a million that has not been put anywhere", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await withNumbers(owner, id);

    const before = await balanceOf(owner.id);
    const res = await owner.agent.post(`/api/projects/${id}/decision-sim/ten-years`).send({ allocation: {} });
    expect(res.status).toBe(400);
    expect(await balanceOf(owner.id)).toBe(before);
    expect(await db.select().from(tenYearOutlooks).where(eq(tenYearOutlooks.projectId, id))).toHaveLength(0);
  });

  it("is covered by the same purchase as the scenarios, in either order", async () => {
    mode = "decision";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await withNumbers(owner, id);

    const start = await balanceOf(owner.id);
    const valued = await owner.agent.post(`/api/projects/${id}/decision-sim/ten-years`)
      .send({ allocation: { marketing: 1_000_000 } });
    expect(valued.status).toBe(200);
    expect(start - (await balanceOf(owner.id))).toBe(OUTCOME_PRICE_CENTS.simulations);

    const after = await balanceOf(owner.id);
    const asked = await ask(owner, id, "What happens if I hire twelve people?");
    expect(asked.status).toBe(200);
    expect(asked.body.paidCents).toBe(0);
    expect(await balanceOf(owner.id)).toBe(after);
  });
});

describe("when the model answers with nonsense", () => {
  it("says so and charges nothing", async () => {
    mode = "garbage";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await withNumbers(owner, id);

    const before = await balanceOf(owner.id);
    const res = await ask(owner, id, "What happens if I hire twelve people?");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await balanceOf(owner.id)).toBe(before);
    expect(await db.select().from(simulationScenarios).where(eq(simulationScenarios.projectId, id))).toHaveLength(0);
    mode = "decision";
  });
});
