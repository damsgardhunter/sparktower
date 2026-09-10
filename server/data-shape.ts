/**
 * Reading the live database: tables, columns, keys and row counts, over a
 * read-only, time-boxed connection to a public host — or this application's
 * own database for the platform owner's own project. Nothing here writes.
 */
import pg from "pg";
import { isIP } from "net";
import type { DataShape, ShapeTable } from "@shared/data-shape";
import { db } from "./db";
import { storage } from "./storage";
import { projectDataShapes } from "@shared/schema";
import { eq } from "drizzle-orm";
import { open as openSecret } from "./secret-box";

/** Postgres URLs only, to public hosts, with credentials; "self" is handled by the caller. */
export function safeDbUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (isIP(host) && (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "::1" || /^f[cde]/.test(host))) return null;
  return u;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

export async function introspectDataShape(connectionString: string, source: DataShape["source"], opts: { exactUnder?: number; maxTables?: number; ssl?: boolean } = {}): Promise<DataShape> {
  const at = new Date().toISOString();
  const client = new pg.Client({ connectionString, statement_timeout: 8000, connectionTimeoutMillis: 8000, ...(opts.ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const tables = (await client.query<{ name: string; est: number }>(`
      SELECT c.relname AS name, c.reltuples::bigint AS est
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      ORDER BY c.relname`)).rows.slice(0, opts.maxTables ?? 150);
    const cols = (await client.query<{ table: string; name: string; type: string; nullable: string }>(`
      SELECT table_name AS "table", column_name AS name, data_type AS type, is_nullable AS nullable
      FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`)).rows;
    const keys = (await client.query<{ table: string; column: string; kind: string; ref_table: string | null; ref_column: string | null }>(`
      SELECT tc.table_name AS "table", kcu.column_name AS "column", tc.constraint_type AS kind,
             ccu.table_name AS ref_table, ccu.column_name AS ref_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      LEFT JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND tc.constraint_type = 'FOREIGN KEY'
      WHERE tc.table_schema = 'public' AND tc.constraint_type IN ('PRIMARY KEY','FOREIGN KEY')`)).rows;

    const exactUnder = opts.exactUnder ?? 200_000;
    const out: ShapeTable[] = [];
    for (const t of tables) {
      if (!IDENT.test(t.name)) continue;
      let rows = Math.max(0, Number(t.est) || 0), exact = false;
      if (rows < exactUnder) {
        try { rows = Number((await client.query(`SELECT count(*)::bigint AS n FROM "${t.name}"`)).rows[0].n); exact = true; } catch { /* keep the estimate */ }
      }
      const pk = new Set(keys.filter((k) => k.table === t.name && k.kind === "PRIMARY KEY").map((k) => k.column));
      out.push({
        name: t.name, rows, exact,
        columns: cols.filter((c) => c.table === t.name).map((c) => ({ name: c.name, type: c.type, nullable: c.nullable === "YES", pk: pk.has(c.name) })),
        foreignKeys: keys.filter((k) => k.table === t.name && k.kind === "FOREIGN KEY" && k.ref_table).map((k) => ({ column: k.column, refTable: k.ref_table!, refColumn: k.ref_column! })),
        inbound: 0,
      });
    }
    for (const t of out) for (const fk of t.foreignKeys) { const target = out.find((x) => x.name === fk.refTable); if (target && target !== t) target.inbound++; }
    await client.query("ROLLBACK").catch(() => {});
    return { at, source, tables: out, totals: { tables: out.length, rows: out.reduce((n, t) => n + t.rows, 0), emptyTables: out.filter((t) => t.rows === 0).length }, compare: null };
  } catch (err) {
    return { at, source, tables: [], totals: { tables: 0, rows: 0, emptyTables: 0 }, compare: null, error: String((err as Error)?.message ?? err).slice(0, 200) };
  } finally {
    await client.end().catch(() => {});
  }
}

/** Code declares tables (Drizzle pgTable names, model names); the database has tables. Both ways of disagreeing matter. */
export function compareWithCode(shape: DataShape, dataModels: { name: string }[]): DataShape {
  if (shape.error) return shape;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const db = new Set(shape.tables.map((t) => norm(t.name)));
  const code = new Map(dataModels.map((m) => [norm(m.name), m.name]));
  // Drizzle names camelCase in code and snake_case in the DB; compare on letters only, and also singular/plural loosely.
  const has = (set: Set<string>, n: string) => set.has(n) || set.has(n + "s") || set.has(n.replace(/s$/, ""));
  const inCodeNotInDb = [...code.entries()].filter(([n]) => !has(db, n)).map(([, name]) => name).sort();
  const codeSet = new Set(code.keys());
  const inDbNotInCode = shape.tables.map((t) => t.name).filter((n) => !has(codeSet, norm(n))).sort();
  return { ...shape, compare: { inCodeNotInDb, inDbNotInCode } };
}

/**
 * Reads the project's database now, from whatever source the owner set,
 * compares with the schema the latest audit saw in code (if any), and
 * stores the result as the project's current shape. Null when no source
 * is configured.
 */
export async function refreshDataShape(projectId: string): Promise<DataShape | null> {
  const project = await storage.getProject(projectId);
  if (!project?.dataSource) return null;
  let shape: DataShape;
  if (project.dataSource === "self") {
    if (!process.env.DATABASE_URL) return null;
    shape = await introspectDataShape(process.env.DATABASE_URL, "self");
  } else {
    const url = openSecret(project.dataSource);
    if (!url) return { at: new Date().toISOString(), source: "connection", tables: [], totals: { tables: 0, rows: 0, emptyTables: 0 }, compare: null, error: "The stored connection could not be unsealed; set it again." };
    shape = await introspectDataShape(url, "connection", { ssl: true });
  }
  const audit = await storage.getLatestCodeAudit(projectId).catch(() => undefined);
  const models = ((audit?.signals as any)?.dataModels ?? []) as { name: string }[];
  if (models.length) shape = compareWithCode(shape, models);
  await db.insert(projectDataShapes).values({ projectId, shape, updatedAt: new Date() })
    .onConflictDoUpdate({ target: projectDataShapes.projectId, set: { shape, updatedAt: new Date() } });
  return shape;
}

export async function getDataShape(projectId: string): Promise<DataShape | null> {
  const [row] = await db.select().from(projectDataShapes).where(eq(projectDataShapes.projectId, projectId));
  return (row?.shape as DataShape) ?? null;
}
