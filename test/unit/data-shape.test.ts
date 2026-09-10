/**
 * The data shape's pure parts: the star layout, the prompt rendering, the
 * URL guard for connection strings, and the seal that keeps them at rest.
 */
import { describe, it, expect } from "vitest";
import { starLayout, renderDataShape, type DataShape } from "@shared/data-shape";
import { safeDbUrl, compareWithCode } from "../../server/data-shape";

const shape: DataShape = {
  at: "2026-09-10T00:00:00Z", source: "self",
  tables: [
    { name: "users", rows: 143, exact: true, columns: [{ name: "id", type: "text", nullable: false, pk: true }], foreignKeys: [], inbound: 3 },
    { name: "projects", rows: 12, exact: true, columns: [{ name: "id", type: "text", nullable: false, pk: true }, { name: "owner_id", type: "text", nullable: false, pk: false }], foreignKeys: [{ column: "owner_id", refTable: "users", refColumn: "id" }], inbound: 2 },
    { name: "project_check_ins", rows: 9, exact: true, columns: [], foreignKeys: [{ column: "project_id", refTable: "projects", refColumn: "id" }, { column: "user_id", refTable: "users", refColumn: "id" }], inbound: 0 },
    { name: "path_pace", rows: 0, exact: true, columns: [], foreignKeys: [{ column: "project_id", refTable: "projects", refColumn: "id" }], inbound: 0 },
    { name: "sessions", rows: 2_000_000, exact: false, columns: [], foreignKeys: [], inbound: 0 },
    { name: "rate_limit_hits", rows: 40, exact: true, columns: [], foreignKeys: [{ column: "user_id", refTable: "users", refColumn: "id" }], inbound: 0 },
  ],
  totals: { tables: 6, rows: 2_000_204, emptyTables: 1 },
  compare: { inCodeNotInDb: ["loopNotes"], inDbNotInCode: ["legacy_widgets"] },
};

describe("starLayout", () => {
  it("puts the most-referenced table at the centre, its referrers on ring one, the rest outside, sized by rows", () => {
    const l = starLayout(shape, 760);
    const by = Object.fromEntries(l.nodes.map((n) => [n.name, n]));
    expect(by.users).toMatchObject({ ring: 0, x: 380, y: 380 });
    expect(by.projects.ring).toBe(1);
    expect(by.rate_limit_hits.ring).toBe(1);
    expect(by.project_check_ins.ring).toBe(1);
    expect(by.path_pace.ring).toBe(2);
    expect(by.sessions.ring).toBe(2);
    expect(by.sessions.r).toBeGreaterThan(by.path_pace.r);
    expect(l.edges).toContainEqual({ from: "projects", to: "users" });
    expect(l.edges.some((e) => e.from === "users")).toBe(false);
    // Deterministic.
    expect(starLayout(shape, 760)).toEqual(l);
  });
});

describe("renderDataShape", () => {
  it("leads with rows, names empty tables, and states drift", () => {
    const t = renderDataShape(shape)!;
    expect(t).toMatch(/BUILT BUT UNUSED/);
    expect(t).toMatch(/sessions 2,000,000~/);
    expect(t).toMatch(/Empty tables \(1\): path_pace/);
    expect(t).toMatch(/in code but not in the database: loopNotes; in the database but not in code: legacy_widgets/);
    expect(renderDataShape({ ...shape, error: "timeout" })).toMatch(/read failed \(timeout\)/);
    expect(renderDataShape(null)).toBeNull();
  });
});

describe("compareWithCode", () => {
  it("matches camelCase code names to snake_case tables, loosely plural", () => {
    const c = compareWithCode({ ...shape, compare: null }, [{ name: "users" }, { name: "projectCheckIns" }, { name: "loopNotes" }, { name: "rateLimitHit" }]);
    expect(c.compare).toEqual({ inCodeNotInDb: ["loopNotes"], inDbNotInCode: ["path_pace", "projects", "sessions"] });
  });
});

describe("safeDbUrl", () => {
  it("accepts public postgres URLs and refuses the rest", () => {
    expect(safeDbUrl("postgresql://ro:pw@db.example.com:5432/app")?.hostname).toBe("db.example.com");
    expect(safeDbUrl("postgres://ro:pw@ep-x.neon.tech/app?sslmode=require")).not.toBeNull();
    for (const bad of ["postgresql://ro:pw@localhost/app", "postgresql://ro:pw@127.0.0.1/app", "postgresql://ro:pw@10.1.1.1/app", "postgresql://ro:pw@db.internal/app", "https://example.com", "mysql://x@example.com/db", ""]) {
      expect(safeDbUrl(bad), bad).toBeNull();
    }
  });
});

describe("secret box", () => {
  it("round-trips and refuses tampering", async () => {
    process.env.SESSION_SECRET ||= "unit-test-secret";
    const { seal, open } = await import("../../server/secret-box");
    const sealed = seal("postgresql://ro:pw@db.example.com/app");
    expect(sealed).not.toContain("example.com");
    expect(open(sealed)).toBe("postgresql://ro:pw@db.example.com/app");
    expect(open(sealed.slice(0, -2) + "zz")).toBeNull();
    expect(open("nonsense")).toBeNull();
  });
});

describe("stripSealedFields", () => {
  it("removes sealed keys anywhere in a payload and leaves everything else, dates included", async () => {
    const { stripSealedFields } = await import("@shared/strip-sealed");
    const d = new Date();
    expect(stripSealedFields({ id: "p", dataSource: "v1.x", createdAt: d, nested: [{ dataSource: "v1.y", keep: 1 }], n: null }))
      .toEqual({ id: "p", createdAt: d, nested: [{ keep: 1 }], n: null });
    expect(stripSealedFields("plain")).toBe("plain");
    expect(stripSealedFields([1, { dataSource: 1 }])).toEqual([1, {}]);
  });
});
