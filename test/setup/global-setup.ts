/**
 * Runs once, before any test file.
 *
 * Creates the test database and applies the schema. Doing it here rather than
 * per-file means `drizzle-kit push` — comfortably the slowest part — happens a
 * single time however many test files there are.
 *
 * It does not set DATABASE_URL for the workers — this runs in its own process,
 * and mutating `process.env` here would not reach them. That is `vitest.config`'s
 * job, via `test.env`, which has to be settled before anything imports
 * `server/db.ts`: that module reads the variable at import time and throws when
 * it is missing.
 */
import { loadEnvFile } from "./env";
import { ensureTestDatabase, applySchema } from "./database";

export default async function setup() {
  loadEnvFile();
  const url = await ensureTestDatabase();

  console.log("[test-db] applying schema…");
  applySchema(url);
  console.log("[test-db] ready");
}
