/**
 * The growth loop, counted.
 *
 * The loop itself works and has done for a while: a published step brings a
 * stranger in, they sign up, make a project, take their first step, publish
 * it. What nobody could answer was *how many*, and where they stopped —
 * because the analytics deliberately has no hand-placed tracking, and every
 * write in the loop looked like every other write (`api.write`, one PATCH
 * among thousands).
 *
 * Six moments are named now (shared/path-funnel.ts). These are the tests that
 * they are written, that they carry enough to join up, and that the counting
 * on top of them says what it means.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { activityEvents, pathArtifacts, projectKanbanTasks, users } from "@shared/schema";
import { PATH_FUNNEL_EVENTS, PATH_FUNNEL_EVENT_NAMES, sanitizePathFunnelProps } from "@shared/path-funnel";
import { passMfa } from "../helpers/mfa";

const savedOwner = process.env.PLATFORM_OWNER_EMAIL;

afterAll(async () => { process.env.PLATFORM_OWNER_EMAIL = savedOwner; await closeTestApp(); });

const password = "Testpass123!";
let n = 0;

async function builder(app: any, first = "Fun") {
  const agent = request.agent(app);
  n += 1;
  const email = `funnel-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.210.${(n % 200) + 20}`)
    .send({ email, password, firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email);
  return { agent, id: res.body.id as string, email };
}

/** A project, its first step finished, and the artifact that step produced — published. */
async function publishedStep(app: any, agent: any) {
  const project = (await agent.post("/api/projects").send({
    title: `Funnel ${Date.now()}-${n}`, description: "Something worth reading about afterwards.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  })).body;

  const tasks = (await agent.get(`/api/projects/${project.id}/kanban`)).body;
  const first = tasks.find((t: any) => t.tags?.includes("backbone:SHIP.M1.1"));
  await agent.patch(`/api/kanban/${first.id}`).send({ status: "done", description: "Plan a week of dinners from what is already in the fridge." });

  const made = await agent.post(`/api/projects/${project.id}/path/tasks/${first.id}/artifact`).send({});
  expect(made.status, JSON.stringify(made.body).slice(0, 200)).toBe(200);
  const published = await agent.post(`/api/artifacts/${made.body.id}/publish`)
    .send({ title: "What we decided to build first", tags: ["ship"] });
  expect(published.status, JSON.stringify(published.body).slice(0, 200)).toBe(200);
  return { project, artifactId: made.body.id as string };
}

const eventsFor = async (name: string, artifactId?: string) => {
  const rows = await db.select().from(activityEvents).where(eq(activityEvents.name, name));
  return artifactId ? rows.filter((r) => (r.props as any)?.artifactId === artifactId) : rows;
};

describe("what the loop writes down", () => {
  it("names the publish, the read, and the signup it produced", async () => {
    const app = await getTestApp();
    const author = await builder(app, "Ada");
    const { artifactId } = await publishedStep(app, author.agent);

    /*
     * Published: the loop's last step, and somebody else's first. Polled,
     * because the row is written fire-and-forget — a publish is never held up
     * by its own analytics, so the write lands just after the response.
     */
    await expect.poll(async () => (await eventsFor(PATH_FUNNEL_EVENTS.published, artifactId)).length, { timeout: 5_000 })
      .toBe(1);

    // Read by a stranger with no account at all.
    const stranger = request.agent(app);
    const page = await stranger.get(`/api/public/artifacts/${artifactId}`).set("x-forwarded-for", "198.51.211.9");
    expect(page.status).toBe(200);
    await expect.poll(async () => (await eventsFor(PATH_FUNNEL_EVENTS.artifactView, artifactId)).length, { timeout: 5_000 }).toBe(1);
    const [view] = await eventsFor(PATH_FUNNEL_EVENTS.artifactView, artifactId);
    expect(view.userId, "a read with no account still counts").toBeNull();
    expect((view.props as any).goal, "and it knows which path it was on").toBe("ship_mvp");

    // Signed up carrying the artifact: the loop closing on a new person.
    const joiner = request.agent(app);
    const joined = await joiner.post("/api/auth/register").set("x-forwarded-for", "198.51.211.10")
      .send({ email: `joined-${Date.now()}@example.test`, password, firstName: "Jo", fromArtifact: artifactId });
    expect(joined.status).toBe(201);
    await expect.poll(async () => (await eventsFor(PATH_FUNNEL_EVENTS.signup, artifactId)).length, { timeout: 5_000 }).toBe(1);

    // And the artifact's own counter agrees with the event.
    const [row] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.id, artifactId));
    expect(row.signups).toBe(1);
    expect(row.views).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it("names a project made from a published step, and its first finished step", async () => {
    const app = await getTestApp();
    const author = await builder(app, "Bo");
    const { artifactId } = await publishedStep(app, author.agent);

    const joiner = await builder(app, "Kit");
    const made = await joiner.agent.post("/api/projects").send({
      title: `From a page ${Date.now()}`, description: "Started after reading somebody else's step.",
      category: "saas", goal: "ship_mvp", subcategory: "saas", fromArtifact: artifactId,
    });
    expect(made.status).toBe(200);

    await expect.poll(async () => (await eventsFor(PATH_FUNNEL_EVENTS.projectCreated, artifactId)).length, { timeout: 5_000 }).toBe(1);
    const [created] = await eventsFor(PATH_FUNNEL_EVENTS.projectCreated, artifactId);
    expect((created.props as any).goal, "on the goal the page was on").toBe("ship_mvp");
    expect(created.projectId).toBe(made.body.id);

    /* fromArtifact is where it came from, not a column on it. */
    expect(made.body.fromArtifact).toBeUndefined();

    // Their first step, once — and not again for the second.
    const tasks = (await joiner.agent.get(`/api/projects/${made.body.id}/kanban`)).body;
    const first = tasks.find((t: any) => t.tags?.includes("backbone:SHIP.M1.1"));
    await joiner.agent.patch(`/api/kanban/${first.id}`).send({ status: "done", description: "The first thing we decided." });
    await expect.poll(async () => (await db.select().from(activityEvents)
      .where(and(eq(activityEvents.name, PATH_FUNNEL_EVENTS.firstStep), eq(activityEvents.projectId, made.body.id)))).length,
      { timeout: 5_000 }).toBe(1);

    const second = tasks.find((t: any) => t.tags?.includes("backbone:SHIP.M1.2"));
    await joiner.agent.patch(`/api/kanban/${second.id}`).send({ status: "done" });
    const still = await db.select().from(activityEvents)
      .where(and(eq(activityEvents.name, PATH_FUNNEL_EVENTS.firstStep), eq(activityEvents.projectId, made.body.id)));
    expect(still.length, "the first step happens once").toBe(1);
  }, 180_000);

  it("counts the funnel for the owner, in the order it happens", async () => {
    const app = await getTestApp();
    const owner = await builder(app, "Ows");
    process.env.PLATFORM_OWNER_EMAIL = owner.email;
    // The owner's console needs a second factor on the session (server/mfa.ts).
    await passMfa(owner.agent);

    const summary = await owner.agent.get("/api/admin/analytics/summary?days=30");
    expect(summary.status, JSON.stringify(summary.body).slice(0, 200)).toBe(200);
    const funnel = summary.body.pathFunnel;
    expect(funnel, "the growth loop is on the dashboard").toBeTruthy();
    expect(funnel.funnel.map((s: any) => s.key)).toEqual(["read", "wanted", "joined", "started", "stepped", "published"]);
    expect(funnel.events.map((e: any) => e.name).sort()).toEqual([...PATH_FUNNEL_EVENT_NAMES].sort());
    for (const step of funnel.funnel) expect(typeof step.sessions).toBe("number");
    expect(Array.isArray(funnel.topArtifacts)).toBe(true);
  }, 120_000);

  it("keeps only what these events are allowed to carry", async () => {
    // The call-to-action is sent by a page with no account behind it.
    expect(sanitizePathFunnelProps({
      artifactId: "0f9c1b2a-1111-2222-3333-444455556666",
      goal: "ship_mvp", subcategory: "saas", intent: "start",
      email: "someone@example.test", note: "an essay".repeat(500), admin: true,
    })).toEqual({
      artifactId: "0f9c1b2a-1111-2222-3333-444455556666",
      goal: "ship_mvp", subcategory: "saas", intent: "start",
    });
    expect(sanitizePathFunnelProps({ artifactId: "../../etc/passwd", goal: "DROP TABLE" })).toEqual({});
    expect(sanitizePathFunnelProps(null)).toEqual({});
  });

  it("accepts the call-to-action from a signed-out page, and nothing else made up", async () => {
    const app = await getTestApp();
    const anyone = request.agent(app);
    const artifactId = "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d";

    const sent = await anyone.post("/api/track").set("x-forwarded-for", "198.51.212.11").send({
      events: [
        { name: PATH_FUNNEL_EVENTS.artifactCta, path: `/a/${artifactId}`, props: { artifactId, goal: "ship_mvp", intent: "start" } },
        { name: "path_funnel.published", path: "/", props: { artifactId } },
      ],
    });
    expect(sent.status).toBeLessThan(400);

    await expect.poll(async () => (await eventsFor(PATH_FUNNEL_EVENTS.artifactCta, artifactId)).length, { timeout: 5_000 }).toBe(1);
    /*
     * A publish is a thing the server watched happen. Letting a page claim one
     * would make the last step of the funnel — the one that says the loop
     * closed — the easiest number in the product to invent.
     */
    expect((await eventsFor(PATH_FUNNEL_EVENTS.published, artifactId)).length, "a page cannot claim a publish").toBe(0);
  }, 120_000);
});
