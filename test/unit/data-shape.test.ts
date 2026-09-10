/**
 * The data shape's pure parts: the star layout, the prompt rendering, the
 * URL guard for connection strings, and the seal that keeps them at rest.
 */
import { describe, it, expect } from "vitest";
import { snowflakeLayout, suggestConsolidations, describeDataModel, renderDataShape, relatedTables, hubTable, type DataShape } from "@shared/data-shape";
import { safeDbUrl, compareWithCode } from "../../server/data-shape-guard";

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

describe("snowflakeLayout", () => {
  it("puts the hub at the centre and every table outward from the one it references, without crossing back", () => {
    const l = snowflakeLayout(shape);
    const by = Object.fromEntries(l.nodes.map((n) => [n.name, n]));
    expect(l.hub).toBe("users");
    expect(by.users).toMatchObject({ depth: 0, parent: null });
    expect(by.projects).toMatchObject({ depth: 1, parent: "users" });
    // check-ins reference both users and projects; they hang off the busier hub they point at.
    expect(by.project_check_ins.parent).toBe("users");
    expect(by.path_pace).toMatchObject({ depth: 2, parent: "projects" });
    const dist = (n: string) => Math.hypot(by[n].x - by.users.x, by[n].y - by.users.y);
    expect(dist("path_pace")).toBeGreaterThan(dist("projects"));
    // A child sits in its parent's direction, not across the middle.
    const ang = (n: string) => Math.atan2(by[n].y - by.users.y, by[n].x - by.users.x);
    expect(Math.abs(ang("path_pace") - ang("projects"))).toBeLessThan(0.8);
    // sessions has no relations: a tree of its own on the rim.
    expect(by.sessions).toMatchObject({ depth: 1, parent: null });
    expect(l.orphans).toEqual(["sessions"]);
    expect(l.edges.find((e) => e.from === "projects" && e.to === "users")?.tree).toBe(true);
    expect(l.edges.find((e) => e.from === "project_check_ins" && e.to === "projects")?.tree).toBe(false);
    expect(snowflakeLayout(shape)).toEqual(l);
  });
});

describe("suggestConsolidations", () => {
  it("names similar tables, empty orphans, one-to-one satellites and wide-nullable tables, with reasons", () => {
    const col = (name: string, nullable = false, pk = false) => ({ name, type: "text", nullable, pk });
    const s: DataShape = {
      ...shape,
      tables: [
        { name: "users", rows: 100, exact: true, columns: [col("id", false, true), col("email"), col("name"), col("bio", true), col("avatar", true)], foreignKeys: [], inbound: 3 },
        { name: "posts", rows: 50, exact: true, columns: [col("id", false, true), col("title"), col("body"), col("author_id"), col("published_at", true)], foreignKeys: [{ column: "author_id", refTable: "users", refColumn: "id" }], inbound: 0 },
        { name: "articles", rows: 20, exact: true, columns: [col("id", false, true), col("title"), col("body"), col("author_id"), col("published_at", true)], foreignKeys: [{ column: "author_id", refTable: "users", refColumn: "id" }], inbound: 0 },
        { name: "user_settings", rows: 80, exact: true, columns: [col("id", false, true), col("user_id"), col("theme"), col("locale")], foreignKeys: [{ column: "user_id", refTable: "users", refColumn: "id" }], inbound: 0 },
        { name: "legacy_widgets", rows: 0, exact: true, columns: [col("id", false, true)], foreignKeys: [], inbound: 0 },
        { name: "everything", rows: 5, exact: true, columns: [col("id", false, true), ...Array.from({ length: 9 }, (_, i) => col(`f${i}`, i < 8))], foreignKeys: [], inbound: 0 },
      ],
    };
    const c = suggestConsolidations(s);
    expect(c.map((x) => [x.kind, x.tables.join("+")])).toEqual([
      ["similar-columns", "posts+articles"],
      ["empty-orphan", "legacy_widgets"],
      ["one-to-one-satellite", "user_settings+users"],
      ["wide-nullable", "everything"],
    ]);
    expect(c[0].reason).toMatch(/4 of their columns are the same/);
    expect(c[2].reason).toMatch(/2 real columns, about one row per users row/);
    expect(describeDataModel(s)).toMatch(/The hub is "users" \(3 tables reference it\)/);
    expect(describeDataModel(s)).toMatch(/Could be simpler/);
  });
});

describe("snowflakeLayout on a crowded ring", () => {
  it("never overlaps boxes on the same ring, even with forty tables off one hub", () => {
    const col = (name: string, nullable = false, pk = false) => ({ name, type: "text", nullable, pk });
    const tables = [{ name: "users", rows: 100, exact: true, columns: [col("id", false, true)], foreignKeys: [], inbound: 40 }];
    for (let i = 0; i < 40; i++) tables.push({ name: `t${i}`, rows: i, exact: true, columns: [col("id", false, true), col("user_id")], foreignKeys: [{ column: "user_id", refTable: "users", refColumn: "id" }], inbound: 0 });
    const l = snowflakeLayout({ ...shape, tables, totals: { tables: 41, rows: 0, emptyTables: 1 }, compare: null });
    const ring = l.nodes.filter((n) => n.depth === 1);
    expect(ring).toHaveLength(40);
    for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
      const a = ring[i], b = ring[j];
      const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      expect(overlap, `${a.name} overlaps ${b.name}`).toBe(false);
    }
  });
});

describe("a wide profile table", () => {
  it("is called optional-by-design with its column groups, not 'several kinds of row'", () => {
    const col = (name: string, nullable = true) => ({ name, type: "text", nullable, pk: false });
    const t: DataShape = { ...shape, compare: null, tables: [
      { name: "users", rows: 100, exact: true, columns: [{ name: "id", type: "text", nullable: false, pk: true }], foreignKeys: [], inbound: 1 },
      { name: "user_profiles", rows: 90, exact: true, columns: [{ name: "id", type: "text", nullable: false, pk: true }, col("user_id", false), col("display_name"), col("username"), col("bio"), col("github_url"), col("linkedin_url"), col("website_url"), col("avatar_url"), col("cover_url"), col("risk_tolerance"), col("schedule_style"), col("conflict_style"), col("hours_per_week"), col("experience"), col("education"), col("resume_url"), col("skills")], foreignKeys: [{ column: "user_id", refTable: "users", refColumn: "id" }], inbound: 0 },
    ] };
    const note = suggestConsolidations(t).find((c) => c.kind === "wide-nullable")!;
    expect(note.reason).toMatch(/expected for a profile that fills in over time, one row per users/);
    expect(note.suggestion).toMatch(/links \(3\)/);
    expect(note.suggestion).toMatch(/working style & preferences \(4\)/);
    expect(note.suggestion).not.toMatch(/several kinds of row/i);
  });
});

describe("relatedTables", () => {
  it("lists one hop from a table: the many side first, with whether the trail goes on", () => {
    expect(hubTable(shape)).toBe("users");
    const r = relatedTables(shape, "users");
    expect(r.map((x) => [x.name, x.direction, x.via, x.further])).toEqual([
      ["rate_limit_hits", "referenced-by", "user_id", 0],
      ["projects", "referenced-by", "owner_id", 2],
      ["project_check_ins", "referenced-by", "user_id", 1],
    ]);
    const p = relatedTables(shape, "projects");
    expect(p.map((x) => [x.name, x.direction])).toEqual([["project_check_ins", "referenced-by"], ["path_pace", "referenced-by"], ["users", "references"]]);
    expect(relatedTables(shape, "sessions")).toEqual([]);
    expect(relatedTables(shape, "nope")).toEqual([]);
  });
});
