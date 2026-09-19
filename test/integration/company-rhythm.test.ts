/**
 * The company rhythm against a real database: who may see a company's weekly
 * numbers, that a week is one row however often it is saved, that a recurring
 * job records its runs and moves on, and that a company can start its Run
 * project in one step.
 *
 * The privacy line is the one worth guarding. A company's check-ins are its
 * takings and its bad weeks, so a stranger must get the same 404 whether the
 * project exists or not — a 403 would confirm there is something to hide.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { companies, companyMembers, projectCheckins, projectMembers, projects, recurringJobRuns, recurringJobs } from "@shared/schema";
import { weekOf, addDays, todayYmd, advanceDue } from "@shared/company-rhythm";

afterAll(async () => { await closeTestApp(); });

/* A range no other spec uses: registering counts against a per-address budget. */
let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.171.${(n % 200) + 20}`;
  const email = `rhythm-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: `R${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

async function runProject(owner: { agent: any }) {
  const res = await owner.agent.post("/api/projects").send({
    title: "Corner Café", description: "A café that has been trading for six years and wants a steadier week.",
    category: "Other", goal: "run_company", subcategory: "restaurant",
  });
  expect(res.status, res.text).toBe(200);
  return res.body.id as string;
}

const thisWeek = () => weekOf(todayYmd());

describe("who can see the rhythm", () => {
  it("is members only: a stranger gets 404, for a real project and a made-up one alike", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const stranger = await person(app);
    const id = await runProject(owner);

    expect((await request(app).get(`/api/projects/${id}/rhythm`)).status).toBe(401);
    expect((await stranger.agent.get(`/api/projects/${id}/rhythm`)).status).toBe(404);
    expect((await stranger.agent.get(`/api/projects/does-not-exist/rhythm`)).status).toBe(404);
    expect((await stranger.agent.put(`/api/projects/${id}/rhythm/checkins/${thisWeek()}`).send({ numbers: { covers: 1 } })).status).toBe(404);
    expect((await stranger.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "Sneak", every: "week" })).status).toBe(404);
    expect((await stranger.agent.get(`/api/projects/${id}/rhythm/report/2026-09`)).status).toBe(404);

    const own = await owner.agent.get(`/api/projects/${id}/rhythm`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ weekOf: thisWeek(), subcategory: "restaurant", current: null });
    expect(own.body.metrics.map((m: any) => m.id)).toContain("covers");
  });
});

describe("the weekly check-in", () => {
  it("replaces the week's row when saved again, and the reply says what changed", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    const week = thisWeek();
    const last = addDays(week, -7);

    const first = await owner.agent.put(`/api/projects/${id}/rhythm/checkins/${last}`).send({ numbers: { covers: 500, cash: 20000 }, wentRight: "Busy Saturday" });
    expect(first.status, first.text).toBe(200);
    expect(first.body.checkin.reply).toMatch(/first check-in/);

    const a = await owner.agent.put(`/api/projects/${id}/rhythm/checkins/${week}`).send({ numbers: { covers: 450, cash: 20000 } });
    expect(a.status).toBe(200);
    const b = await owner.agent.put(`/api/projects/${id}/rhythm/checkins/${week}`).send({ numbers: { covers: 400, cash: "20,100" }, wentWrong: "Two staff off sick" });
    expect(b.status).toBe(200);
    expect(b.body.checkin.id).toBe(a.body.checkin.id);
    expect(b.body.checkin.reply).toMatch(/Covers down 20% on last week/);
    expect(b.body.checkin.reply).toMatch(/The one thing: covers/);

    const rows = await db.select().from(projectCheckins).where(and(eq(projectCheckins.projectId, id), eq(projectCheckins.weekOf, week)));
    expect(rows).toHaveLength(1);
    expect(rows[0].numbers).toEqual({ covers: 400, cash: 20100 });
    expect(rows[0].wentWrong).toBe("Two staff off sick");

    const summary = await owner.agent.get(`/api/projects/${id}/rhythm`);
    expect(summary.body.current.id).toBe(a.body.checkin.id);
    expect(summary.body.checkins).toHaveLength(2);
    // The list follows what the project tracks now, not the full default five.
    expect(summary.body.metrics.map((m: any) => m.id)).toEqual(["covers", "cash"]);
  });

  it("refuses a week that isn't a Monday, a week not yet started, and numbers that aren't numbers", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    expect((await owner.agent.put(`/api/projects/${id}/rhythm/checkins/${addDays(thisWeek(), 1)}`).send({ numbers: { covers: 1 } })).status).toBe(400);
    expect((await owner.agent.put(`/api/projects/${id}/rhythm/checkins/${addDays(thisWeek(), 7)}`).send({ numbers: { covers: 1 } })).status).toBe(400);
    expect((await owner.agent.put(`/api/projects/${id}/rhythm/checkins/${thisWeek()}`).send({ numbers: { covers: "lots" } })).status).toBe(400);
  });

  it("keeps the computed reply when Nova can't be asked", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await owner.agent.put(`/api/projects/${id}/rhythm/checkins/${thisWeek()}`).send({ numbers: { covers: 10 } });
    const saved = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    try {
      const res = await owner.agent.post(`/api/projects/${id}/rhythm/checkins/${thisWeek()}/nova`);
      expect(res.status).toBe(200);
      expect(res.body.ai).toBe(false);
      expect(res.body.checkin.reply).toMatch(/first check-in/);
    } finally {
      if (saved !== undefined) process.env.AI_INTEGRATIONS_OPENAI_API_KEY = saved;
    }
  });
});

describe("recurring jobs", () => {
  it("records a run on time or late, moves the due date on, and lists what's overdue", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const teammate = await person(app);
    const outsider = await person(app);
    const id = await runProject(owner);
    await db.insert(projectMembers).values({ projectId: id, userId: teammate.id, role: "Member" });

    const today = todayYmd();
    const overdueDue = addDays(today, -3);
    expect((await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "Payroll", every: "month", ownerId: outsider.id })).status).toBe(400);
    const made = await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "Stock take", every: "week", nextDue: overdueDue, ownerId: teammate.id, backupId: owner.id });
    expect(made.status, made.text).toBe(200);
    const job = made.body;

    const before = await teammate.agent.get(`/api/projects/${id}/rhythm/jobs`);
    expect(before.body.overdue.map((j: any) => j.id)).toEqual([job.id]);

    const late = await teammate.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({});
    expect(late.status, late.text).toBe(200);
    expect(late.body.run).toMatchObject({ dueOn: overdueDue, doneOn: today, onTime: false, doneBy: teammate.id });
    expect(late.body.job.nextDue).toBe(advanceDue(overdueDue, "week"));

    const onTime = await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ doneOn: today });
    expect(onTime.body.run).toMatchObject({ dueOn: advanceDue(overdueDue, "week"), onTime: true });

    expect((await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ doneOn: addDays(today, 1) })).status).toBe(400);
    const runs = await db.select().from(recurringJobRuns).where(eq(recurringJobRuns.jobId, job.id));
    expect(runs).toHaveLength(2);

    // A month job clamps at month end.
    const monthly = await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "VAT", every: "month", nextDue: "2026-01-31" });
    const done = await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${monthly.body.id}/done`).send({ doneOn: "2026-02-02" });
    expect(done.body.run.onTime).toBe(false);
    expect(done.body.job.nextDue).toBe("2026-02-28");

    // Removing stops it coming round and keeps its history.
    expect((await owner.agent.delete(`/api/projects/${id}/rhythm/jobs/${job.id}`)).status).toBe(200);
    const [gone] = await db.select().from(recurringJobs).where(eq(recurringJobs.id, job.id));
    expect(gone.active).toBe(false);
    expect(await db.select().from(recurringJobRuns).where(eq(recurringJobRuns.jobId, job.id))).toHaveLength(2);
  });
});

describe("the monthly report", () => {
  it("adds up the month from the rows", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    await owner.agent.put(`/api/projects/${id}/rhythm/checkins/2026-08-03`).send({ numbers: { covers: 400 }, wentWrong: "Staff off sick" });
    await owner.agent.put(`/api/projects/${id}/rhythm/checkins/2026-08-17`).send({ numbers: { covers: 300 }, wentWrong: "Short on staff again" });
    const job = (await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "Deep clean", every: "fortnight", nextDue: "2026-08-07" })).body;
    await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ doneOn: "2026-08-07" });
    await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ doneOn: "2026-08-25" });

    const res = await owner.agent.get(`/api/projects/${id}/rhythm/report/2026-08`);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ month: "2026-08", filed: 2, previousMonth: "2026-07", nextMonth: "2026-09" });
    expect(res.body.weeks).toEqual(["2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]);
    expect(res.body.metrics.find((m: any) => m.id === "covers")).toMatchObject({ first: 400, last: 300, verdict: "worse" });
    expect(res.body.jobs).toMatchObject({ onTime: 1, late: 1 });
    expect(res.body.themes.map((t: any) => t.id)).toEqual(["staff"]);
    expect(res.body.fixNext).toMatchObject({ kind: "metric", id: "covers" });
    expect((await owner.agent.get(`/api/projects/${id}/rhythm/report/2026-13`)).status).toBe(400);
  });
});

describe("starting the rhythm from a company", () => {
  it("creates the Run project, puts the company's people on it, and links it", async () => {
    const app = await getTestApp();
    const admin = await person(app);
    const member = await person(app);
    const stranger = await person(app);
    const [company] = await db.insert(companies).values({
      name: "Harbour Bakery", slug: `harbour-${Date.now()}`, industry: "E-Commerce", createdBy: admin.id, createdAt: new Date(),
    }).returning();
    await db.insert(companyMembers).values([
      { companyId: company.id, userId: admin.id, role: "owner", joinedAt: new Date() },
      { companyId: company.id, userId: member.id, role: "member", joinedAt: new Date() },
    ]);

    expect((await stranger.agent.post(`/api/companies/${company.id}/run-project`)).status).toBe(404);
    expect((await member.agent.post(`/api/companies/${company.id}/run-project`)).status).toBe(403);

    const res = await admin.agent.post(`/api/companies/${company.id}/run-project`);
    expect(res.status, res.text).toBe(200);
    const projectId = res.body.project.id;
    expect(res.body.company.projectId).toBe(projectId);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project).toMatchObject({ title: "Harbour Bakery", goal: "run_company", subcategory: "retail", ownerId: admin.id });
    const people = (await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId))).map((m) => m.userId).sort();
    expect(people).toEqual([admin.id, member.id].sort());
    const [linked] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(linked.projectId).toBe(projectId);

    // The path is there, and the company's member can use the rhythm.
    const path = await admin.agent.get(`/api/projects/${projectId}/path?goal=run_company`);
    expect(path.status).toBe(200);
    expect((await member.agent.get(`/api/projects/${projectId}/rhythm`)).status).toBe(200);

    // Once is enough.
    expect((await admin.agent.post(`/api/companies/${company.id}/run-project`)).status).toBe(409);
  });
});
