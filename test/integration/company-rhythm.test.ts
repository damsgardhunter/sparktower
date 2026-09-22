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
import { and, eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import {
  companies, companyMembers, notifications, projectCheckins, projectKanbanTasks, projectMembers, projects, recurringJobRuns, recurringJobs, rhythmSettings,
} from "@shared/schema";
import { weekOf, addDays, todayYmd, advanceDue } from "@shared/company-rhythm";
import { runRhythmReminders } from "../../server/company-rhythm-jobs";

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

async function runProject(owner: { agent: any }, title = "Corner Café") {
  const res = await owner.agent.post("/api/projects").send({
    title, description: `${title}: a business that has been trading for six years and wants a steadier week.`,
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

    const late = await teammate.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ dueOn: overdueDue });
    expect(late.status, late.text).toBe(200);
    expect(late.body.run).toMatchObject({ dueOn: overdueDue, doneOn: today, onTime: false, doneBy: teammate.id });
    expect(late.body.job.nextDue).toBe(advanceDue(overdueDue, "week"));

    const onTime = await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ doneOn: today, dueOn: advanceDue(overdueDue, "week") });
    expect(onTime.body.run).toMatchObject({ dueOn: advanceDue(overdueDue, "week"), onTime: true });

    expect((await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ doneOn: addDays(today, 1), dueOn: advanceDue(overdueDue, "week", null) })).status).toBe(400);
    const runs = await db.select().from(recurringJobRuns).where(eq(recurringJobRuns.jobId, job.id));
    expect(runs).toHaveLength(2);

    // A month job clamps at month end.
    const monthly = await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "VAT", every: "month", nextDue: "2026-01-31" });
    const done = await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${monthly.body.id}/done`).send({ doneOn: "2026-02-02", dueOn: "2026-01-31" });
    expect(done.body.run.onTime).toBe(false);
    expect(done.body.job.nextDue).toBe("2026-02-28");
    // …and goes back to the 31st in March, because the job remembers the day it belongs on.
    expect(monthly.body.anchorDay).toBe(31);
    const again = await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${monthly.body.id}/done`).send({ doneOn: "2026-03-01", dueOn: "2026-02-28" });
    expect(again.body.job.nextDue).toBe("2026-03-31");

    // A job saved before anchors existed takes its anchor from the due date it has.
    const [legacy] = await db.insert(recurringJobs).values({ projectId: id, title: "Rent", every: "month", nextDue: "2026-01-30", active: true, createdAt: new Date() }).returning();
    const legacyDone = await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${legacy.id}/done`).send({ doneOn: "2026-01-30", dueOn: "2026-01-30" });
    expect(legacyDone.body.job).toMatchObject({ nextDue: "2026-02-28", anchorDay: 30 });
    expect((await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${legacy.id}/done`).send({ doneOn: "2026-02-28", dueOn: "2026-02-28" })).body.job.nextDue).toBe("2026-03-30");

    // Moving a monthly job's due date moves its anchor with it.
    const moved = await owner.agent.patch(`/api/projects/${id}/rhythm/jobs/${monthly.body.id}`).send({ nextDue: "2026-04-15" });
    expect(moved.body.anchorDay).toBe(15);

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
    await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ doneOn: "2026-08-07", dueOn: "2026-08-07" });
    await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ doneOn: "2026-08-25", dueOn: "2026-08-21" });

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

describe("which company a project belongs to", () => {
  /*
   * The manager's Simulations panel asks this to decide what to show: a
   * company's season list and a way to start one, the same list read-only, or
   * the public market for a project no company owns. Getting it wrong either
   * hides the feature from the people it is for, or offers a button that
   * cannot work.
   */
  it("answers with the company and the asker's powers, or nothing when it's nobody's", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const plain = await person(app);
    const outsider = await person(app);
    const [company] = await db.insert(companies).values({
      name: `Rail Co ${Date.now()}`, slug: `rail-${Date.now()}`, industry: "Other", createdBy: owner.id, createdAt: new Date(),
    }).returning();
    await db.insert(companyMembers).values([
      { companyId: company.id, userId: owner.id, role: "owner", joinedAt: new Date() },
      { companyId: company.id, userId: plain.id, role: "member", joinedAt: new Date() },
    ]);
    const projectId = (await owner.agent.post(`/api/companies/${company.id}/run-project`)).body.project.id as string;

    const asOwner = await owner.agent.get(`/api/projects/${projectId}/company`);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.company).toMatchObject({ id: company.id, name: company.name });
    expect(asOwner.body.powers, "an owner can run seasons for their people").toContain("run_seasons");

    // On the project, in the company, without the power: the season list, not the button.
    const asMember = await plain.agent.get(`/api/projects/${projectId}/company`);
    expect(asMember.body.company.id).toBe(company.id);
    expect(asMember.body.powers).not.toContain("run_seasons");

    // Nobody else's business, in both senses.
    expect((await outsider.agent.get(`/api/projects/${projectId}/company`)).status).toBe(404);

    // A project of somebody's own says so, rather than looking broken.
    const solo = (await owner.agent.post("/api/projects").send({
      title: "Just mine", description: "A project that belongs to no company at all.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;
    const alone = await owner.agent.get(`/api/projects/${solo}/company`);
    expect(alone.status).toBe(200);
    expect(alone.body.company).toBeNull();
  }, 60_000);
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
    // Private even on a free plan with no private projects to spare: a company's own numbers are never a showcase.
    expect(project).toMatchObject({ title: "Harbour Bakery", goal: "run_company", subcategory: "retail", ownerId: admin.id, isPrivate: true });
    const people = (await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId))).map((m) => m.userId).sort();
    expect(people).toEqual([admin.id, member.id].sort());
    const [linked] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(linked.projectId).toBe(projectId);
    // …and it doesn't spend the admin's own private-project allowance, which is theirs, not the company's.
    const { storage } = await import("../../server/storage");
    expect(await storage.countPrivateProjects(admin.id)).toBe(0);

    // The path is there, and the company's member can use the rhythm.
    const path = await admin.agent.get(`/api/projects/${projectId}/path?goal=run_company`);
    expect(path.status).toBe(200);
    expect((await member.agent.get(`/api/projects/${projectId}/rhythm`)).status).toBe(200);

    // Once is enough.
    expect((await admin.agent.post(`/api/companies/${company.id}/run-project`)).status).toBe(409);
  });
});

// ─── The path closing itself, settings, reminders, goals ─────────────────────

/** The status of a Run milestone's task on the board. */
async function milestoneStatus(projectId: string, milestoneId: string) {
  const [task] = await db.select({ status: projectKanbanTasks.status }).from(projectKanbanTasks)
    .where(and(eq(projectKanbanTasks.projectId, projectId), sql`${projectKanbanTasks.tags} @> ARRAY[${`backbone:${milestoneId}`}]::varchar[]`));
  return task?.status ?? null;
}

async function notesFor(recipientId: string, kind: "job_due" | "checkin_due", targetId: string) {
  return db.select().from(notifications)
    .where(and(eq(notifications.recipientId, recipientId), eq(notifications.kind, kind), eq(notifications.targetId, targetId)));
}

describe("the setup milestones close when the real work happens", () => {
  it("first check-in closes RUN.S1.4, the third job RUN.S2.2, a second person RUN.S2.1, reading a report RUN.S3.4", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const teammate = await person(app);
    const id = await runProject(owner);
    expect(await milestoneStatus(id, "RUN.S1.4")).toBe("todo");

    await owner.agent.put(`/api/projects/${id}/rhythm/checkins/2026-08-03`).send({ numbers: { covers: 400 } });
    expect(await milestoneStatus(id, "RUN.S1.4")).toBe("done");

    for (const title of ["Payroll", "Stock take"]) {
      expect((await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title, every: "week" })).status).toBe(200);
    }
    expect(await milestoneStatus(id, "RUN.S2.2")).toBe("todo");
    await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "Chase invoices", every: "week" });
    expect(await milestoneStatus(id, "RUN.S2.2")).toBe("done");

    expect(await milestoneStatus(id, "RUN.S2.1")).toBe("todo");
    await db.insert(projectMembers).values({ projectId: id, userId: teammate.id, role: "Member" });
    await teammate.agent.get(`/api/projects/${id}/rhythm`);
    expect(await milestoneStatus(id, "RUN.S2.1")).toBe("done");

    // A month with nothing filed, or a glance from the company page, isn't reading the report.
    await owner.agent.get(`/api/projects/${id}/rhythm/report/2026-07`);
    await owner.agent.get(`/api/projects/${id}/rhythm/report/2026-08?glance=1`);
    expect(await milestoneStatus(id, "RUN.S3.4")).toBe("todo");
    await owner.agent.get(`/api/projects/${id}/rhythm/report/2026-08`);
    expect(await milestoneStatus(id, "RUN.S3.4")).toBe("done");
  });

  it("never reopens a milestone someone already closed by hand", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    const at = new Date("2026-01-01T00:00:00Z");
    await db.update(projectKanbanTasks).set({ status: "done", completedAt: at } as any)
      .where(and(eq(projectKanbanTasks.projectId, id), sql`${projectKanbanTasks.tags} @> ARRAY['backbone:RUN.S1.4']::varchar[]`));
    await owner.agent.put(`/api/projects/${id}/rhythm/checkins/2026-08-03`).send({ numbers: { covers: 400 } });
    const [task] = await db.select().from(projectKanbanTasks)
      .where(and(eq(projectKanbanTasks.projectId, id), sql`${projectKanbanTasks.tags} @> ARRAY['backbone:RUN.S1.4']::varchar[]`));
    expect(task.status).toBe("done");
    expect(task.completedAt?.toISOString()).toBe(at.toISOString());
  });
});

describe("the rhythm's settings", () => {
  it("round-trips the day and who's reminded, and closes RUN.S4.4", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const teammate = await person(app);
    const outsider = await person(app);
    const id = await runProject(owner);
    await db.insert(projectMembers).values({ projectId: id, userId: teammate.id, role: "Member" });

    const before = await owner.agent.get(`/api/projects/${id}/rhythm/settings`);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ checkinDay: 0, remindUserIds: [] });
    expect(before.body.members.map((m: any) => m.id).sort()).toEqual([owner.id, teammate.id].sort());
    expect(await milestoneStatus(id, "RUN.S4.4")).toBe("todo");

    expect((await owner.agent.put(`/api/projects/${id}/rhythm/settings`).send({ checkinDay: 7, remindUserIds: [] })).status).toBe(400);
    expect((await owner.agent.put(`/api/projects/${id}/rhythm/settings`).send({ checkinDay: 2, remindUserIds: [outsider.id] })).status).toBe(400);
    expect((await outsider.agent.put(`/api/projects/${id}/rhythm/settings`).send({ checkinDay: 2, remindUserIds: [] })).status).toBe(404);

    const saved = await teammate.agent.put(`/api/projects/${id}/rhythm/settings`).send({ checkinDay: 4, remindUserIds: [teammate.id] });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body).toEqual({ checkinDay: 4, remindUserIds: [teammate.id] });
    expect((await owner.agent.get(`/api/projects/${id}/rhythm/settings`)).body).toMatchObject({ checkinDay: 4, remindUserIds: [teammate.id] });
    expect((await owner.agent.get(`/api/projects/${id}/rhythm`)).body.settings).toEqual({ checkinDay: 4, remindUserIds: [teammate.id] });
    expect(await milestoneStatus(id, "RUN.S4.4")).toBe("done");
  });
});

describe("reminders", () => {
  it("tells a due job's owner once, however often the sweep runs, and its backup once it is two days late", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const doer = await person(app);
    const backup = await person(app);
    const id = await runProject(owner);
    await db.insert(projectMembers).values([
      { projectId: id, userId: doer.id, role: "Member" },
      { projectId: id, userId: backup.id, role: "Member" },
    ]);
    const due = "2026-03-11";
    const job = (await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "Payroll", every: "month", nextDue: due, ownerId: doer.id, backupId: backup.id })).body;
    const target = `${job.id}:${due}`;

    await runRhythmReminders(new Date("2026-03-10T09:00:00Z"));
    expect(await notesFor(doer.id, "job_due", target)).toHaveLength(0); // not due yet

    await runRhythmReminders(new Date("2026-03-11T09:00:00Z"));
    await runRhythmReminders(new Date("2026-03-11T09:15:00Z"));
    const told = await notesFor(doer.id, "job_due", target);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ projectId: id, excerpt: "Payroll — due 11 Mar" });
    expect(await notesFor(backup.id, "job_due", target)).toHaveLength(0);

    await runRhythmReminders(new Date("2026-03-12T09:00:00Z")); // one day late: still the owner's
    expect(await notesFor(backup.id, "job_due", target)).toHaveLength(0);

    await runRhythmReminders(new Date("2026-03-13T09:00:00Z"));
    await runRhythmReminders(new Date("2026-03-14T09:00:00Z"));
    const backedUp = await notesFor(backup.id, "job_due", target);
    expect(backedUp).toHaveLength(1);
    expect(backedUp[0].excerpt).toBe("Payroll — overdue since 11 Mar");
    expect(await notesFor(doer.id, "job_due", target)).toHaveLength(1);

    // Done late: the next occurrence is its own reminder.
    const done = await doer.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ doneOn: "2026-03-14", dueOn: "2026-03-11" });
    expect(done.body.job.nextDue).toBe("2026-04-11");
    await runRhythmReminders(new Date("2026-04-11T08:00:00Z"));
    expect(await notesFor(doer.id, "job_due", `${job.id}:2026-04-11`)).toHaveLength(1);
  });

  it("tells owner and backup together when a job is first seen two days late, and the project owner when a job has no owner", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const doer = await person(app);
    const backup = await person(app);
    const id = await runProject(owner);
    await db.insert(projectMembers).values([
      { projectId: id, userId: doer.id, role: "Member" },
      { projectId: id, userId: backup.id, role: "Member" },
    ]);
    const late = (await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "VAT return", every: "month", nextDue: "2026-03-01", ownerId: doer.id, backupId: backup.id })).body;
    const orphan = (await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "Bins", every: "week", nextDue: "2026-03-04" })).body;
    await runRhythmReminders(new Date("2026-03-04T10:00:00Z"));
    expect(await notesFor(doer.id, "job_due", `${late.id}:2026-03-01`)).toHaveLength(1);
    expect(await notesFor(backup.id, "job_due", `${late.id}:2026-03-01`)).toHaveLength(1);
    expect(await notesFor(owner.id, "job_due", `${orphan.id}:2026-03-04`)).toHaveLength(1);
    const [row] = await db.select().from(recurringJobs).where(eq(recurringJobs.id, late.id));
    expect(row.remindedFor).toBe("2026-03-01:backup");
  });

  it("reminds on the chosen weekday only, only who was chosen, once a week, and not once the week is filed", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const teammate = await person(app);
    const a = await runProject(owner);
    const b = await runProject(owner, "Harbour Bakery");
    const c = await runProject(owner, "Hill Street Garage");
    await db.insert(projectMembers).values([{ projectId: a, userId: teammate.id, role: "Member" }, { projectId: c, userId: teammate.id, role: "Member" }]);
    // Wednesdays for a (only the teammate) and b (everyone); c never chose, so Monday.
    await owner.agent.put(`/api/projects/${a}/rhythm/settings`).send({ checkinDay: 2, remindUserIds: [teammate.id] });
    await owner.agent.put(`/api/projects/${b}/rhythm/settings`).send({ checkinDay: 2, remindUserIds: [] });
    // b has filed this week already.
    await owner.agent.put(`/api/projects/${b}/rhythm/checkins/2026-03-09`).send({ numbers: { covers: 10 } });

    const week = "2026-03-09";
    await runRhythmReminders(new Date("2026-03-10T12:00:00Z")); // Tuesday
    expect(await notesFor(teammate.id, "checkin_due", `${a}:${week}`)).toHaveLength(0);

    await runRhythmReminders(new Date("2026-03-11T06:00:00Z")); // Wednesday
    await runRhythmReminders(new Date("2026-03-11T06:15:00Z"));
    const told = await notesFor(teammate.id, "checkin_due", `${a}:${week}`);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ projectId: a, excerpt: "This week's check-in for Corner Café" });
    expect(await notesFor(owner.id, "checkin_due", `${a}:${week}`)).toHaveLength(0); // not chosen
    expect(await notesFor(owner.id, "checkin_due", `${b}:${week}`)).toHaveLength(0); // already filed
    expect(await notesFor(owner.id, "checkin_due", `${c}:${week}`)).toHaveLength(0); // c's day is Monday

    // The next Wednesday is a new week, and a new reminder.
    await runRhythmReminders(new Date("2026-03-18T06:00:00Z"));
    expect(await notesFor(teammate.id, "checkin_due", `${a}:2026-03-16`)).toHaveLength(1);
    expect(await notesFor(owner.id, "checkin_due", `${b}:2026-03-16`)).toHaveLength(1);

    // A project that never chose is reminded on Monday — everyone on it.
    await runRhythmReminders(new Date("2026-03-23T07:00:00Z"));
    expect(await notesFor(owner.id, "checkin_due", `${c}:2026-03-23`)).toHaveLength(1);
    expect(await notesFor(teammate.id, "checkin_due", `${c}:2026-03-23`)).toHaveLength(1);
    const [settings] = await db.select().from(rhythmSettings).where(eq(rhythmSettings.projectId, c));
    expect(settings).toMatchObject({ checkinDay: 0, remindedWeek: "2026-03-23" });
  });
});

describe("the quarter's goals", () => {
  it("adds, measures, edits and removes goals, and the first one closes RUN.S4.3", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const stranger = await person(app);
    const id = await runProject(owner);
    const q = "2026-Q2";
    await owner.agent.put(`/api/projects/${id}/rhythm/checkins/2026-03-30`).send({ numbers: { covers: 100, prime_cost_pct: 40 } }); // Q1's, not counted
    await owner.agent.put(`/api/projects/${id}/rhythm/checkins/2026-04-06`).send({ numbers: { covers: 500, prime_cost_pct: 36 } });
    await owner.agent.put(`/api/projects/${id}/rhythm/checkins/2026-05-04`).send({ numbers: { covers: 520, prime_cost_pct: 33 } });
    await owner.agent.put(`/api/projects/${id}/rhythm/checkins/2026-06-01`).send({ numbers: { covers: 550, prime_cost_pct: 29 } });

    expect(await milestoneStatus(id, "RUN.S4.3")).toBe("todo");
    expect((await owner.agent.post(`/api/projects/${id}/rhythm/goals`).send({ quarter: q, title: "" })).status).toBe(400);
    expect((await owner.agent.post(`/api/projects/${id}/rhythm/goals`).send({ quarter: q, title: "Busier", metricId: "made_up" })).status).toBe(400);
    expect((await owner.agent.post(`/api/projects/${id}/rhythm/goals`).send({ quarter: q, title: "Busier", target: 600 })).status).toBe(400);
    expect((await stranger.agent.post(`/api/projects/${id}/rhythm/goals`).send({ quarter: q, title: "Sneak" })).status).toBe(404);

    const covers = await owner.agent.post(`/api/projects/${id}/rhythm/goals`).send({ quarter: q, title: "600 covers a week", metricId: "covers", target: 600, ownerId: owner.id });
    expect(covers.status, covers.text).toBe(200);
    expect(covers.body).toMatchObject({ quarter: q, direction: "up", status: "active" });
    expect(covers.body.progress).toMatchObject({ first: 500, latest: 550, state: "behind" }); // the quarter is over and it's halfway
    expect(covers.body.progress.fraction).toBeCloseTo(0.5);
    expect(await milestoneStatus(id, "RUN.S4.3")).toBe("done");

    // Food cost is a number that should go down, so the goal takes that direction unless told otherwise.
    const cost = await owner.agent.post(`/api/projects/${id}/rhythm/goals`).send({ quarter: q, title: "Food cost under 30%", metricId: "prime_cost_pct", target: 30 });
    expect(cost.body).toMatchObject({ direction: "down" });
    expect(cost.body.progress).toMatchObject({ reached: true, state: "reached" });
    const byHand = await owner.agent.post(`/api/projects/${id}/rhythm/goals`).send({ quarter: q, title: "Hire a second chef" });
    expect(byHand.body.progress.state).toBe("not measured");

    const list = await owner.agent.get(`/api/projects/${id}/rhythm/goals?quarter=${q}`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ quarter: q, start: "2026-04-01", end: "2026-06-30", previousQuarter: "2026-Q1", nextQuarter: "2026-Q3" });
    expect(list.body.goals.map((g: any) => g.title)).toEqual(["600 covers a week", "Food cost under 30%", "Hire a second chef"]);
    expect((await owner.agent.get(`/api/projects/${id}/rhythm/goals?quarter=2026-Q9`)).status).toBe(400);
    expect((await owner.agent.get(`/api/projects/${id}/rhythm/goals`)).body.goals).toEqual([]); // this quarter has none
    expect((await stranger.agent.get(`/api/projects/${id}/rhythm/goals?quarter=${q}`)).status).toBe(404);

    // Lowering the target to where it got to reaches it; done and dropped are statuses, not deletions.
    const lowered = await owner.agent.patch(`/api/projects/${id}/rhythm/goals/${covers.body.id}`).send({ target: 550 });
    expect(lowered.body.progress.state).toBe("reached");
    expect((await owner.agent.patch(`/api/projects/${id}/rhythm/goals/${byHand.body.id}`).send({ status: "done" })).body.status).toBe("done");
    expect((await owner.agent.patch(`/api/projects/${id}/rhythm/goals/${byHand.body.id}`).send({ status: "paused" })).status).toBe(400);
    expect((await owner.agent.patch(`/api/projects/${id}/rhythm/goals/${byHand.body.id}`).send({ target: 3 })).status).toBe(400);
    expect((await owner.agent.patch(`/api/projects/${id}/rhythm/goals/${cost.body.id}`).send({ status: "dropped" })).body.status).toBe("dropped");

    expect((await stranger.agent.delete(`/api/projects/${id}/rhythm/goals/${cost.body.id}`)).status).toBe(404);
    expect((await owner.agent.delete(`/api/projects/${id}/rhythm/goals/${cost.body.id}`)).status).toBe(200);
    expect((await owner.agent.delete(`/api/projects/${id}/rhythm/goals/${cost.body.id}`)).status).toBe(404);
    expect((await owner.agent.get(`/api/projects/${id}/rhythm/goals?quarter=${q}`)).body.goals).toHaveLength(2);
  });
});

describe("marking a job done from two screens", () => {
  it("records the occurrence once: the stale tick is told it's already done, and next week's isn't filed early", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const teammate = await person(app);
    const id = await runProject(owner);
    await db.insert(projectMembers).values({ projectId: id, userId: teammate.id, role: "Member" });
    const due = addDays(todayYmd(), -1);
    const job = (await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "Stock take", every: "week", nextDue: due })).body;

    // Both screens loaded the job while it was due yesterday.
    const first = await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ dueOn: due });
    expect(first.status, first.text).toBe(200);
    const second = await teammate.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ dueOn: due });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("already_done");
    expect((await teammate.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({})).status).toBe(400); // no due date said
    const [row] = await db.select().from(recurringJobs).where(eq(recurringJobs.id, job.id));
    expect(row.nextDue).toBe(addDays(due, 7));
    expect(await db.select().from(recurringJobRuns).where(eq(recurringJobRuns.jobId, job.id))).toHaveLength(1);

    // Next week's is within one interval and can be done early; the one after that can't.
    expect((await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ dueOn: addDays(due, 7) })).status).toBe(200);
    const tooEarly = await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ dueOn: addDays(due, 14) });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.code).toBe("too_early");
  });

  it("isn't stuck when its date is moved back onto one already done", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const id = await runProject(owner);
    const job = (await owner.agent.post(`/api/projects/${id}/rhythm/jobs`).send({ title: "Payroll", every: "month", nextDue: "2026-08-28" })).body;
    await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ dueOn: "2026-08-28", doneOn: "2026-08-28" });
    await owner.agent.patch(`/api/projects/${id}/rhythm/jobs/${job.id}`).send({ nextDue: "2026-08-28" });
    const again = await owner.agent.post(`/api/projects/${id}/rhythm/jobs/${job.id}/done`).send({ dueOn: "2026-08-28", doneOn: "2026-09-01" });
    expect(again.status, again.text).toBe(200);
    expect(again.body.job.nextDue).toBe("2026-09-28");
    // The first record of that occurrence stands.
    expect(again.body.run).toMatchObject({ dueOn: "2026-08-28", doneOn: "2026-08-28", onTime: true });
    expect(await db.select().from(recurringJobRuns).where(eq(recurringJobRuns.jobId, job.id))).toHaveLength(1);
  });
});

describe("setting up a company's Run project twice at once", () => {
  it("makes one project, whoever clicks, and leaves no stray", async () => {
    const app = await getTestApp();
    const admin = await person(app);
    const other = await person(app);
    const [company] = await db.insert(companies).values({
      name: `Twin Clicks ${Date.now()}`, slug: `twin-${Date.now()}`, industry: "Other", createdBy: admin.id, createdAt: new Date(),
    }).returning();
    await db.insert(companyMembers).values([
      { companyId: company.id, userId: admin.id, role: "owner", joinedAt: new Date() },
      { companyId: company.id, userId: other.id, role: "admin", joinedAt: new Date() },
    ]);
    const results = await Promise.all([
      admin.agent.post(`/api/companies/${company.id}/run-project`),
      admin.agent.post(`/api/companies/${company.id}/run-project`),
      other.agent.post(`/api/companies/${company.id}/run-project`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    const made = await db.select().from(projects)
      .where(and(eq(projects.goal, "run_company"), sql`${projects.ownerId} in (${admin.id}, ${other.id})`));
    expect(made).toHaveLength(1);
    const [linked] = await db.select().from(companies).where(eq(companies.id, company.id));
    expect(linked.projectId).toBe(made[0].id);
    expect(made[0].isPrivate).toBe(true);
  });
});
