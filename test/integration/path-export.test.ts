/**
 * Taking the path away as a document.
 *
 * Everything Nova writes lands on a task's description, which is where the
 * work belongs while it is being done and a bad place to keep it afterwards: a
 * builder who had paid for a whole business had twenty-five task descriptions
 * and nothing to send a bank. This assembles them, and the cases worth pinning
 * are what it leaves out (a step still showing its own brief), what it costs
 * (nothing), and who can ask for it.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { db } from "../../server/db";
import { users, projectKanbanTasks } from "@shared/schema";

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any) {
  n += 1;
  const email = `export-${Date.now()}-${n}@example.test`;
  const ip = `203.0.117.${(n % 200) + 20}`;
  const agent = request.agent(app);
  const reg = await agent.post("/api/auth/register").set("x-forwarded-for", ip)
    .send({ email, password: "a-good-passphrase-here", firstName: "Ex" });
  expect(reg.status, JSON.stringify(reg.body)).toBe(201);
  await verifyEmail(app, email, ip);
  const project = await agent.post("/api/projects").send({
    title: "Quill & Co", description: "A landscaping company being systemised, whose path should come out as a document.",
    category: "Trades & Home Services", goal: "systemize_business", subcategory: "service",
  });
  expect(project.status).toBe(200);
  return { agent, userId: reg.body.id as string, projectId: project.body.id as string };
}

/** Answer a step the way the product does: write on it and finish it. */
async function answer(projectId: string, backboneId: string, text: string) {
  const rows = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  const task = rows.find((t) => (t.tags ?? []).includes(`backbone:${backboneId}`));
  expect(task, `no task for ${backboneId}`).toBeTruthy();
  await db.update(projectKanbanTasks).set({ description: text, status: "done", completedAt: new Date() })
    .where(eq(projectKanbanTasks.id, task!.id));
  return task!;
}

describe("taking the path away", () => {
  it("offers nothing while nothing is written, then the answers once there are some", async () => {
    const app = await getTestApp();
    const b = await builder(app);

    // A fresh path is all brief and no answers: there is nothing to send.
    const empty = await b.agent.get(`/api/projects/${b.projectId}/path/export/summary?goal=systemize_business`);
    expect(empty.status).toBe(200);
    expect(empty.body.steps, "an untouched path exports nothing").toBe(0);
    const refused = await b.agent.get(`/api/projects/${b.projectId}/path/export?goal=systemize_business`);
    expect(refused.status, "and says so rather than sending an empty document").toBe(409);
    expect(refused.body.code).toBe("nothing_written");

    await answer(b.projectId, "SYS.F1.1", "Cash $25k–$100k, credit 740+, eleven years in, already running one.");
    await answer(b.projectId, "SYS.F1.2", "Three vans, nine people, $780k a year, and every quote goes through me.");

    const summary = await b.agent.get(`/api/projects/${b.projectId}/path/export/summary?goal=systemize_business`);
    expect(summary.body.steps).toBe(2);
    expect(summary.body.goalLabel).toBe("Systemize a business");
  });

  it("sends Markdown with the answers in path order, and never the briefs", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    await answer(b.projectId, "SYS.F1.1", "The first answer, about where we stand.");
    await answer(b.projectId, "SYS.F1.2", "The second answer, about the business today.");

    const res = await b.agent.get(`/api/projects/${b.projectId}/path/export?goal=systemize_business&format=md`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/markdown/);
    expect(res.headers["content-disposition"], "a name a filesystem and a header both accept").toMatch(/attachment; filename="[\w-]+\.md"/);

    const md = res.text;
    expect(md).toContain("# Quill & Co");
    expect(md).toContain("The first answer, about where we stand.");
    expect(md).toContain("The second answer, about the business today.");
    expect(md.indexOf("The first answer"), "path order, not table order").toBeLessThan(md.indexOf("The second answer"));

    /*
     * The briefs stay out. Every unanswered milestone still carries the text
     * the path authored it with, and a document padded with its own
     * instructions is worse than a short one.
     */
    const rows = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, b.projectId));
    const untouched = rows.find((t) => t.status !== "done" && (t.description ?? "").length > 40);
    expect(untouched, "the path has unanswered steps to check against").toBeTruthy();
    expect(md).not.toContain(untouched!.description!.slice(0, 40));
  });

  it("renders a real PDF", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    await answer(b.projectId, "SYS.F1.1", "Something worth sending to a bank.");

    const res = await b.agent.get(`/api/projects/${b.projectId}/path/export?goal=systemize_business`).buffer();
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    expect(res.body.subarray(0, 5).toString(), "a PDF, not an error page with a PDF label").toBe("%PDF-");
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it("costs nothing — it is their own writing, handed back", async () => {
    const app = await getTestApp();
    const b = await builder(app);
    await answer(b.projectId, "SYS.F1.1", "An answer they already have.");

    const [before] = await db.select().from(users).where(eq(users.id, b.userId));
    for (let i = 0; i < 3; i++) {
      expect((await b.agent.get(`/api/projects/${b.projectId}/path/export?goal=systemize_business&format=md`)).status).toBe(200);
    }
    const [after] = await db.select().from(users).where(eq(users.id, b.userId));
    expect(after.creditsUsed, "an export took an action off the allowance").toBe(before.creditsUsed);
    expect(after.balanceCents, "an export took money").toBe(before.balanceCents);
  });

  it("is refused to anyone not on the project", async () => {
    const app = await getTestApp();
    const owner = await builder(app);
    await answer(owner.projectId, "SYS.F1.1", "Private working notes about the business.");
    const stranger = await builder(app);

    const res = await stranger.agent.get(`/api/projects/${owner.projectId}/path/export?goal=systemize_business&format=md`);
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("Private working notes");
  });
});
