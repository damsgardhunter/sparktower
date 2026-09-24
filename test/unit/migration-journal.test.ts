/**
 * The journal has to stay in step with the databases that follow it.
 *
 * `drizzle-kit migrate` picks what to run by comparing each entry's `when`
 * against the newest `created_at` in the bookkeeping table — so a journal whose
 * timestamps are out of order, or whose files have gone missing, doesn't fail
 * loudly. It skips, prints success, and leaves the schema behind. Ten
 * migrations once sat unapplied on a deploying branch this way.
 *
 * These are the properties that keep that comparison meaningful.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import path from "path";
import { MIGRATIONS_FOLDER, readJournal } from "../../script/lib/journal";

describe("the migration journal", () => {
  const entries = readJournal();

  it("has an entry for a file that exists", () => {
    for (const entry of entries) {
      expect(existsSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)), entry.tag).toBe(true);
    }
  });

  it("names each migration once", () => {
    const tags = entries.map((e) => e.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  /*
   * The one that actually bites. Entries run in journal order but are chosen by
   * timestamp, so an entry whose `when` is below the one before it can never be
   * reached: by the time the migrator gets to it the high-water mark has
   * already passed it, and it is skipped for good, in silence.
   */
  it("has timestamps that only go forwards", () => {
    for (let i = 1; i < entries.length; i++) {
      expect(
        entries[i].when,
        `${entries[i].tag} is stamped at or before ${entries[i - 1].tag}`,
      ).toBeGreaterThan(entries[i - 1].when);
    }
  });

  /*
   * `idx` is cosmetic — drizzle-kit numbers the next migration from the last
   * entry's idx and the migrator never reads it — but it should not go
   * backwards. It is currently not unique: two files are numbered 0056, from a
   * hand-edited journal, and renumbering them now would rewrite a filename for
   * no behavioural gain. Ordering is what is worth holding.
   */
  it("has indexes that do not go backwards", () => {
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].idx, entries[i].tag).toBeGreaterThanOrEqual(entries[i - 1].idx);
    }
  });
});
