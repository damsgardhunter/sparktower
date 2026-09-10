/**
 * The audit reads the builder's own docs: markdown that talks about loops,
 * journeys and the plan is ranked, excerpted around the relevant passages,
 * and boilerplate is left out.
 */
import { describe, it, expect } from "vitest";
import { collectProductDocs } from "../../server/code-digest";

const file = (path: string, content: string) => ({ path, size: content.length, content });

describe("collectProductDocs", () => {
  it("ranks docs by how much they say about loops and excerpts those passages with their heading", () => {
    const docs = collectProductDocs([
      // Paragraphs under a heading about loops count even without the word; paragraphs elsewhere don't.
      file("README.md", "# App\n\nInstall with npm.\n\nUnrelated paragraph about licensing.\n\n## Loops\n\nThe build loop: post a check-in, get comments, post again.\n\nPeople come back every week for it."),
      file("docs/product/loops.md", "# Loops we are going for\n\n## Build loop\n\nBuilder posts weekly → gets feedback → returns.\n\n## Explore loop\n\nVisitor reads the feed → follows a project → comes back for updates.\n\n## Fund loop\n\nBacker backs a project → gets updates → backs again."),
      file("CHANGELOG.md", "## 1.0\n- loop fixed\n- loop fixed again\n- loop loop loop"),
      file("node_modules/x/README.md", "loop loop loop loop loop"),
      file(".cache/.bun/install/cache/glob/README.md", "loop loop loop loop loop loop"),
      file(".local/skills/foo/SKILL.md", "loop loop loop loop loop loop loop"),
      file("docs/setup.md", "# Setup\n\nRun the migrations."),
    ]);
    expect(docs.map((d) => d.path)).toEqual(["docs/product/loops.md", "README.md"]);
    expect(docs[0].intentHits).toBeGreaterThan(docs[1].intentHits);
    expect(docs[0].excerpt).toContain("[Build loop] Builder posts weekly");
    expect(docs[0].excerpt).toContain("[Fund loop]");
    expect(docs[1].excerpt).not.toContain("licensing");
    expect(docs[1].excerpt).not.toContain("Install with npm");
    expect(docs[1].excerpt).toContain("[Loops] People come back every week");
  });

  it("caps the number of docs and the size of each excerpt", () => {
    const many = Array.from({ length: 12 }, (_, i) => file(`docs/${i}.md`, `# D${i}\n\n${"the loop is the thing. ".repeat(300)}`));
    const docs = collectProductDocs(many, 3, 500);
    expect(docs).toHaveLength(3);
    for (const d of docs) expect(d.excerpt.length).toBeLessThanOrEqual(520);
  });
});

describe("loopsAlike", () => {
  it("catches a removed loop coming back under a new name", async () => {
    const { loopsAlike } = await import("@shared/phase-trees");
    const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    expect(loopsAlike(norm("Build: post a weekly check-in and get feedback"), norm("Build: ship weekly check-ins on a project"))).toBe(true);
    expect(loopsAlike(norm("Explore: fast feedback (needs-feedback queue)"), norm("Fast feedback queue"))).toBe(true);
    expect(loopsAlike(norm("Build: post a weekly check-in and get feedback"), norm("Raise funding"))).toBe(false);
    expect(loopsAlike(norm("Explore"), norm("Explore: discover builders and follow up"))).toBe(true);
  });
});

describe("splitMergedPaths", () => {
  it("splits a loop that spans several paths into one per path, and leaves single loops alone", async () => {
    const { splitMergedPaths } = await import("@shared/phase-trees");
    const out = splitMergedPaths([
      { title: "Build: follow a goal path (Ship/Systemize/Fund)", steps: "pick path → do next milestone → repeat", state: "partly", evidence: "" },
      { title: "Explore builders", steps: "open feed → follow", state: "built", evidence: "" },
      { title: "Raise funding", steps: "generate deck → critique → iterate", state: "partly", evidence: "" },
    ]);
    expect(out.map((l) => l.title)).toEqual(["Ship an MVP", "Systemize a business", "Raise funding", "Explore builders", "Raise funding"]);
    expect(out[0].steps).toMatch(/on the Ship an MVP path/);
  });
});

describe("detectGuards", () => {
  it("names the mechanisms that exist with application code as evidence, never a scanner, config or lockfile", async () => {
    const { detectGuards } = await import("../../server/code-digest");
    const f = (path: string, content: string) => ({ path, size: content.length, content });
    const guards = detectGuards([
      f("server/moderation.ts", "export async function enforceRateLimit(res, userId, name) { await db.insert(rateLimitHits) }"),
      f("server/surfaces.ts", "export function requireSurface(id) {}"),
      f("server/code-digest.ts", "const checks = [{ test: /rate_limit_hits|requireSurface|helmet\\(/ }]"),
      f("vitest.config.ts", "process.env.SESSION_SECRET = 'x'; // production refuse"),
      f("package.json", '{"devDependencies":{"supertest":"7"}}'),
      f("test/integration/auth.test.ts", "import request from 'supertest'; request(app)"),
      f(".github/workflows/ci.yml", "name: ci"),
    ]);
    expect(guards).toEqual([
      { name: "Durable (database-backed) rate limiting", evidence: "server/moderation.ts" },
      { name: "Feature kill switches / surface flags", evidence: "server/surfaces.ts" },
      { name: "Test suite (integration)", evidence: "test/integration/auth.test.ts" },
      { name: "CI workflow", evidence: ".github/workflows/ci.yml" },
    ]);
  });
});
