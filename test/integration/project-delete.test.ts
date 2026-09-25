/**
 * Deleting a project, and the one case where it must refuse.
 *
 * Almost everything a project owns cascades, which is right: tasks, files,
 * documents and seasons are parts of the project and mean nothing without it.
 * `project_backings` cascades too, and that one is different — those rows are
 * somebody else's money, sometimes still in escrow and refundable, and
 * deleting the project would take the record of the payment with it. No
 * refund, nothing to reconcile against Stripe, and nothing left to say the
 * pledge ever happened.
 *
 * So the interesting test here is not that delete works. It is that it stops.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { projects, projectBackings, projectKanbanTasks } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.130.${20 + (n++ % 200)}`;

async function person(app: any, first = "Owner") {
  n += 1;
  const agent = request.agent(app);
  const email = `proj-del-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, res.text?.slice(0, 200)).toBe(201);
  await verifyEmail(app, email, ip());
  return { agent, id: res.body.id as string };
}

async function aProject(ownerId: string) {
  const [project] = await db.insert(projects).values({
    ownerId, title: "Clinic Scheduler", description: "Scheduling for vets.",
    category: "saas", goal: "ship_mvp",
  } as any).returning();
  return project;
}

const pledge = (projectId: string, backerId: string, status: string) =>
  db.insert(projectBackings).values({
    id: randomUUID(), projectId, backerId, amountCents: 5_000, status,
    stripePaymentIntentId: `pi_${randomUUID()}`, createdAt: new Date(),
  } as any);

describe("deleting a project", () => {
  it("takes the project and everything under it", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const project = await aProject(owner.id);
    await db.insert(projectKanbanTasks).values({
      projectId: project.id, title: "A task", status: "todo", createdAt: new Date(),
    } as any);

    const res = await owner.agent.delete(`/api/projects/${project.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(0);
    expect(
      await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, project.id)),
      "its tasks went with it",
    ).toHaveLength(0);
  }, 60_000);

  it("is refused to anybody but the owner, and the project stays", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const stranger = await person(app, "Stranger");
    const project = await aProject(owner.id);

    const res = await stranger.agent.delete(`/api/projects/${project.id}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("not_yours");
    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(1);
  }, 60_000);

  it("tells somebody who is not signed in nothing at all", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const project = await aProject(owner.id);
    expect((await request(app).delete(`/api/projects/${project.id}`)).status).toBe(401);
  }, 60_000);

  /* The one that matters: money is somebody else's, and its record is theirs too. */
  it("refuses a project holding a refundable pledge, and destroys nothing", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const backer = await person(app, "Backer");
    const project = await aProject(owner.id);
    await pledge(project.id, backer.id, "held");

    const res = await owner.agent.delete(`/api/projects/${project.id}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("has_backing");
    expect(res.body.refundable, "and says how many are still refundable").toBe(1);
    expect(res.body.message).toMatch(/refund or release/i);

    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(1);
    expect(
      await db.select().from(projectBackings).where(eq(projectBackings.projectId, project.id)),
      "the pledge is still there",
    ).toHaveLength(1);
  }, 60_000);

  /* Released money is spent, and its record still cannot be thrown away. */
  it("refuses a project whose pledges have already been released", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const backer = await person(app, "Backer");
    const project = await aProject(owner.id);
    await pledge(project.id, backer.id, "released");

    const res = await owner.agent.delete(`/api/projects/${project.id}`);
    expect(res.status).toBe(409);
    expect(res.body.refundable, "nothing to refund, and still no deleting it").toBe(0);
    expect(res.body.message).toMatch(/money people actually paid/i);
  }, 60_000);

  /* A checkout that never completed is not money, and does not hold the project. */
  it("deletes a project whose only pledge failed", async () => {
    const app = await getTestApp();
    const owner = await person(app);
    const backer = await person(app, "Backer");
    const project = await aProject(owner.id);
    await pledge(project.id, backer.id, "failed");

    const res = await owner.agent.delete(`/api/projects/${project.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(0);
  }, 60_000);
});
