/**
 * Marketing schemes: what is charged, what is refused, and who decides.
 *
 * The thing worth protecting here is the same as everywhere else in this
 * engine: the model reads the words and the server keeps the number. A model
 * asked to judge a plan will flatter it — this one is written to — and the
 * score, the bar for testing and the arithmetic behind it all have to survive
 * that.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

/** A model that loves every plan it is shown, and says so in the right shape. */
let flattering = true;
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(
      flattering
        ? {
            scores: { audience: 95, offer: 95, channel: 95, measurement: 95, economics: 95 },
            notes: { audience: "Perfect.", offer: "Perfect.", channel: "Perfect.", measurement: "Perfect.", economics: "Perfect." },
            restated: "Cards through doors on one street, first collection free.",
            fix: "Nothing at all, it's flawless.",
            assumptions: ["That everybody reads their post."],
          }
        : {
            scores: { audience: 20, offer: 10, channel: 25, measurement: 0, economics: 15 },
            notes: { measurement: "Nothing here says how you would know." },
            restated: "Post about it sometimes.",
            fix: "Name who it is for and how you would count whether it worked.",
            assumptions: [],
          },
    ) } }] }) } };
    responses = { create: async () => ({ output_text: "{}" }) };
    images = { generate: async () => { throw new Error("no images"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { verifyEmail } = await import("../helpers/verify-email");
const { db } = await import("../../server/db");
const { users, marketingSchemes } = await import("@shared/schema");
const { OUTCOME_PRICE_CENTS } = await import("@shared/plans");
const { WORTH_TESTING_AT } = await import("@shared/simulation/marketing");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function owner(app: any, balanceCents = 5_000) {
  n += 1;
  const email = `mkt-${Date.now()}-${n}@example.test`;
  const ip = `203.0.118.${(n % 200) + 20}`;
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: "Mo" });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  await verifyEmail(app, email, ip);
  process.env.RATE_LIMIT_EXEMPT_EMAILS = [process.env.RATE_LIMIT_EXEMPT_EMAILS, email].filter(Boolean).join(",");
  await db.update(users).set({ balanceCents }).where(eq(users.id, reg.body.id));
  const project = await agent.post("/api/projects").send({
    title: "Pfand Run", description: "Bottle-deposit collection from flats, a product that already exists.",
    category: "Transport & Logistics", goal: "ship_mvp", subcategory: "other", currency: "EUR",
  });
  expect(project.status).toBe(200);
  /*
   * The business's own numbers, because the economics are worked out against
   * them: a scheme's LTV is the price times the margin, and a project with no
   * baseline would be judged on a default margin rather than this one's.
   */
  const baseline = await agent.put(`/api/projects/${project.body.id}/decision-sim/baseline`).send({
    numbers: { monthlyRevenue: 0, monthlyCosts: 1000, cash: 0, debt: 0, interestRate: 0, debtRepayment: 0, growth: 0, grossMargin: 0.85, staff: 1 },
    overridden: ["monthlyRevenue", "monthlyCosts", "cash", "grossMargin"],
  });
  expect(baseline.status, JSON.stringify(baseline.body)).toBe(200);
  return { agent, userId: reg.body.id as string, projectId: project.body.id as string };
}

const A_SCHEME = {
  scheme: "Aimed at the 200 flats on Kirkgate. A card through every door offering the first collection free, then EUR 2 a crate. Runs six weeks; I count how many of the 200 book once and how many book twice.",
  monthlyBudget: 300,
  expectedMonthlyReturn: 900,
};

/**
 * The kind of scheme that should be able to score in the nineties: a named
 * audience, a named offer, channels those people are actually in, a stop rule
 * with a number on it — and economics that stand up when they are worked out
 * rather than described.
 */
const A_GOOD_SCHEME = {
  scheme: "Aimed at freelance translators working into English for agencies who have nearly lost an account over terminology. Three channels: a weekly post in the two ProZ terminology forums, sponsorship of four language-pair newsletters at about $250 a month each, and a free glossary audit that scores their existing spreadsheet. The offer is that the audit is instant and I import their first client glossary personally within a day — the import is the work nobody wants to do and the reason free trials die. I count audits run, audits that become trials, trials still paying at day 60, and the channel each came from. Any channel over $60 a signup after two months stops and the money moves; trial-to-paid under 25% at day 60 and I stop the whole thing and fix the import instead.",
  monthlyBudget: 1000,
  expectedMonthlyReturn: 760,
  pricePerMonth: 19,
  monthlyChurnPct: 4,
  newCustomersAtFull: 40,
  marketSize: 640_000,
};

const balanceOf = async (id: string) =>
  (await db.select({ balanceCents: users.balanceCents }).from(users).where(eq(users.id, id)))[0].balanceCents;

describe("reading a marketing scheme", () => {
  it("charges once for the project, then reads every scheme after it for nothing", async () => {
    flattering = true;
    const app = await getTestApp();
    const o = await owner(app);
    const before = await balanceOf(o.userId);

    const first = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`).send(A_SCHEME);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(before - (await balanceOf(o.userId))).toBe(OUTCOME_PRICE_CENTS.marketing);

    const after = await balanceOf(o.userId);
    const second = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`)
      .send({ ...A_SCHEME, scheme: A_SCHEME.scheme + " Second version, leading with the offer instead." });
    expect(second.status).toBe(201);
    expect(await balanceOf(o.userId), "revising is the activity; charging for it would be charging to think").toBe(after);
  });

  it("keeps the score even when the model loves everything", async () => {
    flattering = true;
    const app = await getTestApp();
    const o = await owner(app);
    const res = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`).send(A_SCHEME);
    expect(res.status).toBe(201);
    // Averaged on the server from the five dimensions, never taken as one number.
    expect(res.body.scheme.score).toBe(95);
    expect(res.body.scheme.worthTesting).toBe(true);
  });

  it("refuses a scheme too thin to be one, before anything is charged", async () => {
    const app = await getTestApp();
    const o = await owner(app);
    const before = await balanceOf(o.userId);
    const res = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`)
      .send({ scheme: "do some ads", monthlyBudget: 300 });
    expect(res.status).toBe(400);
    expect(await balanceOf(o.userId)).toBe(before);
    expect(await db.select().from(marketingSchemes).where(eq(marketingSchemes.projectId, o.projectId))).toHaveLength(0);
  });

  it("refuses a scheme with no budget, because a free plan cannot be judged", async () => {
    const app = await getTestApp();
    const o = await owner(app);
    const res = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`)
      .send({ ...A_SCHEME, monthlyBudget: 0 });
    expect(res.status).toBe(400);
  });
});

describe("testing a scheme", () => {
  it("runs a good one for a year, free, on the business's own numbers", async () => {
    flattering = true;
    const app = await getTestApp();
    const o = await owner(app);
    const made = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`).send(A_SCHEME);
    expect(made.status).toBe(201);

    const before = await balanceOf(o.userId);
    const run = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes/${made.body.scheme.id}/test`).send({});
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.result.verdict).toBeTruthy();
    expect(run.body.result.facts.length).toBeGreaterThan(1);
    expect(await balanceOf(o.userId), "the arithmetic is not the expensive part").toBe(before);
    // Answered in the business's own money.
    expect(run.body.result.facts.join(" ")).toContain("€");
  });

  it("refuses to draw a curve on a plan that needs fixing first", async () => {
    flattering = false;
    const app = await getTestApp();
    const o = await owner(app);
    const made = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`).send(A_SCHEME);
    expect(made.status).toBe(201);
    expect(made.body.scheme.score).toBeLessThan(WORTH_TESTING_AT);
    expect(made.body.scheme.worthTesting).toBe(false);

    const run = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes/${made.body.scheme.id}/test`).send({});
    expect(run.status).toBe(409);
    expect(run.body.code).toBe("not_worth_testing");
    expect(run.body.message).toMatch(/Fix what it named/);
  });

  it("is refused to anyone not on the project", async () => {
    flattering = true;
    const app = await getTestApp();
    const mine = await owner(app);
    const made = await mine.agent.post(`/api/projects/${mine.projectId}/marketing-schemes`).send(A_SCHEME);
    expect(made.status).toBe(201);

    const stranger = await owner(app);
    const peek = await stranger.agent.get(`/api/projects/${mine.projectId}/marketing-schemes`);
    expect(peek.status).toBe(404);
  });
});

describe("a scheme where the customers keep paying", () => {
  it("works the economics out rather than taking the model's word for that one", async () => {
    // The model is told everything is perfect, including the economics.
    flattering = true;
    const app = await getTestApp();
    const o = await owner(app);
    const res = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`).send(A_GOOD_SCHEME);
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const { evaluation, score } = res.body.scheme;
    /*
     * $1,000 winning 40 customers is $25 each; $19 a month at 85% margin with
     * 4% leaving is about $404 over their life. 16:1, back inside two months.
     * The model said 95; the arithmetic says 96, and the arithmetic wins.
     */
    expect(evaluation.arithmetic.recurring).toBe(true);
    expect(Math.round(evaluation.arithmetic.cac)).toBe(25);
    expect(evaluation.arithmetic.ltvToCac).toBeGreaterThan(15);
    expect(evaluation.scores.economics, "computed, not judged").toBe(96);
    expect(evaluation.arithmetic.warnings, "nothing to flag in numbers this clean").toEqual([]);
    // Four dimensions of words at 95 and one of arithmetic at 96.
    expect(score).toBeGreaterThanOrEqual(95);
    expect(res.body.scheme.worthTesting).toBe(true);
  });

  it("marks down economics the model called perfect, when they are not", async () => {
    flattering = true;
    const app = await getTestApp();
    const o = await owner(app);
    // $1,000 for 10 customers at $5 a month, a tenth of them leaving monthly:
    // $100 to win somebody worth about $42.
    const res = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`).send({
      ...A_GOOD_SCHEME, pricePerMonth: 5, monthlyChurnPct: 10, newCustomersAtFull: 10,
    });
    expect(res.status).toBe(201);
    expect(res.body.scheme.evaluation.scores.economics, "the words said perfect; the numbers say no").toBeLessThan(20);
    expect(res.body.scheme.evaluation.arithmetic.warnings.join(" ")).toMatch(/paying more for them than they bring/);
    expect(res.body.scheme.score, "and it drags the whole thing below the bar").toBeLessThan(80);
  });

  it("tests it as a subscriber base, so the answer compounds", async () => {
    flattering = true;
    const app = await getTestApp();
    const o = await owner(app);
    const made = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`).send(A_GOOD_SCHEME);
    expect(made.status).toBe(201);

    const run = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes/${made.body.scheme.id}/test`).send({});
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const months = run.body.result.with.likely.months;
    /*
     * A campaign holds a level; subscribers stack up. Month twelve has to be
     * meaningfully ahead of month six, which is the whole difference.
     */
    expect(months[11].revenue).toBeGreaterThan(months[5].revenue * 1.5);
  });

  it("still treats a scheme with no subscription as the campaign it is", async () => {
    flattering = true;
    const app = await getTestApp();
    const o = await owner(app);
    const res = await o.agent.post(`/api/projects/${o.projectId}/marketing-schemes`).send(A_SCHEME);
    expect(res.status).toBe(201);
    expect(res.body.scheme.evaluation.arithmetic.recurring).toBe(false);
    expect(res.body.scheme.evaluation.arithmetic.ltvToCac).toBeNull();
    // The model's own reading of the economics stands where nothing can be computed.
    expect(res.body.scheme.evaluation.scores.economics).toBe(95);
  });
});
