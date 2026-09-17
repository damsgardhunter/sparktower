/**
 * A project's inside is for the people on it.
 *
 * Membership is checked on most project routes, and the ones that forgot were
 * the ones that carried the most: the team's conversation with Nova, the plan
 * with the founder's private notes in it, and the board an AI call writes to.
 * Each of those took an id in the URL and a signed-in stranger was enough.
 *
 * This walks the same routes as an account with no part in the project.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { projects, projectKanbanTasks } from "@shared/schema";
import { verifyEmail } from "../helpers/verify-email";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `access-${first}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.113.${10 + n}`).send({ email, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  await verifyEmail(app, email, `198.51.114.${10 + n}`);
  return { agent, id: res.body.id as string };
}

describe("someone with no part in a project", () => {
  it("can't read its Nova chat, its path, or write to either", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const stranger = await person(app, "Stranger");
    const project = (await owner.agent.post("/api/projects").send({
      title: `Private Plans ${Date.now()}`,
      description: "A project whose plan and chat should stay with its team.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    // Notes only the founder should ever read.
    await db.update(projects).set({ novaNotes: "We're running out of money in March." }).where(eq(projects.id, project.id));

    // Reading.
    expect((await stranger.agent.get(`/api/projects/${project.id}/chat`)).status).toBe(403);
    const path = await stranger.agent.get(`/api/projects/${project.id}/path`);
    expect(path.status).toBe(403);
    expect(JSON.stringify(path.body)).not.toContain("running out of money");

    // Writing.
    expect((await stranger.agent.post(`/api/projects/${project.id}/chat`).send({ message: "Hello, whose project is this?" })).status).toBe(403);
    const before = (await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, project.id))).length;
    expect((await stranger.agent.post(`/api/projects/${project.id}/kanban/ai-generate`).send({})).status).toBe(403);
    expect((await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, project.id))).length, "a stranger's request wrote tasks to the board").toBe(before);

    // The team still has all of it.
    expect((await owner.agent.get(`/api/projects/${project.id}/chat`)).status).toBe(200);
    const theirs = await owner.agent.get(`/api/projects/${project.id}/path`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.novaNotes ?? "").toContain("running out of money");
  });

  it("can't react to a comment on a project they can't see", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Author");
    const stranger = await person(app, "Outsider");
    const project = (await owner.agent.post("/api/projects").send({
      title: `Quiet Thread ${Date.now()}`, description: "A private project with a comment on it.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    await owner.agent.post(`/api/projects/${project.id}/comments`).send({ targetType: "project", targetId: project.id, content: "A note to my team." });
    const [comment] = (await owner.agent.get(`/api/projects/${project.id}/comments?targetType=project&targetId=${project.id}`)).body;
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, project.id));

    const reacted = await stranger.agent.post(`/api/project-comments/${comment.id}/react`).send({});
    expect(reacted.status).toBe(404);
    // The author can still react to their own project's comments.
    expect((await owner.agent.post(`/api/project-comments/${comment.id}/react`).send({})).status).toBe(200);
  });
});
