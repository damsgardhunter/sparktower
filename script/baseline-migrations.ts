/**
 * Marks an existing database as already at the baseline migration.
 *
 * Every database built before this project had migrations — production, and
 * every developer's local one — was built by `drizzle-kit push`, and already
 * has every table `migrations/0000_baseline.sql` would create. Running that
 * file against them fails on the first CREATE TABLE. This records it as
 * applied instead, writing exactly the row `drizzle-kit migrate` would have,
 * so the next migration is the first one that actually runs.
 *
 * It refuses unless the database really is at the baseline: every table and
 * column the baseline creates must already exist. A database that is behind
 * would otherwise be marked current and quietly stay behind for good.
 *
 *   DATABASE_URL=… npm run db:baseline              # check only
 *   DATABASE_URL=… npm run db:baseline -- --apply   # record it
 *
 * Once per database. Running it again is a no-op.
 */
import { readFileSync } from "fs";
import path from "path";
import pg from "pg";
import { readMigrationFiles } from "drizzle-orm/migrator";

const MIGRATIONS_FOLDER = path.resolve("migrations");
const apply = process.argv.includes("--apply");

interface SnapshotTable {
  name: string;
  schema: string;
  columns: Record<string, { name: string }>;
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the database to baseline.");

  const [baseline] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  const snapshot = JSON.parse(
    readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "0000_snapshot.json"), "utf8"),
  );
  const expected = Object.values(snapshot.tables as Record<string, SnapshotTable>);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: [db] } = await client.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    console.log(`database: ${db.name}`);

    // Two queries, not one: Postgres resolves every table a statement names
    // before running it, so a CASE can't guard a table that may not exist.
    const { rows: [bookkeeping] } = await client.query<{ t: string | null }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS t",
    );
    if (bookkeeping.t) {
      const { rows: [applied] } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations",
      );
      if (applied.n > 0) {
        console.log(`already on migrations (${applied.n} applied) — nothing to do.`);
        return 0;
      }
    }

    const { rows: columns } = await client.query<{ t: string; c: string }>(`
      SELECT table_schema || '.' || table_name AS t, column_name AS c
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    `);
    const tables = new Set(columns.map((r) => r.t));
    const cols = new Set(columns.map((r) => `${r.t}.${r.c}`));

    if (![...tables].some((t) => t.startsWith("public."))) {
      console.error("public schema is empty — nothing to baseline. Run `npm run db:migrate` instead.");
      return 1;
    }

    const missing: string[] = [];
    for (const table of expected) {
      const t = `${table.schema || "public"}.${table.name}`;
      if (!tables.has(t)) {
        missing.push(`table   ${t}`);
        continue;
      }
      for (const column of Object.values(table.columns)) {
        if (!cols.has(`${t}.${column.name}`)) missing.push(`column  ${t}.${column.name}`);
      }
    }
    if (missing.length > 0) {
      console.error(`behind the baseline — ${missing.length} missing:`);
      for (const m of missing) console.error(`  ${m}`);
      console.error("Bring it level first (a reviewed `drizzle-kit push --verbose`), then run this again.");
      return 1;
    }
    console.log(`matches the baseline: all ${expected.length} tables and their columns are present.`);

    if (!apply) {
      console.log("check only — rerun with --apply to record the baseline as applied.");
      return 0;
    }

    // The bookkeeping table exactly as drizzle's migrator creates it, so
    // `drizzle-kit migrate` finds its own table and carries on from here.
    await client.query("BEGIN");
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `);
      await client.query(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
        [baseline.hash, baseline.folderMillis],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    console.log("baseline recorded. From here, `npm run db:migrate` applies only newer migrations.");
    return 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
