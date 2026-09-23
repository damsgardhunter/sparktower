/**
 * Running a company's team, against the real app: adding people directly,
 * handing out single powers, the seniority rules that stop a member who
 * manages the team from taking the company over, and the log that records
 * all of it.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { notifications, userProfiles } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function player(app: any, firstName = `A${n + 1}`) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.153.${(n % 200) + 20}`;
  const email = `adm-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string, email };
}

async function company(app: any) {
  const owner = await player(app, "Olive");
  const made = await owner.agent.post("/api/companies").send({ name: "Acme Widgets" });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return { owner, companyId: made.body.company.id as string };
}

const add = (by: any, companyId: string, identifier: string, permissions?: string[]) =>
  by.agent.post(`/api/companies/${companyId}/members`).send({ identifier, permissions });
const setPowers = (by: any, companyId: string, userId: string, permissions: string[]) =>
  by.agent.put(`/api/companies/${companyId}/members/${userId}/permissions`).send({ permissions });

describe("adding people directly", () => {
  it("adds an existing account by email or username, and refuses strangers and duplicates", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const sam = await player(app, "Sam");

    // Any capitalisation of the address finds them.
    const added = await add(owner, companyId, sam.email.toUpperCase(), ["run_seasons"]);
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body.member).toMatchObject({ userId: sam.id, name: "Sam", role: "member", permissions: ["run_seasons"] });

    const view = await sam.agent.get(`/api/companies/${companyId}`).expect(200);
    expect(view.body.me).toEqual({ userId: sam.id, role: "member", permissions: ["run_seasons"], powers: ["run_seasons"] });

    expect((await add(owner, companyId, sam.email)).status).toBe(409);
    const unknown = await add(owner, companyId, `nobody-${Date.now()}@example.test`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toMatch(/no account/i);

    // By username, with or without the @.
    const uma = await player(app, "Uma");
    const handle = `uma${Date.now().toString(36)}`;
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, uma.id));
    if (profile) await db.update(userProfiles).set({ username: handle }).where(eq(userProfiles.userId, uma.id));
    else await db.insert(userProfiles).values({ userId: uma.id, username: handle });
    expect((await add(owner, companyId, `@${handle.toUpperCase()}`)).status).toBe(201);
    expect((await add(owner, companyId, `no-such-handle-${Date.now()}`)).status).toBe(404);

    // They're told, with the company named.
    const [told] = await db.select().from(notifications)
      .where(and(eq(notifications.recipientId, sam.id), eq(notifications.kind, "company_added")));
    expect(told).toMatchObject({ actorId: owner.id, targetId: `${companyId}:${sam.id}`, excerpt: "Acme Widgets" });

    // A plain member can't add anyone.
    const other = await player(app);
    const refused = await add(sam, companyId, other.email);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "missing_power", power: "manage_team" });

    // Nor can a stranger learn the company exists.
    expect((await add(other, companyId, sam.email)).status).toBe(404);
  }, 120_000);
});

describe("powers and seniority", () => {
  it("lets a member who manages the team look after members, but not leaders, roles or the team power itself", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const [manager, admin, plain, newcomer] = [await player(app, "Mia"), await player(app, "Ada"), await player(app, "Pat"), await player(app, "Neo")];
    expect((await add(owner, companyId, manager.email, ["manage_team"])).status).toBe(201);
    expect((await add(owner, companyId, admin.email)).status).toBe(201);
    expect((await owner.agent.patch(`/api/companies/${companyId}/members/${admin.id}`).send({ role: "admin" })).status).toBe(200);
    expect((await add(owner, companyId, plain.email)).status).toBe(201);

    // Adding: fine, but not with the team power attached.
    const grantTeam = await add(manager, companyId, newcomer.email, ["manage_team"]);
    expect(grantTeam.status).toBe(403);
    expect(grantTeam.body.code).toBe("not_leader");
    expect((await add(manager, companyId, newcomer.email, ["recruit"])).status).toBe(201);

    // Powers on a member: yes. The team power: no. Their own: no. A leader's: never stored.
    expect((await setPowers(manager, companyId, plain.id, ["scouting", "challenges"])).status).toBe(200);
    expect((await setPowers(manager, companyId, plain.id, ["manage_team"])).body.code).toBe("not_leader");
    expect((await setPowers(manager, companyId, manager.id, ["manage_team", "recruit"])).status).toBe(403);
    expect((await setPowers(owner, companyId, admin.id, ["recruit"])).status).toBe(409);

    // Roles are a leader's call.
    const promote = await manager.agent.patch(`/api/companies/${companyId}/members/${plain.id}`).send({ role: "admin" });
    expect(promote.status).toBe(403);
    expect(promote.body.code).toBe("not_leader");
    // Nor can they make a link that joins people as admins.
    expect((await manager.agent.post(`/api/companies/${companyId}/invite-link`).send({ role: "admin" })).status).toBe(403);
    expect((await manager.agent.post(`/api/companies/${companyId}/invite-link`).send({ role: "member" })).status).toBe(201);

    // Removing: a member yes, an admin or the owner no.
    expect((await manager.agent.delete(`/api/companies/${companyId}/members/${admin.id}`)).status).toBe(403);
    expect((await manager.agent.delete(`/api/companies/${companyId}/members/${owner.id}`)).status).toBe(403);
    expect((await manager.agent.delete(`/api/companies/${companyId}/members/${newcomer.id}`)).status).toBe(200);

    // A leader can give anything, the team power included, and is heard.
    const given = await setPowers(admin, companyId, plain.id, ["manage_team", "post_as_company", "run_business"]);
    expect(given.status, JSON.stringify(given.body)).toBe(200);
    expect(given.body.permissions).toEqual(["manage_team", "post_as_company", "run_business"]);
    const told = await db.select().from(notifications)
      .where(and(eq(notifications.recipientId, plain.id), eq(notifications.kind, "company_powers")));
    expect(told.length).toBeGreaterThan(0);

    // An admin can't remove the owner, and the last owner can't be demoted.
    expect((await admin.agent.delete(`/api/companies/${companyId}/members/${owner.id}`)).body.code).toBe("not_owner");
    expect((await owner.agent.patch(`/api/companies/${companyId}/members/${owner.id}`).send({ role: "admin" })).body.code).toBe("last_owner");
    expect((await owner.agent.delete(`/api/companies/${companyId}/members/${owner.id}`)).body.code).toBe("last_owner");

    // Anyone can leave.
    expect((await plain.agent.delete(`/api/companies/${companyId}/members/${plain.id}`)).status).toBe(200);
  }, 180_000);

  it("gates training seasons on run_seasons and approaching candidates on recruit", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const [runner, other, candidate] = [await player(app, "Rae"), await player(app, "Oz"), await player(app, "Cam")];
    await add(owner, companyId, runner.email, ["run_seasons"]);
    await add(owner, companyId, other.email);

    const season = { nicheId: "podcasts", yearMinutes: 60 };
    const made = await runner.agent.post(`/api/companies/${companyId}/seasons`).send(season);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const refused = await other.agent.post(`/api/companies/${companyId}/seasons`).send(season);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: "missing_power", power: "run_seasons" });

    await candidate.agent.put("/api/talent/me").send({ open: true, headline: "Numbers person", roles: ["finance"] }).expect(200);
    const message = { message: "We would love to talk to you about finance." };
    const noRecruit = await runner.agent.post(`/api/companies/${companyId}/talent/${candidate.id}/invite`).send(message);
    expect(noRecruit.status).toBe(403);
    expect(noRecruit.body).toMatchObject({ code: "missing_power", power: "recruit" });
    await setPowers(owner, companyId, runner.id, ["run_seasons", "recruit"]).expect(200);
    expect((await runner.agent.post(`/api/companies/${companyId}/talent/${candidate.id}/invite`).send(message)).status).toBe(201);

    const log = (await owner.agent.get(`/api/companies/${companyId}/audit`).expect(200)).body.entries;
    expect(log.find((e: any) => e.action === "season_created")).toMatchObject({ actorName: "Rae" });
    expect(log.find((e: any) => e.action === "candidate_invited")).toMatchObject({ actorName: "Rae", targetName: "Cam" });
  }, 180_000);
});

describe("the activity log", () => {
  it("records adds, removals and power changes with names, newest first, in pages, for leaders and team managers only", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await company(app);
    const [kim, lee] = [await player(app, "Kim"), await player(app, "Lee")];
    await add(owner, companyId, kim.email);
    await add(owner, companyId, lee.email);
    await setPowers(owner, companyId, kim.id, ["scouting"]).expect(200);
    await owner.agent.delete(`/api/companies/${companyId}/members/${lee.id}`).expect(200);

    // Kim can't read it yet; with the team power she can.
    const denied = await kim.agent.get(`/api/companies/${companyId}/audit`);
    expect(denied.status).toBe(403);
    expect(denied.body.power).toBe("manage_team");
    await setPowers(owner, companyId, kim.id, ["scouting", "manage_team"]).expect(200);

    const all = (await kim.agent.get(`/api/companies/${companyId}/audit`).expect(200)).body.entries;
    expect(all.map((e: any) => e.action)).toEqual(["permissions_changed", "member_removed", "permissions_changed", "member_added", "member_added"]);
    expect(all[1]).toMatchObject({ actorName: "Olive", targetName: "Lee", targetUserId: lee.id });
    expect(all[2]).toMatchObject({ targetName: "Kim", detail: { before: [], after: ["scouting"] } });
    expect(all[0].detail).toEqual({ before: ["scouting"], after: ["manage_team", "scouting"] });

    const first = (await owner.agent.get(`/api/companies/${companyId}/audit?limit=2`).expect(200)).body;
    expect(first.entries).toHaveLength(2);
    expect(first.nextBefore).toBe(first.entries[1].id);
    const second = (await owner.agent.get(`/api/companies/${companyId}/audit?limit=2&before=${first.nextBefore}`).expect(200)).body;
    expect(second.entries.map((e: any) => e.id)).toEqual(all.slice(2, 4).map((e: any) => e.id));

    // A stranger learns nothing.
    expect((await lee.agent.get(`/api/companies/${companyId}/audit`)).status).toBe(404);
  }, 120_000);
});
