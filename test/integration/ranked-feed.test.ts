/**
 * The ranked home feed, over the real route.
 *
 * The unit tests (test/unit/feed-ranking.test.ts) pin what the scoring does.
 * What can only be checked here is that ranking didn't break the feed around
 * it — and the thing most at risk is pagination. The feed pages on a cursor
 * taken from `created_at`, so if the cursor were read off the end of the
 * *ranked* list it would be some middling post's timestamp rather than the
 * oldest one, and the next page would silently skip everything between them.
 *
 * So: every post is delivered exactly once across pages, the timelines that
 * are meant to stay chronological still are, and a signed-out reader still
 * gets the plain timeline.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { feedPosts } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, profile: Record<string, unknown> = {}) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.101.${80 + (n % 100)}`)
    .send({ email: `rank-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: `R${n}` });
  expect(res.status).toBe(201);
  await verifyEmail(app, res.body.email, `198.51.106.${40 + (n % 150)}`);
  await agent.put("/api/profile").send({
    displayName: `Ranker ${n}`, headline: "Building things",
    skills: ["typescript"], interests: ["fintech"], experienceLevel: "intermediate", ...profile,
  });
  await agent.post("/api/profile/complete-onboarding").send({});
  return { agent, id: res.body.id as string };
}

/** A post at a chosen age, stamped by the database's clock like the app's own. */
const postAt = (authorId: string, content: string, minutesAgo: number) =>
  db.insert(feedPosts).values({
    authorId, postType: "project_update", content,
    createdAt: sql.raw(`now() - interval '${minutesAgo} minutes'`),
  } as any);

type Page = { posts: { id: string; createdAt: string }[]; nextCursor: string | null; ranked?: boolean };

const getFeed = async (agent: any, query = "") =>
  (await agent.get(`/api/feed?limit=5${query}`)).body as Page;

describe("the ranked feed", () => {
  /*
   * The regression this file exists for. Paging through with a cursor read off
   * a reordered page loses posts; paging with one read off the oldest post
   * doesn't.
   */
  it("pages without skipping or repeating a post, even though each page is reordered", async () => {
    const app = await getTestApp();
    const me = await person(app, { skills: ["payments", "postgres"], interests: ["fintech"] });
    const other = await person(app);

    // Twelve posts over two hours, alternating between relevant and not, so
    // ranking has real work to do inside every page.
    const made: string[] = [];
    for (let i = 0; i < 12; i++) {
      const relevant = i % 2 === 0;
      await postAt(other.id, relevant ? `payments postgres update ${i}` : `unrelated musing ${i}`, i * 10);
      made.push(relevant ? `payments postgres update ${i}` : `unrelated musing ${i}`);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page++) {
      const body: Page = await getFeed(me.agent, cursor ? `&before=${encodeURIComponent(cursor)}` : "");
      seen.push(...body.posts.map((p) => p.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }

    // Nothing delivered twice…
    expect(new Set(seen).size).toBe(seen.length);
    // …and every post made for this test arrived.
    const mine = new Set(made);
    const delivered = await db.select({ id: feedPosts.id, content: feedPosts.content }).from(feedPosts);
    const expected = delivered.filter((p) => mine.has(p.content!)).map((p) => p.id);
    for (const id of expected) expect(seen, `post ${id} was skipped by pagination`).toContain(id);
  });

  it("says when a page is ranked, and ranks for a signed-in reader", async () => {
    const app = await getTestApp();
    const me = await person(app);
    await postAt(me.id, "something to read", 5);
    expect((await getFeed(me.agent)).ranked).toBe(true);
  });

  /* A signed-out reader has no affinity to rank against: they get the timeline. */
  it("leaves a signed-out reader on the plain timeline", async () => {
    const app = await getTestApp();
    const body = (await request(app).get("/api/feed?limit=5")).body as Page;
    expect(body.ranked).toBe(false);
    const times = body.posts.map((p) => Date.parse(p.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  /*
   * A feed you asked for by name is a timeline, not a recommendation: a
   * project's own page, one author's posts, and Following all stay in time
   * order.
   */
  it("keeps a project's own feed, an author's feed and Following in time order", async () => {
    const app = await getTestApp();
    const me = await person(app, { skills: ["payments"] });
    const other = await person(app);

    const project = (await me.agent.post("/api/projects").send({
      title: "Ranked Feed Project", description: "A project whose own feed must stay chronological.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;

    for (let i = 0; i < 4; i++) {
      await postAt(other.id, i % 2 === 0 ? `payments note ${i}` : `sourdough note ${i}`, i * 15);
    }
    await me.agent.post("/api/feed").send({ postType: "project_update", projectId: project, content: "payments work" });

    const chronological = (body: Page) => {
      const times = body.posts.map((p) => Date.parse(p.createdAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      expect(body.ranked).toBe(false);
    };

    chronological(await getFeed(me.agent, `&projectId=${project}`));
    chronological(await getFeed(me.agent, `&authorId=${other.id}`));
    chronological(await getFeed(me.agent, "&scope=following"));
  });

  it("still returns a full page of posts — ranking reorders, it never drops any", async () => {
    const app = await getTestApp();
    const me = await person(app, { skills: ["payments"] });
    const other = await person(app);
    for (let i = 0; i < 8; i++) await postAt(other.id, `note ${i}`, i * 5);

    const body = await getFeed(me.agent);
    expect(body.posts).toHaveLength(5);
    expect(new Set(body.posts.map((p) => p.id)).size).toBe(5);
  });
});
