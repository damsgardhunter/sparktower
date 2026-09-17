/**
 * One search across projects and people.
 *
 * Discover replaced three destinations, so this endpoint carries the browse
 * that used to live on /projects, the people list that used to live on
 * /matches, and the filtering both had. What's pinned here is the part that
 * would be quiet if it broke: the filters actually narrow, the counts are the
 * totals before the cut rather than the length of the page, and someone else's
 * private project never appears in a search no matter what you type.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { projects } from "@shared/schema";
import { eq } from "drizzle-orm";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any, skills: string[] = ["typescript"]) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.102.${(n % 200) + 20}`;
  const res = await agent.post("/api/auth/register")
    .set("x-forwarded-for", ip)
    .send({ email: `ds-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`, password: "Testpass123!", firstName: `S${n}` });
  expect(res.status).toBe(201);
  await verifyEmail(app, res.body.email, ip);
  // complete-onboarding only flips the flag; the searchable words — display
  // name, headline, skills — are written through the profile itself.
  await agent.post("/api/profile").send({
    displayName: `Searcher ${n}`, headline: "Builds things", bio: "Hello.", skills,
  });
  await agent.post("/api/profile/complete-onboarding").send({});
  return { agent, id: res.body.id as string };
}

async function project(agent: any, over: Record<string, unknown> = {}) {
  const res = await agent.post("/api/projects").send({
    title: `Kite Weather ${Math.random().toString(36).slice(2, 8)}`,
    description: `A tool that ${Math.random().toString(36).slice(2, 10)} reads local wind forecasts and says whether it's worth going out.`,
    category: "Web App", goal: "ship_mvp", subcategory: "saas",
    ...over,
  });
  expect([200, 201]).toContain(res.status);
  return res.body;
}

const titles = (body: any) => body.projects.map((p: any) => p.title);

describe("discover search", () => {
  it("narrows by the words in a project, and by its category and stage", async () => {
    const app = await getTestApp();
    const owner = await builder(app);
    const seeker = await builder(app);

    const wind = await project(owner.agent, { title: `Anemometer ${Date.now()}`, oneLiner: "Wind data for kite surfers" });
    await project(owner.agent, { title: `Ledger ${Date.now()}`, category: "Fintech" });

    const hit = await seeker.agent.get(`/api/discover/search?q=${encodeURIComponent("anemometer")}`);
    expect(hit.status).toBe(200);
    expect(titles(hit.body)).toContain(wind.title);
    expect(hit.body.counts.projects).toBe(1);

    const byCategory = await seeker.agent.get("/api/discover/search?category=Fintech&kind=projects");
    expect(titles(byCategory.body)).not.toContain(wind.title);
    // kind=projects means the people half isn't even computed.
    expect(byCategory.body.people).toEqual([]);

    // Stage: everything starts in planning, so completed finds none of these.
    const completed = await seeker.agent.get("/api/discover/search?status=completed&kind=projects");
    expect(titles(completed.body)).not.toContain(wind.title);
  }, 60_000);

  it("never shows someone else's private project, however specific the search", async () => {
    const app = await getTestApp();
    const owner = await builder(app);
    const stranger = await builder(app);

    // Privacy is a paid feature, so the flag is set in the database rather than
    // through the API — what's under test is the search, not the plan gate.
    const secret = await project(owner.agent, { title: `Hushed ${Date.now()}` });
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, secret.id));
    const url = `/api/discover/search?q=${encodeURIComponent(secret.title)}`;

    const asOwner = await owner.agent.get(url);
    expect(titles(asOwner.body)).toContain(secret.title);

    const asStranger = await stranger.agent.get(url);
    expect(titles(asStranger.body)).not.toContain(secret.title);
    expect(asStranger.body.counts.projects).toBe(0);
  }, 60_000);

  it("finds people by what they can do, and never the person searching", async () => {
    const app = await getTestApp();
    const designer = await builder(app, ["figma", "illustration"]);
    const seeker = await builder(app, ["figma"]);

    const res = await seeker.agent.get("/api/discover/search?kind=people&q=illustration");
    expect(res.status).toBe(200);
    const ids = res.body.people.map((p: any) => p.id);
    expect(ids).toContain(designer.id);
    expect(ids).not.toContain(seeker.id);
    expect(res.body.projects).toEqual([]);
  }, 60_000);

  it("requires signing in", async () => {
    const app = await getTestApp();
    expect((await request(app).get("/api/discover/search?q=x")).status).toBe(401);
  });
});
