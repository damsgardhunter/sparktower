/**
 * "What would it take?" against a real database, with the model mocked.
 *
 * What is worth guarding here is not that Nova answers — it is that the answer
 * is made of this company's own numbers and that the honesty survives the
 * model. So the mock is deliberately a flatterer: it returns encouraging prose
 * for every request, and the tests check that a café asking about $50bn is
 * still told, in the stored row, that it is a different business. If the
 * verdict ever starts coming from the model, these fail.
 *
 * The rest: a company with nothing filed is told what to file rather than sold
 * a roadmap; re-running keeps both runs and says which way the gap moved; the
 * first ninety days land on the board in the Run section; and a stranger gets
 * the same 404 the rest of the rhythm gives, because a company's revenue is
 * the most private thing it keeps here.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";

/* Encouraging on purpose: the verdict must not be its to give. */
let mode: "ok" | "garbage" = "ok";
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async () => {
      if (mode === "garbage") return { choices: [{ message: { content: "Absolutely, you can do it!" } }] };
      const content = JSON.stringify({
        headline: "You can absolutely get there with focus and hard work!",
        stages: Array.from({ length: 8 }, (_, i) => ({
          title: `Stage ${i + 1} name`,
          mustBeTrue: ["A second chef", "A till that reports daily"],
          breaksFirst: "The kitchen at peak.",
          costToFix: "About $40,000 and two hires.",
        })),
        first90: [
          { title: "Count covers every day for a month", why: "You cannot plan capacity you have not measured." },
          { title: "Put prices up 5% on the ten best sellers", why: "It is the fastest margin you will find." },
          { title: "Hire a second chef", why: "The kitchen is the ceiling." },
          { title: "Open on Mondays", why: "Fixed costs are already paid." },
        ],
        verdictText: "This is very achievable if you stay focused!",
      });
      return { choices: [{ message: { content } }] };
    } } };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { verifyEmail } = await import("../helpers/verify-email");
const { db } = await import("../../server/db");
const { projectKanbanTasks, whatWouldItTakeRoadmaps } = await import("@shared/schema");
const { weekOf, todayYmd, addDays } = await import("@shared/company-rhythm");
const { CREDIT_COSTS } = await import("@shared/plans");

afterAll(async () => { await closeTestApp(); });

/* A range no other spec registers from: sign-ups count against a per-address budget. */
let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.183.${(n % 200) + 20}`;
  const email = `wwit-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `W${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

async function runProject(owner: { agent: any }, subcategory = "restaurant", title = "Corner Café") {
  const res = await owner.agent.post("/api/projects").send({
    title, description: `${title}: a business that has been trading for six years.`,
    category: "Other", goal: "run_company", subcategory,
  });
  expect(res.status, res.text).toBe(200);
  return res.body.id as string;
}

/** Files `weeks` weekly check-ins ending last week, each with the same numbers. */
async function fileWeeks(agent: any, id: string, weeks: number, numbers: Record<string, number>) {
  const thisWeek = weekOf(todayYmd());
  for (let i = weeks; i >= 1; i -= 1) {
    const res = await agent.put(`/api/projects/${id}/rhythm/checkins/${addDays(thisWeek, -7 * i)}`).send({ numbers });
    expect(res.status, res.text).toBe(200);
  }
}

const creditsUsed = async (agent: any) => (await agent.get("/api/subscription")).body.creditsUsed as number;

const milestoneStatus = async (projectId: string, milestoneId: string) => {
  const [task] = await db.select().from(projectKanbanTasks)
    .where(and(eq(projectKanbanTasks.projectId, projectId), sql`${projectKanbanTasks.tags} @> ARRAY[${`backbone:${milestoneId}`}]::varchar[]`));
  return task?.status ?? null;
};

describe("who can ask", () => {
  it("is members only, and a stranger is told the project doesn't exist", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const stranger = await person(app);
    const id = await runProject(owner);

    expect((await request(app).get(`/api/projects/${id}/what-would-it-take`)).status).toBe(401);
    expect((await stranger.agent.get(`/api/projects/${id}/what-would-it-take`)).status).toBe(404);
    expect((await stranger.agent.post(`/api/projects/${id}/what-would-it-take/m1`)).status).toBe(404);
    expect((await stranger.agent.get(`/api/projects/does-not-exist/what-would-it-take`)).status).toBe(404);
    expect((await owner.agent.get(`/api/projects/${id}/what-would-it-take`)).status).toBe(200);
  });
});

describe("before anything has been filed", () => {
  it("says what to file rather than selling a roadmap built on nothing", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);

    const before = await creditsUsed(owner.agent);
    const view = await owner.agent.get(`/api/projects/${id}/what-would-it-take`);
    expect(view.status).toBe(200);
    expect(view.body.notReady).toMatch(/haven't filed a weekly check-in/);
    expect(view.body.grounding.annualRevenue).toBeNull();
    // The four sizes and what each one is are free, whether or not a roadmap is ever built.
    expect(view.body.targets.map((t: any) => t.id)).toEqual(["m1", "m100", "b1", "b50"]);
    expect(view.body.targets[0].whatItIs).toMatch(/local business/);
    expect(view.body.targets[3].worth).toMatch(/Worth roughly/);

    const res = await owner.agent.post(`/api/projects/${id}/what-would-it-take/b1`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("no_numbers_yet");
    expect(await creditsUsed(owner.agent)).toBe(before);
  });

  it("says which number is missing when the check-ins have no revenue in them", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner, "software", "Ledgerly");
    // All five of a software company's default numbers, none of which is total revenue.
    await fileWeeks(owner.agent, id, 3, { new_revenue: 4000, churn: 500, active_customers: 120, runway_weeks: 30, support_tickets: 40 });

    const view = await owner.agent.get(`/api/projects/${id}/what-would-it-take`);
    expect(view.body.notReady).toMatch(/none of the five numbers a software company watches is total revenue/i);
    expect(view.body.notReady).toMatch(/Revenue/);
    expect((await owner.agent.post(`/api/projects/${id}/what-would-it-take/m1`)).status).toBe(409);
  });
});

describe("a roadmap built from the company's own numbers", () => {
  it("grounds the arithmetic in the check-ins, not in generic advice", async () => {
    mode = "ok";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    // 400 covers a week at $25 = $10,000 a week = $520,000 a year.
    await fileWeeks(owner.agent, id, 4, { covers: 400, avg_spend: 25, cash: 20_000 });

    const before = await creditsUsed(owner.agent);
    const res = await owner.agent.post(`/api/projects/${id}/what-would-it-take/m100`);
    expect(res.status, res.text).toBe(200);
    const { roadmap } = res.body;

    expect(roadmap.annualRevenue).toBe(520_000);
    expect(roadmap.grounding.weeksUsed).toBe(4);
    expect(roadmap.grounding.checkinsOnFile).toBe(4);
    expect(roadmap.grounding.revenueFrom).toMatch(/Covers × Average spend/);
    expect(roadmap.roadmap.gap.multiple).toBeCloseTo(192.31, 1);
    expect(roadmap.roadmap.gap.inCopies).toBe("About 192 restaurants the size of yours");
    expect(roadmap.roadmap.body.arithmetic.join(" ")).toMatch(/\$520k a year/);
    expect(roadmap.roadmap.body.arithmetic.join(" ")).toMatch(/400 covers a week at \$25 each/);
    /*
     * No profit number filed, so the roadmap says so and shows both ends of
     * the range rather than reasoning silently as though revenue were profit.
     */
    expect(roadmap.grounding.margin).toBeNull();
    expect(roadmap.roadmap.body.arithmetic.join(" ")).toMatch(/Margin: not in your check-ins/);
    expect(roadmap.roadmap.body.marginNote).toMatch(/no profit number in your check-ins/i);
    expect(roadmap.roadmap.body.tightenedByMargin).toBe(false);
    expect(roadmap.roadmap.body.verdictText).toMatch(/Add a number of your own called "Profit"/);
    expect(await creditsUsed(owner.agent)).toBe(before + 1);

    /*
     * The model returned eight stages for a shorter ladder. Zipped onto the
     * computed one rather than trusted, or every multiple and length would
     * shift by one and the roadmap would claim a stage takes three years when
     * the arithmetic says eight.
     */
    const stages = roadmap.roadmap.body.stages;
    expect(stages.length).toBeLessThan(8);
    expect(stages.map((s: any) => s.number)).toEqual(stages.map((_: any, i: number) => i + 1));
    expect(stages[stages.length - 1].endsAt).toBe(100_000_000);
    expect(stages[0].mustBeTrue.length).toBeGreaterThan(0);
    expect(stages[0].breaksFirst).toBe("The kitchen at peak.");

    // And it closed the Run path step that asks this question.
    expect(await milestoneStatus(id, "RUN.S4.5")).toBe("done");
  });

  /*
   * The whole point. The mock flatters — every answer it gives is "you can
   * absolutely do it" — and the stored verdict still says otherwise, because
   * the verdict is computed before the model is asked.
   */
  it("tells a café that $50bn is a different business, however encouraging the model is", async () => {
    mode = "ok";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await fileWeeks(owner.agent, id, 3, { covers: 400, avg_spend: 25 });

    const big = (await owner.agent.post(`/api/projects/${id}/what-would-it-take/b50`)).body.roadmap;
    expect(big.roadmap.body.verdict).toBe("a different business");
    expect(big.roadmap.body.verdictText).toMatch(/Not from here, not as this business/);
    expect(big.roadmap.body.verdictText).toMatch(/restaurant group/);

    const small = (await owner.agent.post(`/api/projects/${id}/what-would-it-take/m1`)).body.roadmap;
    expect(small.roadmap.body.verdict).toBe("reachable");
    expect(small.roadmap.gap.multiple).toBeCloseTo(1.92, 1);
  });

  it("charges nothing when the model can't be read", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner, "retail", "The Shop");
    await fileWeeks(owner.agent, id, 2, { sales: 9000, avg_basket: 30 });

    const before = await creditsUsed(owner.agent);
    mode = "garbage";
    const res = await owner.agent.post(`/api/projects/${id}/what-would-it-take/m1`);
    mode = "ok";
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("model_unreadable");
    expect(await creditsUsed(owner.agent)).toBe(before);
    expect(await db.select().from(whatWouldItTakeRoadmaps).where(eq(whatWouldItTakeRoadmaps.projectId, id))).toHaveLength(0);
  });

  it("refuses a target that isn't one of the four", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await fileWeeks(owner.agent, id, 1, { covers: 400, avg_spend: 25 });
    expect((await owner.agent.post(`/api/projects/${id}/what-would-it-take/t1`)).status).toBe(400);
  });
});

describe("what the business keeps", () => {
  it("reads a filed profit number, and lets a thin one make the verdict harder", async () => {
    mode = "ok";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner, "retail", "Thin Margins Ltd");
    // $10k a week of sales, $200 a week kept: 2% net.
    await fileWeeks(owner.agent, id, 4, { sales: 10_000, "custom:Profit": 200 });

    const built = (await owner.agent.post(`/api/projects/${id}/what-would-it-take/m100`)).body.roadmap;
    expect(built.grounding.margin).toMatchObject({ kind: "net" });
    expect(built.grounding.margin.fraction).toBeCloseTo(0.02, 4);
    expect(built.roadmap.body.arithmetic.join(" ")).toMatch(/about 2% net/);

    // On revenue alone this is a stretch; on what it keeps, it needs somebody else's money.
    expect(built.roadmap.body.verdictOnRevenueAlone).toBe("a stretch");
    expect(built.roadmap.body.verdict).toBe("a different business");
    expect(built.roadmap.body.tightenedByMargin).toBe(true);
    expect(built.roadmap.body.marginNote).toMatch(/needs outside money or a different margin/);
    expect(built.roadmap.body.verdictText).toMatch(/rather than "a stretch" on the revenue gap alone/);
  });

  it("does not let a restaurant's prime cost, which is gross, change the verdict", async () => {
    mode = "ok";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    // 38% left after food and labour — healthy for a café, and still not what it keeps.
    await fileWeeks(owner.agent, id, 3, { covers: 400, avg_spend: 25, prime_cost_pct: 62 });

    const built = (await owner.agent.post(`/api/projects/${id}/what-would-it-take/m100`)).body.roadmap;
    expect(built.grounding.margin).toMatchObject({ kind: "gross" });
    expect(built.roadmap.body.arithmetic.join(" ")).toMatch(/about 38% gross/);
    expect(built.roadmap.body.arithmetic.join(" ")).toMatch(/before rent, wages outside the line/);
    expect(built.roadmap.body.tightenedByMargin).toBe(false);
    expect(built.roadmap.body.verdict).toBe(built.roadmap.body.verdictOnRevenueAlone);
    expect(built.roadmap.body.marginNote).toMatch(/that is a gross margin/);
  });

  it("keeps a good margin from being read as a reason to be cautious", async () => {
    mode = "ok";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner, "retail", "Healthy Ltd");
    await fileWeeks(owner.agent, id, 3, { sales: 10_000, "custom:Profit": 2_000 });

    const built = (await owner.agent.post(`/api/projects/${id}/what-would-it-take/m1`)).body.roadmap;
    expect(built.roadmap.body.verdict).toBe("reachable");
    expect(built.roadmap.body.tightenedByMargin).toBe(false);
    expect(built.roadmap.body.marginNote).toMatch(/funded out of the business itself/);
  });
});

describe("running it again, and comparing", () => {
  it("keeps both runs and says which way the gap moved", async () => {
    mode = "ok";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner, "retail", "The Shop");
    await fileWeeks(owner.agent, id, 4, { sales: 10_000 }); // $520k a year

    const first = (await owner.agent.post(`/api/projects/${id}/what-would-it-take/m100`)).body.roadmap;
    expect(first.annualRevenue).toBe(520_000);

    // Trade doubles, and the next run is built from the new weeks.
    const thisWeek = weekOf(todayYmd());
    for (let i = 4; i >= 1; i -= 1) {
      await owner.agent.put(`/api/projects/${id}/rhythm/checkins/${addDays(thisWeek, -7 * (i - 1))}`).send({ numbers: { sales: 20_000 } });
    }
    const second = (await owner.agent.post(`/api/projects/${id}/what-would-it-take/m100`)).body.roadmap;
    expect(second.annualRevenue).toBeGreaterThan(first.annualRevenue);
    expect(second.id).not.toBe(first.id);

    const view = await owner.agent.get(`/api/projects/${id}/what-would-it-take`);
    const slot = view.body.roadmaps.m100;
    expect(slot.runs).toBe(2);
    expect(slot.latest.id).toBe(second.id);
    expect(slot.previous.id).toBe(first.id);
    expect(slot.movement.text).toMatch(/The gap closed from .+ to .+, on revenue up/);
    // Nothing was overwritten: both runs, with the figures each was built from.
    expect(await db.select().from(whatWouldItTakeRoadmaps).where(eq(whatWouldItTakeRoadmaps.projectId, id))).toHaveLength(2);

    // Two targets side by side, each carrying its own gap.
    await owner.agent.post(`/api/projects/${id}/what-would-it-take/b1`);
    const both = await owner.agent.get(`/api/projects/${id}/what-would-it-take`);
    expect(both.body.roadmaps.m100.latest.roadmap.gap.multiple)
      .toBeLessThan(both.body.roadmaps.b1.latest.roadmap.gap.multiple);
    expect(both.body.roadmaps.b1.movement).toBeNull();
    expect(both.body.roadmaps.b50.latest).toBeNull();
  });
});

describe("the hand-off to the board", () => {
  it("puts the first ninety days on the board, in the Run section, saying where they came from", async () => {
    mode = "ok";
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await fileWeeks(owner.agent, id, 2, { covers: 400, avg_spend: 25 });
    const built = (await owner.agent.post(`/api/projects/${id}/what-would-it-take/m1`)).body.roadmap;

    const res = await owner.agent.post(`/api/projects/${id}/what-would-it-take/${built.id}/to-board`).send({});
    expect(res.status, res.text).toBe(200);
    expect(res.body.created).toBe(4);
    const titles = res.body.tasks.map((t: any) => t.title);
    expect(titles).toContain("Hire a second chef");
    for (const task of res.body.tasks) {
      expect(task.tags).toContain("track:run_company");
      expect(task.tags).toContain("wwit:m1");
      expect(task.status).toBe("todo");
      expect(task.description).toMatch(/From the "\$1m a year" roadmap, generated \d{4}-\d{2}-\d{2}\./);
    }

    /*
     * Pressed twice. A double click on a slow response used to put every step
     * on the board a second time, which turns the one part of this feature
     * that ends in work into a mess somebody has to tidy up.
     */
    const again = await owner.agent.post(`/api/projects/${id}/what-would-it-take/${built.id}/to-board`).send({});
    expect(again.status).toBe(409);
    expect(again.body.replayed).toBe(true);
    expect(again.body.created).toBe(0);
    const onBoard = await db.select().from(projectKanbanTasks)
      .where(and(eq(projectKanbanTasks.projectId, id), sql`${projectKanbanTasks.tags} @> ARRAY['wwit:m1']::varchar[]`));
    expect(onBoard).toHaveLength(4);

    // A different selection is a different intention, and still goes through.
    const some = await owner.agent.post(`/api/projects/${id}/what-would-it-take/${built.id}/to-board`).send({ steps: [0, 2] });
    expect(some.status).toBe(200);
    expect(some.body.created).toBe(2);
    expect(some.body.tasks.map((t: any) => t.title).sort()).toEqual(["Count covers every day for a month", "Hire a second chef"]);

    // A roadmap on someone else's project is not reachable by id alone.
    const other = await person(app);
    const otherProject = await runProject(other, "retail", "Elsewhere");
    expect((await other.agent.post(`/api/projects/${otherProject}/what-would-it-take/${built.id}/to-board`).send({})).status).toBe(404);
  });
});
