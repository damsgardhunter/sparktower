/**
 * The project surface beyond creation: milestones, the activity log,
 * members, following. Who may do what, and what gets recorded.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
async function signedIn(app: any, tag: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.80").send({ email: `proj-${tag}-${Date.now()}@example.test`, password });
  return { agent, userId: res.body.id as string };
}
const aProject = (title: string) => ({ title, description: `${title}: a project used to exercise the project API beyond creation.`, category: "saas", goal: "ship_mvp", subcategory: "saas" });

describe("milestones", () => {
  it("are member-only to create, edit and delete, and creation lands in the activity log", async () => {
    const app = await getTestApp();
    const owner = await signedIn(app, "owner");
    const stranger = await signedIn(app, "stranger");
    const id = (await owner.agent.post("/api/projects").send(aProject("Milestones"))).body.id;

    expect((await stranger.agent.post(`/api/projects/${id}/milestones`).send({ title: "Sneak" })).status).toBe(403);
    const created = await owner.agent.post(`/api/projects/${id}/milestones`).send({ title: "First users", description: "Ten people using it", targetDate: "2026-10-01" });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ projectId: id, title: "First users", status: "planned" });

    // The path gave the project its own milestones; ours is among them.
    const list = (await owner.agent.get(`/api/projects/${id}/milestones`)).body;
    expect(list.some((m: any) => m.id === created.body.id)).toBe(true);
    expect((await stranger.agent.get(`/api/projects/${id}/milestones`)).status).toBe(403);

    expect((await stranger.agent.patch(`/api/milestones/${created.body.id}`).send({ title: "Hijacked" })).status).toBe(403);
    const edited = await owner.agent.patch(`/api/milestones/${created.body.id}`).send({ status: "in-progress" });
    expect(edited.body).toMatchObject({ title: "First users", status: "in-progress" });
    expect((await owner.agent.patch(`/api/milestones/00000000-0000-0000-0000-000000000000`).send({ title: "x" })).status).toBe(404);

    const activity = (await owner.agent.get(`/api/projects/${id}/activity`)).body;
    expect(activity.some((a: any) => a.action === "created milestone" && a.entityId === created.body.id)).toBe(true);
    expect((await stranger.agent.get(`/api/projects/${id}/activity`)).status).toBe(403);

    expect((await stranger.agent.delete(`/api/milestones/${created.body.id}`)).status).toBe(403);
    expect((await owner.agent.delete(`/api/milestones/${created.body.id}`)).status).toBe(200);
    expect((await owner.agent.get(`/api/projects/${id}/milestones`)).body.some((m: any) => m.id === created.body.id)).toBe(false);
  });
});

describe("following and members", () => {
  it("toggles a follow, counts followers, lists members, and lets only the owner or the member edit a membership", async () => {
    const app = await getTestApp();
    const owner = await signedIn(app, "o2");
    const fan = await signedIn(app, "fan");
    const id = (await owner.agent.post("/api/projects").send(aProject("Follow"))).body.id;

    expect((await request(app).post(`/api/projects/${id}/follow`)).status).toBe(401);
    expect((await fan.agent.post(`/api/projects/${id}/follow`)).body).toEqual({ following: true });
    expect((await fan.agent.get(`/api/projects/${id}/follow-status`)).body).toMatchObject({ following: true, count: 1 });
    expect((await request(app).get(`/api/projects/${id}/followers`)).status).toBe(200);
    expect((await fan.agent.post(`/api/projects/${id}/follow`)).body).toEqual({ following: false });
    expect((await fan.agent.get(`/api/projects/${id}/follow-status`)).body).toMatchObject({ following: false, count: 0 });

    const members = (await request(app).get(`/api/projects/${id}/members`)).body;
    expect(Array.isArray(members)).toBe(true);
    expect(members.some((m: any) => m.userId === owner.userId)).toBe(true);
    // A stranger can't edit the owner's membership; the owner can.
    expect((await fan.agent.patch(`/api/projects/${id}/members/${owner.userId}`).send({ role: "admin" })).status).toBe(403);
    expect((await owner.agent.patch(`/api/projects/${id}/members/${owner.userId}`).send({ role: "owner" })).status).toBe(200);
  });
});
