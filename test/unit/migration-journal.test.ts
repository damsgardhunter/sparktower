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
import { existsSync, readdirSync, readFileSync } from "fs";
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

/**
 * And the snapshots beside it, which fail in a different way.
 *
 * `drizzle-kit generate` does not read the journal to work out what the schema
 * currently is. It reads `meta/*_snapshot.json`, links them by `prevId` into a
 * chain, and diffs the code against whatever the chain ends at. Those files are
 * named after the migration's *number*, not its position — so when two branches
 * each numbered a migration 0051 and both were merged, the second snapshot
 * overwrote the first.
 *
 * Done thirty times over, that left 56 snapshot files for 86 migrations, a
 * chain that forked at 0050, and a tip describing the schema as it stood thirty
 * migrations earlier. `generate` refused to run, which was the lucky outcome:
 * the alternative is a migration that silently re-creates everything the lost
 * snapshots described.
 *
 * Nothing about a migration's *content* shows this. The SQL is fine, the
 * journal is fine, every database applies cleanly and `db:verify` passes. Only
 * the shape of the chain gives it away, so the shape is what these read.
 */
describe("the snapshots the next migration is written from", () => {
  const dir = path.join(MIGRATIONS_FOLDER, "meta");
  const snapshots = readdirSync(dir)
    .filter((f) => f.endsWith("_snapshot.json"))
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { id: string; prevId?: string } }));

  it("is one chain, not a tree", () => {
    const byId = new Map(snapshots.map((s) => [s.id, s]));
    const children = new Map<string, string[]>();
    for (const s of snapshots) {
      if (!s.prevId || !byId.has(s.prevId)) continue;
      children.set(s.prevId, [...(children.get(s.prevId) ?? []), s.file]);
    }
    const forks = [...children.entries()].filter(([, kids]) => kids.length > 1);
    expect(
      forks.map(([parent, kids]) => `${byId.get(parent)!.file} -> ${kids.join(" and ")}`),
      "two snapshots claim the same parent, so two branches each numbered a migration the same. " +
      "`drizzle-kit generate` refuses to run until one of them is resolved.",
    ).toEqual([]);
  });

  it("starts once and ends once", () => {
    const ids = new Set(snapshots.map((s) => s.id));
    const roots = snapshots.filter((s) => !s.prevId || !ids.has(s.prevId));
    const parents = new Set(snapshots.map((s) => s.prevId).filter(Boolean) as string[]);
    const tips = snapshots.filter((s) => !parents.has(s.id));
    expect(roots.map((s) => s.file), "more than one snapshot begins a history").toHaveLength(1);
    expect(tips.map((s) => s.file), "more than one snapshot ends it, so which one is current is a guess").toHaveLength(1);
  });

  it("ends at the migration the journal ends at", () => {
    const parents = new Set(snapshots.map((s) => s.prevId).filter(Boolean) as string[]);
    const tip = snapshots.find((s) => !parents.has(s.id))!;
    const journal = readJournal();
    const last = journal[journal.length - 1];
    expect(
      tip.file,
      "the newest snapshot has to describe the schema after the newest migration, " +
      "or the next `generate` diffs against a state the code has already left behind.",
    ).toBe(`${String(last.idx).padStart(4, "0")}_snapshot.json`);
  });

  it("gives every snapshot its own identity", () => {
    const ids = snapshots.map((s) => s.id);
    expect(new Set(ids).size, "two snapshots share an id, so the chain is ambiguous").toBe(ids.length);
  });
});
