/**
 * Startup scouting, against a real database.
 *
 * What matters: a company can only ever follow what is already public; the
 * people who act for it hear when a followed project moves — once per thing
 * that happened, not once per time it was reported — and hear about new
 * public projects in the industries they watch, and never private ones.
 *
 * Companies are inserted directly: their own routes belong to another file.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { companies, companyMembers, notifications, projects } from "@shared/schema";
import { notifyScouts, notifyWatchersOfNewProject } from "../../server/scouting-alerts";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.191.${(n % 200) + 20}`;
  const email = `scout-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: first });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

async function company(name: string, owner: string, members: { id: string; role: "admin" | "member" }[] = []) {
  const [c] = await db.insert(companies).values({
    name, slug: `${name.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`, createdBy: owner, createdAt: new Date(),
  }).returning();
  await db.insert(companyMembers).values([
    { companyId: c.id, userId: owner, role: "owner", joinedAt: new Date() },
    ...members.map((m) => ({ companyId: c.id, userId: m.id, role: m.role, joinedAt: new Date() })),
  ]);
  return c;
}

async function project(who: { agent: any }, over: Record<string, unknown> = {}) {
  const res = await who.agent.post("/api/projects").send({
    title: "Fridge Planner", description: "Plans a week of dinners from what is already in your fridge.",
    category: "SaaS", goal: "ship_mvp", subcategory: "saas", ...over,
  });
  expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  return res.body;
}

const settle = () => new Promise((r) => setTimeout(r, 500));
const scoutRows = (userId: string, kind: "scout_update" | "scout_new_project") =>
  db.select().from(notifications).where(and(eq(notifications.recipientId, userId), eq(notifications.kind, kind)));

describe("following projects", () => {
  it("follows only public projects, guards who may, and lists what it follows with suggestions", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const member = await person(app, "Member");
    const stranger = await person(app, "Stranger");
    const founder = await person(app, "Founder");
    const acme = await company("Acme", owner.id, [{ id: member.id, role: "member" }]);

    const open = await project(founder);
    const other = await project(founder, { title: "Invoice Chaser", category: "Fintech" });
    // Made private after the fact: private projects are a paid entitlement, and the rule is the same either way.
    const hidden = await project(founder, { title: "Stealth" });
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, hidden.id));

    // Who may: a stranger learns nothing, a member may look but not act.
    expect((await stranger.agent.get(`/api/companies/${acme.id}/scouting`)).status).toBe(404);
    expect((await stranger.agent.post(`/api/companies/${acme.id}/follows/${open.id}`)).status).toBe(404);
    expect((await member.agent.post(`/api/companies/${acme.id}/follows/${open.id}`)).status).toBe(403);
    expect((await member.agent.put(`/api/companies/${acme.id}/watches`).send({ industries: ["Fintech"] })).status).toBe(403);

    await owner.agent.post(`/api/companies/${acme.id}/follows/${open.id}`).send({ note: "Could plug into our stores." }).expect(200);
    expect((await owner.agent.post(`/api/companies/${acme.id}/follows/${hidden.id}`)).status).toBe(404);
    expect((await owner.agent.post(`/api/companies/${acme.id}/follows/no-such-project`)).status).toBe(404);

    expect((await owner.agent.put(`/api/companies/${acme.id}/watches`).send({ industries: ["Not a thing"] })).status).toBe(400);
    const watched = await owner.agent.put(`/api/companies/${acme.id}/watches`).send({ industries: ["SaaS", "Fintech", "SaaS"] }).expect(200);
    expect(watched.body.watches).toEqual(["Fintech", "SaaS"]);

    const view = (await member.agent.get(`/api/companies/${acme.id}/scouting`).expect(200)).body;
    expect(view.watches).toEqual(["Fintech", "SaaS"]);
    expect(view.follows).toHaveLength(1);
    expect(view.follows[0]).toMatchObject({
      id: open.id, title: "Fridge Planner", category: "SaaS", goal: "ship_mvp", ownerName: "Founder",
      note: "Could plug into our stores.", milestonesDone: 0,
    });
    expect(view.follows[0].lastActivityAt).toBeTruthy();
    // Suggestions: public projects in watched industries it doesn't follow yet — never the private one.
    expect(view.suggestions.map((s: any) => s.id)).toEqual([other.id]);

    await owner.agent.delete(`/api/companies/${acme.id}/follows/${open.id}`).expect(200);
    expect((await owner.agent.get(`/api/companies/${acme.id}/scouting`)).body.follows).toEqual([]);
  });

  it("tells the company's people when a followed project moves, once per event", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const member = await person(app, "Member");
    const founder = await person(app, "Founder");
    const acme = await company("Acme", owner.id, [{ id: member.id, role: "member" }]);
    const p = await project(founder);
    await owner.agent.post(`/api/companies/${acme.id}/follows/${p.id}`).expect(200);

    // A path milestone finished.
    const tasks = (await founder.agent.get(`/api/projects/${p.id}/kanban`)).body;
    const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
    await founder.agent.patch(`/api/kanban/${step.id}`).send({ status: "done", description: "Plan a week of dinners from your fridge." }).expect(200);
    await settle();
    for (const who of [owner, member]) {
      const rows = await scoutRows(who.id, "scout_update");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ projectId: p.id, actorId: founder.id, targetId: `${acme.id}:${p.id}:step:${step.id}` });
      expect(rows[0].excerpt).toMatch(/^Fridge Planner: finished "/);
    }

    // Reopened and finished again: the same event, so nothing new.
    await founder.agent.patch(`/api/kanban/${step.id}`).send({ status: "todo" }).expect(200);
    await founder.agent.patch(`/api/kanban/${step.id}`).send({ status: "done" }).expect(200);
    await settle();
    expect(await scoutRows(owner.id, "scout_update")).toHaveLength(1);

    // An update posted on the project is a second event.
    const post = await founder.agent.post("/api/feed").send({ postType: "project_update", projectId: p.id, content: "Ten people planned their week with it." });
    expect(post.status, JSON.stringify(post.body).slice(0, 200)).toBe(200);
    await settle();
    const after = await scoutRows(member.id, "scout_update");
    expect(after).toHaveLength(2);
    expect(after.find((r) => r.targetId.endsWith(`post:${post.body.id}`))?.excerpt).toBe("Fridge Planner: Ten people planned their week with it.");

    // Reported twice, told once.
    await notifyScouts(p.id, { key: `post:${post.body.id}`, text: "again" });
    expect(await scoutRows(member.id, "scout_update")).toHaveLength(2);
  });

  it("tells watchers about a new public project in their industry, and never a private one", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const founder = await person(app, "Founder");
    const acme = await company("Acme", owner.id);
    const other = await company("Other", (await person(app, "Else")).id);
    await owner.agent.put(`/api/companies/${acme.id}/watches`).send({ industries: ["Fintech"] }).expect(200);

    const fin = await project(founder, { title: "Invoice Chaser", category: "Fintech", oneLiner: "Gets small firms paid on time." });
    await project(founder, { title: "Something Else", category: "Gaming" });
    await settle();
    const rows = await scoutRows(owner.id, "scout_new_project");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projectId: fin.id, targetId: `${acme.id}:${fin.id}`, excerpt: "Fintech: Invoice Chaser — Gets small firms paid on time." });
    expect(await db.select().from(notifications).where(and(eq(notifications.kind, "scout_new_project"), eq(notifications.targetId, `${other.id}:${fin.id}`)))).toHaveLength(0);

    // A private project in the same industry announces nothing.
    const hidden = await project(founder, { title: "Stealth Ledger", category: "Fintech" });
    await settle();
    await db.delete(notifications).where(eq(notifications.projectId, hidden.id));
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, hidden.id));
    await notifyWatchersOfNewProject(hidden.id);
    expect(await scoutRows(owner.id, "scout_new_project")).toHaveLength(1);

    // And a followed project that went private stops reporting.
    await owner.agent.post(`/api/companies/${acme.id}/follows/${fin.id}`).expect(200);
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, fin.id));
    await notifyScouts(fin.id, { key: "post:x", text: "should not be heard" });
    expect(await scoutRows(owner.id, "scout_update")).toHaveLength(0);
  });
});
