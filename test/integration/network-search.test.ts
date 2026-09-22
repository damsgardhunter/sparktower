/**
 * People search finds builders by what the search box promises — name,
 * display name, headline, skills, interests — never by email, and pages.
 * Sent connection requests are listable. A public project's milestones are
 * readable by visitors; a private project's only by its team.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { projects } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

const tag = `z${Date.now().toString(36)}`;
let n = 0;
async function person(app: any, firstName: string) {
  const agent = request.agent(app);
  n += 1;
  const email = `srch-${tag}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${170 + n}`)
    .send({ email, password: "Testpass123!", firstName, lastName: "Searcher" });
  expect(res.status).toBe(201);
  await verifyEmail(app, email, `198.51.104.${170 + n}`);
  return { agent, id: res.body.id as string, email };
}

describe("people search, sent requests and public milestones", () => {
  it("searches profiles by skill and headline, not email, and pages", async () => {
    const app = await getTestApp();
    const ada = await person(app, `Ada${tag}`);
    const bo = await person(app, `Bo${tag}`);
    const saved = await bo.agent.post("/api/profile").send({ headline: `Quantum ${tag} tinkerer`, skills: [`Rust${tag}`], interests: [] });
    expect([200, 201]).toContain(saved.status);

    /*
     * Signed in, because this is the member directory. Anonymous, with an
     * offset and a page of five hundred, it could be walked end to end by
     * anybody — and every row carried the whole profile, résumé link and work
     * history included. Discover's equivalent always required an account;
     * this was the way around it.
     */
    expect((await request(app).get(`/api/users/search?q=rust${tag}`)).status, "signed out gets nothing").toBe(401);

    const bySkill = (await ada.agent.get(`/api/users/search?q=rust${tag}`)).body;
    expect(bySkill.map((u: any) => u.id)).toEqual([bo.id]);
    // A card's worth of person, and no more: the history is on their profile, where asking for it is a visit.
    expect(bySkill[0].profile.headline).toContain("tinkerer");
    for (const field of ["resumeUrl", "experience", "education"]) {
      expect(bySkill[0].profile[field], field).toBeUndefined();
    }
    const byHeadline = (await ada.agent.get(`/api/users/search?q=${encodeURIComponent(`quantum ${tag}`)}`)).body;
    expect(byHeadline.map((u: any) => u.id)).toEqual([bo.id]);
    const byName = (await ada.agent.get(`/api/users/search?q=${encodeURIComponent(`ada${tag} searcher`)}`)).body;
    expect(byName.map((u: any) => u.id)).toEqual([ada.id]);
    expect((await ada.agent.get(`/api/users/search?q=${encodeURIComponent(ada.email)}`)).body).toEqual([]);
    expect((await ada.agent.get(`/api/users/search?q=%25`)).body.length).toBe(0);

    const page = (await ada.agent.get(`/api/users/search?q=${tag}&limit=1`)).body;
    expect(page.length).toBe(1);
    const next = (await ada.agent.get(`/api/users/search?q=${tag}&limit=1&offset=1`)).body;
    expect(next.length).toBe(1);
    expect(next[0].id).not.toBe(page[0].id);
  });

  it("lists requests you've sent until they're answered", async () => {
    const app = await getTestApp();
    const [me, them] = [await person(app, `Me${tag}`), await person(app, `Them${tag}`)];
    const sent = await me.agent.post("/api/connections/request").send({ userId: them.id });
    expect([200, 201]).toContain(sent.status);
    const list = (await me.agent.get("/api/connections/sent")).body;
    expect(list.map((c: any) => c.user.id)).toEqual([them.id]);
    expect(list[0].user.email).toBeUndefined();
    expect((await them.agent.get("/api/connections/sent")).body).toEqual([]);
  });

  it("shows a public project's milestones to visitors, a private one's only to the team", async () => {
    const app = await getTestApp();
    const [owner, visitor] = [await person(app, `Own${tag}`), await person(app, `Vis${tag}`)];
    const id = (await owner.agent.post("/api/projects").send({
      title: "Milestone Showcase", description: "A project whose milestones are on its public page.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;
    expect((await owner.agent.post(`/api/projects/${id}/milestones`).send({ title: "Beta live" })).status).toBeLessThan(300);

    const seen = await visitor.agent.get(`/api/projects/${id}/milestones`);
    expect(seen.status).toBe(200);
    expect(seen.body.some((m: any) => m.title === "Beta live")).toBe(true);
    expect((await request(app).get(`/api/projects/${id}/milestones`)).status).toBe(200);

    await db.update(projects).set({ isPrivate: true } as any).where(eq(projects.id, id));
    expect((await visitor.agent.get(`/api/projects/${id}/milestones`)).status).toBe(404);
    expect((await owner.agent.get(`/api/projects/${id}/milestones`)).status).toBe(200);
  });
});
