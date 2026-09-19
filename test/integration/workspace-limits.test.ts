/**
 * Writes that used to sit behind the general write floor alone now have limits
 * of their own: new workspace items, follows, applications and contest entries,
 * sprints, Stripe sessions, and calls out to GitHub or a project's database.
 * Each is pushed past its limit through a real endpoint and refused with the
 * shared contract — before the route does any work — and every route in the
 * list carries its limit on the running app.
 */
import { describe, it, expect, afterAll } from "vitest";
import { verifyEmail } from "../helpers/verify-email";
import request from "supertest";
import { sql } from "drizzle-orm";
import { getTestApp, closeTestApp } from "../helpers/app";
import { db } from "../../server/db";
import { rateLimitHits } from "@shared/schema";
import { RATE_LIMITS, type RateLimitAction } from "@shared/moderation";

afterAll(async () => { await closeTestApp(); });

const seedHits = (key: string, action: RateLimitAction, count: number) =>
  db.insert(rateLimitHits).values(Array.from({ length: count }, () => ({ userId: key, action, createdAt: sql`now()` })) as any);

/** Which limit each formerly floor-only write now carries. */
const LIMITED: Record<string, [string, string][]> = {
  workspace: [
    ["post", "/api/projects/:id/kanban"], ["post", "/api/projects/:id/milestones"], ["post", "/api/projects/:id/decisions"],
    ["post", "/api/projects/:id/files"], ["post", "/api/projects/:id/links"], ["post", "/api/projects/:id/personas"],
    ["post", "/api/projects/:id/pricing"], ["post", "/api/projects/:id/experiments"], ["post", "/api/projects/:id/analytics-events"],
    ["post", "/api/projects/:id/legal-docs"], ["post", "/api/projects/:id/deploy-checklist"], ["post", "/api/projects/:id/launch-tasks"],
    ["post", "/api/projects/:id/support-tickets"], ["post", "/api/projects/:id/media"], ["post", "/api/projects/:id/application-questions"],
    ["post", "/api/projects/:id/business-plan"], ["post", "/api/roadmap-phases/:phaseId/create-milestone"],
    ["post", "/api/applications/:id/accept"], ["post", "/api/applications/:id/reject"],
    ["post", "/api/projects/:id/path/branch"], ["post", "/api/projects/:id/path/switch"], ["post", "/api/projects/:id/path/mark"],
    ["post", "/api/projects/:id/path/work/:workId/choose"], ["post", "/api/documents/:docId/publish"],
    ["post", "/api/profile/attach-resume"], ["post", "/api/profile/looking-for"], ["post", "/api/profile/apply-resume-draft"],
  ],
  follow: [["post", "/api/projects/:id/follow"]],
  apply: [["post", "/api/projects/:id/apply"], ["post", "/api/contests/:id/join"], ["post", "/api/contests/:id/submit"]],
  sprint: [["post", "/api/games/solo"]],
  checkout: [
    ["post", "/api/checkout"], ["post", "/api/billing-portal"], 
    ["post", "/api/projects/:id/donate-checkout"], ["post", "/api/stripe/connect-account"], ["post", "/api/stripe/sync-subscription"],
  ],
  external: [
    ["post", "/api/projects/:id/code-audit/check-repo"], ["post", "/api/code-audits/:auditId/apply"],
    ["post", "/api/projects/:id/data-shape/refresh"], ["put", "/api/projects/:id/data-source"],
  ],
};

describe("limits on workspace, social, sprint, payment and outside-service writes", () => {
  it("every listed route carries its own limit on the running app", async () => {
    const app: any = await getTestApp();
    const stack: any[] = (app.router ?? app._router).stack;
    const missing: string[] = [];
    for (const [action, routes] of Object.entries(LIMITED)) {
      for (const [method, path] of routes) {
        const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
        if (!layer) { missing.push(`${method.toUpperCase()} ${path} (not registered)`); continue; }
        // The limiter's name is anonymous, so ask it: a handler that refuses a user already at the limit is the one.
        const limited = layer.route.stack.some((s: any) => s.handle?.length === 3 && String(s.handle).includes("withinRateLimit"));
        if (!limited) missing.push(`${method.toUpperCase()} ${path} (${action})`);
      }
    }
    expect(missing).toEqual([]);
    // And the check can tell: an edit with no limit of its own (the floor covers it) doesn't pass for limited.
    const edit = stack.find((l) => l.route?.path === "/api/kanban/:taskId" && l.route.methods.patch);
    expect(edit.route.stack.some((s: any) => s.handle?.length === 3 && String(s.handle).includes("withinRateLimit"))).toBe(false);
  });

  it("refuses each past its limit with the shared contract, before doing the work", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/register").set("x-forwarded-for", "198.51.100.246")
      .send({ email: `wl-${Date.now()}@example.test`, password: "Testpass123!", firstName: "Limit" });
    expect(res.status).toBe(201);
    // Confirmed, so these calls reach the limiter under test rather than the email gate.
    await verifyEmail(app, res.body.email, "198.51.110.246");
    const me = res.body.id as string;
    const project = (await agent.post("/api/projects").send({
      title: "Limit Test", description: "A project for pushing workspace writes past their limits.", category: "saas", goal: "ship_mvp", subcategory: "saas",
    })).body.id as string;

    const calls: [RateLimitAction, () => request.Test][] = [
      ["workspace", () => agent.post(`/api/projects/${project}/decisions`).send({ title: "One more", decision: "Past the limit." })],
      ["follow", () => agent.post(`/api/projects/${project}/follow`)],
      ["apply", () => agent.post(`/api/projects/${project}/apply`).send({ role: "Engineer", message: "Hi" })],
      ["sprint", () => agent.post("/api/games/solo").send({})],
      ["checkout", () => agent.post("/api/checkout").send({ tier: "starter" })],
      ["external", () => agent.post(`/api/projects/${project}/code-audit/check-repo`).send({ repoUrl: "https://github.com/octocat/hello-world" })],
    ];
    for (const [action, call] of calls) {
      await seedHits(me, action, RATE_LIMITS[action].max);
      const refused = await call();
      expect(refused.status, `${action}: ${JSON.stringify(refused.body).slice(0, 160)}`).toBe(429);
      expect(refused.body).toMatchObject({ code: "rate_limited", action, message: RATE_LIMITS[action].message });
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    }

    // The limit is per person: someone else still gets through.
    const other = request.agent(app);
    await other.post("/api/auth/register").set("x-forwarded-for", "198.51.100.247").send({ email: `wl2-${Date.now()}@example.test`, password: "Testpass123!" });
    const theirs = (await other.post("/api/projects").send({ title: "Theirs", description: "Someone else's project, below every limit.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body.id;
    expect((await other.post(`/api/projects/${theirs}/decisions`).send({ title: "Fine", decision: "Under the limit." })).status).toBe(200);
  });
});
