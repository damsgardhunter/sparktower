/**
 * Being findable: robots.txt and the sitemap.
 *
 * The page itself already renders its title and preview tags, so a pasted link
 * looks right. This is the other half — a crawler being told the page exists —
 * and the thing worth pinning is that the sitemap and the page agree. A URL in
 * the sitemap that answers 404 is worse than no sitemap: every artifact that
 * was unpublished, made private or hidden has to disappear from both together.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { feedPosts, pathArtifacts, projects } from "@shared/schema";

afterAll(async () => {
  await closeTestApp();
  delete process.env.PUBLIC_URL;
  process.env.NODE_ENV = "test";
});

const password = "Testpass123!";
let n = 0;
const ip = () => `198.51.110.${20 + (n++ % 200)}`;

/** A builder who finishes their first step and publishes it — the loop, through the real endpoints. */
async function publishedArtifact(app: any, title: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `sitemap-${Date.now()}-${n}@example.test`;
  expect((await agent.post("/api/auth/register").set("x-forwarded-for", ip()).send({ email, password, firstName: "Site" })).status).toBe(201);
  await verifyEmail(app, email, ip());
  await agent.post("/api/profile/complete-onboarding").send({ displayName: "Site Map", headline: "Here", bio: "Publishing." });
  const project = await agent.post("/api/projects").send({ title, description: "A project whose first step gets published.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
  const tasks = await agent.get(`/api/projects/${project.body.id}/kanban`);
  const step = tasks.body.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
  expect((await agent.patch(`/api/kanban/${step.id}`).send({ status: "done", description: "What this project is, in one line." })).status).toBe(200);
  const artifact = await agent.post(`/api/projects/${project.body.id}/path/tasks/${step.id}/artifact`).send({});
  const published = await agent.post(`/api/artifacts/${artifact.body.id}/publish`).send({ title, tags: ["positioning"] });
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  return { agent, projectId: project.body.id as string, artifactId: artifact.body.id as string, postId: published.body.postId as string, url: published.body.url as string };
}

describe("robots.txt", () => {
  it("keeps a preview or a laptop out of the index entirely", async () => {
    const app = await getTestApp();
    delete process.env.PUBLIC_URL;
    process.env.NODE_ENV = "test";
    const res = await request(app).get("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text.trim()).toBe("User-agent: *\nDisallow: /");
  });

  it("on the real site, opens the public pages, shuts the rest, and names the sitemap", async () => {
    const app = await getTestApp();
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_URL = "https://sparktower.example";
    try {
      const res = await request(app).get("/robots.txt");
      expect(res.text).toContain("Allow: /a/");
      expect(res.text).toContain("Sitemap: https://sparktower.example/sitemap.xml");
      // An invite token in a search index would be a one-time credential in a search index.
      for (const shut of ["/api/", "/invite/", "/admin/", "/objects/", "/settings/"]) {
        expect(res.text, shut).toContain(`Disallow: ${shut}`);
      }
    } finally {
      process.env.NODE_ENV = "test";
      delete process.env.PUBLIC_URL;
    }
  });
});

describe("the sitemap", () => {
  it("lists a published artifact, at the address it actually has, and drops it the moment the page would 404", async () => {
    const app = await getTestApp();
    process.env.PUBLIC_URL = "https://sparktower.example";
    try {
      const live = await publishedArtifact(app, `Listed ${Date.now()}`);
      const loc = `https://sparktower.example${live.url}`;

      const first = await request(app).get("/sitemap.xml");
      expect(first.status).toBe(200);
      expect(first.headers["content-type"]).toMatch(/xml/);
      expect(first.text).toContain("<loc>https://sparktower.example/</loc>");
      expect(first.text).toContain(`<loc>${loc}</loc>`);
      expect(first.text).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
      // Listed means readable: no account, no 404.
      expect((await request(app).get(`/api/public/artifacts/${live.artifactId}`)).status).toBe(200);

      // Hidden by a moderator: the page 404s, so the sitemap must stop listing it.
      await db.update(feedPosts).set({ hiddenAt: new Date() }).where(eq(feedPosts.id, live.postId));
      expect((await request(app).get(`/api/public/artifacts/${live.artifactId}`)).status).toBe(404);
      expect((await request(app).get("/sitemap.xml")).text).not.toContain(loc);
      await db.update(feedPosts).set({ hiddenAt: null }).where(eq(feedPosts.id, live.postId));
      expect((await request(app).get("/sitemap.xml")).text).toContain(loc);

      // The project made private: same again.
      await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, live.projectId));
      expect((await request(app).get(`/api/public/artifacts/${live.artifactId}`)).status).toBe(404);
      expect((await request(app).get("/sitemap.xml")).text).not.toContain(loc);
      await db.update(projects).set({ isPrivate: false }).where(eq(projects.id, live.projectId));

      // Unpublished: same again.
      await db.update(pathArtifacts).set({ visibility: "private" }).where(eq(pathArtifacts.id, live.artifactId));
      expect((await request(app).get(`/api/public/artifacts/${live.artifactId}`)).status).toBe(404);
      expect((await request(app).get("/sitemap.xml")).text).not.toContain(loc);
    } finally {
      delete process.env.PUBLIC_URL;
    }
  }, 60_000);

  it("never lists an artifact that was only generated, not published", async () => {
    const app = await getTestApp();
    process.env.PUBLIC_URL = "https://sparktower.example";
    try {
      const live = await publishedArtifact(app, `Draft ${Date.now()}`);
      // A second step, generated and left alone: it has a page id, but no page.
      const tasks = await live.agent.get(`/api/projects/${live.projectId}/kanban`);
      const step = tasks.body.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.3"));
      await live.agent.patch(`/api/kanban/${step.id}`).send({ status: "done", description: "The loops we're betting on." });
      const draft = await live.agent.post(`/api/projects/${live.projectId}/path/tasks/${step.id}/artifact`).send({});
      expect(draft.status).toBe(200);

      const map = await request(app).get("/sitemap.xml");
      expect(map.text).not.toContain(`/a/${draft.body.id}`);
      expect((await request(app).get(`/api/public/artifacts/${draft.body.id}`)).status).toBe(404);
    } finally {
      delete process.env.PUBLIC_URL;
    }
  }, 60_000);
});
