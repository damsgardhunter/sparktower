/**
 * An address is the same address however it was typed.
 *
 * Nothing normalised these, and Postgres compares text exactly, so
 * `Hunter@example.test` and `hunter@example.test` were two accounts — the
 * unique constraint allowed both. Two things followed, and a builder hit both:
 *
 *  - Signing in with a different capitalisation than you registered with said
 *    "invalid email or password".
 *  - Signing up with a password and then using Sign in with Google, whose
 *    address comes back in whatever case Google holds, missed the existing
 *    account and made a second one — which then walked the same person into
 *    onboarding as though they were new.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";
import { authStorage } from "../../server/replit_integrations/auth/storage";

afterAll(async () => { await closeTestApp(); });

let n = 0;
const ip = () => `198.51.121.${20 + (n++ % 200)}`;
const password = "Testpass123!";

describe("addresses, whatever case they arrive in", () => {
  it("signs in with the capitalisation you didn't use at sign-up", async () => {
    const app = await getTestApp();
    const local = `Casey.Mixed-${Date.now()}`;
    const typedAtSignup = `${local}@Example.Test`;

    const made = await request(app).post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: typedAtSignup, password, firstName: "Casey" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);

    // Stored as one thing, so every later lookup finds it.
    expect(made.body.email).toBe(typedAtSignup.toLowerCase());

    for (const attempt of [typedAtSignup, typedAtSignup.toLowerCase(), typedAtSignup.toUpperCase()]) {
      const res = await request(app).post("/api/auth/login").set("x-forwarded-for", ip()).send({ email: attempt, password });
      expect(res.status, `signing in as ${attempt}`).toBe(200);
    }
  });

  it("refuses a second account for an address that differs only in case", async () => {
    const app = await getTestApp();
    const address = `dup-${Date.now()}@example.test`;

    expect((await request(app).post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: address, password, firstName: "First" })).status).toBe(201);

    const again = await request(app).post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: address.toUpperCase(), password, firstName: "Second" });
    expect(again.status, "the same person, shouting").toBe(409);
  });

  it("finds the existing account when Google's address is cased differently", async () => {
    /*
     * The Google strategy itself needs Google, but the lookup it depends on is
     * this one — `getUserByEmail` is what decides between linking to the
     * account somebody already has and creating them a second one.
     */
    const app = await getTestApp();
    const address = `google-link-${Date.now()}@example.test`;
    const made = await request(app).post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: address, password, firstName: "Linked" });
    expect(made.status).toBe(201);

    const asGoogleWouldSendIt = address.replace("google-link", "Google-Link").toUpperCase();
    const found = await authStorage.getUserByEmail(asGoogleWouldSendIt);
    expect(found?.id, "Google's capitalisation must find the account, not miss it").toBe(made.body.id);
  });

  it("sends a password reset to an address typed with capitals", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const address = `reset-case-${Date.now()}@example.test`;
    // Signed in, because the outbox is a development convenience and still guarded.
    expect((await agent.post("/api/auth/register").set("x-forwarded-for", ip())
      .send({ email: address, password, firstName: "Reset" })).status).toBe(201);

    // The route answers the same either way on purpose (it never says whether an
    // account exists), so the outbox is what proves the mail was actually sent.
    const asked = await request(app).post("/api/auth/forgot-password").set("x-forwarded-for", ip())
      .send({ email: address.toUpperCase() });
    expect(asked.status).toBe(200);

    const outbox = await agent.get("/api/dev/outbox");
    expect(outbox.status).toBe(200);
    const messages = (outbox.body?.messages ?? outbox.body) as any[];
    const sent = messages.filter((m) => String(m.to ?? "").toLowerCase() === address.toLowerCase());
    expect(sent.length, "a reset email should have gone out").toBeGreaterThan(0);
  });
});
