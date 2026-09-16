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

const { summarizeTestInventory, summarizeMobileScreens, summarizeAuthEndpoints } = await import("../../server/audit-evidence");
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

  it("follows a screen's own components, so a screen that renders one isn't read as having no data", () => {
    const out = summarizeMobileScreens([
      // The common shape: the route renders a component, and the component fetches.
      { path: "mobile/app/(tabs)/profile.tsx", content: 'import { ProfileView } from "../../src/components/ProfileView";' },
      { path: "mobile/src/components/ProfileView.tsx", content: 'import { Badges } from "./Badges";\napi("/api/profile")' },
      { path: "mobile/src/components/Badges.tsx", content: 'api(`/api/users/${id}/badges`)' },
      // Its own session layer counts for the sign-in screen, and reaches the client that holds the endpoints.
      { path: "mobile/app/(auth)/sign-in.tsx", content: 'import { useAuth } from "../../src/auth/AuthContext";' },
      { path: "mobile/src/auth/AuthContext.tsx", content: 'import { api } from "../api/client";' },
      { path: "mobile/src/api/client.ts", content: 'fetch(`${API_URL}/api/auth/mobile/login`); fetch(`${API_URL}/api/auth/mobile/refresh`)' },
      // A screen with a component chain that doesn't touch the session layer doesn't inherit its endpoints.
      { path: "mobile/app/contests.tsx", content: 'import { List } from "../src/components/List";' },
      { path: "mobile/src/components/List.tsx", content: 'import { useAuth } from "../auth/AuthContext";\napi("/api/contests")' },
      // Nothing to fetch, and said so rather than left blank.
      { path: "mobile/app/contest/[slug].tsx", content: "export default function Contest() { return null; }" },
    ])!;
    expect(out).toContain("/profile  [mobile/app/(tabs)/profile.tsx]  via components: /api/profile, /api/users/:param/badges");
    expect(out).toContain("/sign-in  [mobile/app/(auth)/sign-in.tsx]  via components: /api/auth/mobile/login, /api/auth/mobile/refresh");
    expect(out).toContain("/contests  [mobile/app/contests.tsx]  via components: /api/contests");
    expect(out).toContain("/contest/[slug]  [mobile/app/contest/[slug].tsx]  no API calls (navigation or static screen)");
    expect(out).toContain("3 deep");
  });

  it("reads a template path that holds quotes of its own", () => {
    const out = summarizeMobileScreens([
      { path: "mobile/app/network/index.tsx", content: 'api(`/api/connections/${id}/${accept ? "accept" : "reject"}`, { method: "POST" })' },
    ])!;
    expect(out).toContain("calls: /api/connections/:param/:param");
    expect(out).not.toContain('"accept"');
  });

  it("puts the server's sign-in surface next to the app's, so auth parity is checked not claimed", () => {
    const rows = [
      { method: "POST", path: "/api/auth/mobile/login", file: "server/mobile-auth.ts", auth: false },
      { method: "POST", path: "/api/auth/mobile/refresh", file: "server/mobile-auth.ts", auth: false },
      { method: "GET", path: "/api/auth/user", file: "server/auth.ts", auth: true },
      { method: "POST", path: "/api/logout", file: "server/auth.ts", auth: false },
      { method: "GET", path: "/api/feed", file: "server/feed-routes.ts", auth: false },
      { method: "POST", path: "/api/auth/dead", file: "server/old.ts", auth: false, mounted: false },
    ];
    const out = summarizeAuthEndpoints(rows)!;
    expect(out).toMatch(/^AUTH ENDPOINTS THE APP AND THE WEB SHARE \(4;/);
    expect(out).toContain("POST /api/auth/mobile/login  guarded:n  [server/mobile-auth.ts]");
    expect(out).toContain("GET /api/auth/user  guarded:y  [server/auth.ts]");
    expect(out).not.toContain("/api/feed");
    expect(out).not.toContain("/api/auth/dead");
    expect(summarizeAuthEndpoints([{ method: "GET", path: "/api/feed", file: "f.ts", auth: false }])).toBeNull();
  });
});
