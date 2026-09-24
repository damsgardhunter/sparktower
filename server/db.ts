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
/**
 * How long a request waits for a free connection before it is told no.
 *
 * node-postgres defaults this to 0, which means "wait forever", and forever is
 * what it meant. When the project lock deadlocked the pool
 * (server/project-lock.ts), every later request queued behind it silently: the
 * process sat at 0% CPU with nothing failing, nothing logged and /_health
 * answering 200, because no caller ever gave up. A wait that ends turns that
 * into a burst of 503s — which is a thing a log shows, a monitor notices and a
 * client can retry, rather than a site that is simply unreachable while
 * claiming to be well.
 *
 * Ten seconds is far longer than a healthy checkout, which is microseconds. If
 * this fires, the pool is exhausted, and the answer is never a longer wait.
 */
const CONNECT_WAIT_MS = Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10_000);

/**
 * Connections in the pool. Stated rather than defaulted, because the default
 * (10) is a number worth seeing when reading this file: it is the ceiling on
 * concurrent queries, and it is shared with nothing — the session store and
 * the project lock each keep their own.
 */
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? 10);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  connectionTimeoutMillis: CONNECT_WAIT_MS,
});

/**
 * Whether an error is "the pool had nothing free in time".
 *
 * Matched on the message because node-postgres gives it no code, and down the
 * `cause` chain because nothing hands it over bare: Drizzle wraps it in a
 * `Failed query: select …`, and whatever called Drizzle may wrap that again.
 * The first version of this checked only the top-level message and so would
 * never have fired on a real one — which a pool exhausted on purpose showed
 * within a minute.
 *
 * Narrow on purpose: this decides whether a caller is told the database is
 * busy (503, retryable) rather than that something broke (500), and every
 * other database error should keep saying what it is.
 */
export function isPoolTimeout(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if (/timeout exceeded when trying to connect/i.test(e.message)) return true;
  }
  return false;
}
pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'UTC'").catch((err) => console.error("[db] couldn't set the session to UTC:", err));
});

export const db = drizzle(pool, { schema });
