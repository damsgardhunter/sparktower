/**
 * The check that decides whether a migration may be re-run.
 *
 * `db:catch-up` exists to apply migrations the migrator can no longer reach,
 * against databases that may already have some of them. Everything it runs
 * must therefore survive being run twice — so this refuses anything it cannot
 * prove is guarded.
 *
 * It is pessimistic on purpose. A false refusal costs somebody a minute of
 * reading; a false pass costs a migration that fails half way and is recorded
 * as done, which is the state nothing else in this repository can detect.
 */
import { describe, it, expect } from "vitest";
import { unguardedStatements } from "../../script/catch-up-migrations";

describe("unguardedStatements", () => {
  it("passes the guarded forms", () => {
    expect(unguardedStatements('ALTER TABLE "s" ADD COLUMN IF NOT EXISTS "c" integer;')).toEqual([]);
    expect(unguardedStatements('CREATE TABLE IF NOT EXISTS "t" ("id" varchar);')).toEqual([]);
    expect(unguardedStatements('CREATE INDEX IF NOT EXISTS "i" ON "t" ("c");')).toEqual([]);
    expect(unguardedStatements('CREATE UNIQUE INDEX IF NOT EXISTS "i" ON "t" ("c");')).toEqual([]);
    expect(unguardedStatements('ALTER TABLE "s" DROP COLUMN IF EXISTS "c";')).toEqual([]);
  });

  it("catches the bare forms that would throw on a second run", () => {
    expect(unguardedStatements('CREATE TABLE "t" ("id" varchar);')).toHaveLength(1);
    expect(unguardedStatements('ALTER TABLE "s" ADD COLUMN "c" integer;')).toHaveLength(1);
    expect(unguardedStatements('CREATE INDEX "i" ON "t" ("c");')).toHaveLength(1);
    expect(unguardedStatements('ALTER TABLE "s" DROP COLUMN "c";')).toHaveLength(1);
  });

  /*
   * These two have no IF NOT EXISTS form at all, so a DO block is the only
   * shape that can be re-run — and a file with one is a file somebody has
   * already thought about.
   */
  it("wants a DO block around a constraint or a rename", () => {
    expect(unguardedStatements('ALTER TABLE "s" ADD CONSTRAINT "c" FOREIGN KEY ("a") REFERENCES "b"("id");')).toHaveLength(1);
    expect(unguardedStatements('ALTER TABLE "s" RENAME COLUMN "a" TO "b";')).toHaveLength(1);
    expect(unguardedStatements('DO $$ BEGIN ALTER TABLE "s" ADD CONSTRAINT "c" FOREIGN KEY ("a") REFERENCES "b"("id"); EXCEPTION WHEN duplicate_object THEN NULL; END $$;')).toEqual([]);
    expect(unguardedStatements('DO $$ BEGIN IF EXISTS (SELECT 1) THEN ALTER TABLE "s" RENAME COLUMN "a" TO "b"; END IF; END $$;')).toEqual([]);
  });

  it("does not read a comment as a statement", () => {
    expect(unguardedStatements('-- CREATE TABLE "t" was here once\nALTER TABLE "s" ADD COLUMN IF NOT EXISTS "c" integer;')).toEqual([]);
  });

  it("reports every problem in a file, not just the first", () => {
    expect(unguardedStatements('CREATE TABLE "t" ("id" varchar);\nALTER TABLE "s" ADD COLUMN "c" integer;')).toHaveLength(2);
  });
});

/*
 * The migrations this was built to apply. If any of them stops being safe to
 * re-run, the tool refuses at the worst moment — mid-repair on production —
 * so it is worth failing here instead.
 */
describe("the merged series", () => {
  const MERGED = [
    "0051_season_scope", "0052_bot_run_companies", "0053_simulation_seats", "0054_seat_purchases",
    "0055_two_seat_tiers", "0056_ai_spend", "0057_game_plays", "0058_ai_spend_cached",
    "0059_code_audit_memory", "0060_ai_settings", "0061_custom_market", "0062_verdict_attempts",
    "0063_drop_dead_columns", "0064_bot_skill", "0065_season_cadence", "0066_period_minutes",
  ];

  it("is all safe to re-apply", async () => {
    const { readFileSync } = await import("fs");
    for (const tag of MERGED) {
      const sql = readFileSync(`migrations/${tag}.sql`, "utf8");
      expect(unguardedStatements(sql), tag).toEqual([]);
    }
  });
});
