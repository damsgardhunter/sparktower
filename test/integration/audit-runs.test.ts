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

/**
 * An audit must say what it read, and must not grade what it didn't.
 *
 * Both halves of the same week: audits that reported shipped, tested features
 * as partial or absent because the digest they read was a clipped view, and a
 * builder with no way of telling from the page that it was.
 */
describe("what the audit read", () => {
  it("records the provenance and holds a partial read's 'missing' as unknown", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const email = `prov-${Date.now()}@example.test`;
    await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.233").send({ email, password: "Testpass123!", firstName: "Prov" });
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.email, email));
    const project = (await agent.post("/api/projects").send({ title: "Provenance", description: "A project whose audits should say what they read.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const token = (await agent.post("/api/mcp-tokens").send({ label: "editor" })).body.token;

    gate = Promise.resolve();
    reply = {
      ...audit,
      capabilities: [
        { area: "auth", status: "built", summary: "Sessions in server/index.ts", evidence: [{ file: "server/index.ts" }] },
        { area: "payments", status: "missing", summary: "No payment provider anywhere in the code" },
      ],
      nextThreeThings: ["Build Stripe checkout so the product can charge", "Write the README"],
    };

    /*
     * What makes this a partial view is one *source* file the audit could not
     * open — here, one the editor listed without contents. The lockfile is the
     * control: it is listed and never read too, and it must not count, or
     * every audit of every repository would be partial and no verdict of
     * "missing" could ever survive.
     */
    const listedNotRead = { path: "server/unseen.ts" };
    const partialTree = [...files, { path: "package-lock.json", content: "{}" }, listedNotRead];
    const done = await request(app).post(`/api/mcp/projects/${project.id}/audit`)
      .set("authorization", `Bearer ${token}`).send({ files: partialTree, label: "my-branch" });
    expect(done.status).toBe(200);

    // Returned by the read route, not only by the run that produced it.
    const saved = (await agent.get(`/api/code-audits/${done.body.audit.id}`)).body;
    const prov = saved.findings.scan.provenance;
    expect(prov).toMatchObject({ kind: "worktree", name: "my-branch", ref: null, commit: null, partial: true });
    expect(prov.readCount).toBeLessThan(prov.fileCount);
    expect(Date.parse(prov.capturedAt)).toBeGreaterThan(Date.now() - 120_000);
    expect(saved.findings.scan.provenanceLine).toContain("Editor working tree my-branch");
    expect(prov.unreadSource, "the unread source file, not the lockfile").toBe(1);
    expect(saved.findings.scan.provenanceLine).toMatch(/of \d+ files read — 1 source file unread/);

    // The verdict the audit could not support: a question, not a gap.
    const caps = Object.fromEntries((saved.findings.capabilities as any[]).map((c) => [c.area, c]));
    expect(caps.auth.status).toBe("built");
    expect(caps.payments.status).toBe("unknown");
    expect(caps.payments.note).toMatch(/not the same as it not being there/);

    // And nothing tells the builder to rebuild what the audit never looked for.
    expect(saved.findings.nextThreeThings[0]).toMatch(/UNKNOWN in this audit, not missing/);
    expect(saved.findings.nextThreeThings[1]).toBe("Write the README");
  });

  it("still calls a thing missing when it read every source file there was", async () => {
    /*
     * The other side of the same coin. An audit that can never say a feature
     * is absent cannot tell anybody what to build next, so a complete read
     * must keep its verdicts — a skipped lockfile is not a reason to doubt one.
     */
    const app = await getTestApp();
    const agent = request.agent(app);
    const email = `whole-${Date.now()}@example.test`;
    await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.234").send({ email, password: "Testpass123!", firstName: "Whole" });
    await db.update(users).set({ subscriptionTier: "pro" }).where(eq(users.email, email));
    const project = (await agent.post("/api/projects").send({ title: "Whole read", description: "A project whose audit saw all of its source.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const token = (await agent.post("/api/mcp-tokens").send({ label: "editor" })).body.token;

    gate = Promise.resolve();
    reply = {
      ...audit,
      capabilities: [{ area: "payments", status: "missing", summary: "No payment provider anywhere in the code" }],
      nextThreeThings: ["Build Stripe checkout so the product can charge"],
    };

    const done = await request(app).post(`/api/mcp/projects/${project.id}/audit`)
      .set("authorization", `Bearer ${token}`).send({ files: [...files, { path: "package-lock.json", content: "{}" }], label: "main" });
    expect(done.status).toBe(200);

    const saved = (await agent.get(`/api/code-audits/${done.body.audit.id}`)).body;
    expect(saved.findings.scan.provenance.partial, "a lockfile is not a blind spot").toBe(false);
    expect(saved.findings.scan.provenanceLine).toContain("every source file among them");
    const caps = Object.fromEntries((saved.findings.capabilities as any[]).map((c) => [c.area, c]));
    expect(caps.payments.status, "read it all, so absence means something").toBe("missing");
    expect(saved.findings.nextThreeThings[0]).toBe("Build Stripe checkout so the product can charge");
  });
});
