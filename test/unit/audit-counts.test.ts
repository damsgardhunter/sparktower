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
import { describeProvenance, isPartialView } from "@shared/audit-provenance";

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

/**
 * …and the same for what the audit read at all. A verdict with no provenance
 * is unfalsifiable: "62% built, payments missing" reads identically whether it
 * came from today's working tree or a zip uploaded last Tuesday.
 */
describe("the line that says what the audit read", () => {
  it("names the source, the commit when one is knowable, when it was taken and how much was read", () => {
    const line = describeProvenance({
      kind: "github", source: "github:acme/app@main", name: "acme/app", ref: "main",
      commit: "a1b2c3d", capturedAt: "2026-09-22T10:00:00.000Z", contentAt: null,
      fileCount: 412, readCount: 412, partial: false,
    });
    expect(line).toContain("GitHub acme/app@main");
    expect(line).toContain("commit a1b2c3d");
    expect(line).toContain("2026-09-22");
    expect(line).toContain("412 of 412 files read");
    expect(line).not.toContain("partial view");
  });

  it("says an upload has no commit rather than inventing one, and how old the code in it is", () => {
    const line = describeProvenance({
      kind: "upload", source: "upload:archive.zip", name: "archive.zip", ref: null,
      commit: null, capturedAt: "2026-09-22T10:00:00.000Z", contentAt: "2026-09-15T08:00:00.000Z",
      fileCount: 900, readCount: 120, unreadSource: 12, partial: true,
    });
    expect(line).toContain("no commit (an uploaded archive doesn't carry one)");
    expect(line).toContain("newest file in it 2026-09-15");
    // Said in source files, because that is the number that should stop a reader trusting "missing".
    expect(line).toMatch(/120 of 900 files read — 12 source files unread, so anything not read is unknown, not absent/);
  });

  it("is honest about an audit that predates it", () => {
    expect(describeProvenance(null)).toMatch(/predates provenance/);
  });

  it("counts a partial read in source files, not in files", () => {
    /*
     * Every repository has a lockfile, a PNG and a font, all skipped on
     * purpose. Counting those as "partial" would make every audit partial and
     * no verdict of "missing" could ever survive — an audit that can never say
     * a thing is absent cannot tell anybody what to build next. The number
     * that matters is source the audit could not open.
     */
    expect(isPartialView({ truncated: false, fileCount: 10, readCount: 10, unreadSource: 0 }), "read everything").toBe(false);
    expect(isPartialView({ truncated: false, fileCount: 10, readCount: 7, unreadSource: 0 }), "three skipped, none of them source").toBe(false);
    expect(isPartialView({ truncated: false, fileCount: 10, readCount: 9, unreadSource: 1 }), "one source file unread").toBe(true);
    expect(isPartialView({ truncated: true, fileCount: 10, readCount: 10, unreadSource: 0 }), "clipped at the budget").toBe(true);
    // Audits recorded before the count existed fall back to the blunt comparison,
    // which errs towards "partial" — the right side to be wrong on.
    expect(isPartialView({ truncated: false, fileCount: 10, readCount: 9 })).toBe(true);
  });
});
