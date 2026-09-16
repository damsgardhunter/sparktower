/**
 * Deleting your own post, when other people are in the thread.
 *
 * `feed_comments` and `feed_reactions` cascade from `feed_posts`, so deleting
 * the row deletes other people's words with it. That's right when nobody
 * replied and wrong the moment somebody did — the same reason a comment with
 * replies under it keeps its row and loses its text.
 *
 * So: nothing to lose, the row goes; somebody replied, the author's words go
 * and the thread stays. Either way the author's own content is gone, which is
 * what they asked for.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db, pool } from "../../server/db";
import { feedPosts } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
let n = 0;
const ip = () => `198.51.113.${20 + (n++ % 200)}`;

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `postdel-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  expect((await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email, password, firstName: first })).status).toBe(201);
  await verifyEmail(app, email, ip());
  await agent.post("/api/profile/complete-onboarding").send({ displayName: `${first} Poster`, headline: "Here", bio: "Posting." });
  return { agent, email };
}

const post = async (agent: any, content: string) => {
  const res = await agent.post("/api/feed").send({ postType: "project_update", content });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.id as string;
};

describe("deleting your own post", () => {
  it("takes the row with it when nobody else is in the thread", async () => {
    const app = await getTestApp();
    const author = await person(app, "Alone");
    const id = await post(author.agent, `Nobody replied to this ${Date.now()}`);
    // The author's own comment doesn't hold it open: it's theirs to delete too.
    expect((await author.agent.post(`/api/feed/${id}/comments`).send({ content: "A note to myself." })).status).toBe(200);

    const res = await author.agent.delete(`/api/feed/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.thread).toBe("deleted");
    expect((await pool.query("SELECT 1 FROM feed_posts WHERE id = $1", [id])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM feed_comments WHERE post_id = $1", [id])).rowCount).toBe(0);
  });

  it("keeps what other people wrote, and loses only the author's words", async () => {
    const app = await getTestApp();
    const author = await person(app, "Author");
    const reader = await person(app, "Reader");
    const content = `Shipped the week generator ${Date.now()}`;
    const id = await post(author.agent, content);
    expect((await author.agent.post(`/api/feed/${id}/react`).send({ reaction: "like" })).status).toBe(200);
    const reply = await reader.agent.post(`/api/feed/${id}/comments`).send({ content: "How did you handle leftovers?" });
    expect(reply.status).toBe(200);

    const res = await author.agent.delete(`/api/feed/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.thread).toBe("kept");

    // The post is still a row, with nothing of the author's left on it.
    const [row] = await db.select().from(feedPosts).where(eq(feedPosts.id, id));
    expect(row.deletedAt).toBeTruthy();
    expect(row.content).toBe("");
    expect(row.mediaUrls).toEqual([]);
    expect(row.asks).toEqual([]);
    // And the reader's comment is exactly where they left it.
    const comments = await reader.agent.get(`/api/feed/${id}/comments`);
    expect(comments.status).toBe(200);
    const list = Array.isArray(comments.body) ? comments.body : comments.body.comments ?? [];
    expect(list.map((c: any) => c.content)).toContain("How did you handle leftovers?");

    // It's out of the feeds, and nothing new joins it.
    const feed = await reader.agent.get("/api/feed?limit=50");
    expect((feed.body.posts ?? []).some((p: any) => p.id === id)).toBe(false);
    expect(JSON.stringify(feed.body)).not.toContain(content);
    const late = await reader.agent.post(`/api/feed/${id}/comments`).send({ content: "One more thought" });
    expect(late.status).toBe(410);
    expect(late.body.code).toBe("post_deleted");
    expect((await reader.agent.post(`/api/feed/${id}/react`).send({ reaction: "like" })).status).toBe(410);
  });

  it("is still only the author's to delete, and only once", async () => {
    const app = await getTestApp();
    const author = await person(app, "Owner");
    const stranger = await person(app, "Stranger");
    const id = await post(author.agent, `Not yours to delete ${Date.now()}`);
    expect((await stranger.agent.post(`/api/feed/${id}/comments`).send({ content: "Interesting." })).status).toBe(200);

    expect((await stranger.agent.delete(`/api/feed/${id}`)).status).toBe(404);
    expect((await db.select().from(feedPosts).where(eq(feedPosts.id, id)))[0].deletedAt).toBeNull();

    expect((await author.agent.delete(`/api/feed/${id}`)).body.thread).toBe("kept");
    // Deleting it again changes nothing and says so.
    expect((await author.agent.delete(`/api/feed/${id}`)).status).toBe(404);
  });
});
