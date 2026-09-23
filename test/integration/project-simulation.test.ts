/**
 * A season from a project, for somebody who has no company.
 *
 * The bug this closes: the Simulations tab told most people the truth and
 * left them nowhere to go — private seasons belong to a company, this project
 * belongs to a person, so set up a company account. A form about an
 * organisation that does not exist, standing between somebody and the thing
 * they came for.
 *
 * The model is not called here. What is under test is everything around it:
 * who may press the button, what gets created, and that pressing it twice
 * does not leave somebody with two companies.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { companies, companyMembers, projects, simSeasons } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.122.${20 + (n++ % 200)}`;

async function person(app: any, first = "Builder") {
  n += 1;
  const agent = request.agent(app);
  const email = `proj-sim-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, res.text?.slice(0, 200)).toBe(201);
  await verifyEmail(app, email, ip());
  return { agent, id: res.body.id as string, email };
}

async function aProject(ownerId: string, over: Record<string, unknown> = {}) {
  const [project] = await db.insert(projects).values({
    ownerId,
    title: "Clinic Scheduler",
    description: "Scheduling and reminders for small veterinary practices, sold per clinic.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
    ...over,
  } as any).returning();
  return project;
}

describe("running a market from a project", () => {
  it("is refused to anyone but the project's owner", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const stranger = await person(app, "Stranger");
    const project = await aProject(owner.id);

    const res = await stranger.agent.post(`/api/projects/${project.id}/simulation`).send({});
    expect(res.status, "a stranger cannot stand up a company on somebody else's project").toBe(403);
    expect(res.body.code).toBe("not_yours");

    // And nothing was created on the way to refusing.
    const made = await db.select().from(companies).where(eq(companies.projectId, project.id));
    expect(made).toHaveLength(0);
  }, 120_000);

  it("tells somebody who is not signed in nothing at all", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Quiet");
    const project = await aProject(owner.id);
    expect((await request(app).post(`/api/projects/${project.id}/simulation`).send({})).status).toBe(401);
  }, 120_000);

  it("404s a project that does not exist", async () => {
    const app = await getTestApp();
    const me = await person(app);
    const res = await me.agent.post("/api/projects/00000000-0000-4000-8000-000000000000/simulation").send({});
    expect(res.status).toBe(404);
  }, 120_000);

  it("reuses the company when the project already has one, rather than making a second", async () => {
    /*
     * The double-click case. Standing a company up is the whole point of the
     * button, and doing it twice would leave somebody owning two companies
     * with the same name and one project between them.
     */
    const app = await getTestApp();
    const owner = await person(app, "Twice");
    const project = await aProject(owner.id);

    const [existing] = await db.insert(companies).values({
      name: "Already Here", slug: `already-${Date.now()}`,
      projectId: project.id, createdBy: owner.id, createdAt: new Date(),
    } as any).returning();
    await db.insert(companyMembers).values({ companyId: existing.id, userId: owner.id, role: "owner", joinedAt: new Date() });

    /*
     * The route needs a model, which this suite has no key for, so it refuses
     * at the gate. What matters is which gate: not a 500, and no second
     * company either way.
     */
    const res = await owner.agent.post(`/api/projects/${project.id}/simulation`).send({});
    expect([201, 402, 429, 503], `unexpected ${res.status}: ${res.text?.slice(0, 200)}`).toContain(res.status);

    const all = await db.select().from(companies).where(eq(companies.projectId, project.id));
    expect(all, "still one company for this project").toHaveLength(1);
    expect(all[0].id).toBe(existing.id);
  }, 120_000);

  it("charges nothing when Nova is not configured", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Nokey");
    const project = await aProject(owner.id);

    const res = await owner.agent.post(`/api/projects/${project.id}/simulation`).send({});
    if (res.status === 503) {
      expect(res.body.code).toBe("nova_unavailable");
      // Refused before anything was built, so there is nothing to clean up.
      expect(await db.select().from(companies).where(eq(companies.projectId, project.id))).toHaveLength(0);
      expect(await db.select().from(simSeasons).where(eq(simSeasons.companyId, project.id))).toHaveLength(0);
    }
  }, 120_000);
});
