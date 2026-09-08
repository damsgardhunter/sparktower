/**
 * Runs in every worker, around every test.
 *
 * Empties the database before each test rather than after. Cleaning up
 * afterwards leaves a failing test's rows behind for inspection, and — more
 * usefully — means a test never inherits state from whatever ran before it,
 * including a run that crashed halfway through and never got to its cleanup.
 */
import { beforeEach } from "vitest";
import { truncateAll } from "./database";

const url = process.env.DATABASE_URL;

beforeEach(async () => {
  if (!url) throw new Error("DATABASE_URL is unset in the test worker");
  await truncateAll(url);
});
