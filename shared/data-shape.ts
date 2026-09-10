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

export const BOX_W = 208;
export const BOX_H = 72;

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

  // First pass: angles only. Each node gets the middle of its sector; children split the parent's sector by leaf count.
  const angleOf = new Map<string, number>();
  const depthOf = new Map<string, number>();
  const parentUsed = new Map<string, string | null>();
  const treeEdges = new Set<string>();
  const assign = (n: string, depth: number, a0: number, a1: number, parent: string | null) => {
    angleOf.set(n, (a0 + a1) / 2); depthOf.set(n, depth); parentUsed.set(n, parent);
    if (parent) treeEdges.add(`${n}→${parent}`);
    const kids = children.get(n) ?? [];
    const total = kids.reduce((s, k) => s + (leaves.get(k) ?? 1), 0) || 1;
    let a = a0;
    for (const k of kids) { const span = ((a1 - a0) * (leaves.get(k) ?? 1)) / total; assign(k, depth + 1, a, a + span, n); a += span; }
  };
  const rimShare = otherLeaves ? Math.min(0.35, otherLeaves / (hubLeaves + otherLeaves)) : 0;
  const hubSpan = 2 * Math.PI * (1 - rimShare);
  const start = -Math.PI / 2;
  angleOf.set(hub, 0); depthOf.set(hub, 0); parentUsed.set(hub, null);
  const hubKids = children.get(hub) ?? [];
  const hubTotal = hubKids.reduce((s, k) => s + (leaves.get(k) ?? 1), 0) || 1;
  let a = start;
  for (const k of hubKids) { const span = (hubSpan * (leaves.get(k) ?? 1)) / hubTotal; assign(k, 1, a, a + span, hub); a += span; }
  let b = start + hubSpan;
  for (const r of roots.slice(1)) { const span = (2 * Math.PI * rimShare * (leaves.get(r) ?? 1)) / Math.max(1, otherLeaves); assign(r, 1, b, b + span, null); b += span; }

  // Second pass: each ring's radius comes from the tightest angular gap on
  // it, with neighbours staggered in and out so every other box only has to
  // clear the one two along. That is what keeps a crowded ring readable
  // instead of a pile of boxes over each other.
  const maxDepth = Math.max(0, ...depthOf.values());
  // Tight: the collision check below is the guarantee, so the first guess
  // and the minimum ring step can be as small as a box and a margin.
  const GAP = 14, STAGGER = BOX_H + 10;
  const radii: number[] = [0];
  const stagger = new Map<string, number>();
  const boxW = (d: number) => (d === 0 ? BOX_W + 12 : BOX_W), boxH = (d: number) => (d === 0 ? BOX_H + 8 : BOX_H);
  const at = (n: string, r: number) => ({ x: r * Math.cos(angleOf.get(n)!), y: r * Math.sin(angleOf.get(n)!) });
  const collide = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < BOX_W + GAP && Math.abs(a.y - b.y) < BOX_H + GAP;
  for (let d = 1; d <= maxDepth; d++) {
    const ring = [...depthOf.entries()].filter(([, k]) => k === d).map(([n]) => n).sort((x, y) => angleOf.get(x)! - angleOf.get(y)!);
    ring.forEach((n, i) => stagger.set(n, i % 2 === 0 ? -STAGGER / 2 : STAGGER / 2));
    // Start from a first guess off the every-other angular gap, then widen
    // the ring until no two boxes on it collide. Guaranteed, and still
    // deterministic.
    let minGap2 = 2 * Math.PI;
    if (ring.length >= 3) for (let i = 0; i < ring.length; i++) {
      let g = angleOf.get(ring[(i + 2) % ring.length])! - angleOf.get(ring[i])!; if (g <= 0) g += 2 * Math.PI; minGap2 = Math.min(minGap2, g);
    }
    let r = Math.max(radii[d - 1] + BOX_W * 0.9 + STAGGER, ring.length ? ((BOX_W + GAP) / Math.max(0.02, minGap2)) * 0.85 : 0);
    for (let iter = 0; iter < 80; iter++) {
      const p = ring.map((n) => at(n, r + stagger.get(n)!));
      let hit = false;
      for (let i = 0; i < p.length && !hit; i++) for (let j = i + 1; j < p.length; j++) if (collide(p[i], p[j])) { hit = true; break; }
      if (!hit) break;
      r *= 1.05;
    }
    radii[d] = r;
  }
  const size = 2 * (radii[maxDepth] + STAGGER + BOX_W) + 40;
  const c = size / 2;
  const nodes: MapNode[] = [];
  for (const [n, depth] of depthOf) {
    const r = depth === 0 ? 0 : radii[depth] + (stagger.get(n) ?? 0);
    const q = at(n, r);
    nodes.push({ name: n, x: c + q.x, y: c + q.y, w: boxW(depth), h: boxH(depth), depth, rows: byName.get(n)!.rows, parent: parentUsed.get(n) ?? null });
  }
  nodes.sort((x, y) => x.depth - y.depth || x.name.localeCompare(y.name));

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
    if (nullable / real.length < 0.75) continue;
    // One row per parent row (a unique FK, or a *_profiles/_settings name) is a
    // profile that fills in gradually: optional by design. The useful note is
    // the column groups, not a split by type.
    const oneToOne = (x.foreignKeys.length === 1 && x.inbound === 0 && t.some((p) => p.name === x.foreignKeys[0].refTable && p.rows > 0 && x.rows <= p.rows)) || /_(profiles?|settings|preferences)$/.test(x.name);
    if (oneToOne) {
      const groups = columnGroups(real.filter((c) => c.nullable).map((c) => c.name));
      out.push({ kind: "wide-nullable", tables: [x.name], reason: `${nullable} of ${real.length} columns are optional — expected for a profile that fills in over time, one row per ${x.foreignKeys[0]?.refTable ?? "owner"}.`, suggestion: groups.length ? `The columns fall into groups that different features read: ${groups.map((g) => `${g.label} (${g.columns.length})`).join(", ")}. Each group could be one jsonb column or its own small table if only one feature touches it.` : "Fine as it is unless one feature reads most of it and the rest never does." });
    } else {
      out.push({ kind: "wide-nullable", tables: [x.name], reason: `${nullable} of ${real.length} columns are optional.`, suggestion: "Several kinds of row are probably sharing one table; a type column or a split would make the shape honest." });
    }
  }
  return out.slice(0, 20);
}

/** Optional columns grouped by what they're about, from their names: links, media, style/preference enums, parsed documents, and the rest. */
export function columnGroups(names: string[]): { label: string; columns: string[] }[] {
  // First match wins, so a resume_url is a document and an avatar_url is media, not a link.
  const rules: { label: string; test: RegExp }[] = [
    { label: "media", test: /avatar|cover|image|photo|logo|banner/ },
    { label: "experience & documents", test: /experience|education|portfolio|resume|skills|interests|parsed/ },
    { label: "working style & preferences", test: /_style$|tolerance|_vs_|builder_type|hours_per|looking_for|availability|preference/ },
    { label: "links", test: /_url$|^url$|website|github|linkedin|twitter|handle/ },
    { label: "identity & bio", test: /display_name|username|headline|bio|location|tagline|summary/ },
  ];
  const taken = new Set<string>();
  const out = rules.map((r) => {
    const columns = names.filter((n) => !taken.has(n) && r.test.test(n));
    columns.forEach((n) => taken.add(n));
    return { label: r.label, columns };
  }).filter((g) => g.columns.length >= 2);
  const used = new Set(out.flatMap((g) => g.columns));
  const rest = names.filter((n) => !used.has(n));
  if (rest.length >= 2 && out.length) out.push({ label: "other", columns: rest });
  return out;
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

export interface RelatedTable {
  name: string;
  /** "referenced-by": that table holds a key to this one (it is the many side). "references": this one points at it. */
  direction: "referenced-by" | "references";
  via: string;
  rows: number;
  /** Relations that table has beyond this one — whether the trail goes on. */
  further: number;
}

/** The tables one hop from `name`, children (many side) first, biggest first. */
export function relatedTables(shape: DataShape, name: string): RelatedTable[] {
  const byName = new Map(shape.tables.map((t) => [t.name, t]));
  const me = byName.get(name);
  if (!me) return [];
  const degree = (t: ShapeTable) => new Set([...t.foreignKeys.map((f) => f.refTable), ...shape.tables.filter((o) => o.foreignKeys.some((f) => f.refTable === t.name)).map((o) => o.name)]).size;
  const out: RelatedTable[] = [];
  for (const t of shape.tables) {
    if (t.name === name) continue;
    for (const f of t.foreignKeys) if (f.refTable === name) out.push({ name: t.name, direction: "referenced-by", via: f.column, rows: t.rows, further: Math.max(0, degree(t) - 1) });
  }
  for (const f of me.foreignKeys) {
    const t = byName.get(f.refTable);
    if (t && t.name !== name) out.push({ name: t.name, direction: "references", via: f.column, rows: t.rows, further: Math.max(0, degree(t) - 1) });
  }
  const seen = new Set<string>();
  return out
    .filter((r) => { const k = `${r.direction}:${r.name}:${r.via}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.direction === b.direction ? b.rows - a.rows || a.name.localeCompare(b.name) : a.direction === "referenced-by" ? -1 : 1));
}

/** The table to open on: the most-referenced one. */
export function hubTable(shape: DataShape): string | null {
  if (!shape.tables.length) return null;
  return [...shape.tables].sort((a, b) => b.inbound - a.inbound || b.rows - a.rows || a.name.localeCompare(b.name))[0].name;
}
