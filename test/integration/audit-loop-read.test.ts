/**
 * An audit whose first pass couldn't see a loop's proof gives that loop a close
 * read of the files its doc names — and the close read's verdict is the one kept.
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

const prompts: { system: string; user: string }[] = [];
let firstPass: any = {};
let closeRead: any = {};
vi.mock("openai", () => {
  class OpenAI {
    chat = {
      completions: {
        create: async (body: any) => {
          const system = body.messages[0]?.content ?? "", user = body.messages[1]?.content ?? "";
          prompts.push({ system, user });
          const reply = /close read of one loop/.test(system) ? closeRead : firstPass;
          return { choices: [{ message: { content: JSON.stringify(reply) } }] };
        },
      },
    };
    responses = { create: async () => ({ output_text: "{}", output: [] }) };
    images = { generate: async () => { throw new Error("not in tests"); } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { getTestApp, closeTestApp } = await import("../helpers/app");
const { db } = await import("../../server/db");
const { users } = await import("@shared/schema");
const { eq } = await import("drizzle-orm");
afterAll(async () => { await closeTestApp(); });

describe("the close read of an open loop", () => {
  it("reads the files the loop's doc names, and keeps its verdict over the first pass", async () => {
    const app = await getTestApp();
    const agent = request.agent(app);
    const email = `loopread-${Date.now()}@example.test`;
    await agent.post("/api/auth/register").set("x-forwarded-for", "203.0.113.240").send({ email, password: "Testpass123!", firstName: "Admin" });
    await db.update(users).set({ balanceCents: 100_000 }).where(eq(users.email, email));
    const project = (await agent.post("/api/projects").send({ title: "Safety Loop", description: "A project whose admin safety loop is built but outside the digest's sample.", category: "saas", goal: "ship_mvp", subcategory: "saas" })).body;
    const loops = (await agent.get(`/api/projects/${project.id}/path`)).body.loopTree.loops;
    const product = loops.find((l: any) => l.type === "product");
    await agent.patch(`/api/kanban/${product.taskId}`).send({ title: "Admin: review safety signals and act on reports", description: "1. Review reports and rate-limit hits 2. Take a moderation action 3. Monitor its impact 4. Repeat tomorrow", status: "done" });

    // The repository: a doc that maps the loop, and the files it names. Plus filler the first pass sampled instead.
    const files = [
      { path: "docs/safety-loop.md", content: "# The admin safety loop\nReview safety signals, act on reports, monitor impact, repeat.\n| Review | `server/safety-routes.ts`, `client/src/pages/admin-safety.tsx` |\n| Proof | `test/integration/safety-loop.test.ts` |" },
      { path: "server/safety-routes.ts", content: "app.get('/api/admin/safety/review', h); app.get('/api/admin/safety/impact/:logId', h); app.post('/api/admin/safety/review', h);" },
      { path: "client/src/pages/admin-safety.tsx", content: "export default function AdminSafety() { /* renders review, impact, checklist */ return null; }" },
      { path: "test/integration/safety-loop.test.ts", content: "it('records the review and measures impact', () => {});" },
      ...Array.from({ length: 5 }, (_, i) => ({ path: `server/filler-${i}.ts`, content: `export const x${i} = ${i};` })),
    ];
    firstPass = {
      stage: "mvp", completionPercent: 70, summary: "An MVP.", stackSummary: "Express", capabilities: [], built: [], partial: [], missing: [],
      undocumented: [], risks: [], taskReconciliation: { looksDone: [], notStarted: [] }, milestones: [], nextThreeThings: [], operations: [],
      loops: [{ key: "L1", closure: "open", stages: [{ step: "Review", status: "partial", evidence: [] }], breaksAt: "Review→impact not evidenced in the route list excerpt", fix: "Add impact endpoints" }],
    };
    closeRead = {
      closure: "closed",
      stages: [
        { step: "Review reports and rate-limit hits", status: "built", evidence: ["server/safety-routes.ts", "client/src/pages/admin-safety.tsx"] },
        { step: "Monitor impact", status: "built", evidence: ["server/safety-routes.ts"] },
        { step: "Repeat", status: "built", evidence: ["server/safety-routes.ts", "test/integration/safety-loop.test.ts"] },
      ],
      returnPath: { mechanism: "the daily review comes due and starts from what changed since the last one", evidence: ["server/safety-routes.ts"] },
    };
    prompts.length = 0;
    const token = (await agent.post("/api/mcp-tokens").send({ label: "editor" })).body.token;
    const res = await request(app).post(`/api/mcp/projects/${project.id}/audit`).set("authorization", `Bearer ${token}`).send({ files, label: "tree" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);

    // The close read saw the doc, the files it names, and the routes those files register.
    const read = prompts.find((p) => /close read of one loop/.test(p.system))!;
    expect(read).toBeTruthy();
    expect(read.system).toMatch(/first pass, from a sample of the repository, said: open/);
    for (const path of ["docs/safety-loop.md", "server/safety-routes.ts", "client/src/pages/admin-safety.tsx", "test/integration/safety-loop.test.ts"]) expect(read.user).toContain(`### ${path}`);
    expect(read.user).not.toContain("### server/filler-0.ts");

    const verdict = res.body.audit.findings.loops.find((l: any) => l.loopTaskId === product.taskId);
    expect(verdict).toMatchObject({ closure: "closed", returnPath: { mechanism: expect.stringMatching(/daily review/) } });
    expect(verdict.breaksAt).toBe("");
  });
});
