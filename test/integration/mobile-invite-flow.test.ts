/**
 * The endpoints the phone's invite screens call.
 *
 * The app could be invited but never invite: no composer, and an invite link
 * opened on a phone dead-ended. The screens are mobile/src/components/manage/Team.tsx
 * (the composer and the list) and mobile/app/invite/[token].tsx (the accept
 * screen, which works signed out because the person an invite is for usually
 * has no account yet).
 *
 * The screens themselves can't run here, so this holds the API they depend on:
 * the shapes they read, and the fact that the accept route answers a request
 * carrying a bearer token rather than a cookie.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function onThePhone(app: any, first: string) {
  n += 1;
  // Lowercase: mobile sign-up normalises the address, and the outbox is keyed by what was stored.
  const email = `mob-invite-${first.toLowerCase()}-${Date.now()}-${n}@example.test`;
  const reg = await request(app).post("/api/auth/mobile/register").set("x-forwarded-for", `198.51.118.${10 + n}`)
    .send({ email, password: "Testpass123!", firstName: first, device: "iPhone 15" });
  expect(reg.status, JSON.stringify(reg.body)).toBe(200);
  await verifyEmail(app, email, `198.51.119.${10 + n}`);
  return { token: reg.body.accessToken as string, id: reg.body.user.id as string, email };
}
const bearer = (req: any, token: string) => req.set("Authorization", `Bearer ${token}`);

describe("inviting from the phone", () => {
  it("creates an invite with a shareable link, lists it, and lets the invited phone accept", async () => {
    const app = await getTestApp();
    const owner = await onThePhone(app, "Owner");
    const joiner = await onThePhone(app, "Joiner");

    const project = (await bearer(request(app).post("/api/projects"), owner.token).send({
      title: `Phone Team ${Date.now()}`, description: "A project whose team is built from a phone.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;

    // The composer: an address is optional, the link is not.
    const made = await bearer(request(app).post(`/api/projects/${project.id}/invites`), owner.token).send({ email: joiner.email, role: "Engineer" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.url).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(made.body.invite).toMatchObject({ role: "Engineer", status: "pending" });

    // The list the team screen shows, with who sent each one.
    const listed = await bearer(request(app).get(`/api/projects/${project.id}/invites`), owner.token);
    expect(listed.status).toBe(200);
    expect(listed.body.invites[0]).toMatchObject({ role: "Engineer", status: "pending" });
    expect(listed.body.invites[0].invitedByName, "the list says who sent each invite").toBeTruthy();

    // The accept screen, signed out: it can read who's inviting whom before anyone signs in.
    const token = made.body.url.split("/invite/")[1];
    const preview = await request(app).get(`/api/invites/${token}`).set("x-forwarded-for", "198.51.120.10");
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ status: "pending", role: "Engineer", project: { id: project.id } });
    expect(preview.body.forEmail, "the address is masked for whoever holds the link").not.toBe(joiner.email);

    // And accepting works on a bearer token, which is all the app has.
    const joined = await bearer(request(app).post(`/api/invites/${token}/accept`), joiner.token).send({});
    expect(joined.status, JSON.stringify(joined.body)).toBe(200);
    expect(joined.body).toMatchObject({ projectId: project.id, role: "Engineer" });

    // They're on the team, and can now invite the next person from their own phone.
    const members = await bearer(request(app).get(`/api/projects/${project.id}/members`), joiner.token);
    expect(members.body.some((m: any) => m.userId === joiner.id)).toBe(true);
    const theirs = await bearer(request(app).post(`/api/projects/${project.id}/invites`), joiner.token).send({ role: "Designer" });
    expect(theirs.status).toBe(201);
  });

  it("tells the accept screen when a link can't be used, rather than failing blankly", async () => {
    const app = await getTestApp();
    const owner = await onThePhone(app, "Revoker");
    const project = (await bearer(request(app).post("/api/projects"), owner.token).send({
      title: `Phone Revoke ${Date.now()}`, description: "A project whose invite gets taken back before anyone uses it.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body;
    const made = await bearer(request(app).post(`/api/projects/${project.id}/invites`), owner.token).send({ role: "Collaborator" });
    const token = made.body.url.split("/invite/")[1];
    await bearer(request(app).delete(`/api/projects/${project.id}/invites/${made.body.invite.id}`), owner.token);

    const view = await request(app).get(`/api/invites/${token}`).set("x-forwarded-for", "198.51.120.11");
    expect(view.status).toBe(200);
    expect(view.body.status, "the screen needs a status to explain, not an error").toBe("revoked");

    expect((await request(app).get("/api/invites/not-a-real-token").set("x-forwarded-for", "198.51.120.12")).status).toBe(404);
  });
});
