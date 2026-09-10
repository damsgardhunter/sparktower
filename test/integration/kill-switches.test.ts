/**
 * A surface that is off answers 404 for everything under its prefixes,
 * including the writes that matter most under an incident: new accounts,
 * uploads, and Nova. Sign-in never goes behind a switch.
 */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

async function setSurface(id: string, enabled: boolean) {
  const { db } = await import("../../server/db");
  const { surfaceFlags } = await import("@shared/schema");
  const { loadSurfaceFlags } = await import("../../server/surfaces");
  await db.insert(surfaceFlags).values({ surfaceId: id, enabled } as any).onConflictDoUpdate({ target: surfaceFlags.surfaceId, set: { enabled } as any });
  await loadSurfaceFlags();
}
afterEach(async () => {
  const { loadSurfaceFlags } = await import("../../server/surfaces");
  await loadSurfaceFlags();
});

const password = "Testpass123!";
async function signedIn(app: any, tag: string) {
  const agent = request.agent(app);
  const email = `ks-${tag}-${Date.now()}@example.test`;
  await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.100").send({ email, password });
  return { agent, email };
}

describe("kill switches", () => {
  it("closes registration on web and mobile while sign-in keeps working", async () => {
    const app = await getTestApp();
    const { email } = await signedIn(app, "before");
    await setSurface("signup", false);
    expect((await request(app).post("/api/auth/register").set("x-forwarded-for", "203.0.113.101").send({ email: `late-${Date.now()}@example.test`, password })).status).toBe(404);
    expect((await request(app).post("/api/auth/mobile/register").set("x-forwarded-for", "203.0.113.102").send({ email: `late2-${Date.now()}@example.test`, password })).status).toBe(404);
    expect((await request(app).post("/api/auth/login").set("x-forwarded-for", "203.0.113.103").send({ email, password })).status).toBe(200);
    await setSurface("signup", true);
    expect((await request(app).post("/api/auth/register").set("x-forwarded-for", "203.0.113.104").send({ email: `open-${Date.now()}@example.test`, password })).status).toBe(201);
  });

  it("closes uploads and Nova for everyone, including sub-routes, and reopens", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "nova");
    const project = await agent.post("/api/projects").send({ title: "Switch", description: "A project used to check that a surface that is off answers 404.", category: "saas", goal: "ship_mvp", subcategory: "saas" });
    const id = project.body.id;
    await setSurface("uploads", false);
    expect((await agent.post("/api/uploads/request-url").send({ name: "x.png", size: 10, type: "image/png" })).status).toBe(404);
    await setSurface("nova", false);
    expect((await agent.post(`/api/projects/${id}/path/work`).send({ taskId: "x" })).status).toBe(404);
    expect((await agent.post(`/api/projects/${id}/nova/suggest`).send({})).status).toBe(404);
    expect((await agent.post("/api/chat").send({ message: "hi" })).status).toBe(404);
    // Neighbouring routes with a similar prefix are untouched.
    expect((await agent.put(`/api/projects/${id}/nova-notes`).send({ notes: "still here" })).status).toBe(200);
    expect((await agent.get(`/api/projects/${id}/path`)).status).toBe(200);
    await setSurface("nova", true); await setSurface("uploads", true);
    expect((await agent.post(`/api/projects/${id}/path/work`).send({ taskId: "x" })).status).not.toBe(404);
  });
});
