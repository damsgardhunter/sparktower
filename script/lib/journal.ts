/**
 * The migration journal, with each entry's hash.
 *
 * Its own module so that reading it has no side effects. It lived in
 * reconcile-migrations.ts first, which runs its `main()` on import — so
 * importing the reader ran the whole reconcile report and exited with *its*
 * status, and `db:verify` silently reported somebody else's exit code. A
 * checking tool that can't be trusted to return its own verdict is the exact
 * failure this pair of scripts exists to stop.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";

export const MIGRATIONS_FOLDER = path.resolve("migrations");

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  /** sha256 of the .sql file's contents — the same identity drizzle's migrator computes. */
  hash: string;
}

export function readJournal(folder = MIGRATIONS_FOLDER): JournalEntry[] {
  const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; when: number; tag: string }[];
  };
  return journal.entries.map((entry) => ({
    ...entry,
    hash: createHash("sha256").update(readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8")).digest("hex"),
  }));
}
