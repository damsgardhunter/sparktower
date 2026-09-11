/**
 * Runs once before the browser tests, and before the server they drive.
 *
 * Creates the `_e2e` database and applies the schema, then empties it, so
 * every run starts from the same nothing. Kept separate from the integration
 * suite's `_test` database on purpose: the two can run at the same time, and
 * the integration suite truncates every table it can see before each test.
 */
import { loadEnvFile } from "../test/setup/env";
import { ensureTestDatabase, applySchema, applyDatabaseRules, truncateAll } from "../test/setup/database";

export default async function globalSetup() {
  loadEnvFile();
  const url = await ensureTestDatabase("_e2e");
  console.log("[e2e-db] applying schema…");
  applySchema(url);
  await applyDatabaseRules(url);
  await truncateAll(url);
  console.log("[e2e-db] ready");
}
