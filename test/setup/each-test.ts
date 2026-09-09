/**
 * Runs in every worker, around every test.
 *
 * Empties the database before each test rather than after. Cleaning up
 * afterwards leaves a failing test's rows behind for inspection, and — more
 * usefully — means a test never inherits state from whatever ran before it,
 * including a run that crashed halfway through and never got to its cleanup.
 *
 * Only for the integration suite. The unit tests are pure functions with no
 * database anywhere near them, and truncating a table before each one would
 * make them slower, and worse, make them fail when Postgres isn't running —
 * at which point they aren't unit tests any more.
 */
import { beforeEach } from "vitest";
import { truncateAll } from "./database";

const url = process.env.DATABASE_URL;

beforeEach(async (ctx) => {
  const file = ctx.task?.file?.filepath ?? "";
  // Default to truncating when the path can't be determined: a stray row is a
  // confusing test failure, a skipped truncation is a mysterious one.
  if (file.includes(`${"/"}test${"/"}unit${"/"}`)) return;

  if (!url) throw new Error("DATABASE_URL is unset in the test worker");
  await truncateAll(url);
});
