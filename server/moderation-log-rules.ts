/**
 * The moderation log is append-only in the database, not just by convention.
 *
 * "There is no route that edits it" protects against the app; it doesn't
 * protect against a script, a console session, or a future route written by
 * someone who didn't read the comment. This trigger refuses any UPDATE or
 * DELETE on the table, whoever sends it. (TRUNCATE is a separate privilege
 * and isn't a row trigger — the test suites empty tables that way.)
 *
 * Kept free of the app's database connection so the test setups can apply it
 * to their own databases. Idempotent; applied at every boot.
 */
export const MODERATION_LOG_RULES_SQL = `
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
`;

export async function applyModerationLogRules(run: (sql: string) => Promise<unknown>): Promise<void> {
  await run(MODERATION_LOG_RULES_SQL);
}
