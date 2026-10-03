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
  /** The tags of the unapplied migrations, newest last. Empty when up to date or unanswerable. */
  pendingTags?: string[];
  /** What those files would actually do — see `classifyMigrationSql`. */
  pendingKind?: PendingKind;
}

/** The journal's entries in order, or null when it cannot be read. */
function journalTags(): string[] | null {
  try {
    const journal = JSON.parse(readFileSync(join(process.cwd(), "migrations", "meta", "_journal.json"), "utf8"));
    if (!Array.isArray(journal?.entries)) return null;
    return journal.entries.map((e: { tag?: unknown }) => String(e?.tag ?? ""));
  } catch {
    // Not fatal: a deploy that ships without the folder can still run, it just can't answer this.
    return null;
  }
}

/**
 * What the unapplied migrations would actually do, so the warning can stop
 * guessing.
 *
 * The warning used to say, always, that "this build expects columns the database
 * does not have" and that reads would fail with "column does not exist". That is
 * the right thing to say about a pending ADD COLUMN and wrong about a pending
 * CREATE INDEX, which breaks nothing — and being told to go and look for a
 * missing column that does not exist is worse than being told nothing, because
 * it is a specific instruction to look in the wrong place. This happened: two
 * index migrations produced a warning about columns.
 *
 * **Fails closed.** Only a file whose every statement is confidently a plain
 * `CREATE INDEX` counts as harmless. Anything unrecognised — and anything at all
 * that is not that — is treated as breaking, because the cost of under-warning
 * is a route that 500s in production and the cost of over-warning is a sentence
 * somebody reads twice.
 *
 * A unique index is deliberately *not* harmless: `ON CONFLICT (cols)` needs a
 * matching unique index to exist, so an upsert can fail outright without it.
 */
export type PendingKind = "indexes-only" | "breaking" | "unknown";

export function classifyMigrationSql(statements: readonly string[]): PendingKind {
  if (statements.length === 0) return "unknown";
  for (const raw of statements) {
    const text = raw
      // Comments first, or a commented-out ALTER would be read as one.
      .replace(/--[^\n]*/g, " ")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    if (!text) continue;
    /* Drizzle's own statement separator leaves these behind; they do nothing. */
    if (text === "--> STATEMENT-BREAKPOINT") continue;
    const isPlainIndex = /^CREATE INDEX\b/.test(text) || /^CREATE INDEX IF NOT EXISTS\b/.test(text);
    if (!isPlainIndex) return "breaking";
  }
  return "indexes-only";
}

/** Reads the pending files and says what they contain. Unreadable is "unknown", which warns loudly. */
function classifyPending(tags: readonly string[]): PendingKind {
  if (tags.length === 0) return "unknown";
  let kind: PendingKind = "indexes-only";
  for (const tag of tags) {
    let sqlText: string;
    try {
      sqlText = readFileSync(join(process.cwd(), "migrations", `${tag}.sql`), "utf8");
    } catch {
      return "unknown";
    }
    const statements = sqlText.split(/;|-->\s*statement-breakpoint/i);
    const one = classifyMigrationSql(statements);
    if (one !== "indexes-only") kind = one === "unknown" ? "unknown" : "breaking";
    if (kind === "breaking") return "breaking";
  }
  return kind;
}

export async function migrationState(): Promise<MigrationState> {
  const tags = journalTags();
  const expected = tags?.length ?? null;
  /*
   * The pending ones are the journal's tail. Migrations are applied in journal
   * order and only ever added, so "applied" is a count rather than a set — which
   * is also why this cannot name a migration skipped out of order. That failure
   * has its own tooling (`npm run db:verify`).
   */
  const tail = (applied: number) => (tags ? tags.slice(Math.max(0, applied)) : []);
  try {
    const result: any = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const applied = Number(result?.rows?.[0]?.n ?? 0);
    if (expected == null) return { expected: -1, applied, pending: 0, ok: null };
    const pending = Math.max(0, expected - applied);
    if (pending === 0) return { expected, applied, pending, ok: true, pendingTags: [], pendingKind: "indexes-only" };
    const pendingTags = tail(applied);
    return { expected, applied, pending, ok: false, pendingTags, pendingKind: classifyPending(pendingTags) };
  } catch {
    // No bookkeeping table means migrations have never run here at all.
    const pendingTags = tail(0);
    return {
      expected: expected ?? -1, applied: 0, pending: expected ?? 0,
      ok: expected == null ? null : false,
      pendingTags, pendingKind: expected == null ? "unknown" : classifyPending(pendingTags),
    };
  }
}

/**
 * The warning, in the words the pending files earn.
 *
 * Exported and pure so it can be tested without a database, and so the two
 * places that say this — boot and `/_ready` — cannot drift into saying different
 * things about the same state.
 */
export function pendingMigrationWarning(state: MigrationState): string {
  const head = `[schema] ${state.pending} migration(s) not applied to this database (${state.applied} of ${state.expected})`;
  const names = (state.pendingTags ?? []).join(", ");
  const which = names ? `: ${names}` : "";
  if (state.pendingKind === "indexes-only") {
    return `${head}${which}. All of them add indexes only, so nothing will fail — queries they would have `
      + `sped up are doing it the slow way. Run: npm run db:migrate`;
  }
  if (state.pendingKind === "unknown") {
    return `${head}${which}. Their SQL could not be read, so assume the worst: if any of them adds a column `
      + `or a table, anything reading it fails with "does not exist". Run: npm run db:migrate`;
  }
  return `${head}${which}. These change the schema this build expects, so anything reading what they add `
    + `fails with "column does not exist" or "relation does not exist". Run: npm run db:migrate`;
}

/** Said once at boot, because the failure it predicts is silent until somebody signs in. */
export async function warnIfMigrationsPending(): Promise<void> {
  const state = await migrationState();
  if (state.ok === false && state.pending > 0) {
    console.warn(pendingMigrationWarning(state));
  } else if (state.ok) {
    console.log(`[schema] ${state.applied} migrations applied; the database matches this build.`);
  }
}

/*
 * Whether the background loops should run at all.
 *
 * The boot warning above says the right thing and says it once. What buried it
 * was the simulation's own clock: with one migration missing, every pass read
 * `sim_seasons` for twenty-two running seasons, each one threw "column
 * `opening` does not exist", and each threw a full DrizzleQueryError with the
 * hundred-column SELECT in it — a screen of stack traces a minute, on a loop,
 * on top of the one line that had already named the cause and the command.
 *
 * A loop that cannot succeed should not run. Nothing is lost by waiting: a
 * season's next tick is a time, not a tally, so the clock resumes where it left
 * off once the migration is applied.
 *
 * Cached once true, because migrations are only ever added — so the steady
 * state costs nothing, and the query happens only while the database is behind.
 */
let matched = false;
let lastComplaint = 0;
const COMPLAIN_EVERY_MS = 5 * 60_000;

/** For tests: forget both the cached answer and when it last complained. */
export const forgetSchemaMatch = (): void => { matched = false; lastComplaint = 0; };

export async function schemaMatchesBuild(
  read: () => Promise<MigrationState> = migrationState,
  now: () => number = Date.now,
): Promise<boolean> {
  if (matched) return true;
  const state = await read();
  /*
   * `ok === null` means the question could not be asked — an unreadable
   * journal, or a deploy shipped without the folder. Refusing to run the loops
   * on "don't know" would take a working deployment down over missing
   * bookkeeping, so an unanswerable check is treated as no objection.
   */
  if (state.ok !== false) {
    if (state.ok === true) matched = true;
    return true;
  }
  if (now() - lastComplaint > COMPLAIN_EVERY_MS) {
    lastComplaint = now();
    console.warn(
      `[schema] holding the background loops: ${state.pending} migration(s) not applied ` +
      `(${state.applied} of ${state.expected}). They would fail on every pass. Run: npm run db:migrate`,
    );
  }
  return false;
}
