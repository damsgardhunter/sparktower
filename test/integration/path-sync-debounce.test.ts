/**
 * The path reconcile runs at most once a window, and immediately when asked.
 *
 * `/api/projects/:id/path` is polled every fifteen seconds by every open
 * dashboard, and it used to reconcile the board on each one: a read-modify-
 * write under a per-project advisory lock, finding nothing to do almost every
 * time, serialising everybody looking at the same project behind one lock.
 *
 * What is checked here is the observable part of the fix — that the second
 * read inside the window does not do the work, that a caller who knows
 * something changed still can, and that a change to the inputs re-runs it
 * without anybody asking.
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { getTestApp } from "../helpers/app";
import { verifyEmail } from "../helpers/verify-email";
import { syncPathTree } from "../../server/phase-trees";
import { db } from "../../server/db";
import { pathSyncState } from "@shared/schema";
import { and, eq } from "drizzle-orm";

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

let app: any;

/*
 * Built per test, not once: the suite truncates every table in a `beforeEach`
 * (test/setup/each-test.ts), so a fixture made in `beforeAll` is gone by the
 * time the first test body runs.
 */
async function aProject() {
  app ??= await getTestApp();
  const agent = request.agent(app);
  const email = `path-sync-${stamp()}@example.test`;
  await agent.post("/api/auth/register").send({ email, password: "Rt7wqz!Mk4vLp", firstName: "Pat" }).expect(201);
  await verifyEmail(app, email);
  await agent.post("/api/profile/complete-onboarding")
    .send({ displayName: "Pat Sync", headline: "measuring", bio: "the reconcile" }).expect(200);
  const made = await agent.post("/api/projects")
    .send({ title: "Sync Co", description: "A project for checking how often the path reconciles itself.", category: "saas", goal: "ship_mvp", subcategory: "saas" })
    .expect(200);
  return { projectId: made.body.id as string, goal: made.body.goal as string, subcategory: made.body.subcategory as string };
}

const syncedAt = async (projectId: string, goal: string) => {
  const [row] = await db.select({ at: pathSyncState.syncedAt, key: pathSyncState.syncedKey })
    .from(pathSyncState)
    .where(and(eq(pathSyncState.projectId, projectId), eq(pathSyncState.goal, goal)));
  return row;
};

describe("the path reconcile", () => {
  it("records when it ran", async () => {
    const { projectId, goal, subcategory } = await aProject();
    await syncPathTree(projectId, goal as any, subcategory, null);
    const row = await syncedAt(projectId, goal);
    expect(row?.at).toBeTruthy();
    expect(row?.key).toContain(goal);
  }, 30_000);

  it("does nothing on the next read inside the window", async () => {
    const { projectId, goal, subcategory } = await aProject();
    await syncPathTree(projectId, goal as any, subcategory, null);
    const first = await syncedAt(projectId, goal);
    expect(first?.at, "the first reconcile recorded nothing").toBeTruthy();
    await syncPathTree(projectId, goal as any, subcategory, null);
    const second = await syncedAt(projectId, goal);
    // Unchanged: it never reached the work, so it never recorded a new time.
    expect(second?.at?.getTime()).toBe(first?.at?.getTime());
  }, 30_000);

  it("runs anyway for a caller that knows something changed", async () => {
    const { projectId, goal, subcategory } = await aProject();
    await syncPathTree(projectId, goal as any, subcategory, null);
    const before = await syncedAt(projectId, goal);
    await new Promise((r) => setTimeout(r, 10));
    await syncPathTree(projectId, goal as any, subcategory, null, { force: true });
    const after = await syncedAt(projectId, goal);
    expect(after!.at!.getTime()).toBeGreaterThan(before!.at!.getTime());
  }, 30_000);

  /*
   * The property that makes the window safe to have at all: answering a route
   * question rewrites which phases the path shows, and must not wait.
   */
  it("runs again when an input changes, without being forced", async () => {
    const { projectId, goal, subcategory } = await aProject();
    await syncPathTree(projectId, goal as any, subcategory, null);
    const before = await syncedAt(projectId, goal);
    await new Promise((r) => setTimeout(r, 10));
    await syncPathTree(projectId, goal as any, subcategory, "loan");
    const after = await syncedAt(projectId, goal);
    expect(after!.at!.getTime()).toBeGreaterThan(before!.at!.getTime());
    expect(after!.key).toContain("loan");
  }, 30_000);
});
