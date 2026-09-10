/**
 * Signing out means the session is gone, sign-out-everywhere ends every
 * session and device, and the development upload endpoint is closed to
 * strangers, bad ids, and production.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
async function signedIn(app: any, tag: string) {
  const agent = request.agent(app);
  const email = `ah-${tag}-${Date.now()}@example.test`;
  await agent.post("/api/auth/register").set("x-forwarded-for", `203.0.113.${Math.floor(Math.random() * 200) + 1}`).send({ email, password });
  return { agent, email };
}

describe("signing out", () => {
  it("destroys the session so the cookie is dead, and sign-out-everywhere ends the other sessions and devices too", async () => {
    const app = await getTestApp();
    const { agent, email } = await signedIn(app, "one");
    expect((await agent.get("/api/auth/user")).status).toBe(200);

    // A second browser on the same account.
    const other = request.agent(app);
    await other.post("/api/auth/login").set("x-forwarded-for", "203.0.113.250").send({ email, password }).expect(200);
    // And a phone.
    const phone = await request(app).post("/api/auth/mobile/login").set("x-forwarded-for", "203.0.113.251").send({ email, password });
    expect(phone.status).toBe(200);
    const refreshToken = phone.body.refreshToken;

    // Plain sign-out: this session is gone; the others still work.
    const out = await agent.post("/api/logout");
    expect(out.status).toBe(200);
    expect((await agent.get("/api/auth/user")).status).toBe(401);
    expect((await other.get("/api/auth/user")).status).toBe(200);

    // Sign out everywhere from the other browser: it ends itself, and the phone's refresh token is dead.
    const all = await other.post("/api/auth/logout-all");
    expect(all.status).toBe(200);
    expect(all.body.devicesSignedOut).toBe(1);
    expect((await other.get("/api/auth/user")).status).toBe(401);
    expect((await request(app).post("/api/auth/mobile/refresh").set("x-forwarded-for", "203.0.113.252").send({ refreshToken })).status).toBe(401);
  });
});

describe("the development upload endpoint", () => {
  it("accepts only an id it issued, once, and never in production", async () => {
    const app = await getTestApp();
    const { ObjectStorageService } = await import("../../server/replit_integrations/object_storage");
    // A guessed id, even a well-formed one, is a 404: the URL is the credential.
    expect((await request(app).put("/internal-local-upload/abc123").send("data")).status).toBe(404);
    expect((await request(app).put("/internal-local-upload/..%2F..%2Fetc").send("data")).status).toBe(400);
    // An issued one works without any session — that's how a client uses a presigned URL — and only once.
    const url = new URL(await new ObjectStorageService().getObjectEntityUploadURL());
    expect((await request(app).put(url.pathname).set("Content-Type", "application/octet-stream").send("data")).status).toBe(200);
    expect((await request(app).put(url.pathname).send("again")).status).toBe(404);
    const again = new URL(await new ObjectStorageService().getObjectEntityUploadURL());
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try { expect((await request(app).put(again.pathname).send("data")).status).toBe(404); }
    finally { process.env.NODE_ENV = prev; }
  });
});
