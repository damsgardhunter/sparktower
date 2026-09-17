-- Recovery codes are gone: the six digits from the authenticator app are the
-- only second factor now (server/mfa.ts).
--
-- The column is dropped rather than left empty. What it held is credential
-- material — SHA-256 hashes of strings that each signed an account in once —
-- and nothing reads it any more. A dead column of dead credentials is one more
-- thing every future reader has to stop and rule out, and one more thing every
-- database dump carries around.
--
-- An account that loses its phone is reset by an operator with database access
-- (script/reset-mfa.ts), after confirming who they are some other way.

ALTER TABLE "users" DROP COLUMN "mfa_recovery_codes";