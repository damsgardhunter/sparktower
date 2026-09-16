/**
 * The moderation log's append-only rules, in the database rather than in a
 * comment: no edits, no deletes, and — where it matters — no truncation.
 *
 * Truncation is the way round a row trigger, so production gets a statement
 * trigger too. Test databases deliberately don't: they're emptied between
 * tests exactly that way. This applies both shapes to a throwaway table and
 * checks each does what it claims, which is the only way to know the
 * production one works without running production.
 */
import { describe, it, expect, afterAll } from "vitest";
import { pool } from "../../server/db";
import { applyModerationLogRules } from "../../server/moderation-log-rules";

/*
 * In a schema of its own, not public: the suite truncates every public table
 * between tests, and a table that refuses truncation would take that with it.
 * Which is the rule working — just not somewhere it can be observed.
 */
const SCHEMA = "moderation_log_rules_probe";
const TABLE = `${SCHEMA}.log`;

afterAll(async () => { await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`); });

/** A stand-in for the real table, with the rules applied to it under a chosen name. */
async function probe(protectTruncate: boolean) {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await pool.query(`CREATE TABLE ${TABLE} (id serial primary key, note text)`);
  // Only the table it acts ON is redirected; the function and trigger names stay as production writes them.
  await applyModerationLogRules(
    (sql) => pool.query(sql.replace(/ON moderation_log\b/g, `ON ${TABLE}`)),
    protectTruncate,
  );
  await pool.query(`INSERT INTO ${TABLE} (note) VALUES ('a decision')`);
}

describe("the append-only rules", () => {
  it("refuses an edit or a delete, whoever sends it", async () => {
    await probe(false);
    await expect(pool.query(`UPDATE ${TABLE} SET note = 'rewritten'`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM ${TABLE}`)).rejects.toThrow(/append-only/);
    // And the row is still exactly as it was.
    expect((await pool.query(`SELECT note FROM ${TABLE}`)).rows).toEqual([{ note: "a decision" }]);
  });

  it("refuses truncation the way production has it", async () => {
    await probe(true);
    await expect(pool.query(`TRUNCATE ${TABLE}`)).rejects.toThrow(/append-only/);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${TABLE}`)).rows[0].n).toBe(1);
  });

  it("leaves truncation alone elsewhere, so a test database can still be reset", async () => {
    await probe(false);
    await pool.query(`TRUNCATE ${TABLE}`);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ${TABLE}`)).rows[0].n).toBe(0);
  });
});
