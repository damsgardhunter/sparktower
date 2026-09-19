/**
 * Direct messages, over both doors into this server.
 *
 * The web app signs in with a cookie session; the phone carries a bearer token
 * from `/api/auth/mobile/*` (server/mobile-auth.ts). They reach the same
 * routes, so a message sent from one has to be readable on the other — which
 * is the thing nobody checks until somebody says "messages aren't working" and
 * it isn't clear which half is at fault.
 *
 * What this pins:
 *
 *   - A message crosses between the two clients in both directions.
 *   - The connection rule holds. Messaging needs an accepted connection, and
 *     a stranger is refused — that's a guard, not a bug, and it's the most
 *     likely reason a working system looks broken.
 *   - The list, the unread count and marking-read agree with each other.
 *   - `/conversations` and `/unread-count` are not swallowed by `/:userId`.
 *     They're registered before it, so Express matches them first; reverse the
 *     order and "conversations" becomes a user id and every list 403s.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const password = "Testpass123!";

/** An account with a cookie session, the way the web app holds one. */
async function webPerson(app: any, first: string) {
  n += 1;
  const agent = request.agent(app);
  const email = `dm-web-${Date.now()}-${n}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.120.${10 + (n % 200)}`)
    .send({ email, password, firstName: first });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await verifyEmail(app, email, `198.51.121.${10 + (n % 200)}`);
  await agent.post("/api/profile/complete-onboarding").send({ displayName: first });
  return { agent, id: res.body.id as string, email };
}

/** The same account, reached the way the phone does: a bearer token, no cookie. */
async function mobileTokenFor(app: any, email: string) {
  const res = await request(app).post("/api/auth/mobile/login")
    .set("x-forwarded-for", "198.51.122.5")
    .send({ email, password });
  expect(res.status, `mobile login: ${JSON.stringify(res.body)}`).toBe(200);
  const token = res.body.accessToken ?? res.body.token;
  expect(token, "mobile login should return an access token").toBeTruthy();
  return token as string;
}

const asMobile = (app: any, token: string) => ({
  get: (path: string) => request(app).get(path).set("authorization", `Bearer ${token}`),
  post: (path: string) => request(app).post(path).set("authorization", `Bearer ${token}`),
});

/** Connect two accounts, which is the precondition for messaging at all. */
async function connect(a: any, b: any) {
  const req = await a.agent.post("/api/connections/request").send({ userId: b.id });
  expect(req.status, JSON.stringify(req.body)).toBeLessThan(300);
  const accept = await b.agent.post(`/api/connections/${req.body.id}/accept`).send({});
  expect(accept.status, JSON.stringify(accept.body)).toBe(200);
}

describe("messages between the web app and the phone", () => {
  it("carries a message both ways, and keeps the list and the unread count in step", async () => {
    const app = await getTestApp();
    const ari = await webPerson(app, "Ari");
    const bea = await webPerson(app, "Bea");
    await connect(ari, bea);

    // Web → phone.
    const sent = await ari.agent.post(`/api/messages/${bea.id}`).send({ content: "From the website." });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const beaPhone = asMobile(app, await mobileTokenFor(app, bea.email));
    const onPhone = await beaPhone.get(`/api/messages/${ari.id}`);
    expect(onPhone.status, JSON.stringify(onPhone.body)).toBe(200);
    expect(onPhone.body.map((m: any) => m.content)).toContain("From the website.");

    // The phone sees it as unread until it says otherwise.
    const unread = await beaPhone.get("/api/messages/unread-count");
    expect(unread.status).toBe(200);
    expect(unread.body.count, "a message just received should be unread").toBeGreaterThan(0);

    // Phone → web.
    const replied = await beaPhone.post(`/api/messages/${ari.id}`).send({ content: "From the phone." });
    expect(replied.status, JSON.stringify(replied.body)).toBe(200);

    const onWeb = await ari.agent.get(`/api/messages/${bea.id}`);
    expect(onWeb.status).toBe(200);
    const said = onWeb.body.map((m: any) => m.content);
    expect(said, "both sides of the conversation belong in one thread").toEqual(
      expect.arrayContaining(["From the website.", "From the phone."]),
    );

    // Reading catches up the count.
    expect((await beaPhone.post(`/api/messages/${ari.id}/read`).send({})).status).toBe(200);
    expect((await beaPhone.get("/api/messages/unread-count")).body.count).toBe(0);

    // And the other person appears in the conversation list, on both clients.
    for (const [who, list] of [
      ["web", await ari.agent.get("/api/messages/conversations")],
      ["phone", await beaPhone.get("/api/messages/conversations")],
    ] as const) {
      expect(list.status, `${who}: ${JSON.stringify(list.body)}`).toBe(200);
      expect(Array.isArray(list.body), `${who} should get an array`).toBe(true);
      expect(list.body.length, `${who} should see the conversation`).toBeGreaterThan(0);
    }
  });

  /*
   * Registered before `/:userId`, so Express matches them first. If they ever
   * move below it, "conversations" is read as a user id, the connection check
   * finds nothing, and every client's inbox 403s — which looks exactly like
   * messaging being broken.
   */
  it("does not let /:userId swallow /conversations or /unread-count", async () => {
    const app = await getTestApp();
    const solo = await webPerson(app, "Solo");
    expect((await solo.agent.get("/api/messages/conversations")).status).toBe(200);
    expect((await solo.agent.get("/api/messages/unread-count")).status).toBe(200);
  });

  it("refuses a stranger, in both directions and on both clients", async () => {
    const app = await getTestApp();
    const ari = await webPerson(app, "Ari");
    const zed = await webPerson(app, "Zed");

    expect((await ari.agent.post(`/api/messages/${zed.id}`).send({ content: "hello" })).status).toBe(403);
    expect((await ari.agent.get(`/api/messages/${zed.id}`)).status).toBe(403);

    const zedPhone = asMobile(app, await mobileTokenFor(app, zed.email));
    expect((await zedPhone.post(`/api/messages/${ari.id}`).send({ content: "hello" })).status).toBe(403);
  });

  it("refuses an empty message rather than storing a blank one", async () => {
    const app = await getTestApp();
    const ari = await webPerson(app, "Ari");
    const bea = await webPerson(app, "Bea");
    await connect(ari, bea);
    for (const content of ["", "   "]) {
      expect((await ari.agent.post(`/api/messages/${bea.id}`).send({ content })).status).toBe(400);
    }
  });

  it("needs a session or a token — not nothing", async () => {
    const app = await getTestApp();
    const bea = await webPerson(app, "Bea");
    expect((await request(app).get("/api/messages/conversations")).status).toBe(401);
    expect((await request(app).post(`/api/messages/${bea.id}`).send({ content: "hi" })).status).toBe(401);
  });
});
