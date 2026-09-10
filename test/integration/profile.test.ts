/**
 * The profile: created with a display name, edited a field at a time,
 * persisted across a fresh application instance, never reassigned to
 * another user by a crafted body, and onboarding marked complete.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
async function signedIn(app: any, tag: string) {
  const agent = request.agent(app);
  const email = `profile-${tag}-${Date.now()}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.70").send({ email, password });
  return { agent, email, userId: res.body.id as string };
}

describe("profile", () => {
  it("is edited a field at a time, persists every field, and cannot be reassigned by a crafted body", async () => {
    const app = await getTestApp();
    const { agent, userId, email } = await signedIn(app, "a");
    // Registration seeds a profile; without one, a display name is required to create it.
    const initial = await agent.get("/api/profile");
    expect([200, 404]).toContain(initial.status);
    if (initial.status === 404) expect((await agent.post("/api/profile").send({ bio: "No name yet" })).status).toBe(400);

    const created = await agent.post("/api/profile").send({ displayName: "Ada", headline: "Builds planners", skills: ["typescript", "postgres"], hoursPerWeek: 12 });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ userId, displayName: "Ada", headline: "Builds planners", skills: ["typescript", "postgres"], hoursPerWeek: 12 });

    // One field at a time: the rest is untouched.
    const edited = await agent.post("/api/profile").send({ bio: "Cooks on weeknights." });
    expect(edited.body).toMatchObject({ displayName: "Ada", skills: ["typescript", "postgres"], bio: "Cooks on weeknights." });

    // A body that names another user's id or profile id changes nothing about ownership.
    const { userId: other } = await signedIn(app, "b");
    const hijack = await agent.post("/api/profile").send({ userId: other, id: "00000000-0000-0000-0000-000000000000", displayName: "Ada" });
    expect(hijack.status).toBe(200);
    expect(hijack.body.userId).toBe(userId);
    expect(hijack.body.id).toBe(created.body.id);
    expect((await agent.get("/api/profile")).body.displayName).toBe("Ada");

    // Persisted: a fresh application instance, a fresh session, the same profile.
    await closeTestApp();
    const fresh = await getTestApp();
    const relogin = request.agent(fresh);
    await relogin.post("/api/auth/login").set("x-forwarded-for", "203.0.113.71").send({ email, password }).expect(200);
    const back = await relogin.get("/api/profile");
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ id: created.body.id, displayName: "Ada", bio: "Cooks on weeknights.", skills: ["typescript", "postgres"] });
  });

  it("marks onboarding complete, and shows it on the user", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "c");
    await agent.post("/api/profile").send({ displayName: "Grace" }).expect(200);
    expect((await agent.post("/api/profile/complete-onboarding")).body).toEqual({ success: true });
    const me = (await agent.get("/api/auth/user")).body;
    const profile = (await agent.get("/api/profile")).body;
    expect(me.isOnboarded === true || profile.isOnboarded === true).toBe(true);
    // A stranger cannot read or write it.
    expect((await request(app).get("/api/profile")).status).toBe(401);
    expect((await request(app).post("/api/profile").send({ displayName: "X" })).status).toBe(401);
  });
});
