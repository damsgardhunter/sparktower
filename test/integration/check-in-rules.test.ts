/**
 * Check-ins beyond the happy path: field validation, one per week that
 * updates rather than duplicates, visibility and the feedback queue, a
 * private project's check-ins staying inside it, and author-only edits.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { getTestApp, closeTestApp } from "../helpers/app";

afterAll(async () => { await closeTestApp(); });

const password = "Testpass123!";
async function signedIn(app: any, tag: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.90").send({ email: `ci-${tag}-${Date.now()}@example.test`, password });
  return { agent, userId: res.body.id as string };
}
const aProject = (title: string, extra: Record<string, unknown> = {}) => ({ title, description: `${title}: a project used to exercise the rules around check-ins.`, category: "saas", goal: "ship_mvp", subcategory: "saas", ...extra });
// Proof has to say what shipped ("shipped", "merged", "wrote"…) and the next step has to start with a verb: those are the rules under test.
const aCheckIn = (over: Record<string, unknown> = {}) => ({ goal: "Get the planner generating a week", proof: "Shipped the generator wired to the fridge screen; it works end to end", nextStep: "Add a shopping list export", ...over });

describe("check-in rules", () => {
  it("validates fields, and a second check-in in the same week updates the first", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "week");
    const id = (await agent.post("/api/projects").send(aProject("Weekly"))).body.id;
    const bad = await agent.post(`/api/projects/${id}/check-ins`).send({ goal: "x", proof: "", nextStep: "" });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.errors).sort()).toEqual(["goal", "nextStep", "proof"]);
    // Each rule says what to type, not what was wrong.
    const vague = await agent.post(`/api/projects/${id}/check-ins`).send(aCheckIn({ proof: "Worked on it a lot and made progress", nextStep: "the shopping list" }));
    expect(vague.status).toBe(422);
    expect(vague.body.errors.proof).toMatch(/say what shipped/);
    expect(vague.body.errors.nextStep).toMatch(/Start with a verb/);

    const first = await agent.post(`/api/projects/${id}/check-ins`).send(aCheckIn());
    expect(first.status).toBe(200);
    const second = await agent.post(`/api/projects/${id}/check-ins`).send(aCheckIn({ proof: "Merged it properly this time, with tests behind it" }));
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const list = (await agent.get(`/api/projects/${id}/check-ins`)).body;
    expect(list).toHaveLength(1);
    expect(list[0].proof).toMatch(/properly this time/);
  });

  it("puts only public check-ins that ask for feedback in the queue, and only from public projects", async () => {
    const app = await getTestApp();
    const { agent } = await signedIn(app, "queue");
    const pub = (await agent.post("/api/projects").send(aProject("Public"))).body.id;
    const unlisted = await agent.post(`/api/projects/${pub}/check-ins`).send(aCheckIn({ needsFeedback: true, visibility: "unlisted" }));
    expect(unlisted.body.visibility).toBe("unlisted");
    let queue = (await request(app).get("/api/check-ins/queue/needs-feedback")).body as any[];
    expect(queue.some((c) => c.id === unlisted.body.id)).toBe(false);

    // Flip it public: now it's in the queue. Flip needsFeedback off: gone.
    await agent.patch(`/api/check-ins/${unlisted.body.id}`).send({ visibility: "public" }).expect(200);
    queue = (await request(app).get("/api/check-ins/queue/needs-feedback")).body;
    expect(queue.some((c) => c.id === unlisted.body.id)).toBe(true);
    await agent.patch(`/api/check-ins/${unlisted.body.id}`).send({ needsFeedback: false }).expect(200);
    queue = (await request(app).get("/api/check-ins/queue/needs-feedback")).body;
    expect(queue.some((c) => c.id === unlisted.body.id)).toBe(false);
  });

  it("keeps a private project's check-ins inside the project whatever the link says, and lets only the author edit or delete", async () => {
    const app = await getTestApp();
    const author = await signedIn(app, "author");
    const stranger = await signedIn(app, "stranger");
    const id = (await author.agent.post("/api/projects").send(aProject("Private"))).body.id;
    // The free tier has no private-project quota, so the flag is set directly: the rule under test is what a private project does to its check-ins.
    const { db } = await import("../../server/db");
    const { projects } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(projects).set({ isPrivate: true }).where(eq(projects.id, id));
    const ci = await author.agent.post(`/api/projects/${id}/check-ins`).send(aCheckIn({ visibility: "public", needsFeedback: true }));
    expect(ci.status).toBe(200);
    // The stricter setting wins: public check-in, private project, stranger sees nothing.
    expect((await stranger.agent.get(`/api/check-ins/${ci.body.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/check-ins/${ci.body.id}`)).status).toBe(404);
    expect((await author.agent.get(`/api/check-ins/${ci.body.id}`)).status).toBe(200);
    expect(((await request(app).get("/api/check-ins/queue/needs-feedback")).body as any[]).some((c) => c.id === ci.body.id)).toBe(false);
    expect((await stranger.agent.get(`/api/projects/${id}/check-ins`)).status).toBe(403);

    expect((await stranger.agent.patch(`/api/check-ins/${ci.body.id}`).send({ visibility: "unlisted" })).status).toBe(403);
    expect((await stranger.agent.delete(`/api/check-ins/${ci.body.id}`)).status).toBe(403);
    expect((await author.agent.delete(`/api/check-ins/${ci.body.id}`)).status).toBe(200);
    expect((await author.agent.get(`/api/check-ins/${ci.body.id}`)).status).toBe(404);
    expect((await author.agent.delete(`/api/check-ins/${ci.body.id}`)).status).toBe(404);
  });
});
