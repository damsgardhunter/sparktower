/**
 * The funding routes through the API. They used to be a path of their own;
 * they now sit inside Systemize, after its first three money weeks and before
 * the roadmap week, so the walk starts by getting past those:
 *
 *   Systemize's money weeks done → ownership goal → money → experience → business history (filled from a
 *   résumé) → capital goal → a fundability score on the dashboard → Nova's
 *   profile built on that exact score → choose a route → only that route's
 *   roadmap → switch routes and back without losing work → pipeline mode once
 *   in market → an older funding project's retired steps put away.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

const prompts: string[] = [];
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async (args: any) => {
      prompts.push(args.messages.map((m: any) => m.content).join("\n"));
      return { choices: [{ message: { content: JSON.stringify({
        summary: "A funder would see strong experience and a thin cash position.",
        figures: [{ label: "Fundability", value: "57/100" }],
        sections: [{ heading: "Lender's view", body: "Credit clears most banks; the injection is short." }],
        gaps: ["Cash covers under 10% of the raise"],
        actions: [{ title: "Save $8k toward the injection", detail: "Automate $700 a month", when: "months 1–12", moves: "cash part +5" }],
        assumptions: [], tables: [], verifyWith: "An SBA lender",
      }) } }] };
    } } };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { userProfiles, projectKanbanTasks } = await import("@shared/schema");
afterAll(async () => { await closeTestApp(); });

let address = 80;
async function founder(app: any) {
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: "Dana" });
  const project = await agent.post("/api/projects").send({
    title: "Brightside Acquisition", description: "Buying a commercial cleaning company and growing it across the city.",
    category: "services", goal: "systemize_business", subcategory: "other",
  });
  expect(project.status).toBe(200);
  return { agent, userId: reg.body.id as string, projectId: project.body.id as string };
}
const path = async (agent: any, id: string) => (await agent.get(`/api/projects/${id}/path`)).body;
const answer = (agent: any, id: string, taskId: string, answers: Record<string, unknown>) =>
  agent.post(`/api/projects/${id}/path/intake`).send({ taskId, answers });
const taskFor = async (agent: any, id: string, backbone: string) =>
  (await agent.get(`/api/projects/${id}/kanban`)).body.find((t: any) => t.tags?.includes(`backbone:${backbone}`));

// Systemize's first three weeks — the numbers — come before the capital
// profile on the main line. They're marked done the way any step is ticked,
// so what follows is exactly what someone arriving at the funding weeks sees.
const SYS_MONEY_WEEKS = [
  "SYS.F1.1", "SYS.F1.2", "SYS.F1.3", "SYS.F1.4", "SYS.F1.5", "SYS.F1.6",
  "SYS.F2.1", "SYS.F2.2", "SYS.F2.3", "SYS.F2.4",
  "SYS.F3.1", "SYS.F3.2", "SYS.F3.3",
];
async function pastTheMoneyWeeks(agent: any, id: string) {
  for (const backbone of SYS_MONEY_WEEKS) {
    await agent.patch(`/api/kanban/${(await taskFor(agent, id, backbone)).id}`).send({ status: "done" }).expect(200);
  }
}
const phaseIds = (p: any) => p.phases.map((x: any) => x.id);
const OPERATING_WEEKS = ["money-4", "week-1", "week-2", "week-3", "week-4"];

describe("the funding routes, inside Systemize", () => {
  it("builds a capital profile and score, then the chosen route's roadmap", async () => {
    const app = await getTestApp();
    const { agent, userId, projectId } = await founder(app);

    // Before a route is chosen, only the two weeks everyone walks are on the
    // path between the money weeks and the roadmap — no route's phases yet.
    let p = await path(agent, projectId);
    expect(phaseIds(p)).toEqual(["money-1", "money-2", "money-3", "capital-1", "capital-2", ...OPERATING_WEEKS]);
    expect(p.next.id).toBe("SYS.F1.1");
    expect(p.capital).toMatchObject({ score: 0, answered: 0, route: null });

    await pastTheMoneyWeeks(agent, projectId);
    p = await path(agent, projectId);
    expect(p.next).toMatchObject({ id: "FUND.C1.1", workKind: "intake" });
    expect(p.capital).toMatchObject({ score: 0, answered: 0, route: null });

    await answer(agent, projectId, p.next.workTaskId, { why: ["wealth", "legacy"], path: "buy", role: "operator", horizon: "forever" }).expect(200);
    p = await path(agent, projectId);
    await answer(agent, projectId, p.next.workTaskId, { cash: "25k_100k", credit: "670_739", income: "100k_200k", debt: "500_1500", assets: ["home_equity"] }).expect(200);
    p = await path(agent, projectId);
    await answer(agent, projectId, p.next.workTaskId, { industry_years: "5_10", level: "manager", managed: "6_20", pnl: "some" }).expect(200);

    // The score is on the dashboard as soon as there's something to score.
    p = await path(agent, projectId);
    expect(p.capital.answered).toBe(3);
    expect(p.capital.score).toBeGreaterThan(0);
    expect(p.capital.routeFit).toHaveLength(5);

    // Business history: nothing on the profile yet, then a résumé with an owner role.
    expect(p.next).toMatchObject({ id: "FUND.C1.4", prefill: "resume" });
    const historyTask = p.next.workTaskId;
    expect((await agent.get(`/api/projects/${projectId}/path/prefill/${historyTask}`)).body).toMatchObject({ hasResume: false, answers: null });
    await db.update(userProfiles).set({
      resumeParsedAt: new Date(),
      experience: [{ title: "Owner", company: "Sparkle Pro Cleaning", startDate: "2016-01", endDate: "2021-06", current: false, description: "Office cleaning, 9 staff" }],
    } as any).where(eq(userProfiles.userId, userId));
    const filled = (await agent.get(`/api/projects/${projectId}/path/prefill/${historyTask}`)).body;
    expect(filled).toMatchObject({ hasResume: true, found: ["Owner, Sparkle Pro Cleaning"] });
    expect(filled.answers).toMatchObject({ owned: ["once"], idea: ["Sparkle Pro Cleaning — Office cleaning, 9 staff"], age: ["5_10"] });
    // Only a suggestion: nothing is saved until they confirm.
    expect((await taskFor(agent, projectId, "FUND.C1.4")).status).toBe("todo");
    // What's asked for depends on the answer: a business owner has to say how it went.
    expect((await answer(agent, projectId, historyTask, filled.answers)).body.field).toBe("industry");
    await answer(agent, projectId, historyTask, { ...filled.answers, industry: "services", revenue: "250k_1m", profit: "50k_250k", employees: "6_20", customers: "50_500", outcome: "sold" }).expect(200);

    p = await path(agent, projectId);
    await answer(agent, projectId, p.next.workTaskId, { amount: "500k_1m", uses: ["acquisition", "working_capital"], timeline: "6_12", equity: "lt10", debt_ok: "guarantee", ownership: "75_plus" }).expect(200);

    // Nova's profile is built on the computed score — the exact number.
    p = await path(agent, projectId);
    expect(p.capital.answered).toBe(5);
    expect(p.next).toMatchObject({ id: "FUND.C1.6", workKind: "plan" });
    prompts.length = 0;
    const work = await agent.post(`/api/projects/${projectId}/path/work`).send({ taskId: p.next.workTaskId });
    expect(work.status).toBe(200);
    expect(prompts[0]).toContain(`Fundability score: ${p.capital.score}/100 (${p.capital.band.label})`);
    expect(prompts[0]).toMatch(/never invent a different score/);
    expect(prompts[0]).toMatch(/Owner|Sparkle Pro Cleaning|I sold it/);
    await agent.post(`/api/projects/${projectId}/path/work/${work.body.id}/choose`).send({}).expect(200);

    // The capital map, then the route.
    await agent.patch(`/api/kanban/${(await taskFor(agent, projectId, "FUND.C2.1")).id}`).send({ status: "done" }).expect(200);
    p = await path(agent, projectId);
    expect(p.next).toMatchObject({ id: "FUND.C2.2", routeQuestion: "route" });
    const routeTask = p.next.workTaskId;
    expect((await answer(agent, projectId, routeTask, { route: "seller" })).body.route).toBe("seller");

    p = await path(agent, projectId);
    expect(p.capital.route).toBe("seller");
    // The chosen route's roadmap slots in right after the route choice, ahead
    // of the roadmap week, and it's the next thing to do.
    expect(phaseIds(p)).toEqual(["money-1", "money-2", "money-3", "capital-1", "capital-2", "seller-1", "seller-2", "seller-3", "seller-4", ...OPERATING_WEEKS]);
    expect(p.next.id).toBe("FUND.S1.1");
    expect((await agent.get(`/api/projects/${projectId}`)).body.capitalRoute).toBe("seller");

    // Work on the route, switch away, and come back to it as it was.
    const s11 = await taskFor(agent, projectId, "FUND.S1.1");
    await agent.patch(`/api/kanban/${s11.id}`).send({ status: "done", description: "Services, $400k–$800k SDE, within 30 miles." }).expect(200);
    await answer(agent, projectId, routeTask, { route: "debt" }).expect(200);
    p = await path(agent, projectId);
    expect(phaseIds(p).slice(5)).toEqual(["debt-1", "debt-2", "debt-3", "debt-4", ...OPERATING_WEEKS]);
    expect(p.next.id).toBe("FUND.D1.1");
    const board = (await agent.get(`/api/projects/${projectId}/kanban`)).body;
    expect(board.find((t: any) => t.id === s11.id).tags).toContain("archived:route-seller");

    await answer(agent, projectId, routeTask, { route: "seller" }).expect(200);
    p = await path(agent, projectId);
    expect(p.next.id).toBe("FUND.S1.2");
    const back = (await agent.get(`/api/projects/${projectId}/kanban`)).body.filter((t: any) => t.tags?.includes("backbone:FUND.S1.1"));
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: s11.id, status: "done" });
    expect(back[0].tags).not.toContain("archived:route-seller");
    // The debt tasks it made are put away, not left counting.
    expect((await agent.get(`/api/projects/${projectId}/kanban`)).body.find((t: any) => t.tags?.includes("backbone:FUND.D1.1")).tags).toContain("archived:route-debt");

    // Making the offer is being in market: the dashboard stops projecting a date.
    await agent.patch(`/api/kanban/${(await taskFor(agent, projectId, "FUND.S3.4")).id}`).send({ status: "done" }).expect(200);
    expect((await path(agent, projectId)).pace.mode).toBe("pipeline");
  });

  it("puts an older funding project's retired steps away, keeping the work on the board", async () => {
    const app = await getTestApp();
    const { agent, projectId } = await founder(app);
    // A step from the funding path's earliest shape, carried onto Systemize by
    // the migration: its FUND. id still reads as this path's, but no tree has it.
    const [old] = await db.insert(projectKanbanTasks).values({
      projectId, title: "Situation read", description: "Written back when.", status: "done",
      tags: ["actor:nova-drafts", "tier:artifact", "backbone:FUND.M1.1"],
    } as any).returning();
    const p = await path(agent, projectId);
    expect(p.phases.flatMap((x: any) => x.milestones).some((m: any) => m.id === "FUND.M1.1")).toBe(false);
    const kept = (await agent.get(`/api/projects/${projectId}/kanban`)).body.find((t: any) => t.id === old.id);
    expect(kept.tags).toContain("archived:retired");
    expect(kept.status).toBe("done");
  });
});
