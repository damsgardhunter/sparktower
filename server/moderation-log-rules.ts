/**
 * The moderation log is append-only in the database, not just by convention.
 *
 * "There is no route that edits it" protects against the app; it doesn't
 * protect against a script, a console session, or a future route written by
 * someone who didn't read the comment. These triggers refuse any UPDATE or
 * DELETE on the table, whoever sends it.
 *
 * TRUNCATE is the way round a row trigger, so production gets a statement
 * trigger against that too. It is deliberately NOT applied elsewhere: the test
 * suites empty tables between tests exactly that way, and a database that
 * can't be reset is a test suite that can't run. Dropping the trigger needs
 * the same privilege as truncating, so this is a lock on the door rather than
 * a wall — what it stops is the accidental wipe and the careless script.
 *
 * Kept free of the app's database connection so the test setups can apply it
 * to their own databases. Idempotent; applied at every boot.
 */
export function moderationLogRulesSql(protectTruncate: boolean): string {
  return `
CREATE OR REPLACE FUNCTION moderation_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'moderation_log is append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS moderation_log_append_only ON moderation_log;
CREATE TRIGGER moderation_log_append_only
  BEFORE UPDATE OR DELETE ON moderation_log
  FOR EACH ROW EXECUTE FUNCTION moderation_log_append_only();
DROP TRIGGER IF EXISTS moderation_log_no_truncate ON moderation_log;
${protectTruncate ? `CREATE TRIGGER moderation_log_no_truncate
  BEFORE TRUNCATE ON moderation_log
  FOR EACH STATEMENT EXECUTE FUNCTION moderation_log_append_only();` : "-- truncate left alone outside production, so tests can reset their own databases"}
`;
}

/** The rules as production gets them: no edits, no deletes, no truncation. */
export const MODERATION_LOG_RULES_SQL = moderationLogRulesSql(true);

/**
 * Applies them. `protectTruncate` defaults to production only — see above for
 * why a test database must stay resettable.
 */
export async function applyModerationLogRules(
  run: (sql: string) => Promise<unknown>,
  protectTruncate = process.env.NODE_ENV === "production",
): Promise<void> {
  await run(moderationLogRulesSql(protectTruncate));
}
