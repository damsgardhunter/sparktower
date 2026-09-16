/**
 * Creates the `_e2e` database and its schema, before the server that needs it.
 *
 * Playwright's global setup does this too, but the web server it launches can
 * start first — on a machine where the database already exists (anyone who has
 * run these before) nothing goes wrong, and on a fresh one (CI, every time) the
 * server boots against a database that isn't there yet and logs its way through
 * a dozen failed queries. Running it from the server's own command fixes the
 * order wherever the tests run.
 *
 * Idempotent: creating a database that exists is a no-op, and the schema is
 * applied by migrations that know what they've already done.
 */
import { loadEnvFile } from "../test/setup/env";
import { ensureTestDatabase, applySchema, applyDatabaseRules } from "../test/setup/database";

loadEnvFile();
const url = await ensureTestDatabase("_e2e");
await applySchema(url);
await applyDatabaseRules(url);
console.log("[e2e-db] ready before the server starts");
