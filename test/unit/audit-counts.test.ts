/**
 * The numbers an audit shows are the repository's, not the list's.
 *
 * Routes, models and tests are counted over everything that was read; the
 * lists beside them are clipped to what fits in a prompt or a panel. When a
 * count came from a clipped list, a project with a hundred tables was told it
 * had forty models — a limit of ours reported as a fact about their code, and
 * the kind of number a builder makes decisions on.
 */
import { describe, it, expect } from "vitest";
import { buildCodeDigest } from "../../server/code-digest";
import { buildRouteCoverage } from "../../server/route-coverage";

/** More routes and tables than any display list keeps. */
const many = (n: number, body: (i: number) => string) => Array.from({ length: n }, (_, i) => body(i)).join("\n");
const files = [
  { path: "package.json", size: 60, content: JSON.stringify({ dependencies: { express: "4", "drizzle-orm": "0.3" } }) },
  {
    path: "server/routes.ts", size: 9000,
    content: `import express from "express";\nconst app = express();\n${many(260, (i) => `app.post("/api/thing-${i}", isAuthenticated, handler);`)}`,
  },
  {
    path: "shared/schema.ts", size: 9000,
    content: many(200, (i) => `export const table${i} = pgTable("table_${i}", { id: varchar("id").primaryKey() });`),
  },
];

describe("what an audit counts", () => {
  it("counts every route and model it read, past any display limit", () => {
    const digest = buildCodeDigest({ files, source: "worktree", sourceKind: "worktree" } as any);
    expect(digest.signals.routes.length).toBe(260);
    expect(digest.signals.dataModels.length).toBe(200);
    // And the route matrix agrees with the digest: two readings of the same code, one answer.
    expect(buildRouteCoverage(files as any).rows.length).toBe(260);
  });

  it("keeps the counts separate from the clipped lists the panels show", () => {
    const digest = buildCodeDigest({ files, source: "worktree", sourceKind: "worktree" } as any);
    // What the audit stores for the UI: a clipped list, and the real count beside it.
    const scan = {
      routeCount: digest.signals.routes.length,
      routes: digest.signals.routes.slice(0, 60),
      modelCount: digest.signals.dataModels.length,
      dataModels: digest.signals.dataModels.slice(0, 120),
    };
    expect(scan.routes.length).toBeLessThan(scan.routeCount);
    expect(scan.dataModels.length).toBeLessThan(scan.modelCount);
    expect(scan.routeCount).toBe(260);
    expect(scan.modelCount).toBe(200);
  });

  it("says a clipped list is clipped, so absence from it isn't evidence of absence", () => {
    const digest = buildCodeDigest({ files, source: "worktree", sourceKind: "worktree" } as any);
    expect(digest.prompt).toMatch(/more not listed here/);
    expect(digest.prompt).toMatch(/absence from it is not evidence of absence/);
  });
});
