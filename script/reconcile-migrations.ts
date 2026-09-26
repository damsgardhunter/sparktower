/**
 * Realigns a database's migration bookkeeping with the journal.
 *
 * `drizzle-kit migrate` decides what to run by one comparison: the newest
 * `created_at` in drizzle.__drizzle_migrations against each journal entry's
 * `when`. Anything at or below the high-water mark is considered done. That is
 * fast and it is fragile — a single row with a `created_at` above the newest
 * journal entry makes every pending migration invisible, and the migrator
 * still prints "migrations applied successfully!" on its way out.
 *
 * Which is what happened here. This database had eighteen rows whose hash
 * matched no migration file, one of them stamped later than anything in the
 * journal, so ten migrations were skipped on every deploy in silence.
 *
 * Two things put a row out of step with the journal:
 *
 *   - **An orphan.** The row's hash matches no file, because the file was
 *     edited or deleted after it ran. Drizzle can never match it again, so it
 *     contributes nothing but its timestamp — and its timestamp can block
 *     everything behind it.
 *   - **A drifted timestamp.** The row's hash matches, but its `created_at`
 *     is not the journal's `when`, because the journal was rewritten after the
 *     migration ran. Harmless today, and the thing that grows into the case
 *     above the next time somebody renumbers.
 *
 * The journal is the source of truth: it is in the repository, it is reviewed,
 * and every database is supposed to agree with it. So matched rows are moved
 * to the journal's `when`, and orphans are copied into
 * drizzle.__drizzle_migrations_orphaned and removed. The archive matters — a
 * row saying a migration once ran is the only record that it did, and this is
 * a delete against production bookkeeping.
 *
 *   DATABASE_URL=… npm run db:reconcile              # report only
 *   DATABASE_URL=… npm run db:reconcile -- --apply   # repair
 *
 * Reporting is the default because the repair deletes rows. Run it, read what
 * it intends to do, then run it again with --apply. It is safe to repeat: on
 * an aligned database it finds nothing.
 */
import pg from "pg";
import { readJournal } from "./lib/journal";

const apply = process.argv.includes("--apply");

interface Row {
  id: number;
  hash: string;
  created_at: string | number | null;
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the database to reconcile.");

  const entries = readJournal();
  const byHash = new Map(entries.map((e) => [e.hash, e]));

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: [db] } = await client.query<{ name: string }>("SELECT current_database() AS name");
    console.log(`database: ${db.name}`);
    console.log(`journal:  ${entries.length} entries, newest ${entries[entries.length - 1]?.tag}`);

    const { rows: [bookkeeping] } = await client.query<{ t: string | null }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS t",
    );
    if (!bookkeeping.t) {
      console.log("no bookkeeping table — this database has never been migrated. Nothing to reconcile.");
      return 0;
    }

    const { rows } = await client.query<Row>(
      "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id",
    );
    console.log(`rows:     ${rows.length}`);

    /*
     * Two rows with the same hash are the same migration recorded twice. Only
     * the first is bookkeeping; the rest are duplicates and get archived with
     * the orphans, because a second row for one migration is another timestamp
     * that can drift on its own.
     */
    const seen = new Set<string>();
    const orphans: Row[] = [];
    const drifted: { row: Row; when: number; tag: string }[] = [];
    for (const row of rows) {
      const entry = byHash.get(row.hash);
      if (!entry || seen.has(row.hash)) {
        orphans.push(row);
        continue;
      }
      seen.add(row.hash);
      if (Number(row.created_at) !== entry.when) drifted.push({ row, when: entry.when, tag: entry.tag });
    }

    if (orphans.length) {
      console.log(`\n${orphans.length} row(s) match no migration file — archive and remove:`);
      for (const r of orphans) console.log(`  id ${r.id}  created_at ${r.created_at}  ${r.hash.slice(0, 12)}…`);
    }
    if (drifted.length) {
      console.log(`\n${drifted.length} row(s) sit at a timestamp the journal disagrees with — move:`);
      for (const d of drifted) console.log(`  id ${d.row.id}  ${d.row.created_at} → ${d.when}  ${d.tag}`);
    }

    // What the migrator will do afterwards, which is the answer somebody
    // actually came here for.
    const kept = entries.filter((e) => seen.has(e.hash));
    const highWater = kept.length ? Math.max(...kept.map((e) => e.when)) : -1;
    const pending = entries.filter((e) => e.when > highWater);
    console.log(`\nafter this, the high-water mark is ${highWater === -1 ? "(none)" : highWater}`);
    if (pending.length === 0) {
      console.log("and `npm run db:migrate` has nothing left to apply.");
    } else {
      console.log(`and \`npm run db:migrate\` applies ${pending.length}:`);
      for (const e of pending) console.log(`  ${e.tag}`);
    }

    // A migration below the mark that never ran can't be reached by the
    // migrator at all — it needs a hand, and saying so is the whole point.
    const unreachable = entries.filter((e) => !seen.has(e.hash) && e.when <= highWater);
    if (unreachable.length) {
      console.log(`\n⚠️  ${unreachable.length} migration(s) have no row AND sit below the mark, so the`);
      console.log("   migrator will never reach them. Apply them by hand, or renumber them to the end:");
      for (const e of unreachable) console.log(`  ${e.tag}`);
    }

    if (!orphans.length && !drifted.length) {
      console.log("\nalready aligned — nothing to do.");
      return unreachable.length ? 1 : 0;
    }
    if (!apply) {
      console.log("\nreport only — rerun with --apply to make these changes.");
      return 0;
    }

    await client.query("BEGIN");
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations_orphaned (
          id integer,
          hash text NOT NULL,
          created_at bigint,
          archived_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      for (const r of orphans) {
        await client.query(
          "INSERT INTO drizzle.__drizzle_migrations_orphaned (id, hash, created_at) VALUES ($1, $2, $3)",
          [r.id, r.hash, r.created_at],
        );
        await client.query("DELETE FROM drizzle.__drizzle_migrations WHERE id = $1", [r.id]);
      }
      for (const d of drifted) {
        await client.query("UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE id = $2", [
          d.when,
          d.row.id,
        ]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
    console.log(`\narchived ${orphans.length}, moved ${drifted.length}. Run \`npm run db:migrate\` next.`);
    return unreachable.length ? 1 : 0;
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
