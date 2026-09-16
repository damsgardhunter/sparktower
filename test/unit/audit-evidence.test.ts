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

const { summarizeTestInventory, summarizeMobileScreens, summarizeWebScreens, summarizeAuthEndpoints, summarizeUntestedRoutes } = await import("../../server/audit-evidence");
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

  it("lists every web route with what gates it and what it calls, and the pages no route renders", () => {
    const app = `
      import Landing from "@/pages/landing";
      import Home from "@/pages/home";
      import Artifact from "@/pages/public-artifact";
      import Profile from "@/pages/profile";
      function Router() {
        if (isPublicRoute) {
          return <Switch><Route path="/a/:id" component={Artifact} /></Switch>;
        }
        if (!isAuthenticated) {
          return <Switch><Route path="/" component={Landing} /></Switch>;
        }
        return <div><AppSidebar />
          <Route path="/" component={Home} />
          <Route path="/profile" component={Profile} />
        </div>;
      }`;
    const out = summarizeWebScreens([
      { path: "client/src/App.tsx", content: app },
      { path: "client/src/pages/public-artifact.tsx", content: 'useQuery({ queryKey: ["/api/public/artifacts", id] })' },
      { path: "client/src/pages/landing.tsx", content: 'fetch("/api/auth/login", { method: "POST", body })' },
      {
        path: "client/src/pages/home.tsx",
        // Imports a component that fetches, and invalidates a key it never reads.
        content: `import { Feed } from "@/components/feed";\nimport { useAuth } from "@/hooks/use-auth";\nqueryClient.invalidateQueries({ queryKey: ["/api/notifications"] });`,
      },
      { path: "client/src/components/feed.tsx", content: 'useQuery({ queryKey: ["/api/feed"] }); apiRequest("POST", `/api/feed/${id}/react`)' },
      { path: "client/src/pages/profile.tsx", content: "export default function Profile() { return null; }" },
      { path: "client/src/pages/orphan.tsx", content: "export default function Orphan() { return null; }" },
      { path: "client/src/hooks/use-auth.ts", content: 'fetch("/api/auth/user"); fetch("/api/logout", { method: "POST" })' },
    ])!;

    expect(out).toMatch(/^WEB SCREENS \(4 routes in client\/src\/App\.tsx/);
    // The question worth answering about a single-page app, in the header line.
    expect(out).toContain("2 reachable without a signed-in account");
    expect(out).toContain("/a/:id  [public (no account needed)]  [client/src/pages/public-artifact.tsx]  calls: GET /api/public/artifacts/:param");
    // fetch defaults to GET; a method in the options is read off it.
    expect(out).toContain("/  [signed out]  [client/src/pages/landing.tsx]  calls: POST /api/auth/login");
    // Followed into the component that actually fetches; the invalidated key is not a call.
    expect(out).toContain("/  [signed in]  [client/src/pages/home.tsx]  calls: GET /api/feed, POST /api/feed/:param/react");
    expect(out).not.toContain("/api/notifications");
    // The session hook is on every page, so its endpoints are nobody's page in particular.
    expect(out).not.toContain("/api/auth/user");
    expect(out).toContain("/profile  [signed in]  [client/src/pages/profile.tsx]  no API calls found");
    expect(out).toContain("PAGE FILES NO ROUTE RENDERS (1): client/src/pages/orphan.tsx");
    // No client router, nothing to say — rather than an empty heading.
    expect(summarizeWebScreens([{ path: "server/routes.ts", content: "app.get('/api/x')" }])).toBeNull();
  });

  it("gives the CI read the gate contract, since the gate itself is a setting on GitHub", async () => {
    // Whether merges are blocked can't be read off code at all; what the repository can show is the written
    // contract and the script that compares it with what GitHub enforces. Without them the read can only
    // say "enforcement cannot be confirmed", which is true of any repository and useful to nobody.
    const files = [
      { path: ".github/workflows/ci.yml", size: 10, content: "jobs:\n  server-web:\n  e2e:" },
      { path: "docs/ci-gate.md", size: 10, content: "# The CI gate\nBranch protection requires: server-web, e2e" },
      { path: "scripts/check-branch-protection.mjs", size: 10, content: "const REQUIRED = ['server-web', 'e2e'];" },
      { path: "test/integration/auth.test.ts", size: 10, content: "it('signs in')" },
    ];
    prompts.length = 0;
    await deepReadArea(ent, { area: "ci", status: "built", summary: "", evidence: [] } as any, files as any, null);
    expect(prompts[0]).toContain("### docs/ci-gate.md");
    expect(prompts[0]).toContain("### scripts/check-branch-protection.mjs");
    expect(prompts[0]).toContain("### .github/workflows/ci.yml");
  });

  it("keeps the file that answers the area's question, however many others match its name", async () => {
    // Ten files matching /stripe|billing/ ahead of it: name-matching alone pushed the handler out of the read,
    // and a payments verdict without it can only say the claim-before-side-effects mechanism isn't shown.
    const crowded = [
      ...Array.from({ length: 10 }, (_, i) => ({ path: `server/stripe-extra-${i}.ts`, size: 10, content: `// stripe helper ${i}` })),
      { path: "server/webhookHandlers.ts", size: 10, content: "export class WebhookHandlers { static async claim() {} }" },
      { path: "server/billing-credits.ts", size: 10, content: "export const refill = 1;" },
      { path: "server/routes.ts", size: 10, content: "// checkout return" },
    ];
    prompts.length = 0;
    await deepReadArea(ent, { area: "payments", status: "built", summary: "", evidence: [{ file: "server/routes.ts" }] } as any, crowded as any, null);
    expect(prompts[0]).toContain("### server/webhookHandlers.ts");
    expect(prompts[0]).toContain("### server/billing-credits.ts");
    // The area's own evidence still gets in alongside it.
    expect(prompts[0]).toContain("### server/routes.ts");

    // Other areas keep theirs too.
    prompts.length = 0;
    await deepReadArea(ent, { area: "moderation", status: "built", summary: "", evidence: [] } as any,
      [...crowded, { path: "server/moderation.ts", size: 10, content: "// the queue" }] as any, null);
    expect(prompts[0]).toContain("### server/moderation.ts");
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

  it("crosses the routes against the tests, so 'what isn't covered' is answered from the repository", () => {
    const rows = [
      { method: "POST", path: "/api/projects/:id/invites", file: "server/invite-routes.ts", write: true },
      { method: "DELETE", path: "/api/admin/users/:id", file: "server/admin.ts", write: true, privileged: true },
      { method: "GET", path: "/api/feed", file: "server/feed-routes.ts" },
      { method: "POST", path: "/api/feed", file: "server/feed-routes.ts", write: true },
      { method: "POST", path: "/api/retired", file: "server/old.ts", write: true, mounted: false },
    ];
    const files = [
      // A test writes a route with its parameters filled in; that still counts as naming it.
      { path: "test/integration/invites.test.ts", content: "await agent.post(`/api/projects/${project.id}/invites`).send({});" },
      { path: "e2e/wedge.spec.ts", content: 'await api.get("/api/feed");' },
      { path: "server/feed-routes.ts", content: 'app.post("/api/feed", handler); app.delete("/api/admin/users/:id", handler);' },
    ];
    const out = summarizeUntestedRoutes(files, rows)!;
    // One of the three live paths is named by no test — and product code naming it doesn't count.
    expect(out).toMatch(/^PATHS NO TEST MENTIONS \(1 of 3; 1 of them write\./);
    expect(out).toContain("DELETE /api/admin/users/:id  privileged  [server/admin.ts]");
    // /api/feed is named by a test, so both its methods count as named: the claim is about paths.
    expect(out).not.toContain("/api/feed");
    expect(out).not.toContain("/api/projects/:id/invites");

    /*
     * A sweep drives routes it never names — it reads the route scan and calls
     * each one — so it declares what it covers. Without this the summary keeps
     * reporting swept routes as untested, which is how a covered admin surface
     * comes back as a finding.
     */
    const withSweep = summarizeUntestedRoutes([
      ...files,
      { path: "test/integration/admin-guards.test.ts", content: "// covers-routes: ^/api/admin/\nconst routes = scan();" },
    ], rows)!;
    expect(withSweep).not.toContain("/api/admin/users/:id");
    expect(withSweep).toMatch(/^PATHS NO TEST MENTIONS \(0 of 3;/);
    expect(withSweep).toContain("driven by a sweep that names no paths (test/integration/admin-guards.test.ts)");

    // The declaration only covers what it says: a sweep of one prefix says nothing about another.
    const narrow = summarizeUntestedRoutes([
      ...files,
      { path: "test/integration/other.test.ts", content: "// covers-routes: ^/api/nothing-like-this/" },
    ], rows)!;
    expect(narrow).toContain("DELETE /api/admin/users/:id");
    expect(out).not.toContain("/api/retired");
    // Privileged routes lead: an untested admin route is the one to look at first.
    expect(out.split("\n")[1]).toContain("/api/admin/users/:id");
  });

  it("says so plainly when every route is named, and answers nothing without routes or tests", () => {
    const rows = [{ method: "GET", path: "/api/feed", file: "server/feed-routes.ts" }];
    const tested = [{ path: "test/a.test.ts", content: 'get("/api/feed")' }];
    expect(summarizeUntestedRoutes(tested, rows)).toContain("every path is named by at least one test");
    expect(summarizeUntestedRoutes([{ path: "server/x.ts", content: "get('/api/feed')" }], rows)).toBeNull();
    expect(summarizeUntestedRoutes(tested, [])).toBeNull();
  });
});
