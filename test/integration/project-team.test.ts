/**
 * Who is on a project's team, and what being on it (or not) lets you do.
 *
 * Each block here is a hole that was open: following saw through privacy; a
 * team could be joined but never left; a member could rewrite the owner's
 * brief through Nova; the owner could hand the project to anyone by PATCHing
 * `ownerId`; the team's working notes went out on every public read;
 * accepting an application fell over when the applicant was already in; and
 * a private project's donations were readable by anyone.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { projectApplications, projectInvites, projectMembers, projects, users } from "@shared/schema";
import { TEAM_ONLY_PROJECT_FIELDS } from "../../server/project-visibility";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `team-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.210.${10 + n}`).send({ email, password: "Testpass123!", firstName: first });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, `198.51.211.${10 + n}`);
  return { agent, id: res.body.id as string, email };
}

async function newProject(owner: { agent: any }, title: string) {
  const res = await owner.agent.post("/api/projects").send({
    title: `${title} ${Date.now()}`, description: "A project for the team-access tests.",
    category: "saas", goal: "ship_mvp", subcategory: "saas",
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { id: string; title: string };
}

const addMember = (projectId: string, userId: string) =>
  db.insert(projectMembers).values({ projectId, userId, role: "Engineer" });
const membersOf = (projectId: string, userId: string) =>
  db.select().from(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
const bell = async (who: { agent: any }) => {
  // notify() is fire-and-forget from the routes.
  await new Promise((r) => setTimeout(r, 300));
  return (await who.agent.get("/api/notifications")).body.items as any[];
};

const NOTES = "Runway ends in March; do not tell the team yet.";
async function withTeamNotes(projectId: string) {
  await db.update(projects).set({
    novaNotes: NOTES, rejectedLoops: ["referrals"], auditAutoApply: "all", activeBranch: "branch-build",
    landingPageConfig: { headline: "Draft headline" }, businessPlanUrl: "/objects/plan.pdf",
  }).where(eq(projects.id, projectId));
}

describe("following a project", () => {
  it("refuses a private project to anyone off its team, and the Following list shows only what the follower may see", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const member = await person(app, "Member");
    const stranger = await person(app, "Stranger");
    const project = await newProject(owner, "Followable");
    await withTeamNotes(project.id);
    await addMember(project.id, member.id);

    expect((await stranger.agent.post(`/api/projects/does-not-exist/follow`).send({ following: true })).status).toBe(404);

    // Public: anyone may follow, and gets the public projection back.
    expect((await stranger.agent.post(`/api/projects/${project.id}/follow`).send({ following: true })).status).toBe(200);
    expect((await member.agent.post(`/api/projects/${project.id}/follow`).send({ following: true })).status).toBe(200);
    let list = (await stranger.agent.get("/api/user/followed-projects")).body as any[];
    expect(list.map((f) => f.project.id)).toContain(project.id);
    for (const field of TEAM_ONLY_PROJECT_FIELDS) expect(list[0].project).not.toHaveProperty(field);
    expect(JSON.stringify(list)).not.toContain(NOTES);

    // Gone private: out of the stranger's list, still in the member's.
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, project.id));
    list = (await stranger.agent.get("/api/user/followed-projects")).body;
    expect(list.map((f) => f.project.id)).not.toContain(project.id);
    const theirs = (await member.agent.get("/api/user/followed-projects")).body as any[];
    expect(theirs.map((f) => f.project.id)).toContain(project.id);
    expect(JSON.stringify(theirs)).not.toContain(NOTES);

    // A new follow of a private project is a 404; letting go of an old one still works.
    const other = await person(app, "Other");
    expect((await other.agent.post(`/api/projects/${project.id}/follow`).send({ following: true })).status).toBe(404);
    const unfollow = await stranger.agent.post(`/api/projects/${project.id}/follow`).send({ following: false });
    expect(unfollow.status).toBe(200);
    expect(unfollow.body).toEqual({ following: false });
  });
});

describe("leaving and removing", () => {
  it("lets the owner remove anyone but themselves, anyone leave, revokes their invites, and tells the removed person", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const kept = await person(app, "Kept");
    const removed = await person(app, "Removed");
    const stranger = await person(app, "Stranger");
    const project = await newProject(owner, "Team Changes");
    await addMember(project.id, kept.id);
    await addMember(project.id, removed.id);

    // An invite the soon-removed member sent, and one addressed to them (to come back with).
    const sent = await removed.agent.post(`/api/projects/${project.id}/invites`).send({ role: "Engineer" });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    // The route won't invite someone already on the team, so this is the one left over from before they joined.
    const [toThemRow] = await db.insert(projectInvites).values({
      projectId: project.id, email: removed.email, role: "Engineer", tokenHash: `test-${Date.now()}-${Math.random()}`,
      expiresAt: new Date(Date.now() + 7 * 86_400_000), createdById: owner.id,
    }).returning();
    const toThem = { body: { invite: { id: toThemRow.id } } };
    const keptInvite = await kept.agent.post(`/api/projects/${project.id}/invites`).send({ role: "Designer" });
    expect(keptInvite.status).toBe(201);

    // Who may do what.
    expect((await stranger.agent.delete(`/api/projects/${project.id}/members/${kept.id}`)).status).toBe(403);
    expect((await kept.agent.delete(`/api/projects/${project.id}/members/${removed.id}`)).status).toBe(403);
    expect((await owner.agent.delete(`/api/projects/${project.id}/members/${owner.id}`)).body.code).toBe("owner_cannot_leave");
    expect((await owner.agent.delete(`/api/projects/${project.id}/members/${stranger.id}`)).status).toBe(404);

    const out = await owner.agent.delete(`/api/projects/${project.id}/members/${removed.id}`);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body).toMatchObject({ removed: true, userId: removed.id, left: false });
    expect(await membersOf(project.id, removed.id)).toHaveLength(0);

    // Their invites are revoked in the same step; a teammate's are left alone.
    const invites = await db.select().from(projectInvites).where(eq(projectInvites.projectId, project.id));
    const byId = new Map(invites.map((i) => [i.id, i]));
    expect(byId.get(sent.body.invite.id)?.revokedAt).toBeTruthy();
    expect(byId.get(toThem.body.invite.id)?.revokedAt).toBeTruthy();
    expect(byId.get(keptInvite.body.invite.id)?.revokedAt).toBeNull();

    // Told, and the link opens the project.
    const theirBell = await bell(removed);
    expect(theirBell.find((x) => x.kind === "project_removed")).toMatchObject({ href: `/projects/${project.id}`, text: expect.stringContaining(project.title) });

    // Leaving: themselves, no notification to anyone for it.
    const left = await kept.agent.delete(`/api/projects/${project.id}/members/${kept.id}`);
    expect(left.status).toBe(200);
    expect(left.body.left).toBe(true);
    expect(await membersOf(project.id, kept.id)).toHaveLength(0);
    expect((await bell(kept)).some((x) => x.kind === "project_removed")).toBe(false);
    // The owner is still on it.
    expect(await membersOf(project.id, owner.id)).toHaveLength(1);
  });
});

describe("Nova's operations from a member", () => {
  it("apply to the board but can't rewrite the owner's brief or scope", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const member = await person(app, "Member");
    const project = await newProject(owner, "Nova Guard");
    await addMember(project.id, member.id);
    // The apply route is a plan feature.
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.id, member.id));
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.id, owner.id));
    await db.update(projects).set({ oneLiner: "The owner's pitch" }).where(eq(projects.id, project.id));

    const res = await member.agent.post(`/api/projects/${project.id}/nova/apply`).send({ operations: [
      { op: "update_project", fields: { oneLiner: "Hijacked by a member" } },
      { op: "update_scope", mvp: ["Something else"] },
      { op: "create_task", title: "A task a member may add" },
    ] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.changes.map((c: any) => c.entity)).toEqual(["task"]);
    expect(res.body.skipped.filter((s: string) => s.includes("Only the project's owner"))).toHaveLength(2);
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row.oneLiner).toBe("The owner's pitch");
    expect((row.scope as any)?.mvp ?? []).not.toContain("Something else");

    // The owner still can.
    const mine = await owner.agent.post(`/api/projects/${project.id}/nova/apply`).send({ operations: [
      { op: "update_project", fields: { oneLiner: "The owner's new pitch" } },
    ] });
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect((await db.select().from(projects).where(eq(projects.id, project.id)))[0].oneLiner).toBe("The owner's new pitch");
  });
});

describe("editing a project", () => {
  it("can't change its owner", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const other = await person(app, "Other");
    const project = await newProject(owner, "Keep Owner");
    const res = await owner.agent.patch(`/api/projects/${project.id}`).send({ ownerId: other.id, oneLiner: "Still mine" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
    expect(row.ownerId).toBe(owner.id);
    expect(row.oneLiner).toBe("Still mine");
  });
});

describe("a project's team-only fields", () => {
  it("go to the team, and nowhere else: not the project page, the listing, or a profile", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const member = await person(app, "Member");
    const stranger = await person(app, "Stranger");
    const project = await newProject(owner, "Working Notes");
    await withTeamNotes(project.id);
    await addMember(project.id, member.id);

    const outside = [
      (await stranger.agent.get(`/api/projects/${project.id}`)).body,
      (await request(app).get(`/api/projects/${project.id}`)).body,
      ((await request(app).get(`/api/projects`)).body as any[]).find((p) => p.id === project.id),
      ((await stranger.agent.get(`/api/users/${owner.id}`)).body.projects as any[]).find((p) => p.id === project.id),
    ];
    for (const body of outside) {
      expect(body, "the project should be visible").toBeTruthy();
      expect(body.title).toBe(project.title);
      for (const field of TEAM_ONLY_PROJECT_FIELDS) expect(body).not.toHaveProperty(field);
      expect(JSON.stringify(body)).not.toContain(NOTES);
    }

    for (const who of [owner, member]) {
      const body = (await who.agent.get(`/api/projects/${project.id}`)).body;
      expect(body.novaNotes).toBe(NOTES);
      expect(body.auditAutoApply).toBe("all");
    }
    // The owner's own listing rows keep everything.
    expect(((await owner.agent.get(`/api/projects`)).body as any[]).find((p) => p.id === project.id)?.novaNotes).toBe(NOTES);
  });
});

describe("applications", () => {
  it("tell the owner, tell the applicant either way, and accept idempotently when they're already on the team", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const applicant = await person(app, "Applicant");
    const declined = await person(app, "Declined");
    const project = await newProject(owner, "Hiring");

    const applied = await applicant.agent.post(`/api/projects/${project.id}/apply`).send({ message: "I'd love to build this." });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const ownerBell = await bell(owner);
    expect(ownerBell.find((x) => x.kind === "project_application")).toMatchObject({
      href: `/projects/${project.id}/manage?tab=team`, text: expect.stringContaining("Applicant applied to join"),
    });

    // They got in some other way before the owner answered.
    await addMember(project.id, applicant.id);
    const accepted = await owner.agent.post(`/api/applications/${applied.body.id}/accept`).send({});
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.status).toBe("accepted");
    expect(await membersOf(project.id, applicant.id)).toHaveLength(1);
    // A second click is a success that changes nothing.
    expect((await owner.agent.post(`/api/applications/${applied.body.id}/accept`).send({})).status).toBe(200);
    expect(await membersOf(project.id, applicant.id)).toHaveLength(1);
    expect((await bell(applicant)).find((x) => x.kind === "application_accepted")).toMatchObject({ href: `/projects/${project.id}/manage` });

    // A no is an answer too.
    const second = await declined.agent.post(`/api/projects/${project.id}/apply`).send({ message: "Me too." });
    expect(second.status).toBe(200);
    expect((await owner.agent.post(`/api/applications/${second.body.id}/reject`).send({})).status).toBe(200);
    expect((await bell(declined)).find((x) => x.kind === "application_rejected")).toMatchObject({ href: `/projects/${project.id}` });
    expect((await owner.agent.post(`/api/applications/${second.body.id}/accept`).send({})).status).toBe(400);
    expect(await membersOf(project.id, declined.id)).toHaveLength(0);
  });

  it("are marked accepted when the applicant joins by invite", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const applicant = await person(app, "Applicant");
    const project = await newProject(owner, "Invite After Apply");

    const applied = await applicant.agent.post(`/api/projects/${project.id}/apply`).send({ message: "Hello." });
    expect(applied.status).toBe(200);
    const invite = await owner.agent.post(`/api/projects/${project.id}/invites`).send({ role: "Engineer" });
    const token = String(invite.body.url).split("/invite/")[1];
    expect((await applicant.agent.post(`/api/invites/${token}/accept`)).status).toBe(200);

    const [row] = await db.select().from(projectApplications).where(eq(projectApplications.id, applied.body.id));
    expect(row.status).toBe("accepted");
    // And accepting it afterwards is harmless.
    expect((await owner.agent.post(`/api/applications/${applied.body.id}/accept`).send({})).status).toBe(200);
    expect(await membersOf(project.id, applicant.id)).toHaveLength(1);
  });

  it("can't be made to a private project from outside it", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const stranger = await person(app, "Stranger");
    const project = await newProject(owner, "Private Hiring");
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, project.id));
    expect((await stranger.agent.post(`/api/projects/${project.id}/apply`).send({ message: "Let me in." })).status).toBe(404);
  });
});

describe("a project's donations", () => {
  it("are readable wherever the project is, and not for a private project off its team", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const member = await person(app, "Member");
    const project = await newProject(owner, "Donations");
    await addMember(project.id, member.id);

    expect((await request(app).get(`/api/projects/${project.id}/donations`)).status).toBe(200);
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, project.id));
    expect((await request(app).get(`/api/projects/${project.id}/donations`)).status).toBe(404);
    const stranger = await person(app, "Stranger");
    expect((await stranger.agent.get(`/api/projects/${project.id}/donations`)).status).toBe(404);
    expect((await owner.agent.get(`/api/projects/${project.id}/donations`)).status).toBe(200);
    expect((await member.agent.get(`/api/projects/${project.id}/donations`)).status).toBe(200);
    expect((await request(app).get(`/api/projects/does-not-exist/donations`)).status).toBe(404);
  });
});
