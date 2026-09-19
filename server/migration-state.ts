/**
 * Whether the database has caught up with the code that is about to query it.
 *
 * A build whose schema is ahead of its database does not fail at boot. It
 * starts, answers the health check, serves the landing page, and then 500s on
 * everything that reads the table with the new column — which is every route
 * that touches an account. The error it prints is a hundred-column SELECT with
 * one name in it nobody recognises, and the cause (two migrations nobody ran)
 * appears nowhere in it. That happened here, and took a while to place.
 *
 * So the answer is checked and said plainly: at boot, in the log, and on
 * `/_ready`, which is the endpoint a person asks whether a deploy actually
 * works.
 *
 * The count comes from drizzle's own bookkeeping table against its journal, so
 * it needs no list of expected columns to be kept up to date by hand — the
 * thing that would rot first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "./db";

export interface MigrationState {
  /** Files in migrations/, from drizzle's journal. */
  expected: number;
  /** Rows in drizzle.__drizzle_migrations. */
  applied: number;
  pending: number;
  /** Null when the question couldn't be asked — an unreadable journal, or no bookkeeping table yet. */
  ok: boolean | null;
}

function expectedCount(): number | null {
  try {
    const journal = JSON.parse(readFileSync(join(process.cwd(), "migrations", "meta", "_journal.json"), "utf8"));
    return Array.isArray(journal?.entries) ? journal.entries.length : null;
  } catch {
    // Not fatal: a deploy that ships without the folder can still run, it just can't answer this.
    return null;
  }
}

export async function migrationState(): Promise<MigrationState> {
  const expected = expectedCount();
  try {
    const result: any = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const applied = Number(result?.rows?.[0]?.n ?? 0);
    if (expected == null) return { expected: -1, applied, pending: 0, ok: null };
    const pending = Math.max(0, expected - applied);
    return { expected, applied, pending, ok: pending === 0 };
  } catch {
    // No bookkeeping table means migrations have never run here at all.
    return { expected: expected ?? -1, applied: 0, pending: expected ?? 0, ok: expected == null ? null : false };
  }
}

/** Said once at boot, because the failure it predicts is silent until somebody signs in. */
export async function warnIfMigrationsPending(): Promise<void> {
  const state = await migrationState();
  if (state.ok === false && state.pending > 0) {
    console.warn(
      `[schema] ${state.pending} migration(s) have not been applied to this database ` +
      `(${state.applied} of ${state.expected}). This build expects columns the database does not have, ` +
      `so anything reading them will fail with "column does not exist". Run: npm run db:migrate`,
    );
  } else if (state.ok) {
    console.log(`[schema] ${state.applied} migrations applied; the database matches this build.`);
  }
}
