/**
 * An audit while it runs is visible to everyone on the project: started from
 * the editor bridge or the web, it shows as running with its stage, and when
 * it ends the status says how — the audit it produced, or what went wrong. A
 * run a crashed server left unfinished stops reading as running.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

let reply: any = {};
let gate: Promise<void> = Promise.resolve();
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async () => { await gate; return { choices: [{ message: { content: typeof reply === "string" ? reply : JSON.stringify(reply) } }] }; } } };
    responses = { create: async () => { await gate; return { output_text: JSON.stringify(reply), output: [] }; } };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users, codeAuditRuns } = await import("@shared/schema");
const { eq, sql } = await import("drizzle-orm");
afterAll(async () => { await closeTestApp(); });

const audit = {
  stage: "mvp", completionPercent: 40, summary: "A small app.", stackSummary: "Express",
  capabilities: [], built: [], partial: [], missing: [], undocumented: [], risks: [],
  taskReconciliation: { looksDone: [], notStarted: [] }, milestones: [], loops: [], nextThreeThings: [],
  catchUpNote: "", operations: [],
  securityPlan: [
    { title: "Add security headers", severity: "high", why: "No helmet.", fix: "app.use(helmet()) in server/index.ts", files: ["server/index.ts", "server/made-up.ts"], checkId: "security-headers" },
    { title: "No fix given", severity: "high", why: "x" },
  ],
};
const files = [
  { path: "package.json", content: JSON.stringify({ name: "runs", dependencies: { express: "4" } }) },
  { path: "server/index.ts", content: "import express from 'express'; express().get('/api/x', (_q, r) => r.json({}));" },
];

describe("audit runs", () => {
  it("show as running while the audit works, then say how it ended", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const email = `runs-${Date.now()}@example.test`;
    await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.231").send({ email, password: "Testpass123!", firstName: "Runner" });
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.email, email));
    const project = (await agent.post("/api/projects").send({ title: "Run Status", description: "A project whose audits should show while they run.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const token = (await agent.post("/api/mcp-tokens").send({ label: "editor" })).body.token;
    const status = async () => (await agent.get(`/api/projects/${project.id}/code-audit/status`)).body;

    expect(await status()).toEqual({ running: null, last: null });

    // Hold Nova's answer so the run can be seen mid-flight.
    let release!: () => void;
    gate = new Promise((r) => { release = r; });
    reply = audit;
    const pending = request(app).post(`/api/mcp/projects/${project.id}/audit`).set("authorization", `Bearer ${token}`).send({ files, label: "my-branch" }).then((r) => r);
    let mid: any = null;
    for (let i = 0; i < 40 && !mid?.running; i++) { await new Promise((r) => setTimeout(r, 100)); mid = await status(); }
    expect(mid.running).toMatchObject({ source: "worktree:my-branch", stage: "reading", startedBy: { firstName: "Runner" } });
    expect(mid.last).toBeNull();

    release();
    const done = await pending;
    expect(done.status).toBe(200);
    const after = await status();
    expect(after.running).toBeNull();
    expect(after.last).toMatchObject({ source: "worktree:my-branch", auditId: done.body.audit.id, error: null });

    // Security before release: the deterministic checklist rides on the audit, and Nova's plan is kept to real files.
    const security = done.body.audit.findings.security;
    expect(security.checks.length).toBeGreaterThan(15);
    expect(security.checks.find((c: any) => c.id === "security-headers").status).toBe("missing");
    expect(typeof security.score).toBe("number");
    expect(security.plan).toEqual([expect.objectContaining({ title: "Add security headers", files: ["server/index.ts"], checkId: "security-headers" })]);

    // A run whose answer can't be read ends with an error, not stuck as running.
    gate = Promise.resolve();
    reply = "this is not json";
    const bad = await request(app).post(`/api/mcp/projects/${project.id}/audit`).set("authorization", `Bearer ${token}`).send({ files, label: "broken" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const failed = await status();
    expect(failed.running).toBeNull();
    expect(failed.last).toMatchObject({ source: "worktree:broken", auditId: null });
    expect(failed.last.error).toBeTruthy();

    // The web route: a URL that isn't GitHub ends its run at once.
    const notGithub = await agent.post(`/api/projects/${project.id}/code-audit`).send({ repoUrl: "https://example.com/nope" });
    expect(notGithub.status).toBe(400);
    expect((await status()).running).toBeNull();

    // A run a crash left open reads as over after a while.
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    await db.insert(codeAuditRuns).values({ projectId: project.id, startedById: user.id, source: "github:old/crash", stage: "reading", startedAt: sql`now() - interval '20 minutes'` } as any);
    expect((await status()).running).toBeNull();
    await db.insert(codeAuditRuns).values({ projectId: project.id, startedById: user.id, source: "github:now/running", stage: "fetching" } as any);
    expect((await status()).running).toMatchObject({ source: "github:now/running", stage: "fetching" });

    // Only the team can see it.
    const stranger = request.agent(app);
    await stranger.post("/api/auth/register").set("x-forwarded-for", "203.0.113.232").send({ email: `runs-x-${Date.now()}@example.test`, password: "Testpass123!" });
    expect((await stranger.get(`/api/projects/${project.id}/code-audit/status`)).status).toBe(403);
  });
});
