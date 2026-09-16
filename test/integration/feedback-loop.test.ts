/**
 * The build loop, end to end: a project posts an update with specific asks,
 * someone outside the team answers, the team sees it as new, turns it into a
 * task, finishes it, and credits it in the next update — and the person who
 * gave the feedback is told, once.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";

afterAll(async () => { await closeTestApp(); });

let address = 160;
async function signUp(app: any, name: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${address++}`)
    .send({ email: `fb-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: name });
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
  await verifyEmail(app, res.body.email, `203.0.114.${address++}`);
  return agent;
}

describe("publish a progress post and get feedback", () => {
  it("closes: asks → feedback → new → task → credited update → the commenter hears", async () => {
    const app = await getTestApp();
    const builder = await signUp(app, "Builder");
    const ada = await signUp(app, "Ada");
    const project = (await builder.post("/api/projects").send({
      title: "Loop Closer", description: "A meal planner that plans a week of dinners from the fridge.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;

    // Asks belong on a project's post, and have to be answerable.
    expect((await builder.post("/api/feed").send({ postType: "project_update", content: "Shipped it", asks: ["Would you use this weekly?"] })).body.field).toBe("projectId");
    expect((await builder.post("/api/feed").send({ postType: "project_update", content: "Shipped it", projectId: project.id, asks: ["ok?"] })).status).toBe(400);

    const post = await builder.post("/api/feed").send({
      postType: "project_update", projectId: project.id,
      content: "Shipped fridge scanning. It reads a photo into an inventory in about four seconds.",
      asks: ["Would you scan your fridge weekly?", "Is the plan screen clear, or does it need a shopping list first?"],
    });
    expect(post.status, JSON.stringify(post.body).slice(0, 300)).toBe(200);
    expect(post.body.asks).toHaveLength(2);
    expect(post.body.credits).toEqual([]);

    // The team talking isn't feedback; Ada is.
    await builder.post(`/api/feed/${post.body.id}/comments`).send({ content: "Note to self: check Android" });
    const commented = await ada.post(`/api/feed/${post.body.id}/comments`).send({ content: "Needs a shopping list before the plan — I don't cook from what I have." });
    expect(commented.status).toBe(200);
    const adaComment = commented.body.find((c: any) => !c.byTeam);
    const teamComment = commented.body.find((c: any) => c.byTeam);
    expect(adaComment.content).toMatch(/shopping list/);

    let inbox = (await builder.get(`/api/projects/${project.id}/feedback`)).body;
    expect(inbox.items.map((i: any) => [i.author.name, i.state, i.isNew])).toEqual([["Ada", "open", true]]);
    expect(inbox.counts).toMatchObject({ new: 1, open: 1, applied: 0, closed: 0 });
    expect((await ada.get(`/api/projects/${project.id}/feedback`)).status).toBe(403);

    await builder.post(`/api/projects/${project.id}/feedback/seen`).send({}).expect(200);
    expect((await builder.get(`/api/projects/${project.id}/feedback`)).body.counts.new).toBe(0);

    // Only the team acts on it, only on outside feedback, and twice is once.
    expect((await ada.post(`/api/feed/comments/${adaComment.id}/apply`).send({})).status).toBe(403);
    expect((await builder.post(`/api/feed/comments/${teamComment.id}/apply`).send({})).body.code).toBe("not_feedback");
    const applied = await builder.post(`/api/feed/comments/${adaComment.id}/apply`).send({});
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ created: true, task: { title: expect.stringMatching(/^Feedback from Ada: Needs a shopping list/) } });
    expect(applied.body.task.tags).toEqual(expect.arrayContaining(["source:feedback", `feedback:${adaComment.id}`]));
    expect((await builder.post(`/api/feed/comments/${adaComment.id}/apply`).send({})).body).toMatchObject({ created: false, task: { id: applied.body.task.id } });

    inbox = (await builder.get(`/api/projects/${project.id}/feedback`)).body;
    expect(inbox.counts).toMatchObject({ open: 0, applied: 1, readyToClose: 0 });
    await builder.patch(`/api/kanban/${applied.body.task.id}`).send({ status: "done" });
    expect((await builder.get(`/api/projects/${project.id}/feedback`)).body.counts.readyToClose).toBe(1);

    // Credit it in the next update. Unapplied, foreign or already-credited feedback is refused.
    expect((await builder.post("/api/feed").send({ postType: "project_update", projectId: project.id, content: "x", closesCommentIds: [teamComment.id] })).body.field).toBe("closesCommentIds");
    const update = await builder.post("/api/feed").send({
      postType: "project_update", projectId: project.id,
      content: "Added a shopping list that comes before the plan.", closesCommentIds: [adaComment.id],
      asks: ["Does the shopping list cover what you'd buy?"],
    });
    expect(update.status, JSON.stringify(update.body).slice(0, 300)).toBe(200);
    expect(update.body.credits).toEqual([{ commentId: adaComment.id, authorId: expect.any(String), name: "Ada" }]);
    expect((await builder.post("/api/feed").send({ postType: "project_update", projectId: project.id, content: "again", closesCommentIds: [adaComment.id] })).body.message).toMatch(/already credited/);
    expect((await builder.get(`/api/projects/${project.id}/feedback`)).body.counts).toMatchObject({ applied: 0, closed: 1 });

    // Ada hears, on her feed and in her bell — and is handed the update's own questions.
    const used = (await ada.get("/api/me/feedback-used")).body.items;
    expect(used).toEqual([expect.objectContaining({
      commentId: adaComment.id, project: { id: project.id, title: "Loop Closer" },
      update: expect.objectContaining({ id: update.body.id, asks: ["Does the shopping list cover what you'd buy?"] }),
    })]);
    expect((await builder.get("/api/me/feedback-used")).body.items).toEqual([]);
    await new Promise((r) => setTimeout(r, 400));
    const bell = (await ada.get("/api/notifications")).body.items;
    expect(bell.find((x: any) => x.kind === "feedback_used")).toMatchObject({
      text: "Builder used your feedback in an update on Loop Closer", href: `/posts/${update.body.id}`, read: false,
      excerpt: expect.stringMatching(/Needs a shopping list/),
    });

    // The loop comes round: answering the update puts the card away.
    await ada.post(`/api/feed/${update.body.id}/comments`).send({ content: "Yes — and it should group by aisle." }).expect(200);
    await new Promise((r) => setTimeout(r, 300));
    expect((await ada.get("/api/me/feedback-used")).body.items).toEqual([]);
    // Ada's answer is new feedback on the project: the next round of the loop.
    expect((await builder.get(`/api/projects/${project.id}/feedback`)).body.counts).toMatchObject({ new: 1, open: 1, closed: 1 });

    // And the comment on the first post shows its whole history.
    const thread = (await ada.get(`/api/feed/${post.body.id}/comments`)).body;
    expect(thread.find((c: any) => c.id === adaComment.id)).toMatchObject({ byTeam: false, closedByPostId: update.body.id, appliedTaskId: applied.body.task.id });
  });
});
