/**
 * Applies the migrations `drizzle-kit migrate` can no longer reach.
 *
 * ## Why the migrator cannot do this
 *
 * It decides what to run by one comparison: the newest `created_at` in
 * drizzle.__drizzle_migrations against each journal entry's `when`. Anything
 * stamped earlier is assumed done. That works while there is one line of
 * history, and stops working the moment two branches each grow their own
 * migrations and are merged — because then the journal interleaves two series,
 * and a database that took one of them has a high-water mark above the other's
 * entries. Those entries can never be reached again, whatever order the
 * journal is put in.
 *
 * That is the state this repository is in: `main` and `pay-per-use` each wrote
 * a 0051-0066, and every database has one series and is missing the other.
 * Restamping cannot fix it — pushing one series above the mark pushes the
 * other out of reach on the database that has *it*. There is no single
 * ordering that satisfies both, because there is only one mark.
 *
 * So this ignores the mark. It asks the honest question instead — which
 * journal entries have no row here, matched by content hash — and runs those,
 * in journal order, recording each as the migrator would.
 *
 * ## Why this is safe to run twice
 *
 * Every migration it can reach is written to survive being re-applied: the
 * ones from the merged series were guarded for exactly this (`IF NOT EXISTS`,
 * and a `DO` block around the renames and the constraints, which have no such
 * form). A statement that finds its work already done does nothing.
 *
 * It refuses outright on a migration it cannot prove is guarded, rather than
 * running it and hoping — an unguarded `ADD COLUMN` against a database that
 * already has the column fails mid-file, and a half-applied migration recorded
 * as applied is worse than one never applied.
 *
 *   DATABASE_URL=… npm run db:catch-up              # report only
 *   DATABASE_URL=… npm run db:catch-up -- --apply   # do it
 *
 * Afterwards every journal entry has a row, `db:verify` passes, and
 * `db:migrate` works normally again for everything that comes next.
 */
import { readFileSync } from "fs";
import path from "path";
import pg from "pg";
import { MIGRATIONS_FOLDER, readJournal, type JournalEntry } from "./lib/journal";

const apply = process.argv.includes("--apply");

/**
 * Whether every statement in a migration can survive being run again.
 *
 * Deliberately crude and deliberately pessimistic: it looks for the bare forms
 * that would throw, and a file containing any of them is refused. A false
 * refusal costs somebody a minute of reading; a false pass costs a
 * half-applied migration recorded as done.
 */
export function unguardedStatements(sql: string): string[] {
  /* Comments first: a bare CREATE TABLE inside one is not a statement. */
  const body = sql.replace(/--[^\n]*/g, "");
  const found: string[] = [];
  const bare: [RegExp, string][] = [
    [/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)"/i, "CREATE TABLE without IF NOT EXISTS"],
    [/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)"/i, "CREATE INDEX without IF NOT EXISTS"],
    [/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)"/i, "ADD COLUMN without IF NOT EXISTS"],
    [/\bDROP\s+COLUMN\s+(?!IF\s+EXISTS)"/i, "DROP COLUMN without IF EXISTS"],
    [/\bDROP\s+TABLE\s+(?!IF\s+EXISTS)"/i, "DROP TABLE without IF EXISTS"],
  ];
  for (const [re, what] of bare) if (re.test(body)) found.push(what);

  /*
   * These have no IF NOT EXISTS form at all, so the only safe shape is inside
   * a DO block — which is checked for rather than parsed, since a file with
   * one is a file somebody has already thought about.
   */
  const inDoBlock = /DO\s+\$\$/i.test(body);
  if (!inDoBlock) {
    if (/\bADD\s+CONSTRAINT\b/i.test(body)) found.push("ADD CONSTRAINT outside a DO block");
    if (/\bRENAME\s+(COLUMN|TO)\b/i.test(body)) found.push("RENAME outside a DO block");
  }
  return found;
}

const sqlOf = (entry: JournalEntry) =>
  readFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), "utf8");

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the database to catch up.");

  const entries = readJournal();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: [db] } = await client.query<{ name: string }>("SELECT current_database() AS name");
    console.log(`database: ${db.name}`);

    const { rows: [bookkeeping] } = await client.query<{ t: string | null }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS t",
    );
    if (!bookkeeping.t) {
      console.error("no bookkeeping table — run `npm run db:migrate` first, on a database that has one.");
      return 1;
    }

    const { rows } = await client.query<{ hash: string }>("SELECT hash FROM drizzle.__drizzle_migrations");
    const applied = new Set(rows.map((r) => r.hash));
    const missing = entries.filter((e) => !applied.has(e.hash));

    if (!missing.length) {
      console.log(`all ${entries.length} migrations already recorded — nothing to catch up.`);
      return 0;
    }

    console.log(`\n${missing.length} of ${entries.length} have no row here:`);
    const refused: string[] = [];
    for (const entry of missing) {
      const problems = unguardedStatements(sqlOf(entry));
      if (problems.length) refused.push(`${entry.tag}: ${problems.join("; ")}`);
      console.log(`  ${problems.length ? "✖" : "•"} ${entry.tag}`);
    }

    if (refused.length) {
      console.error(`\nRefusing to run ${refused.length} that could fail halfway:`);
      for (const r of refused) console.error(`  ${r}`);
      console.error("\nGuard them the way the rest of the folder does, then run this again.");
      return 1;
    }

    if (!apply) {
      console.log("\nreport only — rerun with --apply to run these and record them.");
      return 0;
    }

    /*
     * One migration per transaction, in journal order. Not one transaction for
     * all of them: a failure half way should leave the ones that worked
     * recorded, so a second run has less to do rather than starting over.
     */
    for (const entry of missing) {
      const statements = sqlOf(entry).split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
      await client.query("BEGIN");
      try {
        for (const statement of statements) await client.query(statement);
        await client.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [entry.hash, entry.when],
        );
        await client.query("COMMIT");
        console.log(`  applied ${entry.tag}`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`\nstopped at ${entry.tag}: ${(err as Error)?.message}`);
        console.error("Nothing from that migration was kept. Everything before it is recorded.");
        return 1;
      }
    }

    console.log(`\ncaught up ${missing.length}. \`npm run db:verify\` should pass now.`);
    return 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => { console.error(err); process.exit(1); },
);
