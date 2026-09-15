/**
 * The retention loop: come back to the next step. Each project's next step is
 * one call away for the home screen; finishing a step tells the rest of the
 * team what's next; a finished step can be shared for feedback, tied to the
 * step; and time away with a step waiting sends one nudge — once.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { projectMembers, projects, notifications, pathPace } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function person(app: any, first: string) {
  const agent = request.agent(app);
  n += 1;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.100.${10 + (n % 200)}`)
    .send({ email: `return-${first}-${Date.now()}-${n}@example.test`, password: "Testpass123!", firstName: first });
  expect(res.status).toBe(201);
  return { agent, id: res.body.id as string };
}
const settle = () => new Promise((r) => setTimeout(r, 500));
const bell = async (who: { agent: any }) => (await who.agent.get("/api/notifications")).body.items as any[];

describe("coming back to the next step", () => {
  it("shows the next step, tells the team when one is finished, and shares a finished step for feedback", async () => {
    const app = await getTestApp();
    const owner = await person(app, "Owner");
    const mate = await person(app, "Mate");
    const project = (await owner.agent.post("/api/projects").send({ title: "Return Path", description: "A project whose path should bring its builders back.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    await db.insert(projectMembers).values({ projectId: project.id, userId: mate.id, role: "Engineer" } as any);

    const home = (await owner.agent.get("/api/me/next-steps")).body.items;
    expect(home[0]).toMatchObject({ project: { id: project.id, title: "Return Path" }, next: { id: "SHIP.M1.1", title: "Product statement" }, lastDone: null });

    // The teammate finishes the step: the owner hears, with what's next; the teammate doesn't hear about themselves.
    const tasks = (await mate.agent.get(`/api/projects/${project.id}/kanban`)).body;
    const statement = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
    await mate.agent.patch(`/api/kanban/${statement.id}`).send({ status: "done", description: "Plan a week of dinners from your fridge." }).expect(200);
    await settle();
    expect((await bell(owner)).find((x) => x.kind === "path_step_done")).toMatchObject({
      text: "Mate finished a step on Return Path", href: `/projects/${project.id}/manage`, excerpt: expect.stringMatching(/^Product statement — next: /),
    });
    expect((await bell(mate)).some((x) => x.kind === "path_step_done")).toBe(false);

    // The path shows what was just finished, and the home screen offers to share it.
    const path = (await owner.agent.get(`/api/projects/${project.id}/path`)).body;
    expect(path.next.id).not.toBe("SHIP.M1.1");
    expect(path.lastDone).toMatchObject({ taskId: statement.id, title: "Product statement", sharedPostId: null });

    // Sharing it: only a finished step on this project's path.
    const open = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.3"));
    expect((await owner.agent.post("/api/feed").send({ postType: "project_update", projectId: project.id, content: "x", pathTaskId: open.id })).body.field).toBe("pathTaskId");
    expect((await owner.agent.post("/api/feed").send({ postType: "project_update", content: "x", pathTaskId: statement.id })).status).toBe(400);
    const shared = await owner.agent.post("/api/feed").send({ postType: "project_update", projectId: project.id, content: 'Just finished "Product statement".', asks: ["Does this say who it's for?"], pathTaskId: statement.id });
    expect(shared.status, JSON.stringify(shared.body).slice(0, 200)).toBe(200);
    expect(shared.body).toMatchObject({ entityType: "path_step", entityId: statement.id, pathStep: { taskId: statement.id, title: "Product statement" } });
    expect((await owner.agent.get("/api/me/next-steps")).body.items[0].lastDone).toMatchObject({ sharedPostId: shared.body.id });

    // Feedback on the shared step brings the builder back to it.
    const stranger = await person(app, "Reader");
    await stranger.agent.post(`/api/feed/${shared.body.id}/comments`).send({ content: "It says what, not who." }).expect(200);
    await settle();
    expect((await bell(owner)).find((x) => x.kind === "comment")).toMatchObject({ href: `/posts/${shared.body.id}` });
  });

  it("tells the whole team when nobody on it finished the step, and nudges once after time away", async () => {
    const app = await getTestApp();
    const solo = await person(app, "Solo");
    const project = (await solo.agent.post("/api/projects").send({ title: "Quiet Path", description: "A project its builder stepped away from for a few days.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;

    // A solo builder finishing their own step hears nothing about it.
    const tasks = (await solo.agent.get(`/api/projects/${project.id}/kanban`)).body;
    const first = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
    await solo.agent.patch(`/api/kanban/${first.id}`).send({ status: "done" }).expect(200);
    await settle();
    expect((await bell(solo)).some((x) => x.kind === "path_step_done")).toBe(false);

    // Nova's answer chosen (no person completed it): the owner is told.
    const { saveWork, chooseWork } = await import("../../server/phase-trees");
    const scope = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.2"));
    const work = await saveWork(project.id, scope.id, { kind: "options", intro: "", options: [{ title: "A", body: "1. a 2. b 3. back to 1" }] } as any);
    await chooseWork(project.id, work.id, { index: 0 });
    await settle();
    expect((await bell(solo)).find((x) => x.kind === "path_step_done")).toMatchObject({ text: "Solo finished a step on Quiet Path" });

    // Away three days with a step waiting: one nudge, for that step, and only once.
    await db.update(projects).set({ createdAt: sql`now() - interval '10 days'` } as any).where(eq(projects.id, project.id));
    await db.execute(sql`update project_kanban_tasks set completed_at = now() - interval '3 days' where project_id = ${project.id} and completed_at is not null`);
    await db.execute(sql`update path_pace_events set created_at = now() - interval '3 days' where project_id = ${project.id}`);
    await db.delete(pathPace).where(eq(pathPace.projectId, project.id));
    const away = (await solo.agent.get("/api/me/next-steps")).body.items.find((i: any) => i.project.id === project.id);
    expect(away.daysSinceActivity).toBeGreaterThanOrEqual(2);
    await settle();
    const nudges = (await bell(solo)).filter((x) => x.kind === "next_step");
    expect(nudges).toEqual([expect.objectContaining({ text: "Your next step on Quiet Path is ready", href: `/projects/${project.id}/manage`, excerpt: away.next.step ?? away.next.title })]);
    await solo.agent.post("/api/notifications/read").send({ all: true }).expect(200);
    await solo.agent.get("/api/me/next-steps").expect(200);
    await settle();
    const rows = await db.select().from(notifications).where(eq(notifications.kind, "next_step"));
    expect(rows.filter((r) => r.projectId === project.id)).toHaveLength(1);
    expect(rows.find((r) => r.projectId === project.id)?.readAt).not.toBeNull();
  });
});
