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
 * defaulting to `now()`, and any `now()` in hand-written SQL, stores the
 * *database session's* wall clock, while a JS Date written through Drizzle is
 * stored in UTC and read back as UTC — so on a machine five hours behind UTC
 * only some times were wrong, which is why it surfaced one symptom at a time:
 * a notification "5h ago" the moment it arrived, "seen" markers that left new
 * feedback looking new for hours, invites swept five hours late.
 *
 * Pinning the session makes `now()` mean what every reader assumes, without a
 * migration over a hundred-odd columns, and the explicit `(now() at time zone
 * 'utc')` forms elsewhere stay correct under it. Servers already running in
 * UTC are unaffected — this is the guarantee, not a change of behaviour.
 *
 * Set on connect rather than as a startup option (`options: "-c timezone=UTC"`,
 * which is the other obvious way to write this): a pooled Postgres in front of
 * the database — PgBouncer, and the managed poolers built on it — rejects
 * startup parameters it doesn't recognise, and the failure is not a wrong
 * clock but a process that cannot connect at all. The statement is queued on
 * the client before anything else it will run, because pg runs one client's
 * queries in order.
 */
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'UTC'").catch((err) => console.error("[db] couldn't set the session to UTC:", err));
});

export const db = drizzle(pool, { schema });
