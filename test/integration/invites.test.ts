/**
 * Inviting a collaborator, through the API: the owner creates an invite (stored
 * as a hash, emailed — logged here — when there's an address, always a link);
 * anyone with the link can see what it's for; the right signed-in account
 * accepts it once and joins the project; and the abuse controls hold.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { projectInvites, projectMembers, rateLimitHits } from "@shared/schema";
import { hashInviteToken } from "../../server/invite-routes";
import { devOutbox } from "../../server/email";
import { INVITES_PER_PROJECT_PER_DAY } from "@shared/invites";
import { RATE_LIMITS } from "@shared/moderation";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string, email?: string) {
  const agent = request.agent(app);
  n += 1;
  const address = email ?? `invite-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.105.${10 + n}`).send({ email: address, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  await verifyEmail(app, address, `198.51.106.${10 + n}`);
  return { agent, id: res.body.id as string, email: address };
}
const tokenOf = (url: string) => url.split("/invite/")[1];

describe("project invites", () => {
  it("creates an invite with a link and a logged email, opens it without an account, and the right account joins once", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const invitee = await person(app, "Invitee");
    const project = (await owner.agent.post("/api/projects").send({ title: "Invite Me", description: "A project that invites a collaborator.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;

    expect((await invitee.agent.post(`/api/projects/${project.id}/invites`).send({})).status).toBe(403);
    expect((await owner.agent.post(`/api/projects/${project.id}/invites`).send({ email: "nope" })).body).toMatchObject({ field: "email" });

    const created = await owner.agent.post(`/api/projects/${project.id}/invites`).send({ email: invitee.email.toUpperCase(), role: "Engineer", expiresInDays: 7 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ invite: { email: invitee.email, role: "Engineer", status: "pending", emailStatus: "logged" }, email: { status: "logged" }, url: expect.stringMatching(/\/invite\/[A-Za-z0-9_-]{43}$/) });
    const token = tokenOf(created.body.url);

    // Stored: the hash, not the token.
    const [row] = await db.select().from(projectInvites).where(eq(projectInvites.id, created.body.invite.id));
    expect(row).toMatchObject({ projectId: project.id, email: invitee.email, role: "Engineer", createdById: owner.id, tokenHash: hashInviteToken(token), emailStatus: "logged" });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    // The email that would have been sent, with the link in it.
    expect(devOutbox()[0]).toMatchObject({ to: invitee.email, subject: expect.stringContaining("Invite Me"), text: expect.stringContaining(token) });
    // The list shows it, never the link.
    const list = (await owner.agent.get(`/api/projects/${project.id}/invites`)).body.invites;
    expect(list[0]).toMatchObject({ id: row.id, status: "pending" });
    expect(JSON.stringify(list)).not.toContain(token);

    // Anyone with the link, no account: what it's for, the address masked.
    const view = await request(app).get(`/api/invites/${token}`).set("x-forwarded-for", "198.51.105.200");
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ status: "pending", role: "Engineer", project: { id: project.id, title: "Invite Me" }, invitedBy: "Owner", forEmail: expect.stringMatching(/\*\*\*@example\.test$/) });
    expect(JSON.stringify(view.body)).not.toContain(invitee.email);
    expect((await request(app).get(`/api/invites/${"x".repeat(43)}`)).status).toBe(404);

    // Accepting needs an account, and the right one.
    expect((await request(app).post(`/api/invites/${token}/accept`)).status).toBe(401);
    const stranger = await person(app, "Stranger");
    expect((await stranger.agent.post(`/api/invites/${token}/accept`)).body.code).toBe("invite_wrong_account");
    const joined = await invitee.agent.post(`/api/invites/${token}/accept`);
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toMatchObject({ projectId: project.id, role: "Engineer", alreadyMember: false });
    expect(await db.select().from(projectMembers).where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, invitee.id)))).toHaveLength(1);
    // Once.
    expect((await invitee.agent.post(`/api/invites/${token}/accept`)).body.code).toBe("invite_used");
    expect((await request(app).get(`/api/invites/${token}`)).body.status).toBe("accepted");
    // The owner hears.
    await new Promise((r) => setTimeout(r, 300));
    const bell = (await owner.agent.get("/api/notifications")).body.items as any[];
    expect(bell.find((x) => x.kind === "invite_accepted")).toMatchObject({ text: "Invitee accepted your invite to Invite Me", href: `/projects/${project.id}/manage?tab=team` });
    // Inviting someone already on the team by email is refused.
    expect((await owner.agent.post(`/api/projects/${project.id}/invites`).send({ email: invitee.email })).body.code).toBe("already_member");
  });

  it("a link invite works for anyone, once; revoked and expired links don't; and the limits hold", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Limiter");
    const project = (await owner.agent.post("/api/projects").send({ title: "Limits", description: "A project that tests invite limits.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;

    const link = await owner.agent.post(`/api/projects/${project.id}/invites`).send({});
    expect(link.body).toMatchObject({ invite: { email: null, role: "Collaborator" }, email: null });
    const someone = await person(app, "Someone");
    expect((await someone.agent.post(`/api/invites/${tokenOf(link.body.url)}/accept`)).status).toBe(200);

    const revoked = await owner.agent.post(`/api/projects/${project.id}/invites`).send({});
    await owner.agent.delete(`/api/projects/${project.id}/invites/${revoked.body.invite.id}`).expect(200);
    expect((await someone.agent.post(`/api/invites/${tokenOf(revoked.body.url)}/accept`)).body.code).toBe("invite_revoked");

    const expired = await owner.agent.post(`/api/projects/${project.id}/invites`).send({ expiresInDays: 1 });
    await db.update(projectInvites).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(projectInvites.id, expired.body.invite.id));
    expect((await someone.agent.post(`/api/invites/${tokenOf(expired.body.url)}/accept`)).body.code).toBe("invite_expired");

    // Per project: a day's cap.
    await db.insert(projectInvites).values(Array.from({ length: INVITES_PER_PROJECT_PER_DAY }, (_, i) => ({ projectId: project.id, role: "Collaborator", tokenHash: `seed-${project.id}-${i}`, expiresAt: new Date(Date.now() + 86_400_000), createdById: owner.id })) as any);
    const capped = await owner.agent.post(`/api/projects/${project.id}/invites`).send({});
    expect(capped.status).toBe(429);
    expect(capped.body.message).toMatch(/invites today/);

    // Per person: the invite limit.
    const other = await person(app, "Busy");
    const p2 = (await other.agent.post("/api/projects").send({ title: "Busy", description: "Another project for the per-person limit.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    await db.insert(rateLimitHits).values(Array.from({ length: RATE_LIMITS.invite.max }, () => ({ userId: other.id, action: "invite" })) as any);
    const limited = await other.agent.post(`/api/projects/${p2.id}/invites`).send({});
    expect(limited.status).toBe(429);
    expect(limited.body.action).toBe("invite");

    // Solo builds don't take collaborators.
    const owner3 = await person(app, "Solo");
    const solo = (await owner3.agent.post("/api/projects").send({ title: "Solo", description: "A solo build that can't invite anyone.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const { projects } = await import("@shared/schema");
    await db.update(projects).set({ soloMode: true }).where(eq(projects.id, solo.id));
    expect((await owner3.agent.post(`/api/projects/${solo.id}/invites`).send({})).body.code).toBe("solo_project");
  });

  it("gives the person who just joined their own way back to the work", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Host");
    const joiner = await person(app, "Newcomer");
    const project = (await owner.agent.post("/api/projects").send({ title: "Onboarding Loop", description: "A project someone joins and then picks up a step on.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;

    const invite = await owner.agent.post(`/api/projects/${project.id}/invites`).send({ email: joiner.email, role: "Engineer" });
    expect(invite.status).toBe(201);
    expect((await joiner.agent.post(`/api/invites/${tokenOf(invite.body.url)}/accept`).send({})).status).toBe(200);
    await new Promise((r) => setTimeout(r, 400));

    // The owner hears someone joined; the person who joined gets the step, not a welcome they can close and forget.
    const theirs = (await joiner.agent.get("/api/notifications")).body.items as any[];
    const back = theirs.find((n) => n.kind === "next_step" && n.project?.id === project.id);
    expect(back, "a new collaborator needs something that brings them back").toBeTruthy();
    // It opens the section the step is on, with the Next Step card in view (shared/notifications.ts).
    expect(back.href).toMatch(new RegExp(`^/projects/${project.id}/manage\\?section=ship_mvp&tab=nova&focus=SHIP\\.`));
    expect(back.excerpt).toBeTruthy();

    const owners = (await owner.agent.get("/api/notifications")).body.items as any[];
    expect(owners.some((n) => n.kind === "invite_accepted" && n.project?.id === project.id)).toBe(true);
    // The owner isn't told to start their own project, and the joiner isn't told they joined themselves.
    expect(owners.some((n) => n.kind === "next_step" && n.project?.id === project.id)).toBe(false);
  });

  it("lets whoever joined bring in the next person, but not take back someone else's invite", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Lead");
    const joiner = await person(app, "Joiner");
    const stranger = await person(app, "Stranger");
    const project = (await owner.agent.post("/api/projects").send({ title: "Referral Chain", description: "A project where the person who joins can invite the next one.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;

    // The owner invites the first collaborator, who accepts.
    const first = await owner.agent.post(`/api/projects/${project.id}/invites`).send({ email: joiner.email, role: "Engineer" });
    expect(first.status).toBe(201);
    expect((await joiner.agent.post(`/api/invites/${tokenOf(first.body.url)}/accept`).send({})).status).toBe(200);

    // Now they can invite the next person themselves — that's the loop coming back round.
    const second = await joiner.agent.post(`/api/projects/${project.id}/invites`).send({ email: `next-${Date.now()}@example.test`, role: "Designer" });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect((await joiner.agent.post(`/api/projects/${project.id}/invites`).send({ role: "Designer" })).status).toBe(201);

    // Someone with no part in the project still can't.
    const refused = await stranger.agent.post(`/api/projects/${project.id}/invites`).send({ email: "outsider@example.test" });
    expect(refused.status).toBe(403);
    expect((await stranger.agent.get(`/api/projects/${project.id}/invites`)).status).toBe(403);

    // The list says whose invite is whose, to everyone on the team.
    const listed = (await joiner.agent.get(`/api/projects/${project.id}/invites`)).body.invites as any[];
    expect(listed.find((i) => i.id === second.body.invite.id)).toMatchObject({ invitedById: joiner.id, invitedByName: "Joiner" });
    expect(listed.find((i) => i.id === first.body.invite.id)).toMatchObject({ invitedById: owner.id });

    // A teammate can take back their own invite, and only their own.
    const ownersInvite = (await owner.agent.post(`/api/projects/${project.id}/invites`).send({ email: `theirs-${Date.now()}@example.test`, role: "Engineer" })).body.invite;
    expect((await joiner.agent.delete(`/api/projects/${project.id}/invites/${ownersInvite.id}`)).status).toBe(404);
    expect((await joiner.agent.delete(`/api/projects/${project.id}/invites/${second.body.invite.id}`)).status).toBe(200);
    // The owner can take back anyone's.
    expect((await owner.agent.delete(`/api/projects/${project.id}/invites/${ownersInvite.id}`)).status).toBe(200);
  });
});
