/**
 * Comments on a post as a thread: replies to any comment, reactions on any
 * comment, deleting without breaking the thread, and reporting a comment
 * through to a reviewer taking it down.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { users } from "@shared/schema";
import { passMfa } from "../helpers/mfa";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${120 + (n % 100)}`)
    .send({ email: `thread-${first}-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}
const byContent = (rows: any[], text: string) => rows.find((c) => c.content === text);

describe("comment threads on posts", () => {
  it("replies to replies, reacts to comments, and keeps the thread when a comment with replies is deleted", async () => {
    const app = await getTestApp();
    const ada = await person(app, "Ada");
    const ben = await person(app, "Ben");
    const post = (await ada.agent.post("/api/feed").send({ postType: "project_update", content: "Shipped search." })).body;
    const other = (await ada.agent.post("/api/feed").send({ postType: "project_update", content: "Another post." })).body;

    let rows = (await ben.agent.post(`/api/feed/${post.id}/comments`).send({ content: "Search is fast" })).body;
    const top = byContent(rows, "Search is fast");
    rows = (await ada.agent.post(`/api/feed/${post.id}/comments`).send({ content: "Thanks! Anything missing?", parentCommentId: top.id })).body;
    const reply = byContent(rows, "Thanks! Anything missing?");
    rows = (await ben.agent.post(`/api/feed/${post.id}/comments`).send({ content: "Filters by date", parentCommentId: reply.id })).body;
    expect(byContent(rows, "Filters by date").parentCommentId).toBe(reply.id);
    expect(reply.parentCommentId).toBe(top.id);

    // A reply has to hang off a comment on the same post.
    expect((await ben.agent.post(`/api/feed/${other.id}/comments`).send({ content: "Wrong thread", parentCommentId: top.id })).body.field).toBe("parentCommentId");

    // Reactions: set, change, take back — counted on the comment, and yours comes back as yours.
    expect((await ada.agent.post(`/api/feed/comments/${top.id}/react`).send({ reaction: "insightful" })).body).toEqual({ reactionCount: 1, viewerReaction: "insightful" });
    await ben.agent.post(`/api/feed/comments/${top.id}/react`).send({ reaction: "like" }).expect(200);
    expect((await ada.agent.post(`/api/feed/comments/${top.id}/react`).send({ reaction: "celebrate" })).body).toEqual({ reactionCount: 2, viewerReaction: "celebrate" });
    let seen = byContent((await ada.agent.get(`/api/feed/${post.id}/comments`)).body, "Search is fast");
    expect(seen).toMatchObject({ reactionCount: 2, viewerReaction: "celebrate" });
    expect(seen.reactionBreakdown).toEqual(expect.arrayContaining([{ reaction: "celebrate", count: 1 }, { reaction: "like", count: 1 }]));
    expect((await ada.agent.post(`/api/feed/comments/${top.id}/react`).send({ reaction: "celebrate" })).body).toEqual({ reactionCount: 1, viewerReaction: null });
    expect((await ada.agent.post(`/api/feed/comments/${top.id}/react`).send({ reaction: "shrug" })).status).toBe(400);

    // Deleting a comment that has replies leaves a placeholder; one without replies just goes.
    await ada.agent.delete(`/api/feed/comments/${reply.id}`).expect(200);
    rows = (await ben.agent.get(`/api/feed/${post.id}/comments`)).body;
    expect(rows.find((c: any) => c.id === reply.id)).toMatchObject({ deleted: true, content: "" });
    expect(byContent(rows, "Filters by date").parentCommentId).toBe(reply.id);
    expect((await ben.agent.post(`/api/feed/${post.id}/comments`).send({ content: "Too late", parentCommentId: reply.id })).status).toBe(400);
    expect((await ben.agent.post(`/api/feed/comments/${reply.id}/react`).send({ reaction: "like" })).status).toBe(404);
    const leaf = byContent(rows, "Filters by date");
    await ben.agent.delete(`/api/feed/comments/${leaf.id}`).expect(200);
    expect((await ben.agent.get(`/api/feed/${post.id}/comments`)).body.some((c: any) => c.id === leaf.id)).toBe(false);
  });

  it("reports a comment, and a reviewer's takedown hides it from everyone but its author", async () => {
    const app = await getTestApp();
    const author = await person(app, "Poster");
    const troll = await person(app, "Troll");
    const reader = await person(app, "Reader");
    const mod = await person(app, "Mod");
    await db.update(users).set({ platformRole: "reviewer" }).where(eq(users.id, mod.id));
    // Review tools need a second factor on the session (server/mfa.ts).
    await passMfa(mod.agent);

    const post = (await author.agent.post("/api/feed").send({ postType: "project_update", content: "Launched today." })).body;
    const bad = byContent((await troll.agent.post(`/api/feed/${post.id}/comments`).send({ content: "This is garbage, like you" })).body, "This is garbage, like you");

    expect((await troll.agent.post("/api/reports").send({ targetType: "feed_comment", targetId: bad.id, reason: "abuse", detail: "targets_other" })).status).toBe(400);
    const sent = await reader.agent.post("/api/reports").send({ targetType: "feed_comment", targetId: bad.id, reason: "abuse", detail: "targets_other" });
    expect(sent.status).toBe(200);

    const queue = (await mod.agent.get("/api/admin/reports?type=feed_comment")).body;
    const report = queue.find((r: any) => r.targetId === bad.id);
    expect(report).toMatchObject({ targetType: "feed_comment", targetHidden: false, targetPostId: post.id, snapshot: "This is garbage, like you", note: "It's aimed at someone else" });

    await mod.agent.post(`/api/admin/content/feed_comment/${bad.id}/hide`).send({ reason: "Personal attack" }).expect(200);
    expect((await reader.agent.get(`/api/feed/${post.id}/comments`)).body.some((c: any) => c.id === bad.id)).toBe(false);
    expect((await troll.agent.get(`/api/feed/${post.id}/comments`)).body.find((c: any) => c.id === bad.id)).toMatchObject({ hidden: true, hiddenReason: "Personal attack" });
    expect((await reader.agent.post(`/api/feed/${post.id}/comments`).send({ content: "Replying anyway", parentCommentId: bad.id })).status).toBe(400);
    expect((await mod.agent.get("/api/admin/reports?type=feed_comment")).body.find((r: any) => r.targetId === bad.id).targetHidden).toBe(true);

    await mod.agent.post(`/api/admin/content/feed_comment/${bad.id}/restore`).send({}).expect(200);
    expect((await reader.agent.get(`/api/feed/${post.id}/comments`)).body.some((c: any) => c.id === bad.id)).toBe(true);
  });
});
