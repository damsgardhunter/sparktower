/**
 * The growth loop: publish a path artifact. A finished step becomes an
 * artifact; its team publishes it with a title and tags (a feed post and a
 * public page); anyone can read it with no account; a stranger who lands on
 * it and signs up is credited to it and its author hears; and that new
 * builder can publish their own. E2E: e2e/growth-loop.spec.ts.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { pathArtifacts, projects, users } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string, extra: Record<string, unknown> = {}) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.101.${10 + (n % 200)}`)
    .send({ email: `artifact-${first}-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: first, ...extra });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}
const settle = () => new Promise((r) => setTimeout(r, 500));

async function finishedStep(who: { agent: any }, title: string, extra: Record<string, unknown> = {}) {
  const project = (await who.agent.post("/api/projects").send({ title, description: "A meal planner built in public, one step at a time.", category: "saas", goal: "ship_mvp", subcategory: "saas", ...extra })).body;
  const tasks = (await who.agent.get(`/api/projects/${project.id}/kanban`)).body;
  const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
  return { project, step, tasks };
}

describe("publishing a path artifact", () => {
  it("generates from a finished step, publishes publicly, credits the signup, and the newcomer publishes theirs", async () => {
    const app = await getTestApp();
    const author = await person(app, "Author");
    const outsider = await person(app, "Outsider");
    const { project, step, tasks } = await finishedStep(author, "Artifact Path");

    // Only a finished step on this project's path, only by its team.
    expect((await author.agent.post(`/api/projects/${project.id}/path/tasks/${step.id}/artifact`)).body.code).toBe("step_not_done");
    await author.agent.patch(`/api/kanban/${step.id}`).send({ status: "done", description: "Plan a week of dinners from what's already in your fridge." }).expect(200);
    expect((await outsider.agent.post(`/api/projects/${project.id}/path/tasks/${step.id}/artifact`)).status).toBe(403);
    const loose = tasks.find((t: any) => !(t.tags ?? []).some((x: string) => /^(backbone|parent|injected):/.test(x)));
    if (loose) expect((await author.agent.post(`/api/projects/${project.id}/path/tasks/${loose.id}/artifact`)).body.code).toBe("not_on_path");

    const made = await author.agent.post(`/api/projects/${project.id}/path/tasks/${step.id}/artifact`);
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(made.body).toMatchObject({ taskId: step.id, backboneId: "SHIP.M1.1", title: "Product statement", visibility: "private", body: expect.stringContaining("fridge") });
    // Regenerating keeps the one artifact.
    expect((await author.agent.post(`/api/projects/${project.id}/path/tasks/${step.id}/artifact`)).body.id).toBe(made.body.id);

    // Not public until published.
    expect((await request(app).get(`/api/public/artifacts/${made.body.id}`)).status).toBe(404);
    expect((await outsider.agent.post(`/api/artifacts/${made.body.id}/publish`).send({ title: "Our product statement" })).status).toBe(403);
    expect((await author.agent.post(`/api/artifacts/${made.body.id}/publish`).send({ title: "Hi" })).body.field).toBe("title");

    const pub = await author.agent.post(`/api/artifacts/${made.body.id}/publish`).send({ title: "The one-line product statement", tags: ["Positioning", "meal planning"], asks: ["Is it clear who it's for?"] });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(pub.body).toMatchObject({ url: `/a/${made.body.id}`, artifact: { visibility: "public", tags: ["positioning", "meal-planning"] } });

    // The feed post links to the page, and the step counts as shared.
    const post = (await author.agent.get(`/api/feed/${pub.body.postId}`)).body;
    expect(post).toMatchObject({ entityType: "path_artifact", entityId: made.body.id, artifact: { id: made.body.id, public: true } });
    expect((await author.agent.get(`/api/projects/${project.id}/path`)).body.lastDone).toMatchObject({ taskId: step.id, sharedPostId: pub.body.postId });

    // Anyone, with no account, reads it with its backlink to the project and path.
    const pageData = await request(app).get(`/api/public/artifacts/${made.body.id}`);
    expect(pageData.status).toBe(200);
    expect(pageData.body).toMatchObject({
      title: "The one-line product statement", views: 1,
      project: { id: project.id, title: "Artifact Path" },
      path: { goal: "ship_mvp", goalLabel: "Ship an MVP", progress: { done: 1 } },
      author: { id: author.id },
    });
    expect(JSON.stringify(pageData.body)).not.toMatch(/email|password/i);

    // A stranger lands on the page, then signs up: the signup is credited, the author hears.
    const stranger = request.agent(app);
    const landed = await stranger.get(`/a/${made.body.id}`).set("accept", "text/html").set("x-forwarded-for", "198.51.101.250");
    expect(String(landed.headers["set-cookie"] ?? "")).toContain("st_attr");
    const reg = await stranger.post("/api/auth/register").set("x-forwarded-for", "198.51.101.250")
      .send({ email: `artifact-stranger-${Date.now()}@example.test`, password: "Testpass123!", firstName: "Newcomer" });
    expect(reg.status).toBe(201);
    await settle();
    const [row] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.id, made.body.id));
    expect(row.signups).toBe(1);
    const [u] = await db.select({ landing: users.signupLandingPath }).from(users).where(eq(users.id, reg.body.id));
    expect(u.landing).toBe(`/a/${made.body.id}`);
    const bell = (await author.agent.get("/api/notifications")).body.items as any[];
    expect(bell.find((x) => x.kind === "artifact_signup")).toMatchObject({ text: "Newcomer joined SparkTower from your artifact", href: `/projects/${project.id}/manage` });

    // The newcomer starts their own path and publishes their first artifact.
    const newcomer = { agent: stranger, id: reg.body.id };
    const theirs = await finishedStep(newcomer, "Newcomer Path");
    await stranger.patch(`/api/kanban/${theirs.step.id}`).send({ status: "done", description: "Budget travel plans for students." }).expect(200);
    const a2 = (await stranger.post(`/api/projects/${theirs.project.id}/path/tasks/${theirs.step.id}/artifact`)).body;
    expect((await stranger.post(`/api/artifacts/${a2.id}/publish`).send({ title: "My first product statement" })).status).toBe(200);
    expect((await request(app).get(`/api/public/artifacts/${a2.id}`)).status).toBe(200);

    // Someone who'd been here before (first page wasn't the artifact) is still credited by the artifact they signed up from.
    const returning = request.agent(app);
    await returning.get("/").set("accept", "text/html").set("x-forwarded-for", "198.51.101.251");
    await returning.post("/api/auth/register").set("x-forwarded-for", "198.51.101.251")
      .send({ email: `artifact-returning-${Date.now()}@example.test`, password: "Testpass123!", firstName: "Returning", fromArtifact: made.body.id }).expect(201);
    expect((await db.select().from(pathArtifacts).where(eq(pathArtifacts.id, made.body.id)))[0].signups).toBe(2);

    // Unpublishing takes the page down.
    await author.agent.post(`/api/artifacts/${made.body.id}/unpublish`).expect(200);
    expect((await request(app).get(`/api/public/artifacts/${made.body.id}`)).status).toBe(404);
  });

  it("won't publish a private project's artifacts, and making it private takes the page down", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Private");
    const { project, step } = await finishedStep(owner, "Hidden Path");
    await owner.agent.patch(`/api/kanban/${step.id}`).send({ status: "done", description: "A plan worth keeping quiet." }).expect(200);
    const a = (await owner.agent.post(`/api/projects/${project.id}/path/tasks/${step.id}/artifact`)).body;
    await owner.agent.post(`/api/artifacts/${a.id}/publish`).send({ title: "A product statement, briefly public" }).expect(200);
    expect((await request(app).get(`/api/public/artifacts/${a.id}`)).status).toBe(200);

    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, project.id));
    expect((await request(app).get(`/api/public/artifacts/${a.id}`)).status).toBe(404);
    expect((await owner.agent.post(`/api/artifacts/${a.id}/publish`).send({ title: "A product statement, again" })).body.code).toBe("project_private");
  });
});
