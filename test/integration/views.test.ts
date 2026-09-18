/**
 * What a view is, now that it means something.
 *
 * `projects.views` counted every `GET /api/projects/:id` — the route the
 * owner's own dashboard reads, which the client refetches. In the production
 * database that produced 450 views on a project two people had ever opened,
 * one of them the owner; 81 on one with no outside visitor at all. It was shown
 * as social proof and ranked the views leaderboard.
 *
 * And profile views were not recorded anywhere, so there was no number to be
 * wrong.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { projects } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.140.${20 + (n++ % 200)}`;
const password = "Testpass123!";

async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `views-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip())
    .send({ email, password, firstName: first });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { agent, id: res.body.id as string, email };
}

const viewsOf = async (projectId: string) =>
  (await db.select({ views: projects.views }).from(projects).where(eq(projects.id, projectId)))[0]?.views ?? 0;

describe("what counts as a project view", () => {
  it("ignores the owner reading their own dashboard, however many times", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const made = await owner.agent.post("/api/projects").send({
      title: "Own Dashboard", description: "A project its owner keeps open in a tab all day.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    expect(made.status).toBeLessThan(300);
    const id = made.body.id as string;

    for (let i = 0; i < 5; i++) expect((await owner.agent.get(`/api/projects/${id}`)).status).toBe(200);
    expect(await viewsOf(id), "your own visits are not an audience").toBe(0);
  });

  it("counts a stranger once a day, not once a refresh", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Author");
    const made = await owner.agent.post("/api/projects").send({
      title: "Read By Someone", description: "A project somebody else opens, and then opens again.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    const id = made.body.id as string;

    const reader = await person(app, "Reader");
    for (let i = 0; i < 4; i++) expect((await reader.agent.get(`/api/projects/${id}`)).status).toBe(200);
    expect(await viewsOf(id), "one person reading four times is one visit").toBe(1);

    // A second person is a second visit.
    const another = await person(app, "Another");
    await another.agent.get(`/api/projects/${id}`);
    expect(await viewsOf(id)).toBe(2);
  });

  it("doesn't count a crawler", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Crawled");
    const made = await owner.agent.post("/api/projects").send({
      title: "Crawled Project", description: "Something a bot will fetch while indexing the site.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    });
    const id = made.body.id as string;

    await request(app).get(`/api/projects/${id}`)
      .set("user-agent", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
    await request(app).get(`/api/projects/${id}`).set("user-agent", "curl/8.4.0");
    expect(await viewsOf(id)).toBe(0);
  });
});

describe("profile views, which were not recorded at all", () => {
  it("counts somebody looking at your profile, once, and never your own visits", async () => {
    const app = await getTestApp();
    const me = await person(app, "Looked");
    const visitor = await person(app, "Visitor");

    // Reading your own profile is not somebody looking at it.
    for (let i = 0; i < 3; i++) await me.agent.get(`/api/users/${me.id}`);
    expect((await me.agent.get(`/api/users/${me.id}`)).body.views).toBe(0);

    // Somebody else, twice, is one viewer.
    await visitor.agent.get(`/api/users/${me.id}`);
    await visitor.agent.get(`/api/users/${me.id}`);
    expect((await me.agent.get(`/api/users/${me.id}`)).body.views).toBe(1);

    const third = await person(app, "Third");
    await third.agent.get(`/api/users/${me.id}`);
    expect((await me.agent.get(`/api/users/${me.id}`)).body.views).toBe(2);
  });
});
