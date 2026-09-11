/**
 * Coming back to Discover: what counts as news, and how coming back is measured.
 *
 * Posts are stamped with the database's own clock here, exactly as real posts
 * are. An earlier version wrote their times from JavaScript and passed while
 * the feature was broken: on a database not running in UTC, a post's time
 * read back into JS is hours off, and only a database-stamped post shows it.
 *
 * The badge says "2 new posts since you last looked". Everything worth testing
 * is in what it must not count: posts from before you looked, a post on a
 * private project you're not in, a post a reviewer took down, and your own.
 * Those rules already live in the feed; this proves the badge goes through
 * them rather than around them. Then the repeat measure: sessions that went
 * open → act → back twice.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { activityEvents, feedPosts, projects } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${180 + n}`)
    .send({ email: `ret-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: `R${n}` });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}

/** A post stamped by the database's clock, `minutes` ago — the way the app's own posts are. */
const post = (authorId: string, minutes: number, extra: Record<string, unknown> = {}) =>
  db.insert(feedPosts).values({
    authorId, postType: "project_update", content: "An update.",
    createdAt: sql.raw(`now() - interval '${Number(minutes)} minutes'`), ...extra,
  } as any);

describe("what's new since you last looked", () => {
  it("counts posts since then, through the feed's own visibility rules", async () => {
    const app = await getTestApp();
    const [ari, bea] = [await person(app), await person(app)];
    const newProject = async (title: string) => (await bea.agent.post("/api/projects").send({
      title, description: "A project Bea posts updates about, for the return-loop test.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;
    const open = await newProject("Open Project");
    const closed = await newProject("Closed Project");
    await db.update(projects).set({ isPrivate: true } as any).where(eq(projects.id, closed));
    // Creating a project announces it in the feed ("Started building …"). Those
    // are real posts and would count; clear them so the posts below are the
    // whole story this test is telling.
    await db.delete(feedPosts).where(eq(feedPosts.authorId, bea.id));

    const seen = Date.now() - 60 * 60_000;                                // Ari looked an hour ago (a real instant)
    await post(bea.id, 90);                                               // before Ari looked: not news
    await post(bea.id, 5);                                                // news
    await post(bea.id, 4, { projectId: open });                           // news, on the open project
    await post(bea.id, 3, { projectId: closed });                         // private, Ari isn't in it: never counted
    await post(bea.id, 2, { hiddenAt: new Date() });                      // taken down: never counted
    await post(ari.id, 1, { projectId: open });                           // Ari's own: not news to Ari

    const t = [`builder.${bea.id}.${seen}`, `project.${open}.${seen}`, `project.${closed}.${seen}`, `builder.${ari.id}.${seen}`, "not-a-token"].join(",");
    const res = await ari.agent.get(`/api/discover/updates?t=${encodeURIComponent(t)}`);

    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.updates.map((u: any) => [`${u.kind}:${u.id}`, u]));
    expect(byKey[`builder:${bea.id}`].newPosts).toBe(2);
    expect(byKey[`project:${open}`]).toMatchObject({ newPosts: 1, name: "Open Project", more: false });
    // A private project Ari can't see says nothing — not even that it exists.
    expect(byKey[`project:${closed}`]).toBeUndefined();
    expect(byKey[`builder:${ari.id}`]).toBeUndefined();
    expect(res.body.updates).toHaveLength(2);
  });

  it("is for signed-in people, and ignores a clock from the future", async () => {
    const app = await getTestApp();
    const [ari, bea] = [await person(app), await person(app)];
    await post(bea.id, 1);
    expect((await request(app).get(`/api/discover/updates?t=builder.${bea.id}.${Date.now() - 60_000}`)).status).toBe(401);
    const future = await ari.agent.get(`/api/discover/updates?t=builder.${bea.id}.${Date.now() + 3_600_000}`);
    expect(future.body.updates).toEqual([]);
  });
});

describe("the repeat measure", () => {
  it("counts sessions that went open → act → back, and how many did it twice", async () => {
    const app = await getTestApp();
    let address = 40;
    const send = (session: string, names: string[]) => request(app).post("/api/track")
      .set("x-forwarded-for", `203.0.113.${address++}`)
      .set("Cookie", `st_vid=vis-${session}; st_sid=${session}`)
      .send({ events: names.map((name) => ({ name, path: "/discover", props: { source: "discover" } })) });

    // Twice round: open, follow, back; connect, back.
    await send("ses-twice", ["explore.open_discover", "explore.follow", "explore.open_discover", "explore.return_to_discover", "explore.connect_request", "explore.open_discover", "explore.return_to_discover"]);
    // Acted, never came back.
    await send("ses-once", ["explore.open_discover", "explore.follow"]);

    for (let i = 0; i < 60; i++) {
      const rows = await db.select().from(activityEvents);
      if (rows.filter((r) => r.name.startsWith("explore.")).length >= 9) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const owner = request.agent(app);
    await owner.get("/").set("Accept", "text/html");
    await owner.post("/api/auth/register").send({ email: "owner@test.local", password: "Testpass123!", firstName: "O", lastName: "W" });
    const summary = await owner.get("/api/admin/analytics/summary?days=7");
    expect(summary.status).toBe(200);
    expect(summary.body.explore.cycles).toEqual({ sessions: 2, completedOne: 1, twoPlus: 1, rate: 0.5 });
  });
});

describe("a post made a moment ago", () => {
  it("is news, whatever timezone the database runs in", async () => {
    const app = await getTestApp();
    const [ari, bea] = [await person(app), await person(app)];
    const lookedAt = Date.now() - 5_000;
    // Through the API, as a person would — stamped by the database's clock.
    expect((await bea.agent.post("/api/feed").send({ postType: "project_update", content: "Shipped reminders today." })).status).toBe(200);
    const res = await ari.agent.get(`/api/discover/updates?t=builder.${bea.id}.${lookedAt}`);
    expect(res.body.updates).toHaveLength(1);
    expect(res.body.updates[0].newPosts).toBe(1);
  });
});
