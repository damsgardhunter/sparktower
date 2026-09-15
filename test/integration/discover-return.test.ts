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
import { eq, inArray, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { recordActivity } from "../../server/analytics";
import { db } from "../../server/db";
import { activityEvents, exploreSeen, feedPosts, projects } from "@shared/schema";
import { passMfa } from "../helpers/mfa";

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
    // Written in order through the server's own recorder. The actions among
    // these are recorded by their endpoints in the product (and refused by
    // /api/track); this is about the counting, so the rows are laid down directly.
    const send = async (session: string, names: string[]) => {
      for (const name of names) {
        await recordActivity({ name, visitorId: `vis-${session}`, sessionId: session, path: "/discover", props: { source: "discover" } });
      }
    };

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
    // The owner's console needs a second factor on the session (server/mfa.ts).
    await passMfa(owner);
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

describe("what's new, remembered on the server", () => {
  /** Remembered as looked at `minutes` ago — the server's own record, written the way an older browser hands one over. */
  const lookedAt = (agent: any, kind: string, id: string, minutes: number) =>
    agent.post("/api/discover/seen").send({ items: [{ kind, id, at: Date.now() - minutes * 60_000 }] });

  it("feeds the cards and the badge from what you looked at, on any device, and a Discover visit clears the badge", async () => {
    const app = await getTestApp();
    const [ari, bea] = [await person(app), await person(app)];
    await db.delete(feedPosts).where(eq(feedPosts.authorId, bea.id));

    // Nothing looked at: nothing new, and a badge of zero.
    expect((await ari.agent.get("/api/discover/new-count")).body).toMatchObject({ count: 0, updates: [] });

    // Ari opens Bea's profile (on one device); Bea posts twice.
    expect((await ari.agent.post("/api/discover/seen").send({ kind: "builder", id: bea.id })).body).toEqual({ remembered: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect((await bea.agent.post("/api/feed").send({ postType: "project_update", content: "Shipped reminders today." })).status).toBe(200);
    expect((await bea.agent.post("/api/feed").send({ postType: "project_update", content: "And streaks, finally." })).status).toBe(200);

    // Any device asks with nothing remembered locally, and gets the news.
    const updates = (await ari.agent.get("/api/discover/updates")).body.updates;
    expect(updates).toEqual([expect.objectContaining({ kind: "builder", id: bea.id, newPosts: 2 })]);
    const badge = (await ari.agent.get("/api/discover/new-count")).body;
    expect(badge).toMatchObject({ count: 2, more: false, lastVisitAt: null });
    expect(badge.updates[0]).toMatchObject({ id: bea.id, newPosts: 2 });

    // Opening Discover clears the badge; the card keeps its news until Bea's profile is opened.
    await ari.agent.post("/api/discover/visit").expect(200);
    expect((await ari.agent.get("/api/discover/new-count")).body).toMatchObject({ count: 0 });
    expect((await ari.agent.get("/api/discover/updates")).body.updates[0].newPosts).toBe(2);

    // A new post after the visit brings the badge back.
    await new Promise((r) => setTimeout(r, 20));
    await bea.agent.post("/api/feed").send({ postType: "project_update", content: "Dark mode is live." }).expect(200);
    expect((await ari.agent.get("/api/discover/new-count")).body.count).toBe(1);

    // Opening her profile again: nothing is new on the card any more.
    await ari.agent.post("/api/discover/seen").send({ kind: "builder", id: bea.id }).expect(200);
    expect((await ari.agent.get("/api/discover/updates")).body.updates).toEqual([]);
  });

  it("remembers what you act on, not just what you open", async () => {
    const app = await getTestApp();
    const [ari, bea] = [await person(app), await person(app)];
    const project = (await bea.agent.post("/api/projects").send({
      title: "Plant Swap", description: "A small app for swapping cuttings with neighbours nearby.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;
    await db.delete(feedPosts).where(eq(feedPosts.authorId, bea.id));

    // Following the project is enough — the follow endpoint remembers it.
    await ari.agent.post(`/api/projects/${project}/follow`).send({ following: true }).expect(200);
    await new Promise((r) => setTimeout(r, 50));
    await bea.agent.post("/api/feed").send({ postType: "project_update", content: "First swap happened!", projectId: project }).expect(200);
    const badge = (await ari.agent.get("/api/discover/new-count")).body;
    expect(badge.updates).toEqual([expect.objectContaining({ kind: "project", id: project, name: "Plant Swap", newPosts: 1 })]);
  });

  it("takes an older browser's memory once, without overwriting newer records or trusting its clock", async () => {
    const app = await getTestApp();
    const [ari, bea, cai] = [await person(app), await person(app), await person(app)];
    await db.delete(feedPosts).where(inArray(feedPosts.authorId, [bea.id, cai.id]));
    await post(bea.id, 30);   // after Ari looked at Bea (an hour ago): news
    await post(cai.id, 30);   // but Ari's browser claims to have seen Cai in the future: clamped to now, so not news

    expect((await lookedAt(ari.agent, "builder", bea.id, 60)).body).toEqual({ remembered: 1 });
    await ari.agent.post("/api/discover/seen").send({ items: [
      { kind: "builder", id: cai.id, at: Date.now() + 86_400_000 },
      { kind: "builder", id: ari.id, at: Date.now() - 60_000 },  // yourself: ignored
      { kind: "nonsense", id: bea.id, at: 1 },                   // not a kind: dropped
    ] }).expect(200);
    const ids = (await ari.agent.get("/api/discover/updates")).body.updates.map((u: any) => u.id);
    expect(ids).toEqual([bea.id]);

    // An old claim never rolls back a newer record: Ari has since opened Bea's profile.
    await ari.agent.post("/api/discover/seen").send({ kind: "builder", id: bea.id }).expect(200);
    await lookedAt(ari.agent, "builder", bea.id, 120);
    expect((await ari.agent.get("/api/discover/updates")).body.updates).toEqual([]);

    // Bad input and no account.
    expect((await ari.agent.post("/api/discover/seen").send({ kind: "builder", id: "../etc" })).status).toBe(400);
    expect((await request(app).post("/api/discover/seen").send({ kind: "builder", id: bea.id })).status).toBe(401);
    expect((await request(app).get("/api/discover/new-count")).status).toBe(401);
  });

  it("keeps only the most recent thirty, and the visit apart from them", async () => {
    const app = await getTestApp();
    const ari = await person(app);
    const items = Array.from({ length: 35 }, (_, i) => ({ kind: "project", id: `p-${i}`, at: Date.now() - (35 - i) * 60_000 }));
    await ari.agent.post("/api/discover/visit").expect(200);
    for (const item of items) await ari.agent.post("/api/discover/seen").send({ items: [item] }).expect(200);
    const rows = await db.select().from(exploreSeen).where(eq(exploreSeen.userId, ari.id));
    expect(rows.filter((r) => r.kind === "project")).toHaveLength(30);
    expect(rows.filter((r) => r.kind === "project").map((r) => r.targetId)).not.toContain("p-0");
    expect(rows.filter((r) => r.kind === "discover")).toHaveLength(1);
    // Neither call is logged as an action in the behaviour stream.
    const logged = await db.select().from(activityEvents).where(eq(activityEvents.userId, ari.id));
    expect(logged.filter((e) => /\/api\/discover\/(seen|visit)/.test(e.path))).toHaveLength(0);
  });
});
