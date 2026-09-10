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
    describeDataModel(d),
  ].filter(Boolean).join("\n");
}

export interface MapNode { name: string; x: number; y: number; w: number; h: number; depth: number; rows: number; parent: string | null }
/** from = the "many" side (holds the foreign key); to = the "one" side. */
export interface MapEdge { from: string; to: string; column: string; tree: boolean }
export interface MapLayout { width: number; height: number; nodes: MapNode[]; edges: MapEdge[]; hub: string; orphans: string[] }

export const BOX_W = 168;
export const BOX_H = 56;

/**
 * A snowflake: the most-referenced table at the centre, and every table
 * placed outward from the table it references — a radial tree over the
 * foreign keys, each child fanning out inside its parent's angular sector,
 * so relations run outward and never cross back through the middle.
 * Tables with no path to the hub form their own small trees on the rim.
 * Deterministic, so the map is the same on every open.
 */
export function snowflakeLayout(shape: DataShape): MapLayout {
  const tables = shape.tables;
  if (!tables.length) return { width: 800, height: 800, nodes: [], edges: [], hub: "", orphans: [] };
  const byName = new Map(tables.map((t) => [t.name, t]));
  const edges: MapEdge[] = [];
  for (const t of tables) for (const fk of t.foreignKeys) if (byName.has(fk.refTable) && fk.refTable !== t.name) edges.push({ from: t.name, to: fk.refTable, column: fk.column, tree: false });

  // Each table hangs off the table it references with the most inbound edges (the busiest hub it points at).
  const parentOf = new Map<string, string>();
  for (const t of tables) {
    const targets = [...new Set(t.foreignKeys.map((f) => f.refTable))].filter((n) => n !== t.name && byName.has(n));
    if (!targets.length) continue;
    targets.sort((a, b) => (byName.get(b)!.inbound - byName.get(a)!.inbound) || a.localeCompare(b));
    parentOf.set(t.name, targets[0]);
  }
  // Break cycles: walk each chain and drop the back-edge.
  for (const t of tables) {
    const seen = new Set<string>(); let cur: string | undefined = t.name;
    while (cur && !seen.has(cur)) { seen.add(cur); cur = parentOf.get(cur); }
    if (cur && seen.has(cur)) parentOf.delete(cur);
  }
  const children = new Map<string, string[]>();
  for (const [c, p] of parentOf) children.set(p, [...(children.get(p) ?? []), c]);
  for (const list of children.values()) list.sort((a, b) => (byName.get(b)!.rows - byName.get(a)!.rows) || a.localeCompare(b));

  const hub = [...tables].sort((a, b) => b.inbound - a.inbound || b.rows - a.rows || a.name.localeCompare(b.name))[0].name;
  const leaves = new Map<string, number>();
  const countLeaves = (n: string): number => { const kids = children.get(n) ?? []; const v = kids.length ? kids.reduce((s, k) => s + countLeaves(k), 0) : 1; leaves.set(n, v); return v; };

  const roots = [hub, ...tables.map((t) => t.name).filter((n) => n !== hub && !parentOf.has(n)).sort((a, b) => (leaves.get(b) ?? 0) - (leaves.get(a) ?? 0) || a.localeCompare(b))];
  roots.forEach(countLeaves);
  const hubLeaves = leaves.get(hub) ?? 1;
  const otherLeaves = roots.slice(1).reduce((s, r) => s + (leaves.get(r) ?? 1), 0);

  // Depth → radius: rings far enough apart for boxes to fit, growing with the crowd on that ring.
  const maxDepth = (() => { let d = 0; const walk = (n: string, k: number) => { d = Math.max(d, k); for (const c of children.get(n) ?? []) walk(c, k + 1); }; roots.forEach((r) => walk(r, r === hub ? 0 : 1)); return d; })();
  const ringGap = Math.max(210, Math.ceil((tables.length * (BOX_W + 26)) / (2 * Math.PI * Math.max(1, maxDepth)) / Math.max(1, maxDepth)) + 60);
  const size = 2 * (ringGap * (maxDepth + 1)) + BOX_W;
  const c = size / 2;
  const nodes: MapNode[] = [];
  const treeEdges = new Set<string>();

  const place = (n: string, depth: number, a0: number, a1: number, parent: string | null) => {
    const mid = (a0 + a1) / 2;
    const r = depth * ringGap;
    nodes.push({ name: n, x: c + r * Math.cos(mid), y: c + r * Math.sin(mid), w: BOX_W, h: BOX_H, depth, rows: byName.get(n)!.rows, parent });
    if (parent) treeEdges.add(`${n}→${parent}`);
    const kids = children.get(n) ?? [];
    const total = kids.reduce((s, k) => s + (leaves.get(k) ?? 1), 0) || 1;
    let a = a0;
    for (const k of kids) { const span = ((a1 - a0) * (leaves.get(k) ?? 1)) / total; place(k, depth + 1, a, a + span, n); a += span; }
  };
  // The hub takes the whole circle for its descendants, minus a slice for other trees on the rim.
  const rimShare = otherLeaves ? Math.min(0.35, otherLeaves / (hubLeaves + otherLeaves)) : 0;
  const hubSpan = 2 * Math.PI * (1 - rimShare);
  const start = -Math.PI / 2;
  // Hub at the centre; its children split the circle.
  nodes.push({ name: hub, x: c, y: c, w: BOX_W + 12, h: BOX_H + 8, depth: 0, rows: byName.get(hub)!.rows, parent: null });
  const hubKids = children.get(hub) ?? [];
  const hubTotal = hubKids.reduce((s, k) => s + (leaves.get(k) ?? 1), 0) || 1;
  let a = start;
  for (const k of hubKids) { const span = (hubSpan * (leaves.get(k) ?? 1)) / hubTotal; place(k, 1, a, a + span, hub); a += span; }
  // Other trees share the remaining slice, on ring one outward.
  let b = start + hubSpan;
  for (const r of roots.slice(1)) { const span = (2 * Math.PI * rimShare * (leaves.get(r) ?? 1)) / Math.max(1, otherLeaves); place(r, 1, b, b + span, null); b += span; }

  for (const e of edges) e.tree = treeEdges.has(`${e.from}→${e.to}`);
  const orphans = tables.filter((t) => !t.foreignKeys.length && t.inbound === 0).map((t) => t.name);
  return { width: size, height: size, nodes, edges, hub, orphans };
}

export interface Consolidation { kind: "similar-columns" | "empty-orphan" | "one-to-one-satellite" | "wide-nullable"; tables: string[]; reason: string; suggestion: string }

/**
 * Places the schema could be simpler. Heuristics, named as such: two
 * tables with mostly the same columns, empty tables nothing points at,
 * a small table that is one-to-one with its parent, and a table whose
 * columns are mostly optional. Each comes with the reason so the builder
 * (and Nova) can disagree with evidence.
 */
export function suggestConsolidations(shape: DataShape): Consolidation[] {
  const out: Consolidation[] = [];
  const t = shape.tables;
  const cols = (x: ShapeTable) => new Set(x.columns.map((c) => c.name).filter((n) => !/^(id|created_at|updated_at)$/.test(n)));
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) {
    const a = cols(t[i]), b = cols(t[j]);
    if (a.size < 4 || b.size < 4) continue;
    let shared = 0; for (const c of a) if (b.has(c)) shared++;
    const jaccard = shared / (a.size + b.size - shared);
    if (jaccard >= 0.7) out.push({ kind: "similar-columns", tables: [t[i].name, t[j].name], reason: `${shared} of their columns are the same (${Math.round(jaccard * 100)}% overlap).`, suggestion: "One table with a type column, or a shared parent table, unless they genuinely diverge." });
  }
  for (const x of t) if (x.rows === 0 && x.inbound === 0 && x.foreignKeys.length === 0) out.push({ kind: "empty-orphan", tables: [x.name], reason: "No rows, nothing references it, it references nothing.", suggestion: "Either it's a feature not yet wired, or it can go." });
  for (const x of t) {
    if (x.foreignKeys.length !== 1 || x.inbound > 0) continue;
    const fk = x.foreignKeys[0];
    const nonKey = x.columns.filter((c) => !c.pk && c.name !== fk.column && !/^(created_at|updated_at)$/.test(c.name));
    if (nonKey.length > 3) continue;
    const parent = t.find((p) => p.name === fk.refTable);
    if (!parent || parent.rows === 0) continue;
    // Roughly one row per parent row: a satellite, not a child collection.
    if (x.rows > 0 && x.rows <= parent.rows && x.rows >= 0.6 * parent.rows) out.push({ kind: "one-to-one-satellite", tables: [x.name, parent.name], reason: `${nonKey.length} real column${nonKey.length === 1 ? "" : "s"}, about one row per ${parent.name} row (${x.rows} vs ${parent.rows}), nothing else references it.`, suggestion: `Those columns could live on ${parent.name} unless they are optional for most rows.` });
  }
  for (const x of t) {
    const real = x.columns.filter((c) => !c.pk);
    if (real.length < 8) continue;
    const nullable = real.filter((c) => c.nullable).length;
    if (nullable / real.length >= 0.75) out.push({ kind: "wide-nullable", tables: [x.name], reason: `${nullable} of ${real.length} columns are optional.`, suggestion: "Several kinds of row are probably sharing one table; a type column or a split would make the shape honest." });
  }
  return out.slice(0, 20);
}

/** What the schema is, in words: the hub, the relations, what stands alone. */
export function describeDataModel(shape: DataShape): string | null {
  if (!shape.tables.length || shape.error) return null;
  const layout = snowflakeLayout(shape);
  const hub = shape.tables.find((t) => t.name === layout.hub)!;
  const relations = layout.edges.length;
  const depth = Math.max(0, ...layout.nodes.map((n) => n.depth));
  const firstRing = layout.nodes.filter((n) => n.depth === 1 && n.parent === hub.name).map((n) => n.name);
  const cons = suggestConsolidations(shape);
  return [
    `DATA MODEL: ${shape.tables.length} tables, ${relations} foreign-key relations. The hub is "${hub.name}" (${hub.inbound} tables reference it); ${firstRing.length} hang directly off it: ${firstRing.slice(0, 12).join(", ")}${firstRing.length > 12 ? " …" : ""}. Deepest chain: ${depth} hops. Standalone tables (no relations): ${layout.orphans.length ? layout.orphans.slice(0, 10).join(", ") : "none"}.`,
    cons.length ? `- Could be simpler (heuristics, check before acting): ${cons.slice(0, 6).map((c) => `${c.tables.join(" + ")} — ${c.reason}`).join(" | ")}` : null,
  ].filter(Boolean).join("\n");
}
