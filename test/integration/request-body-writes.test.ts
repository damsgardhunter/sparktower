/**
 * A write stores what the route allows, where the URL says, and nothing else.
 *
 * Workspace items used to be written with the request body spread in or passed
 * whole, and updated or deleted by item id alone after checking membership of
 * whichever project the URL named. So an account with a project of its own
 * could edit or delete another project's rows, move rows between projects with
 * `projectId`, promote itself with `role`, and record donations nobody paid.
 * Each case below is one of those attempts.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { cofounderSprints, projectMembers, projectPricingTiers, projects, sprintKanbanTasks } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let ip = 40;
async function person(name: string) {
  const app = await getTestApp();
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${ip++}`)
    .send({ email: `body-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`, password: "Testpass123!", firstName: name });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}
async function projectOf(agent: request.Agent, title: string) {
  const res = await agent.post("/api/projects").send({ title, description: "A project used to test what writes may touch.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
  expect(res.status).toBe(200);
  return res.body.id as string;
}

describe("workspace writes", () => {
  it("can't reach another project's rows through your own project's URL", async () => {
    const victim = await person("Victim");
    const attacker = await person("Attacker");
    const theirs = await projectOf(victim.agent, "Victim Project");
    const mine = await projectOf(attacker.agent, "Attacker Project");

    const tier = (await victim.agent.post(`/api/projects/${theirs}/pricing`).send({ name: "Pro", price: 20 })).body;
    expect(tier.projectId).toBe(theirs);

    const edits: Record<string, object> = {
      pricing: { name: "Hijacked" }, interviews: { notes: "Hijacked" }, experiments: { result: "Hijacked" }, "legal-docs": { title: "Hijacked" },
      "deploy-checklist": { item: "Hijacked" }, "support-tickets": { subject: "Hijacked" }, "launch-tasks": { notes: "Hijacked" }, "analytics-events": { description: "Hijacked" },
    };
    for (const [seg, body] of Object.entries(edits)) {
      const patch = await attacker.agent.patch(`/api/projects/${mine}/${seg}/${tier.id}`).send(body);
      expect(patch.status, `PATCH ${seg}`).toBe(404);
    }
    expect((await attacker.agent.delete(`/api/projects/${mine}/pricing/${tier.id}`)).status).toBe(404);
    expect((await attacker.agent.delete(`/api/projects/${mine}/waitlist/${tier.id}`)).status).toBe(404);

    const [row] = await db.select().from(projectPricingTiers).where(eq(projectPricingTiers.id, tier.id));
    expect(row).toMatchObject({ name: "Pro", projectId: theirs });

    // A body with nothing it may change says so rather than failing.
    expect((await victim.agent.patch(`/api/projects/${theirs}/pricing/${tier.id}`).send({ projectId: "elsewhere" })).status).toBe(400);

    // The owner, on the right URL, still can.
    const own = await victim.agent.patch(`/api/projects/${theirs}/pricing/${tier.id}`).send({ name: "Pro+" });
    expect(own.status).toBe(200);
    expect(own.body.name).toBe("Pro+");
    expect((await victim.agent.delete(`/api/projects/${theirs}/pricing/${tier.id}`)).status).toBe(200);
  });

  it("ignores ids, owners and fields the route doesn't allow", async () => {
    const victim = await person("Owner");
    const attacker = await person("Mover");
    const theirs = await projectOf(victim.agent, "Destination");
    const mine = await projectOf(attacker.agent, "Origin");

    // Created on my project, however hard the body insists otherwise.
    const tier = await attacker.agent.post(`/api/projects/${mine}/pricing`).send({ name: "Starter", price: 5, projectId: theirs, id: "chosen-id" });
    expect(tier.status).toBe(200);
    expect(tier.body.projectId).toBe(mine);
    expect(tier.body.id).not.toBe("chosen-id");
    // And an update can't move it.
    const moved = await attacker.agent.patch(`/api/projects/${mine}/pricing/${tier.body.id}`).send({ projectId: theirs, price: 6 });
    expect(moved.body).toMatchObject({ projectId: mine, price: 6 });

    const link = await attacker.agent.post(`/api/projects/${mine}/links`).send({ label: "Docs", url: "https://example.com", projectId: theirs });
    expect(link.status).toBe(200);
    expect(link.body.projectId).toBe(mine);
    const decision = await attacker.agent.post(`/api/projects/${mine}/decisions`).send({ title: "Stack", decision: "Postgres", userId: victim.id, projectId: theirs });
    expect(decision.body).toMatchObject({ projectId: mine, userId: attacker.id });
    expect((await attacker.agent.post(`/api/projects/${mine}/decisions`).send({ title: "No decision field" })).status).toBe(400);

    // A new project's counters and owner come from the server.
    const created = await attacker.agent.post("/api/projects").send({ title: "Inflated", description: "Trying to start with numbers it didn't earn.", category: "saas", goal: "ship_mvp", subcategory: "saas", ownerId: victim.id, views: 99999, totalDonations: 50000 });
    expect(created.body).toMatchObject({ ownerId: attacker.id, views: 0, totalDonations: 0 });
  });

  it("lets a member edit their availability, not their role", async () => {
    const owner = await person("Lead");
    const member = await person("Member");
    const pid = await projectOf(owner.agent, "Team Project");
    await db.insert(projectMembers).values({ projectId: pid, userId: member.id, role: "member" });

    const res = await member.agent.patch(`/api/projects/${pid}/members/${member.id}`).send({ role: "owner", timezone: "UTC", hoursPerWeek: 10 });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, pid), eq(projectMembers.userId, member.id)));
    expect(row).toMatchObject({ role: "member", timezone: "UTC", hoursPerWeek: 10 });
  });

  it("records no donation without a payment", async () => {
    const donor = await person("Donor");
    const owner = await person("Creator");
    const pid = await projectOf(owner.agent, "Funded Project");
    const res = await donor.agent.post(`/api/projects/${pid}/donate`).send({ amount: 100000, stripeChargeId: "ch_fake" });
    expect(res.status).toBe(404);
    const [p] = await db.select({ total: projects.totalDonations }).from(projects).where(eq(projects.id, pid));
    expect(p.total).toBe(0);
  });

  it("keeps sprint tasks in their sprint and assigned within it", async () => {
    const a = await person("SprintA");
    const b = await person("SprintB");
    const outsider = await person("SprintC");
    const [mine] = await db.insert(cofounderSprints).values({ user1Id: a.id, user2Id: b.id, duration: "24h" }).returning();
    const [other] = await db.insert(cofounderSprints).values({ user1Id: outsider.id, user2Id: b.id, duration: "24h" }).returning();
    const [otherTask] = await db.insert(sprintKanbanTasks).values({ sprintId: other.id, title: "Someone else's task" }).returning();

    const created = await a.agent.post(`/api/sprints/${mine.id}/tasks`).send({ title: "Ship it", sprintId: other.id });
    expect(created.status).toBe(200);
    expect(created.body.sprintId).toBe(mine.id);
    expect((await a.agent.post(`/api/sprints/${mine.id}/tasks`).send({ title: "Hand off", assigneeId: outsider.id })).status).toBe(400);

    expect((await a.agent.patch(`/api/sprints/${mine.id}/tasks/${otherTask.id}`).send({ title: "Hijacked" })).status).toBe(404);
    const [still] = await db.select().from(sprintKanbanTasks).where(eq(sprintKanbanTasks.id, otherTask.id));
    expect(still).toMatchObject({ title: "Someone else's task", sprintId: other.id });

    const moved = await a.agent.patch(`/api/sprints/${mine.id}/tasks/${created.body.id}`).send({ status: "done", sprintId: other.id });
    expect(moved.body).toMatchObject({ status: "done", sprintId: mine.id });
  });
});
