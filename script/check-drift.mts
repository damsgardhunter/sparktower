/**
 * What the code expects, against what the database actually has.
 *
 * The migration journal answers "which migrations ran", and that turned out
 * not to be the same question as "is this database current". A development
 * database here had every one of its 65 migrations recorded as applied and was
 * still missing two columns that migrations 0025 and 0035 create —
 * `sim_ventures.state` and `sim_seasons.year_minutes`. Something had dropped
 * them after the fact, most likely a `drizzle-kit push` run against a schema
 * mid-edit.
 *
 * Missing columns fail in the worst possible way. `sim_ventures.state` threw
 * inside `withLock`, which left an advisory lock held by an open transaction,
 * which exhausted the connection pool, which hung every request on the server
 * — several layers away from a cause that reads "column does not exist".
 *
 * So this asks Postgres directly and compares it to the Drizzle schema:
 * missing tables, missing columns, wrong types and columns the code believes
 * are NOT NULL that the database would accept a null into.
 *
 * Run it against whichever database you are pointed at:
 *
 *     npx tsx script/check-drift.mts
 *
 * It only reports. Deciding what to do about a difference needs a person:
 * adding a column back is usually right, changing a type usually is not.
 * `activity_events.seq` is expected to differ — `bigserial` is a `bigint` with
 * a sequence attached, and that is how Postgres reports it.
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema";
import { Client } from "pg";
import { readFileSync } from "fs";

const url = readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))!.slice("DATABASE_URL=".length).trim();

const client = new Client({ connectionString: url });
await client.connect();

const actual = new Map<string, Set<string>>();
const meta = new Map<string, any>();
for (const r of (await client.query(
  `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public'`)).rows) {
  if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
  actual.get(r.table_name)!.add(r.column_name);
  meta.set(`${r.table_name}.${r.column_name}`, r);
}

const missingTables: string[] = [];
const missingCols: any[] = [];
for (const value of Object.values(schema)) {
  let cfg: any;
  try { cfg = getTableConfig(value as any); } catch { continue; }
  const have = actual.get(cfg.name);
  if (!have) { missingTables.push(cfg.name); continue; }
  for (const col of cfg.columns) {
    if (!have.has(col.name)) {
      missingCols.push({ table: cfg.name, column: col.name, type: col.getSQLType(),
        notNull: col.notNull, hasDefault: col.hasDefault, default: col.default });
    }
  }
}
/*
 * Presence was only half of it. A column that exists with the wrong type, or
 * that the code believes is NOT NULL while the database will happily take a
 * null, fails later and further away than a missing one.
 */
const norm = (t: string) => t.toLowerCase()
  .replace("character varying", "varchar").replace("timestamp without time zone", "timestamp")
  .replace("timestamp with time zone", "timestamptz").replace("double precision", "double")
  .replace(/\(\d+\)/, "").replace("[]", "").replace("array", "").trim();
const typeIssues: string[] = [];
const nullIssues: string[] = [];
for (const value of Object.values(schema)) {
  let cfg: any;
  try { cfg = getTableConfig(value as any); } catch { continue; }
  for (const col of cfg.columns) {
    const m = meta.get(`${cfg.name}.${col.name}`);
    if (!m) continue;
    const want = norm(col.getSQLType());
    const got = norm(m.data_type);
    if (want !== got && !(want.startsWith(got) || got.startsWith(want)) && !(got === "user-defined")) {
      typeIssues.push(`  ${cfg.name}.${col.name}: code says ${col.getSQLType()}, db has ${m.data_type}`);
    }
    if (col.notNull && m.is_nullable === "YES" && !col.primary) {
      nullIssues.push(`  ${cfg.name}.${col.name}: code says NOT NULL, db allows null`);
    }
  }
}
console.log("type mismatches:", typeIssues.length);
typeIssues.slice(0, 25).forEach((l) => console.log(l));
console.log("nullability mismatches:", nullIssues.length);
nullIssues.slice(0, 25).forEach((l) => console.log(l));
console.log("missing tables:", missingTables.length ? missingTables.join(", ") : "none");
console.log("missing columns:", missingCols.length);
for (const m of missingCols) {
  console.log(`  ${m.table}.${m.column} :: ${m.type}${m.notNull ? " NOT NULL" : ""}${m.hasDefault ? ` DEFAULT ${JSON.stringify(m.default)}` : ""}`);
}
await client.end();
