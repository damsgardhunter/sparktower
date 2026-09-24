/**
 * Company accounts, against the real app: making one, the exact shape every
 * company tab reads, who is told what, the team link, and the rule that a
 * company always has an owner.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { makeVerifiedCompany } from "../helpers/company";
import { verifyEmail } from "../helpers/verify-email";
import { readCompanyInviteToken, makeCompanyInviteToken } from "../../server/company-routes";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function player(app: any, firstName = `C${n + 1}`) {
  const agent = request.agent(app);
  n += 1;
  const ip = `198.51.152.${(n % 200) + 20}`;
  const email = `co-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName });
  expect(res.status, `${res.status}: ${(res.text ?? "").slice(0, 300)}`).toBe(201);
  await verifyEmail(app, email, ip);
  return { agent, id: res.body.id as string };
}

async function companyWithOwner(app: any) {
  const owner = await player(app, "Olive");
  /*
   * No `website` here any more. Creating a company spends a domain
   * verification and the route sets the website from the domain that was
   * proved — anything the caller sends is overwritten, which is the point:
   * the website on a company is the one it demonstrated it owns.
   */
  const made = await makeVerifiedCompany(owner.agent, "Acme Widgets", {
    industry: "Fintech", size: "11-50", description: "We make widgets.",
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return { owner, companyId: made.body.company.id as string, domain: made.domain };
}

/** Someone joins through a link the owner makes. */
async function joinByLink(owner: any, companyId: string, who: any, role = "member") {
  const link = await owner.agent.post(`/api/companies/${companyId}/invite-link`).send({ role });
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  const token = new URL(link.body.url).searchParams.get("invite");
  const accepted = await who.agent.post("/api/company-invites/accept").send({ token });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  return accepted.body;
}

describe("making and reading a company", () => {
  it("creates, lists and reads back in the shape the page relies on", async () => {
    const app = await getTestApp();
    const { owner, companyId, domain } = await companyWithOwner(app);

    const list = await owner.agent.get("/api/companies");
    expect(list.status).toBe(200);
    expect(list.body.companies).toHaveLength(1);
    expect(list.body.companies[0]).toMatchObject({ id: companyId, name: "Acme Widgets", role: "owner" });

    const one = await owner.agent.get(`/api/companies/${companyId}`);
    expect(one.status).toBe(200);
    expect(Object.keys(one.body).sort()).toEqual(["company", "me", "members", "role"]);
    /*
     * The proof travels with the company now, because the page draws a badge
     * from it — a builder deciding whether to spend a fortnight on somebody's
     * challenge is entitled to see which domain they proved and when.
     */
    expect(Object.keys(one.body.company).sort()).toEqual([
      "description", "id", "industry", "name", "projectId", "size", "slug",
      "verifiedAt", "verifiedDomain", "verifiedMethod", "website",
    ]);
    expect(one.body.company).toMatchObject({
      id: companyId, name: "Acme Widgets", industry: "Fintech", size: "11-50",
      website: `https://${domain}`, description: "We make widgets.", projectId: null,
      verifiedDomain: domain,
    });
    expect(one.body.company.slug).toMatch(/^acme-widgets-[a-z0-9]{6}$/);
    expect(one.body.role).toBe("owner");
    expect(one.body.members).toEqual([{ userId: owner.id, name: "Olive", role: "owner", avatarUrl: null, permissions: [] }]);
    // What the viewer can do, worked out once on the server: an owner holds every power.
    expect(one.body.me).toMatchObject({ userId: owner.id, role: "owner", permissions: [] });
    expect(one.body.me.powers).toHaveLength(7);
  }, 120_000);

  it("refuses a bad name, industry or size", async () => {
    const app = await getTestApp();
    const p = await player(app);
    expect((await p.agent.post("/api/companies").send({ name: "A" })).body.field).toBe("name");
    expect((await p.agent.post("/api/companies").send({ name: "Acme", industry: "Alchemy" })).body.field).toBe("industry");
    expect((await p.agent.post("/api/companies").send({ name: "Acme", size: "huge" })).body.field).toBe("size");
    expect((await p.agent.post("/api/companies").send({ name: "Acme", description: "x".repeat(601) })).body.field).toBe("description");
  }, 120_000);

  it("tells a stranger nothing, and a member they can't manage", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithOwner(app);
    const stranger = await player(app);
    const member = await player(app);
    await joinByLink(owner, companyId, member);

    expect((await stranger.agent.get(`/api/companies/${companyId}`)).status).toBe(404);
    expect((await stranger.agent.patch(`/api/companies/${companyId}`).send({ name: "Mine now" })).status).toBe(404);

    expect((await member.agent.get(`/api/companies/${companyId}`)).status).toBe(200);
    expect((await member.agent.patch(`/api/companies/${companyId}`).send({ name: "Mine now" })).status).toBe(403);
    expect((await member.agent.post(`/api/companies/${companyId}/invite-link`).send({})).status).toBe(403);
    expect((await member.agent.delete(`/api/companies/${companyId}`)).status).toBe(403);

    const edited = await owner.agent.patch(`/api/companies/${companyId}`).send({ name: "Acme Holdings", website: "" });
    expect(edited.status).toBe(200);
    expect(edited.body.company).toMatchObject({ name: "Acme Holdings", website: null });
  }, 120_000);
});

describe("the team", () => {
  it("admits whoever holds the link, with the role in it", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithOwner(app);
    const colleague = await player(app, "Carl");
    const joined = await joinByLink(owner, companyId, colleague, "admin");
    expect(joined).toMatchObject({ companyId, role: "admin", alreadyMember: false });

    // A second, lesser link doesn't demote them.
    const again = await joinByLink(owner, companyId, colleague, "member");
    expect(again).toMatchObject({ role: "admin", alreadyMember: true });

    const one = await colleague.agent.get(`/api/companies/${companyId}`);
    expect(one.body.role).toBe("admin");
    expect(one.body.members.map((m: any) => m.role)).toEqual(["owner", "admin"]);
  }, 120_000);

  it("refuses a forged, altered or expired link", async () => {
    const app = await getTestApp();
    const { companyId } = await companyWithOwner(app);
    const p = await player(app);

    const good = makeCompanyInviteToken(companyId, "member", new Date(Date.now() + 60_000));
    const [payload, mac] = good.split(".");
    const promoted = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), r: "admin" })).toString("base64url");
    expect(readCompanyInviteToken(`${promoted}.${mac}`).ok).toBe(false);
    expect((await p.agent.post("/api/company-invites/accept").send({ token: `${promoted}.${mac}` })).status).toBe(404);
    expect((await p.agent.post("/api/company-invites/accept").send({ token: "nonsense" })).status).toBe(404);

    const old = makeCompanyInviteToken(companyId, "member", new Date(Date.now() - 1000));
    const expired = await p.agent.post("/api/company-invites/accept").send({ token: old });
    expect(expired.status).toBe(410);
    expect((await p.agent.get(`/api/companies/${companyId}`)).status).toBe(404);
  }, 120_000);

  it("never leaves a company without an owner", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithOwner(app);
    const admin = await player(app);
    await joinByLink(owner, companyId, admin, "admin");

    // The last owner can't be demoted, removed, or leave.
    const demote = await owner.agent.patch(`/api/companies/${companyId}/members/${owner.id}`).send({ role: "admin" });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe("last_owner");
    expect((await owner.agent.delete(`/api/companies/${companyId}/members/${owner.id}`)).status).toBe(409);

    // An admin can't touch an owner or make one.
    expect((await admin.agent.delete(`/api/companies/${companyId}/members/${owner.id}`)).status).toBe(403);
    expect((await admin.agent.patch(`/api/companies/${companyId}/members/${admin.id}`).send({ role: "owner" })).status).toBe(403);

    // Hand over, and then the first owner may step down.
    expect((await owner.agent.patch(`/api/companies/${companyId}/members/${admin.id}`).send({ role: "owner" })).status).toBe(200);
    expect((await owner.agent.patch(`/api/companies/${companyId}/members/${owner.id}`).send({ role: "member" })).status).toBe(200);
    const after = await admin.agent.get(`/api/companies/${companyId}`);
    expect(after.body.members.find((m: any) => m.userId === owner.id).role).toBe("member");
  }, 120_000);

  it("lets an admin remove a member, and a member leave", async () => {
    const app = await getTestApp();
    const { owner, companyId } = await companyWithOwner(app);
    const a = await player(app);
    const b = await player(app);
    await joinByLink(owner, companyId, a);
    await joinByLink(owner, companyId, b);

    expect((await a.agent.delete(`/api/companies/${companyId}/members/${b.id}`)).status).toBe(403);
    expect((await owner.agent.delete(`/api/companies/${companyId}/members/${b.id}`)).status).toBe(200);
    expect((await a.agent.delete(`/api/companies/${companyId}/members/${a.id}`)).status).toBe(200);
    const left = await owner.agent.get(`/api/companies/${companyId}`);
    expect(left.body.members).toHaveLength(1);

    expect((await owner.agent.delete(`/api/companies/${companyId}`)).status).toBe(200);
    expect((await owner.agent.get(`/api/companies/${companyId}`)).status).toBe(404);
  }, 120_000);
});
