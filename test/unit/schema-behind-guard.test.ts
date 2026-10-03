/**
 * The background loops, while the database is behind the build.
 *
 * `warnIfMigrationsPending` already says the right thing at boot, once, and
 * even predicts the symptom: "anything reading them will fail with 'column
 * does not exist'". It was right, and nobody saw it, because the simulation's
 * clock then buried it — one missing column on `sim_seasons` made every pass
 * read twenty-two running seasons, each throwing a DrizzleQueryError carrying
 * the whole hundred-column SELECT. A screen of stack traces a minute, on a
 * loop, on top of the one line that had already named the cause and the fix.
 *
 * So a loop that cannot succeed no longer runs. What is tested here is the
 * decision, not the loop: whether the answer is cached, what happens when the
 * question cannot be answered, and that the complaint is throttled rather than
 * printed every pass — which would simply move the noise.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  classifyMigrationSql, forgetSchemaMatch, pendingMigrationWarning, schemaMatchesBuild,
  type MigrationState,
} from "../../server/migration-state";

const state = (over: Partial<MigrationState>): MigrationState =>
  ({ expected: 88, applied: 88, pending: 0, ok: true, ...over });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  forgetSchemaMatch();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { warn.mockRestore(); });

describe("whether the background loops may run", () => {
  it("lets them run when the database matches the build", async () => {
    expect(await schemaMatchesBuild(async () => state({}))).toBe(true);
  });

  it("holds them when a migration has not been applied, and says which command fixes it", async () => {
    const behind = state({ applied: 87, pending: 1, ok: false });
    expect(await schemaMatchesBuild(async () => behind)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/db:migrate/);
    expect(String(warn.mock.calls[0][0]), "and how far behind it is").toMatch(/87 of 88|1 migration/);
  });

  /*
   * Moving a screen of stack traces to a screen of warnings is not a fix.
   */
  it("complains at most once in five minutes, not once a pass", async () => {
    const behind = state({ applied: 87, pending: 1, ok: false });
    let clock = 1_000_000;
    const read = async () => behind;
    const now = () => clock;

    for (let i = 0; i < 10; i++) { await schemaMatchesBuild(read, now); clock += 60_000; }
    expect(warn.mock.calls.length, "ten passes over nine minutes").toBe(2);
  });

  /*
   * Once the database has caught up the question stops being asked, so the
   * steady state costs nothing.
   */
  it("stops asking once the answer is yes", async () => {
    let asked = 0;
    const read = async () => { asked += 1; return state({}); };
    for (let i = 0; i < 5; i++) expect(await schemaMatchesBuild(read)).toBe(true);
    expect(asked, "asked once, then cached").toBe(1);
  });

  it("keeps asking while the answer is no, so it notices the migration landing", async () => {
    let applied = 87;
    const read = async () => (applied === 88 ? state({}) : state({ applied, pending: 88 - applied, ok: false }));
    expect(await schemaMatchesBuild(read)).toBe(false);
    applied = 88;
    expect(await schemaMatchesBuild(read), "the loops resume without a restart").toBe(true);
  });

  /*
   * An unreadable journal, or a deploy shipped without the folder. Refusing to
   * run on "don't know" would take a working deployment down over missing
   * bookkeeping.
   */
  it("treats a question it cannot answer as no objection", async () => {
    expect(await schemaMatchesBuild(async () => state({ expected: -1, ok: null }))).toBe(true);
    expect(warn, "and does not complain about it every pass").not.toHaveBeenCalled();
  });
});

/**
 * What the warning says the pending migrations would do.
 *
 * It used to say one thing always: that "this build expects columns the database
 * does not have" and that reads would fail with "column does not exist". That is
 * right about a pending ADD COLUMN and wrong about a pending CREATE INDEX, which
 * breaks nothing — and it was observed being wrong, on a database two index
 * migrations behind. A warning that names a specific symptom you will not find is
 * worse than a vague one, because it is an instruction to look in the wrong
 * place, and the person following it is already debugging something.
 *
 * The classifier therefore has one job and one bias: say "indexes only" when it
 * is certain, and treat everything else as breaking. Under-warning costs a route
 * that 500s in production; over-warning costs a sentence somebody reads twice.
 */
describe("what the pending migrations would do", () => {
  it("calls a plain index migration what it is", () => {
    expect(classifyMigrationSql(['CREATE INDEX "sim_seats_user_idx" ON "sim_seats" USING btree ("user_id")'])).toBe("indexes-only");
    /* The real pair that produced the wrong warning, partial index and all. */
    expect(classifyMigrationSql([
      'CREATE INDEX "a" ON "sim_seats" USING btree ("user_id")',
      'CREATE INDEX "b" ON "sim_ventures" USING btree ("phase","phase_ends_at") WHERE "sim_ventures"."phase" in (\'filling\')',
    ])).toBe("indexes-only");
    expect(classifyMigrationSql(['CREATE INDEX IF NOT EXISTS "c" ON "t" ("x")'])).toBe("indexes-only");
  });

  it("calls anything that changes the shape breaking", () => {
    for (const sql of [
      'ALTER TABLE "users" ADD COLUMN "nickname" text',
      'CREATE TABLE "things" ("id" varchar PRIMARY KEY)',
      'ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL',
      'ALTER TABLE "users" DROP COLUMN "old"',
      'ALTER TABLE "a" ADD CONSTRAINT "a_b_fk" FOREIGN KEY ("b") REFERENCES "b"("id")',
      'CREATE TYPE "mood" AS ENUM (\'ok\')',
      'DROP TABLE "gone"',
    ]) {
      expect(classifyMigrationSql([sql]), sql.slice(0, 40)).toBe("breaking");
    }
  });

  /*
   * A unique index is not harmless, and this is the one that would be easy to
   * wave through: `ON CONFLICT (cols)` needs a matching unique index to exist, so
   * an upsert fails outright without it rather than merely running slowly.
   */
  it("does not treat a unique index as harmless, because an upsert depends on one", () => {
    expect(classifyMigrationSql(['CREATE UNIQUE INDEX "u" ON "t" ("a","b")'])).toBe("breaking");
  });

  it("fails closed on a file it cannot make sense of", () => {
    expect(classifyMigrationSql([]), "nothing to judge").toBe("unknown");
    expect(classifyMigrationSql(["SELECT do_something()"])).toBe("breaking");
    expect(classifyMigrationSql(["???"])).toBe("breaking");
  });

  /* One index statement beside one ALTER is a breaking migration, not a mixed one. */
  it("judges a file by its worst statement", () => {
    expect(classifyMigrationSql([
      'CREATE INDEX "i" ON "t" ("x")',
      'ALTER TABLE "t" ADD COLUMN "y" text',
    ])).toBe("breaking");
  });

  it("ignores comments and drizzle's statement breakpoints", () => {
    expect(classifyMigrationSql([
      '-- ALTER TABLE "t" ADD COLUMN "fake" text',
      'CREATE INDEX "i" ON "t" ("x")',
      '--> statement-breakpoint',
      '   ',
      '/* ALTER TABLE "t" ADD COLUMN "also_fake" text */ CREATE INDEX "j" ON "t" ("y")',
    ]), "a commented-out ALTER is not an ALTER").toBe("indexes-only");
  });
});

describe("the sentence an operator actually reads", () => {
  const state = (over: Partial<MigrationState>): MigrationState => ({
    expected: 90, applied: 88, pending: 2, ok: false,
    pendingTags: ["0088_brief_raza", "0089_bouncy_thunderbird"],
    pendingKind: "indexes-only",
    ...over,
  });

  it("names the migrations, so you can look at them yourself", () => {
    const text = pendingMigrationWarning(state({}));
    expect(text).toContain("0088_brief_raza");
    expect(text).toContain("0089_bouncy_thunderbird");
    expect(text).toContain("88 of 90");
    expect(text).toContain("npm run db:migrate");
  });

  it("says nothing will fail when nothing will", () => {
    const text = pendingMigrationWarning(state({ pendingKind: "indexes-only" }));
    expect(text).toContain("indexes only");
    expect(text).toContain("nothing will fail");
    expect(text, "the symptom that sent somebody looking in the wrong place").not.toContain("column does not exist");
  });

  it("says what will fail when something will", () => {
    const text = pendingMigrationWarning(state({ pendingKind: "breaking" }));
    expect(text).toContain("column does not exist");
    expect(text).not.toContain("nothing will fail");
  });

  it("assumes the worst when it could not read them", () => {
    const text = pendingMigrationWarning(state({ pendingKind: "unknown" }));
    expect(text).toContain("assume the worst");
    expect(text).not.toContain("nothing will fail");
  });
});
