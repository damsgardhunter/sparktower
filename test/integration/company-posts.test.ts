/**
 * Posting on the feed in a company's name.
 *
 * A company post is an ordinary feed post written by a person and shown as the
 * company, so it is held to everything a person's post is — the email gate,
 * the limits, the duplicate check — and only people the company trusted with
 * "post as the company" may write one. These run against the real app.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { companies, companyMembers, companyAuditLog, feedPosts } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, firstName: string, { verified = true } = {}) {
  n += 1;
  const agent = request.agent(app);
  const ip = `198.51.157.${(n % 200) + 20}`;
  const email = `cpost-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  if (verified) await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

/** A company made straight in the database, with each person's role and powers set exactly. */
async function company(members: { id: string; role: "owner" | "admin" | "member"; permissions?: string[] }[]) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [row] = await db.insert(companies).values({
    name: `Northwind ${suffix}`, slug: `northwind-${suffix}`, createdBy: members[0].id, createdAt: new Date(),
  }).returning();
  await db.insert(companyMembers).values(members.map((m) => ({
    companyId: row.id, userId: m.id, role: m.role, permissions: m.permissions ?? [], joinedAt: new Date(),
  })));
  return row;
}

const unique = (what: string) => `${what} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("posting as a company", () => {
  it("lets a member with the power post, and the feed shows the company as the poster", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owen");
    const writer = await person(app, "Wren");
    const co = await company([{ id: owner.id, role: "owner" }, { id: writer.id, role: "member", permissions: ["post_as_company"] }]);

    const content = unique("We opened our second warehouse this week");
    const res = await writer.agent.post(`/api/companies/${co.id}/posts`).send({ content });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Written by the person, shown as the company; general unless it says otherwise.
    expect(res.body).toMatchObject({ authorId: writer.id, companyId: co.id, projectId: null, postType: "project_update", company: { id: co.id, name: co.name, slug: co.slug } });

    // The feed and the post's own page both carry the company, alongside everything they carried before.
    const feed = await owner.agent.get("/api/feed?limit=50");
    expect(feed.status).toBe(200);
    const inFeed = feed.body.posts.find((p: any) => p.id === res.body.id);
    expect(inFeed).toBeTruthy();
    expect(inFeed.company).toEqual({ id: co.id, name: co.name, slug: co.slug });
    expect(inFeed.author.id).toBe(writer.id);
    const own = await request(app).get(`/api/feed/${res.body.id}`);
    expect(own.status).toBe(200);
    expect(own.body.company).toEqual({ id: co.id, name: co.name, slug: co.slug });

    // A person's own post says it isn't a company's.
    const mine = await owner.agent.post("/api/feed").send({ postType: "project_update", content: unique("Just me, posting") });
    expect(mine.status).toBe(200);
    expect(mine.body.company).toBeNull();

    // And the company has it written down.
    const log = await db.select().from(companyAuditLog).where(and(eq(companyAuditLog.companyId, co.id), eq(companyAuditLog.action, "post_published")));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: writer.id, detail: { postId: res.body.id } });
  }, 120_000);

  it("refuses a member without the power (403) and a stranger (404)", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Oona");
    const member = await person(app, "Milo");
    const stranger = await person(app, "Stan");
    const co = await company([{ id: owner.id, role: "owner" }, { id: member.id, role: "member", permissions: ["recruit"] }]);

    const refused = await member.agent.post(`/api/companies/${co.id}/posts`).send({ content: unique("Not mine to say") });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "missing_power", power: "post_as_company" });

    const hidden = await stranger.agent.post(`/api/companies/${co.id}/posts`).send({ content: unique("Who are you") });
    expect(hidden.status).toBe(404);
    expect((await stranger.agent.get(`/api/companies/${co.id}/posts`)).status).toBe(404);

    expect(await db.select().from(feedPosts).where(eq(feedPosts.companyId, co.id))).toHaveLength(0);
  }, 120_000);

  it("refuses an unconfirmed email, as posting as yourself does", async () => {
    const app = await getTestApp();
    const unconfirmed = await person(app, "Una", { verified: false });
    const co = await company([{ id: unconfirmed.id, role: "owner" }]);

    const personal = await unconfirmed.agent.post("/api/feed").send({ postType: "project_update", content: unique("Hello") });
    const asCompany = await unconfirmed.agent.post(`/api/companies/${co.id}/posts`).send({ content: unique("Hello") });
    expect(personal.status).toBe(403);
    expect(asCompany.status).toBe(403);
    expect(asCompany.body.code).toBe(personal.body.code);
    expect(asCompany.body.code).toBe("email_unverified");
  }, 120_000);

  it("holds a company post to the same duplicate check as a person's post", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Dora");
    const co = await company([{ id: owner.id, role: "owner" }]);

    // The check counts the person's posts, whichever name they were made under.
    const content = unique("Announcing our spring hiring round for engineers");
    expect((await owner.agent.post("/api/feed").send({ postType: "project_update", content })).status).toBe(200);
    const again = await owner.agent.post(`/api/companies/${co.id}/posts`).send({ content });
    expect(again.status).toBe(409);
    expect(again.body.action).toBe("feedPost");
  }, 120_000);

  it("won't put a company post on a project the poster isn't on", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Pia");
    const outsider = await person(app, "Quin");
    const project = await outsider.agent.post("/api/projects").send({ title: "Somebody Else's", description: "A project the poster is not on.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    expect(project.status, JSON.stringify(project.body)).toBeLessThan(300);
    const co = await company([{ id: owner.id, role: "owner" }]);

    const res = await owner.agent.post(`/api/companies/${co.id}/posts`).send({ content: unique("About their project"), projectId: project.body.id });
    expect(res.status).toBe(403);
  }, 120_000);
});

describe("the company's own posts", () => {
  it("lists them newest first for any member, with who wrote each, and pages", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Ada");
    const reader = await person(app, "Rae");
    const co = await company([{ id: owner.id, role: "owner" }, { id: reader.id, role: "member" }]);

    const ids: string[] = [];
    for (const what of ["First news", "Second news", "Third news"]) {
      const res = await owner.agent.post(`/api/companies/${co.id}/posts`).send({ content: unique(what) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      ids.push(res.body.id);
    }

    const page = await reader.agent.get(`/api/companies/${co.id}/posts?limit=2`);
    expect(page.status).toBe(200);
    expect(page.body.posts.map((p: any) => p.id)).toEqual([ids[2], ids[1]]);
    expect(page.body.posts[0].author.id).toBe(owner.id);
    expect(page.body.posts[0].company.id).toBe(co.id);
    // A plain member may read, not post or take down.
    expect(page.body).toMatchObject({ canPost: false, canRemoveOthers: false });
    expect(page.body.nextCursor).toBeTruthy();

    const next = await reader.agent.get(`/api/companies/${co.id}/posts?limit=2&before=${encodeURIComponent(page.body.nextCursor)}`);
    expect(next.status).toBe(200);
    expect(next.body.posts.map((p: any) => p.id)).toEqual([ids[0]]);
    expect(next.body.nextCursor).toBeNull();

    expect((await owner.agent.get(`/api/companies/${co.id}/posts`)).body).toMatchObject({ canPost: true, canRemoveOthers: true });
  }, 120_000);

  it("lets a leader remove a member's company post, but not a member without the power", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Lea");
    const writer = await person(app, "Wes");
    const bystander = await person(app, "Bea");
    const co = await company([
      { id: owner.id, role: "owner" },
      { id: writer.id, role: "member", permissions: ["post_as_company"] },
      { id: bystander.id, role: "member" },
    ]);
    const posted = await writer.agent.post(`/api/companies/${co.id}/posts`).send({ content: unique("Posted in error") });
    expect(posted.status).toBe(200);

    const refused = await bystander.agent.delete(`/api/companies/${co.id}/posts/${posted.body.id}`);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "missing_power", power: "post_as_company" });

    const removed = await owner.agent.delete(`/api/companies/${co.id}/posts/${posted.body.id}`);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(removed.body.thread).toBe("deleted");
    expect(await db.select().from(feedPosts).where(eq(feedPosts.id, posted.body.id))).toHaveLength(0);

    const log = await db.select().from(companyAuditLog).where(and(eq(companyAuditLog.companyId, co.id), eq(companyAuditLog.action, "post_removed")));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: owner.id, targetUserId: writer.id });

    // Only posts made in this company's name can be removed through it.
    const own = await writer.agent.post("/api/feed").send({ postType: "project_update", content: unique("My own words") });
    expect((await owner.agent.delete(`/api/companies/${co.id}/posts/${own.body.id}`)).status).toBe(404);
  }, 120_000);

  it("lets the author delete their own company post, either way", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Aya");
    const writer = await person(app, "Ari");
    const co = await company([{ id: owner.id, role: "owner" }, { id: writer.id, role: "member", permissions: ["post_as_company"] }]);

    const one = await writer.agent.post(`/api/companies/${co.id}/posts`).send({ content: unique("Take one") });
    const two = await writer.agent.post(`/api/companies/${co.id}/posts`).send({ content: unique("Take two") });
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);

    // As any post of theirs, from the feed…
    expect((await writer.agent.delete(`/api/feed/${one.body.id}`)).status).toBe(200);
    // …and from the company's page — even after the power was taken back.
    await db.update(companyMembers).set({ permissions: [] }).where(and(eq(companyMembers.companyId, co.id), eq(companyMembers.userId, writer.id)));
    expect((await writer.agent.delete(`/api/companies/${co.id}/posts/${two.body.id}`)).status).toBe(200);

    expect(await db.select().from(feedPosts).where(eq(feedPosts.companyId, co.id))).toHaveLength(0);
    const log = await db.select().from(companyAuditLog).where(and(eq(companyAuditLog.companyId, co.id), eq(companyAuditLog.action, "post_removed")));
    expect(log).toHaveLength(2);
  }, 120_000);
});
