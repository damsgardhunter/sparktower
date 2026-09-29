/**
 * Fails if the database is not actually at the journal's newest migration.
 *
 * `drizzle-kit migrate` prints "migrations applied successfully!" whether it
 * applied ten migrations or none. That is the entire reason ten migrations sat
 * unapplied on a deploying branch without anybody noticing: the pre-deploy step
 * passed, every time, while doing nothing. A step that cannot fail is not a
 * check.
 *
 * So this runs straight after it, and asks the only question that matters —
 * does every entry in the journal have a row in the bookkeeping table? If one
 * doesn't, the deploy fails and the previous version keeps serving, which is
 * the outcome the release checklist wanted and never got.
 *
 *   DATABASE_URL=… npm run db:verify
 *
 * Orphans are reported but do not fail: a row matching no file is untidy and
 * `npm run db:reconcile` clears it, but it does not mean the schema is behind.
 */
import pg from "pg";
import { readJournal } from "./lib/journal";
import { pathToFileURL } from "node:url";

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the database to verify.");

  const entries = readJournal();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows: [bookkeeping] } = await client.query<{ t: string | null }>(
      "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS t",
    );
    if (!bookkeeping.t) {
      console.error("no drizzle.__drizzle_migrations table — nothing has been migrated.");
      return 1;
    }
    const { rows } = await client.query<{ hash: string }>("SELECT hash FROM drizzle.__drizzle_migrations");
    const applied = new Set(rows.map((r) => r.hash));

    const missing = entries.filter((e) => !applied.has(e.hash));
    const orphans = rows.length - entries.filter((e) => applied.has(e.hash)).length;

    if (missing.length) {
      console.error(`${missing.length} of ${entries.length} migrations are NOT applied:`);
      for (const e of missing) console.error(`  ${e.tag}`);
      console.error("\nThe migrator skipped them. `npm run db:reconcile` explains why.");
      return 1;
    }
    console.log(`all ${entries.length} migrations applied${orphans > 0 ? ` (${orphans} orphaned row(s) — see db:reconcile)` : ""}.`);
    return 0;
  } finally {
    await client.end();
  }
}

/*
 * Only when run as a command, never on import.
 *
 * `main()` at module scope means importing anything from this file — a helper,
 * a type, a constant a test wants — connects to a database, does the work and
 * calls process.exit in the middle of whatever imported it. Vitest reports
 * that as "process.exit unexpectedly called with 0" against an unrelated test
 * file, which is the worst shape a failure can have: every test passes and the
 * check is red, with nothing pointing at the cause. It cost a session an
 * afternoon on the catch-up script (1dcf2a0a); these are its siblings.
 */
const runDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}
