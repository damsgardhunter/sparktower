/**
 * The shape of a project's data: what the live database holds, table by
 * table, and how that compares with the schema in the code. Pure types,
 * rendering and layout live here; the introspection is server-side.
 */
export interface ShapeColumn { name: string; type: string; nullable: boolean; pk: boolean }
export interface ShapeForeignKey { column: string; refTable: string; refColumn: string }
export interface ShapeTable {
  name: string;
  rows: number;
  /** Exact count, or a planner estimate for big tables. */
  exact: boolean;
  columns: ShapeColumn[];
  foreignKeys: ShapeForeignKey[];
  /** How many other tables point at this one: the hub score. */
  inbound: number;
}
export interface DataShape {
  at: string;
  source: "self" | "connection";
  tables: ShapeTable[];
  totals: { tables: number; rows: number; emptyTables: number };
  /** Tables the code declares that the database doesn't have, and the reverse. */
  compare: { inCodeNotInDb: string[]; inDbNotInCode: string[] } | null;
  error?: string;
}

/** Row counts, in words a planner can use. */
export function renderDataShape(d: DataShape | null | undefined, max = 40): string | null {
  if (!d) return null;
  if (d.error) return `DATA IN USE: the data-shape read failed (${d.error}); judge features by code only.`;
  const sorted = [...d.tables].sort((a, b) => b.rows - a.rows);
  const busy = sorted.filter((t) => t.rows > 0).slice(0, max).map((t) => `${t.name} ${t.rows.toLocaleString()}${t.exact ? "" : "~"}`).join(", ");
  const empty = sorted.filter((t) => t.rows === 0).map((t) => t.name);
  return [
    `DATA IN USE (live database, ${d.at.slice(0, 10)}; ${d.totals.tables} tables, ${d.totals.rows.toLocaleString()} rows). A feature whose tables are empty is BUILT BUT UNUSED: judge it "partial" for the product, not "built", and say so.`,
    `- Rows: ${busy || "none"}`,
    empty.length ? `- Empty tables (${empty.length}): ${empty.slice(0, max).join(", ")}${empty.length > max ? " …" : ""}` : "- No empty tables.",
    d.compare && (d.compare.inCodeNotInDb.length || d.compare.inDbNotInCode.length)
      ? `- Schema drift: in code but not in the database: ${d.compare.inCodeNotInDb.join(", ") || "none"}; in the database but not in code: ${d.compare.inDbNotInCode.join(", ") || "none"}.`
      : "- Schema in code and database agree.",
  ].join("\n");
}

export interface StarNode { name: string; x: number; y: number; r: number; ring: number; rows: number }
export interface StarEdge { from: string; to: string }
export interface StarLayout { width: number; height: number; nodes: StarNode[]; edges: StarEdge[] }

/**
 * A star layout: the most-referenced table at the centre, the tables that
 * point at it on the first ring, everything else on an outer ring, node
 * size by row count. Deterministic, so the map is the same on every open.
 */
export function starLayout(shape: DataShape, size = 760): StarLayout {
  const tables = shape.tables;
  if (!tables.length) return { width: size, height: size, nodes: [], edges: [] };
  const byName = new Map(tables.map((t) => [t.name, t]));
  const edges: StarEdge[] = [];
  for (const t of tables) for (const fk of t.foreignKeys) if (byName.has(fk.refTable) && fk.refTable !== t.name) edges.push({ from: t.name, to: fk.refTable });
  const hub = [...tables].sort((a, b) => b.inbound - a.inbound || b.rows - a.rows)[0];
  const first = new Set(edges.filter((e) => e.to === hub.name).map((e) => e.from));
  const ring1 = tables.filter((t) => t.name !== hub.name && first.has(t.name)).sort((a, b) => b.rows - a.rows);
  const ring2 = tables.filter((t) => t.name !== hub.name && !first.has(t.name)).sort((a, b) => b.inbound - a.inbound || b.rows - a.rows);
  const maxRows = Math.max(1, ...tables.map((t) => t.rows));
  const radius = (rows: number) => 10 + 16 * Math.sqrt(Math.log10(rows + 1) / Math.log10(maxRows + 1));
  const c = size / 2;
  const place = (list: ShapeTable[], R: number, ring: number): StarNode[] =>
    list.map((t, i) => { const a = (2 * Math.PI * i) / Math.max(1, list.length) - Math.PI / 2; return { name: t.name, x: c + R * Math.cos(a), y: c + R * Math.sin(a), r: radius(t.rows), ring, rows: t.rows }; });
  const nodes = [
    { name: hub.name, x: c, y: c, r: radius(hub.rows) + 4, ring: 0, rows: hub.rows },
    ...place(ring1, size * 0.22 + Math.min(60, ring1.length * 2), 1),
    ...place(ring2, size * 0.42, 2),
  ];
  return { width: size, height: size, nodes, edges };
}
