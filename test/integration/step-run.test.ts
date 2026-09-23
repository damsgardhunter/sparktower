/**
 * Doing a step leaves something behind.
 *
 * The artifact — the page a step's answer becomes — was built by a separate
 * action, in a dialog somebody had to know to open. So the work the growth
 * loop runs on existed only for the people who already knew about it, and a
 * step finished on Tuesday became shareable on Thursday if at all.
 *
 * What's checked here is the part the browser test can't do cheaply: that the
 * first few milestones of *every* path produce a real artifact from a real
 * answer, attached to the task that made it, and that publishing one produces
 * the feed post and the public page together — because a page nobody is told
 * about is not a loop.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { feedPosts, pathArtifacts } from "@shared/schema";
import { mainLineMilestones, resolveTree } from "@shared/phase-trees";
import type { ProjectGoal } from "@shared/goals";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;

async function builder(app: any) {
  const agent = request.agent(app);
  n += 1;
  const email = `steprun-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.220.${(n % 200) + 20}`)
    .send({ email, password, firstName: `S${n}` });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 200)}`).toBe(201);
  await verifyEmail(app, email);
  return agent;
}

const project = (agent: any, goal: ProjectGoal, subcategory: string) =>
  agent.post("/api/projects").send({
    title: `Step run ${Date.now()}-${n}`, description: "A project whose steps should leave something behind.",
    category: "saas", goal, subcategory,
  });

/**
 * One step, run the way the card runs it: write the answer, mark it done, then
 * make the artifact from it. The last call is the one the UI now makes at the
 * end of every completion rather than later and separately.
 */
async function runStep(agent: any, projectId: string, backboneId: string, answer: string) {
  const tasks = (await agent.get(`/api/projects/${projectId}/kanban`)).body;
  const task = tasks.find((t: any) => t.tags?.includes(`backbone:${backboneId}`));
  expect(task, `a task for ${backboneId}`).toBeTruthy();

  const done = await agent.patch(`/api/kanban/${task.id}`).send({ status: "done", description: answer });
  expect(done.status, JSON.stringify(done.body).slice(0, 200)).toBe(200);

  const made = await agent.post(`/api/projects/${projectId}/path/tasks/${task.id}/artifact`).send({});
  expect(made.status, JSON.stringify(made.body).slice(0, 200)).toBe(200);
  return { taskId: task.id as string, artifact: made.body };
}

const PATHS: { goal: ProjectGoal; subcategory: string; answer: string }[] = [
  { goal: "ship_mvp", subcategory: "saas", answer: "A week of dinners planned from what is already in the fridge, for people who cook on weeknights." },
  { goal: "systemize_business", subcategory: "restaurant", answer: "Opening runs off one checklist: fridge temperatures, prep list, float counted, specials written up." },
  // Run a company — the third path. This row used to be raise_funding, which
  // folded into Systemize and would now walk the same milestones as the row
  // above it, leaving "every path" covering two of the three.
  { goal: "run_company", subcategory: "software", answer: "The week runs off one rhythm: Monday the numbers, Wednesday the customers we lost, Friday what shipped." },
];

describe("the first steps of every path leave something behind", () => {
  for (const { goal, subcategory, answer } of PATHS) {
    it(`makes an artifact from each of the first three ${goal} milestones`, async () => {
      const app = await getTestApp();
      const agent = await builder(app);
      const id = (await project(agent, goal, subcategory)).body.id;
      const main = mainLineMilestones(resolveTree(goal, subcategory));

      for (const milestone of main.slice(0, 3)) {
        const { taskId, artifact } = await runStep(agent, id, milestone.id, `${answer} (${milestone.title})`);

        expect(artifact.id, `${milestone.id} produced an artifact`).toBeTruthy();
        expect(artifact.taskId, "attached to the step that made it").toBe(taskId);
        expect(artifact.backboneId).toBe(milestone.id);
        expect(String(artifact.body), "built from what was written, not from the milestone's own blurb").toContain(answer.slice(0, 20));
        expect(artifact.visibility, "made, not published — that is a second decision").toBe("private");

        // Stored once per task, however many times the step is re-run.
        const again = await agent.post(`/api/projects/${id}/path/tasks/${taskId}/artifact`).send({});
        expect(again.body.id, "re-running a step updates its artifact rather than making a second").toBe(artifact.id);
        const rows = await db.select().from(pathArtifacts).where(eq(pathArtifacts.taskId, taskId));
        expect(rows.length).toBe(1);
      }
    }, 240_000);
  }

  it("refuses to invent a page for a step with nothing written on it", async () => {
    const app = await getTestApp();
    const agent = await builder(app);
    const id = (await project(agent, "ship_mvp", "saas")).body.id;
    const tasks = (await agent.get(`/api/projects/${id}/kanban`)).body;
    const first = tasks.find((t: any) => t.tags?.includes("backbone:SHIP.M1.1"));

    await agent.patch(`/api/kanban/${first.id}`).send({ status: "done" });
    const made = await agent.post(`/api/projects/${id}/path/tasks/${first.id}/artifact`).send({});
    expect(made.status).toBe(400);
    expect(made.body.code, "the card offers the writing box instead").toBe("artifact_empty");
  }, 120_000);
});

describe("publishing is the continuation, not a separate errand", () => {
  it("puts the page up, posts it to the feed, and the post points at the page", async () => {
    const app = await getTestApp();
    const agent = await builder(app);
    const id = (await project(agent, "ship_mvp", "saas")).body.id;
    const { artifact } = await runStep(agent, id, "SHIP.M1.1", PATHS[0].answer);

    const published = await agent.post(`/api/artifacts/${artifact.id}/publish`)
      .send({ title: "What we decided to build first", tags: ["ship", "cooking"] });
    expect(published.status, JSON.stringify(published.body).slice(0, 200)).toBe(200);
    expect(published.body.url).toBe(`/a/${artifact.id}`);

    const [row] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.id, artifact.id));
    expect(row.visibility).toBe("public");
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(row.publishedPostId, "and a post went out with it").toBeTruthy();

    const [post] = await db.select().from(feedPosts).where(eq(feedPosts.id, row.publishedPostId!));
    expect(post.entityType).toBe("path_artifact");
    expect(post.entityId, "the post points at the page").toBe(artifact.id);
    expect(post.content).toContain("What we decided to build first");

    // And a stranger can read it, with no account and no session.
    const stranger = request.agent(app);
    const page = await stranger.get(`/api/public/artifacts/${artifact.id}`);
    expect(page.status).toBe(200);
    expect(page.body.title).toBe("What we decided to build first");
    expect(page.body.path.goal).toBe("ship_mvp");
  }, 180_000);

  it("takes the page down with the post, so nothing outlives the decision", async () => {
    const app = await getTestApp();
    const agent = await builder(app);
    const id = (await project(agent, "ship_mvp", "saas")).body.id;
    const { artifact } = await runStep(agent, id, "SHIP.M1.1", PATHS[0].answer);
    await agent.post(`/api/artifacts/${artifact.id}/publish`).send({ title: "Up for a moment", tags: [] });

    const down = await agent.post(`/api/artifacts/${artifact.id}/unpublish`).send({});
    expect(down.status).toBe(200);
    const stranger = request.agent(app);
    expect((await stranger.get(`/api/public/artifacts/${artifact.id}`)).status).toBe(404);
  }, 180_000);
});
