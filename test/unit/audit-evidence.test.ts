/**
 * A close read of one area sees the whole test inventory by path — all of it
 * for the testing and CI areas, the files named for the area elsewhere — plus
 * the CI workflow and test harness in full for the testing area. It can no
 * longer report "not present in the files provided" about a test that exists.
 */
import { describe, it, expect, vi } from "vitest";

const prompts: string[] = [];
vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: async (body: any) => {
      prompts.push(body.messages.map((m: any) => m.content).join("\n"));
      return { choices: [{ message: { content: JSON.stringify({ coverage: "ok", gaps: [], strengths: [] }) } }] };
    } } };
    static default = OpenAI;
  }
  return { default: OpenAI, OpenAI };
});

const { summarizeTestInventory, summarizeMobileScreens } = await import("../../server/audit-evidence");
const { deepReadArea } = await import("../../server/audit-deep-reads");

const repo = [
  { path: "server/stripe-routes.ts", size: 10, content: "export const x = 1;" },
  { path: ".github/workflows/ci.yml", size: 10, content: "jobs:\n  test:\n    steps:\n      - run: npm test\n      - run: npm run test:e2e" },
  { path: "test/setup/database.ts", size: 10, content: "// TRUNCATE between tests" },
  { path: "test/integration/auth.test.ts", size: 10, content: "it('signs in')" },
  { path: "test/integration/path-return.test.ts", size: 10 },
  { path: "test/integration/stripe-webhook.test.ts", size: 10 },
  { path: "test/unit/credits.test.ts", size: 10 },
  { path: "e2e/retention-loop.spec.ts", size: 10, content: "test('loop')" },
  { path: "node_modules/pkg/test/x.test.js", size: 10 },
];
const ent = { tier: "pro" } as any;

describe("the test inventory a close read gets", () => {
  it("lists every test by folder, ignoring vendored ones, or only the area's", () => {
    const all = summarizeTestInventory(repo.map((f) => f.path), null)!;
    expect(all).toMatch(/^TEST FILES \(5, every one in the repository\)/);
    expect(all).toContain("test/integration/ (3): auth.test.ts, path-return.test.ts, stripe-webhook.test.ts");
    expect(all).toContain("e2e/ (1): retention-loop.spec.ts");
    expect(all).not.toContain("node_modules");
    const payments = summarizeTestInventory(repo.map((f) => f.path), /stripe|billing|payment|webhook/i)!;
    expect(payments).toMatch(/^TEST FILES NAMED FOR THIS AREA \(1 of 5 in the repository\)/);
    expect(payments).toContain("stripe-webhook.test.ts");
    expect(summarizeTestInventory(["src/a.ts"], null)).toMatch(/no test files/);
  });

  it("gives the testing area the whole inventory, the CI workflow and the harness — and other areas only their tests", async () => {
    prompts.length = 0;
    await deepReadArea(ent, { area: "tests", status: "built", summary: "", evidence: [{ file: "test/integration/auth.test.ts" }] } as any, repo as any, null);
    const testsPrompt = prompts[0];
    expect(testsPrompt).toContain("TEST FILES (5, every one in the repository)");
    expect(testsPrompt).toContain("path-return.test.ts");
    expect(testsPrompt).toContain("### .github/workflows/ci.yml");
    expect(testsPrompt).toContain("### test/setup/database.ts");
    expect(testsPrompt).toMatch(/never call it missing/);

    prompts.length = 0;
    await deepReadArea(ent, { area: "payments", status: "built", summary: "", evidence: [{ file: "server/stripe-routes.ts" }] } as any, repo as any, null);
    expect(prompts[0]).toContain("TEST FILES NAMED FOR THIS AREA (1 of 5");
    expect(prompts[0]).toContain("stripe-webhook.test.ts");
    expect(prompts[0]).not.toContain("### test/integration/auth.test.ts");
  });

  it("lists every mobile screen as a route with the API paths its file calls", () => {
    const out = summarizeMobileScreens([
      { path: "mobile/app/_layout.tsx", content: "" },
      { path: "mobile/app/index.tsx", content: 'api<{ items: X[] }>("/api/me/next-steps")' },
      { path: "mobile/app/(tabs)/notifications.tsx", content: "api(`/api/notifications?limit=50`); api('/api/notifications/read-all', { method: 'POST' })" },
      { path: "mobile/app/manage/[id].tsx", content: "api<any>(`/api/projects/${id}`); fetch(`${API_URL}/api/projects/${id}/path?goal=x`)" },
      { path: "mobile/app/+not-found.tsx", content: "" },
      { path: "client/src/pages/home.tsx", content: 'fetch("/api/feed")' },
    ])!;
    expect(out).toMatch(/^MOBILE SCREENS \(3, every route file/);
    expect(out).toContain("/  [mobile/app/index.tsx]  calls: /api/me/next-steps");
    expect(out).toContain("/notifications  [mobile/app/(tabs)/notifications.tsx]  calls: /api/notifications, /api/notifications/read-all");
    expect(out).toContain("/manage/[id]  [mobile/app/manage/[id].tsx]  calls: /api/projects/:param, /api/projects/:param/path");
    expect(out).not.toContain("client/src");
  });
});
