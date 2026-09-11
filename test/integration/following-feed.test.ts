/**
 * Following builders, and the feed made of who you follow.
 *
 * The step's named risk was that following changes nothing. What proves it
 * does: a follow is a state the server keeps (and a second click can't undo),
 * and the Following feed is exactly the posts by builders you follow and on
 * projects you follow — no one else's, and still not a private project's.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { feedPosts, projects } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${60 + n}`)
    .send({ email: `fol-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: `F${n}` });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}

/** A post stamped by the database's clock, as the app's own are. */
const post = (authorId: string, content: string, extra: Record<string, unknown> = {}) =>
  db.insert(feedPosts).values({ authorId, postType: "project_update", content, createdAt: sql.raw("now()"), ...extra } as any);

describe("following a builder", () => {
  it("is a state the server keeps — explicit, repeatable, and never of yourself", async () => {
    const app = await getTestApp();
    const [ari, bea] = [await person(app), await person(app)];
    const follow = (body?: object) => ari.agent.post(`/api/users/${bea.id}/follow`).send(body ?? {});

    expect((await follow({ following: true })).body).toEqual({ following: true, followers: 1 });
    expect((await follow({ following: true })).body).toEqual({ following: true, followers: 1 });   // twice is once
    expect((await ari.agent.get(`/api/users/${bea.id}/follow-status`)).body).toEqual({ following: true, followers: 1 });

    expect((await follow({ following: false })).body).toEqual({ following: false, followers: 0 });
    expect((await follow()).body.following).toBe(true);                                             // the toggle, for old callers

    expect((await ari.agent.post(`/api/users/${ari.id}/follow`).send({ following: true })).status).toBe(400);
    expect((await request(app).post(`/api/users/${bea.id}/follow`).send({ following: true })).status).toBe(401);
  });
});

describe("the Following feed", () => {
  it("is exactly who you follow — builders and projects — and still hides what you can't see", async () => {
    const app = await getTestApp();
    const [ari, bea, cai, dee] = [await person(app), await person(app), await person(app), await person(app)];
    const newProject = async (owner: typeof bea, title: string) => (await owner.agent.post("/api/projects").send({
      title, description: "A project with updates, for the Following feed test.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;
    const caisProject = await newProject(cai, "Cai's Project");
    const beasSecret = await newProject(bea, "Bea's Secret");
    await db.update(projects).set({ isPrivate: true } as any).where(eq(projects.id, beasSecret));
    // Creating a project announces it; clear those so the posts below are the whole story.
    await db.delete(feedPosts);

    const following = async () => (await ari.agent.get("/api/feed?scope=following")).body;

    // Before following anyone: nothing, and it knows why.
    expect(await following()).toMatchObject({ posts: [], followingCount: 0 });

    await ari.agent.post(`/api/users/${bea.id}/follow`).send({ following: true });
    await ari.agent.post(`/api/projects/${caisProject}/follow`).send({ following: true });

    await post(bea.id, "Bea: shipped reminders");                                  // a builder Ari follows
    await post(cai.id, "Cai: on the followed project", { projectId: caisProject }); // a project Ari follows
    await post(cai.id, "Cai: elsewhere");                                          // Cai himself isn't followed
    await post(dee.id, "Dee: a stranger");                                         // nobody Ari follows
    await post(bea.id, "Bea: on her private project", { projectId: beasSecret });  // followed builder, but private

    const feed = await following();
    expect(feed.posts.map((p: any) => p.content).sort()).toEqual(["Bea: shipped reminders", "Cai: on the followed project"]);
    expect(feed.followingCount).toBe(2);

    // Everyone still means everyone Ari can see.
    const everyone = (await ari.agent.get("/api/feed")).body.posts.map((p: any) => p.content);
    expect(everyone).toEqual(expect.arrayContaining(["Cai: elsewhere", "Dee: a stranger"]));
    expect(everyone).not.toContain("Bea: on her private project");
  });

  it("is only for someone signed in", async () => {
    const app = await getTestApp();
    expect((await request(app).get("/api/feed?scope=following")).status).toBe(401);
  });
});
