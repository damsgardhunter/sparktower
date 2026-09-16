/**
 * An empty table means the feature is unused. It does not mean the feature is
 * unbuilt, and the difference is the whole judgement for a product before
 * launch — where every table is empty because nobody has arrived yet.
 *
 * Tests tell the two apart: a table the suite fills is proven, whatever
 * production looks like. A table no test names is the one worth doubting.
 */
import { describe, it, expect } from "vitest";
import { renderDataShape, tablesExercisedByTests, type DataShape } from "@shared/data-shape";

const shape = (tables: { name: string; rows: number }[]): DataShape => ({
  at: "2026-09-16T00:00:00.000Z",
  source: "self",
  tables: tables.map((t) => ({ ...t, exact: true, columns: [], primaryKey: [], foreignKeys: [] })) as any,
  totals: { tables: tables.length, rows: tables.reduce((n, t) => n + t.rows, 0), emptyTables: tables.filter((t) => !t.rows).length },
  compare: null,
});

const files = [
  { path: "test/integration/moderation-loop.test.ts", content: "await db.insert(moderationLog).values({});\nawait pool.query('SELECT 1 FROM content_reports');" },
  { path: "server/moderation.ts", content: "db.insert(contests)" },
];

describe("which tables the tests fill", () => {
  it("ignores unit tests, which can't fill a database", () => {
    // How `contests` came to read as proven: a unit fixture and a 404 test named it, and nothing had joined one.
    const unitOnly = [{ path: "test/unit/audit-evidence.test.ts", content: "const rows = [{ table: 'contests' }];" }];
    expect(tablesExercisedByTests(unitOnly, ["contests"])).toEqual([]);
    const integration = [{ path: "test/integration/contests.test.ts", content: "await db.insert(contests).values({});" }];
    expect(tablesExercisedByTests(integration, ["contests"])).toEqual(["contests"]);
    const browser = [{ path: "e2e/contests.spec.ts", content: "await api.post('/api/contests/x/join');\nconst rows = 'contests';" }];
    expect(tablesExercisedByTests(browser, ["contests"])).toEqual(["contests"]);
  });

  it("finds a table by either spelling, and doesn't count product code", () => {
    const found = tablesExercisedByTests(files, ["moderation_log", "content_reports", "contests"]);
    // moderationLog in an ORM call, content_reports in SQL — both are the test exercising that table.
    expect(found.sort()).toEqual(["content_reports", "moderation_log"]);
    // `contests` appears only in server code, which proves nothing about tests.
    expect(found).not.toContain("contests");
  });

  it("separates empty-but-proven from empty-and-unproven, and says what each means", () => {
    const out = renderDataShape(
      shape([{ name: "users", rows: 12 }, { name: "moderation_log", rows: 0 }, { name: "contests", rows: 0 }]),
      40,
      ["moderation_log"],
    )!;
    expect(out).toContain("Empty but exercised by tests — built and proven, nobody has used it yet (1): moderation_log");
    expect(out).toContain("Empty and named by no test — unproven (1): contests");
    // And the instruction matches: unused is not unbuilt.
    expect(out).toContain('say "built, not yet used" where tests exercise it');
  });

  it("falls back to one list when nothing says which tests ran", () => {
    const out = renderDataShape(shape([{ name: "users", rows: 1 }, { name: "contests", rows: 0 }]))!;
    expect(out).toContain("Empty tables (1): contests");
    expect(out).not.toContain("exercised by tests");
  });
});
