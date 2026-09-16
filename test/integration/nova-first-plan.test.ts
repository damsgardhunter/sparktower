/**
 * A new project's first plan: asked, previewed, and only then on the board.
 *
 * The questions come from the project's own prompt pack, so what a website
 * project is asked differs from what a restaurant is asked. The plan itself is
 * preview-first, like every other Nova surface here: a builder who doesn't like
 * it has lost a look, not a board full of tasks to delete. And an unreadable
 * answer costs nothing, which is the rule for every AI route in this codebase.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

let mode: "ok" | "garbage" = "ok";
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async () => ({
      choices: [{ message: { content: mode === "garbage" ? "Sorry, I can't do that." : JSON.stringify({
        summary: "Get one page live that books calls.",
        steps: [
          { title: "Make the booking link work end to end", done: "A stranger can pick a time and you get the invite", why: "Everything else points at this" },
          { title: "Put the page at a URL", done: "A public URL opens a readable page on a phone" },
          { title: "Write what you charge", done: "The page states a price a founder can act on" },
        ],
      }) } }],
    }) } };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users, projectKanbanTasks } = await import("@shared/schema");
const { verifyEmail } = await import("../helpers/verify-email");

afterAll(async () => { await closeTestApp(); });

let n = 0;
async function builder(app: any) {
  n += 1;
  const agent = request.agent(app);
  const email = `plan-${Date.now()}-${n}@example.test`;
  const res = await agent.post("/api/auth/register").set("x-forwarded-for", `198.51.111.${10 + n}`).send({ email, password: "Testpass123!", firstName: "Planner" });
  expect(res.status).toBe(201);
  await verifyEmail(app, email, `198.51.112.${10 + n}`);
  // Paid features: the first plan is behind the same entitlement as Nova's other help.
  await db.update(users).set({ subscriptionTier: "builder" }).where(eq(users.id, res.body.id));
  return { agent, id: res.body.id as string };
}
// Distinct text per project: identical descriptions are refused as duplicate content, as they should be.
const project = (agent: any, subcategory: string) => agent.post("/api/projects").send({
  title: `Copy that converts ${subcategory} ${Date.now()}`,
  description: `A landing page for ${subcategory} work, so people stop asking for a portfolio over email (${Math.random().toString(36).slice(2, 8)}).`,
  category: "saas", goal: "ship_mvp", subcategory,
});

describe("a project's first plan", () => {
  it("asks the questions its kind of project turns on, and says whether the pack is written or a stub", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const written = (await project(me.agent, "website")).body;
    const stubbed = (await project(me.agent, "game")).body;

    const forWebsite = await me.agent.get(`/api/projects/${written.id}/nova/first-plan`);
    expect(forWebsite.status, JSON.stringify(forWebsite.body)).toBe(200);
    expect(forWebsite.body.pack).toMatchObject({ key: "ship_mvp:website", status: "live", version: "v1" });
    expect(forWebsite.body.questions.map((q: any) => q.id)).toEqual(["visitor", "action", "proof", "live"]);

    expect(stubbed.id, JSON.stringify(stubbed)).toBeTruthy();
    const forGame = await me.agent.get(`/api/projects/${stubbed.id}/nova/first-plan`);
    expect(forGame.body.pack).toMatchObject({ key: "ship_mvp:game", status: "stub" });
    expect(forGame.body.questions.length).toBeGreaterThan(0);

    // Someone who isn't on the project gets nothing, questions included.
    const outsider = await builder(app);
    expect((await outsider.agent.get(`/api/projects/${written.id}/nova/first-plan`)).status).toBe(403);
  });

  it("previews the plan, and writes it to the board only when asked", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const p = (await project(me.agent, "website")).body;
    const before = (await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, p.id))).length;

    const preview = await me.agent.post(`/api/projects/${p.id}/nova/first-plan`).send({
      answers: { visitor: "A founder whose site doesn't explain what they do", action: "Book a 20-minute call" },
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.plan.steps).toHaveLength(3);
    expect(preview.body.plan.steps[0]).toMatchObject({ title: expect.stringContaining("booking link") });
    expect(preview.body.saved).toBeNull();
    expect((await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, p.id))).length, "a preview writes nothing").toBe(before);

    const saved = await me.agent.post(`/api/projects/${p.id}/nova/first-plan`).send({ save: true, answers: { action: "Book a call" } });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toMatchObject({ created: 3 });

    // On the board, with the "done when" kept and tagged with the pack that wrote them.
    const tasks = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, p.id));
    const mine = tasks.filter((t) => (t.tags ?? []).includes("nova-first-plan"));
    expect(mine).toHaveLength(3);
    expect(mine[0].description).toMatch(/Done when:/);
    expect(mine[0].tags).toContain("pack:ship_mvp:website");
    expect(mine[0].tags).toContain("pack-version:v1");
  });

  it("charges for a plan it could read, and nothing for one it couldn't", async () => {
    const app = await getTestApp();
    const me = await builder(app);
    const p = (await project(me.agent, "website")).body;
    const used = async () => (await db.select({ u: users.creditsUsed }).from(users).where(eq(users.id, me.id)))[0].u;

    const before = await used();
    expect((await me.agent.post(`/api/projects/${p.id}/nova/first-plan`).send({})).status).toBe(200);
    const afterGood = await used();
    expect(afterGood).toBeGreaterThan(before);

    mode = "garbage";
    try {
      const bad = await me.agent.post(`/api/projects/${p.id}/nova/first-plan`).send({});
      expect(bad.status).toBe(502);
      expect(bad.body.code).toBe("model_unreadable");
      expect(await used(), "an answer nobody can read is not charged for").toBe(afterGood);
    } finally { mode = "ok"; }
  });
});
