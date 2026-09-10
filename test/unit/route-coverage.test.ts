/**
 * The route-to-guard matrix is read from source, deterministically: the
 * middleware on each route, the guards inside the handler, the surface
 * prefix that covers it, and the writes and costly routes left without.
 */
import { describe, it, expect } from "vitest";
import { buildRouteCoverage, detectSurfacePrefixes, renderRouteCoverage } from "../../server/route-coverage";
import { sanitizeDeepRead } from "@shared/capabilities";

const f = (path: string, content: string) => ({ path, size: content.length, content });
const app = f("server/routes.ts", `
  app.use("/api/feed", requireSurface("feed"));
  app.get("/api/projects", async (req, res) => { res.json([]); });
  app.post("/api/projects", isAuthenticated, rateLimit("project"), async (req: any, res) => { res.json({}); });
  app.post("/api/feed", isAuthenticated, async (req, res) => { res.json({}); });
  app.post("/api/open", async (req, res) => { res.json({}); });
  app.post("/api/projects/:id/nova", isAuthenticated, async (req: any, res) => {
    if (!(await requireCredits(res, userId, 4, "x"))) return;
    const r = await openai.chat.completions.create({});
  });
  app.post("/api/projects/:id/free-ai", isAuthenticated, async (req: any, res) => {
    const r = await openai.chat.completions.create({});
  });
  app.get("/api/admin/analytics", requireOwner, async (req, res) => {});
`);
const registry = f("shared/surfaces.ts", `export const NOVA_SURFACES = [{ id: "projects", label: "P", prefixes: ["/api/projects"] }];`);
const test = f("test/integration/x.test.ts", `app.post("/api/should-not-count", async (req, res) => {});`);
const entry = f("server/routes.ts", `import { registerX } from "./x-routes";`);
const live = f("server/x-routes.ts", `export function registerX(app) { app.post("/api/live", isAuthenticated, async (req, res) => {}); }`);
const dead = f("server/replit_integrations/chat/routes.ts", `app.post("/api/conversations", async (req, res) => {});`);

describe("buildRouteCoverage", () => {
  it("reads guards off each route and names the gaps exactly", () => {
    const c = buildRouteCoverage([app, registry, test]);
    const by = Object.fromEntries(c.rows.map((r) => [`${r.method} ${r.path}`, r]));
    expect(c.rows.map((r) => `${r.method} ${r.path}`)).not.toContain("POST /api/should-not-count");
    expect(by["POST /api/projects"]).toMatchObject({ write: true, auth: true, rateLimited: true, surface: "projects", credits: false });
    expect(by["POST /api/projects"].guards).toEqual(["isAuthenticated", 'rateLimit("project")']);
    expect(by["POST /api/feed"]).toMatchObject({ auth: true, rateLimited: false, surface: "feed" });
    expect(by["POST /api/open"]).toMatchObject({ auth: false, rateLimited: false, surface: null });
    expect(by["POST /api/projects/:id/nova"]).toMatchObject({ cost: true, credits: true, rateLimited: true });
    expect(by["POST /api/projects/:id/free-ai"]).toMatchObject({ cost: true, credits: false, rateLimited: false });
    expect(by["GET /api/admin/analytics"]).toMatchObject({ auth: true, privileged: true, write: false });

    expect(c.unguardedWrites).toEqual(["POST /api/open"]);
    expect(c.unlimitedWrites).toEqual(["POST /api/feed", "POST /api/open", "POST /api/projects/:id/free-ai"]);
    expect(c.unmeteredCost).toEqual(["POST /api/projects/:id/free-ai"]);
    expect(c.summary).toMatchObject({ routes: 7, writes: 5, costly: 2, writesWithAuth: 4, writesRateLimited: 2, costlyMetered: 1 });
    expect(detectSurfacePrefixes([app, registry])).toEqual([{ prefix: "/api/feed", surface: "feed" }, { prefix: "/api/projects", surface: "projects" }]);
    expect(renderRouteCoverage(c)).toMatch(/Unguarded writes: POST \/api\/open/);
    expect(renderRouteCoverage(null)).toBeNull();
  });

  it("does not count routes in files nothing imports", () => {
    const c = buildRouteCoverage([entry, live, dead]);
    expect(c.rows.find((r) => r.path === "/api/live")?.mounted).toBe(true);
    expect(c.rows.find((r) => r.path === "/api/conversations")?.mounted).toBe(false);
    expect(c.unmountedFiles).toEqual(["server/replit_integrations/chat/routes.ts"]);
    expect(c.unguardedWrites).toEqual([]);
    expect(c.summary.routes).toBe(1);
    expect(renderRouteCoverage(c)).toMatch(/dead code, not live endpoints\): server\/replit_integrations\/chat\/routes\.ts/);
  });
});

describe("detectSecrets", () => {
  it("flags a real-looking database URL and not a documented placeholder", async () => {
    const { detectSecrets } = await import("../../server/code-digest");
    const realish = ["postgresql://app", "Zx9!kq2m@db-prod-7.internal-cloud.net:5432/app"].join(":");
    const files = [
      f("server/config.ts", `const url = "${realish}";`),
      f("docs/setup.md", `Use ${["postgresql://ro", "pw@db.example.com/app"].join(":")} as a template.`),
      f("test/x.test.ts", `const u = "${["postgresql://a", "b@203.0.113.9/x"].join(":")}";`),
      f("client/card.tsx", `placeholder="${["postgresql://user", "…@host:5432/db"].join(":")}"`),
    ];
    expect(detectSecrets(files)).toEqual([{ file: "server/config.ts", hint: "a database URL with a password in it" }]);
  });
});

describe("sanitizeDeepRead", () => {
  it("keeps quantified coverage and gaps, drops files it wasn't shown, and is null on nothing", () => {
    const allowed = new Set(["server/moderation.ts"]);
    expect(sanitizeDeepRead({ coverage: "14 of 19 writes limited", gaps: [{ item: "Comments not limited", file: "server/moderation.ts", severity: "high" }, { item: "Uploads", file: "server/src/nope.ts", severity: "weird" }, { item: "" }], strengths: ["durable"] }, allowed))
      .toEqual({ coverage: "14 of 19 writes limited", gaps: [{ item: "Comments not limited", file: "server/moderation.ts", severity: "high" }, { item: "Uploads", file: undefined, severity: "medium" }], strengths: ["durable"] });
    expect(sanitizeDeepRead({ coverage: "", gaps: [] }, allowed)).toBeNull();
    expect(sanitizeDeepRead("nonsense", allowed)).toBeNull();
  });
});
