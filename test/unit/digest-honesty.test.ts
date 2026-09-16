/**
 * The digest is a summary with size limits, and a clipped list reads exactly
 * like a complete one.
 *
 * That isn't hypothetical: an audit of this codebase was shown 90 routes of
 * 461 under a header that said "(120)", and reported working features as
 * "not evidenced in the provided files" — three times, about code that was
 * there. A summary may leave things out; it may not imply it hasn't.
 *
 * So: the counts are of what was found, not of what fits, and every clipped
 * list says what it isn't showing.
 */
import { describe, it, expect } from "vitest";
import { buildCodeDigest } from "../../server/code-digest";
import { snapshotFromFiles } from "../../server/code-ingest";

/** A server with `count` routes and `tables` tables, past any sane cap. */
function bigRepo(count: number, tables: number) {
  const routes = Array.from({ length: count }, (_, i) => `app.get("/api/thing-${i}", isAuthenticated, (req, res) => res.json({}));`).join("\n");
  const schema = Array.from({ length: tables }, (_, i) => `export const table${i} = pgTable("table_${i}", { id: varchar("id") });`).join("\n");
  return snapshotFromFiles([
    { path: "package.json", content: JSON.stringify({ name: "big", dependencies: { express: "4" } }) },
    { path: "server/routes.ts", content: `import express from "express";\nconst app = express();\n${routes}` },
    { path: "shared/schema.ts", content: `import { pgTable, varchar } from "drizzle-orm/pg-core";\n${schema}` },
  ] as any, "test");
}

describe("what the digest says about itself", () => {
  it("counts what it found, not what it printed, and admits the list is clipped", () => {
    const digest = buildCodeDigest(bigRepo(400, 150));

    // The header is the true total, so nobody reads the cap as the size of the API.
    expect(digest.prompt).toContain("ROUTES AND PAGES FOUND IN CODE (400 found)");
    expect(digest.prompt).toContain("PERSISTED DATA MODELS (150 found)");
    // And the body says what it left out, in as many words.
    expect(digest.prompt).toMatch(/… and \d+ more not listed here/);
    expect(digest.prompt).toContain("absence from it is not evidence of absence");
    // The route list points at the table that does hold everything.
    expect(digest.prompt).toContain("ROUTE COVERAGE table below");
  });

  it("says it is a digest, how much of the codebase it shows, and what not to conclude from that", () => {
    const digest = buildCodeDigest(bigRepo(30, 10));
    expect(digest.prompt).toContain("HOW TO READ THIS");
    expect(digest.prompt).toMatch(/This is a digest of \d+ files, not the codebase/);
    expect(digest.prompt).toMatch(/\d+ appear as excerpts \(opening lines only, not whole files\)/);
    expect(digest.prompt).toContain("Nothing here being absent means it is absent from the code");
  });

  it("leaves a list that fits alone — no clipping note where nothing was clipped", () => {
    const digest = buildCodeDigest(bigRepo(12, 4));
    expect(digest.prompt).toContain("ROUTES AND PAGES FOUND IN CODE (12 found)");
    expect(digest.prompt).not.toMatch(/… and \d+ more not listed here/);
  });

  it("holds a real API's worth of routes and tables, not a fraction of one", () => {
    // 461 routes and 104 tables is this repository, the day the caps were found.
    const digest = buildCodeDigest(bigRepo(461, 104));
    const listed = (digest.prompt.match(/^- (GET|POST|PUT|PATCH|DELETE) /gm) ?? []).length;
    expect(listed).toBeGreaterThan(200);
    // Listed by the name the database uses, which is what a reader would grep for.
    const models = (digest.prompt.match(/^- table_\d+ {2}\[shared\/schema\.ts\]$/gm) ?? []).length;
    expect(models).toBe(104);
  });
});
