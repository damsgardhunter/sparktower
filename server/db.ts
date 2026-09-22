import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Every connection talks UTC.
 *
 * Almost every time column in the schema is `timestamp` with no zone, and the
 * two halves of a round trip disagreed about what that meant. A column
 * defaulting to `now()` stores the *database session's* wall clock, while the
 * driver reads a zoneless value back as UTC — so on a machine five hours
 * behind UTC, something posted this minute came back to the browser five
 * hours old, and "just now" read as "5 hours ago". Anything written as a JS
 * Date was stored in UTC and was right, which is why only some times were
 * wrong: the two write paths disagreed with each other.
 *
 * Pinning the session to UTC makes `now()` mean what the reader assumes,
 * everywhere, without a migration over a hundred-odd columns. Servers that
 * already run in UTC are unaffected — this is the guarantee, not a change of
 * behaviour. It is set on the connection itself rather than by a query after
 * connecting, so no statement can ever run before it takes effect.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c timezone=UTC",
});
export const db = drizzle(pool, { schema });
