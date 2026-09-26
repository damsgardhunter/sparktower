/**
 * What happens around a company when its people change: closing an account
 * never takes the company with it, the Run project's team follows the
 * company's, invite links can be taken back, and a deleted company's posts
 * don't reappear under their authors' names.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { makeVerifiedCompany } from "../helpers/company";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { deleteAccount } from "../../server/account-data";
import { CHALLENGE_FEE_CENTS, MIN_PRIZE_CENTS } from "@shared/challenges-money";
import {
  companies, companyAuditLog, companyChallenges, companyFollows, companyMembers, feedPosts,
  projectMembers, projects, recruitInvites, users,
} from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function player(app: any, firstName = `L${n + 1}`) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.154.${(n % 200) + 20}`;
  const email = `life-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, email };
}

async function company(app: any) {
  const owner = await player(app, "Olive");
  const made = await makeVerifiedCompany(owner.agent, "Acme Widgets");
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return { owner, companyId: made.body.company.id as string };
}

const roleOf = async (companyId: string, userId: string) =>
  (await db.select({ role: companyMembers.role }).from(companyMembers)
    .where(and(eq(companyMembers.companyId, companyId), eq(companyMembers.userId, userId))))[0]?.role ?? null;
const onProject = async (projectId: string, userId: string) =>
  (await db.select({ role: projectMembers.role }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId))))[0]?.role ?? null;
const linkToken = async (by: any, companyId: string, role = "member") => {
  const res = await by.agent.post(`/api/companies/${companyId}/invite-link`).send({ role });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.token as string;
};

describe("closing an account", () => {
  it("hands a company to its longest-serving admin, keeps what the owner made, and keeps the Run project with the company", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const [member, admin, laterAdmin] = [await player(app, "Mo"), await player(app, "Ada"), await player(app, "Abe")];
    for (const p of [member, admin, laterAdmin]) await owner.agent.post(`/api/companies/${companyId}/members`).send({ identifier: p.email }).expect(201);
    await owner.agent.patch(`/api/companies/${companyId}/members/${admin.id}`).send({ role: "admin" }).expect(200);
    await owner.agent.patch(`/api/companies/${companyId}/members/${laterAdmin.id}`).send({ role: "admin" }).expect(200);
    const run = await owner.agent.post(`/api/companies/${companyId}/run-project`);
    expect(run.status, run.text).toBe(200);
    const projectId = run.body.project.id as string;
    /*
     * A challenge now carries a real prize, held by SparkTower, and the fee
     * and the prize leave the balance together — so the owner has to have the
     * money before they can post one. This test is about what happens to a
     * company when its owner closes their account; the prize is a fixture.
     */
    await db.update(users).set({ balanceCents: CHALLENGE_FEE_CENTS + MIN_PRIZE_CENTS }).where(eq(users.id, owner.id));
    const challenge = await owner.agent.post(`/api/companies/${companyId}/challenges`).send({
      title: "Cut our returns rate", brief: "We ship furniture and a fifth of it comes back. Show us a way to cut that.",
      terms: "Winners are paid within 30 days of the announcement.", deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      prizeCents: MIN_PRIZE_CENTS,
    });
    expect(challenge.status, challenge.text).toBe(201);

    await deleteAccount(owner.id, { keepPosts: false });

    const [still] = await db.select().from(companies).where(eq(companies.id, companyId));
    expect(still).toBeTruthy();
    expect(await roleOf(companyId, owner.id)).toBeNull();
    // The admin who joined first, not the member who joined before them.
    expect(await roleOf(companyId, admin.id)).toBe("owner");
    expect(await roleOf(companyId, laterAdmin.id)).toBe("admin");
    expect(await roleOf(companyId, member.id)).toBe("member");
    expect((await db.select().from(companyChallenges).where(eq(companyChallenges.id, challenge.body.id)))).toHaveLength(1);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project.ownerId).toBe(admin.id);
    expect(await onProject(projectId, admin.id)).toBe("Owner");
    const log = await db.select().from(companyAuditLog).where(and(eq(companyAuditLog.companyId, companyId), eq(companyAuditLog.action, "owner_succeeded")));
    expect(log[0]?.targetUserId).toBe(admin.id);
  }, 180_000);

  it("falls back to the longest-serving member, and removes a company nobody is left in", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const [first, second] = [await player(app), await player(app)];
    await owner.agent.post(`/api/companies/${companyId}/members`).send({ identifier: first.email }).expect(201);
    await owner.agent.post(`/api/companies/${companyId}/members`).send({ identifier: second.email }).expect(201);
    await deleteAccount(owner.id, { keepPosts: false });
    expect(await roleOf(companyId, first.id)).toBe("owner");
    expect(await roleOf(companyId, second.id)).toBe("member");

    const alone = await company(app);
    await deleteAccount(alone.owner.id, { keepPosts: false });
    expect(await db.select().from(companies).where(eq(companies.id, alone.companyId))).toHaveLength(0);
  }, 120_000);

  it("keeps the company's rows when a creator's user row is removed outright", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const target = await player(app);
    const [creator] = await db.insert(users).values({ email: `gone-${Date.now()}@example.test`, firstName: "Gone" }).returning();
    await db.update(companies).set({ createdBy: creator.id }).where(eq(companies.id, companyId));
    const [c] = await db.insert(companyChallenges).values({
      companyId, title: "A challenge", brief: "x".repeat(40), terms: "Terms.", deadline: new Date(Date.now() + 86_400_000),
      status: "open", createdBy: creator.id, createdAt: new Date(),
    }).returning();
    const [p] = await db.insert(projects).values({ title: "Watched", description: "A project.", category: "SaaS", ownerId: owner.id } as any).returning();
    await db.insert(companyFollows).values({ companyId, projectId: p.id, createdBy: creator.id, createdAt: new Date() });
    await db.insert(recruitInvites).values({ companyId, userId: target.id, sentBy: creator.id, message: "Hello there, shall we talk?", status: "sent", createdAt: new Date() });

    await db.delete(users).where(eq(users.id, creator.id));

    expect((await db.select().from(companies).where(eq(companies.id, companyId)))[0].createdBy).toBeNull();
    expect((await db.select().from(companyChallenges).where(eq(companyChallenges.id, c.id)))[0].createdBy).toBeNull();
    expect((await db.select().from(companyFollows).where(eq(companyFollows.companyId, companyId)))[0].createdBy).toBeNull();
    expect((await db.select().from(recruitInvites).where(eq(recruitInvites.companyId, companyId)))[0].sentBy).toBeNull();
  }, 120_000);
});

describe("the Run project follows the company's team", () => {
  it("puts people on it when they join and takes them off when they go, and never loses the project with its owner", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const run = await owner.agent.post(`/api/companies/${companyId}/run-project`);
    expect(run.status, run.text).toBe(200);
    const projectId = run.body.project.id as string;

    // Added directly, then by link.
    const [added, linked, coOwner] = [await player(app), await player(app), await player(app)];
    await owner.agent.post(`/api/companies/${companyId}/members`).send({ identifier: added.email }).expect(201);
    expect(await onProject(projectId, added.id)).toBe("Member");
    await linked.agent.post("/api/company-invites/accept").send({ token: await linkToken(owner, companyId) }).expect(200);
    expect(await onProject(projectId, linked.id)).toBe("Member");
    expect((await added.agent.get(`/api/projects/${projectId}/rhythm`)).status).toBe(200);

    // A role change carries across.
    await owner.agent.patch(`/api/companies/${companyId}/members/${added.id}`).send({ role: "admin" }).expect(200);
    expect(await onProject(projectId, added.id)).toBe("Admin");

    // Removed, and left: off the project, and can no longer read the numbers.
    await owner.agent.delete(`/api/companies/${companyId}/members/${added.id}`).expect(200);
    expect(await onProject(projectId, added.id)).toBeNull();
    expect((await added.agent.get(`/api/projects/${projectId}/rhythm`)).status).toBe(404);
    await linked.agent.delete(`/api/companies/${companyId}/members/${linked.id}`).expect(200);
    expect(await onProject(projectId, linked.id)).toBeNull();

    // The project's owner leaving hands it to the company's next owner.
    await owner.agent.post(`/api/companies/${companyId}/members`).send({ identifier: coOwner.email }).expect(201);
    await owner.agent.patch(`/api/companies/${companyId}/members/${coOwner.id}`).send({ role: "owner" }).expect(200);
    await owner.agent.delete(`/api/companies/${companyId}/members/${owner.id}`).expect(200);
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(project.ownerId).toBe(coOwner.id);
    expect(await onProject(projectId, coOwner.id)).toBe("Owner");
    expect(await onProject(projectId, owner.id)).toBeNull();
  }, 180_000);
});

describe("taking invite links back", () => {
  it("retires every earlier link on a reset, and on a removal, so a removed person can't walk back in", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const [a, b, c] = [await player(app), await player(app), await player(app)];

    const old = await linkToken(owner, companyId);
    await owner.agent.post(`/api/companies/${companyId}/invite-link/reset`).expect(200);
    const refused = await a.agent.post("/api/company-invites/accept").send({ token: old });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe("invite_not_found");
    const log = (await owner.agent.get(`/api/companies/${companyId}/audit`).expect(200)).body.entries;
    expect(log[0]).toMatchObject({ action: "invite_links_reset", actorName: "Olive" });

    // A fresh link works; the person it let in is removed, and it no longer does.
    const fresh = await linkToken(owner, companyId);
    await b.agent.post("/api/company-invites/accept").send({ token: fresh }).expect(200);
    await owner.agent.delete(`/api/companies/${companyId}/members/${b.id}`).expect(200);
    expect((await b.agent.post("/api/company-invites/accept").send({ token: fresh })).status).toBe(404);
    expect(await roleOf(companyId, b.id)).toBeNull();

    // A plain member can't reset them.
    await c.agent.post("/api/company-invites/accept").send({ token: await linkToken(owner, companyId) }).expect(200);
    expect((await c.agent.post(`/api/companies/${companyId}/invite-link/reset`)).status).toBe(403);
  }, 120_000);
});

describe("deleting a company", () => {
  it("deletes its posts rather than leaving them under their authors' names", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const posted = await owner.agent.post(`/api/companies/${companyId}/posts`).send({ content: `We are hiring ${Date.now()}` });
    expect(posted.status, posted.text).toBe(200);
    const before = await db.select().from(feedPosts).where(eq(feedPosts.companyId, companyId));
    expect(before).toHaveLength(1);
    await owner.agent.delete(`/api/companies/${companyId}`).expect(200);
    expect(await db.select().from(feedPosts).where(eq(feedPosts.id, before[0].id))).toHaveLength(0);
  }, 120_000);
});
