/**
 * One writer at a time, per project.
 *
 * Several of the paths that shape a project's board are read-modify-write over
 * a whole set of rows rather than a single statement: the path sync reads the
 * tasks a project has, works out which milestones are missing, and inserts
 * them. Nothing in that sequence is atomic, and it runs from a plain GET (the
 * dashboard, the home screen's next-step card). Two tabs, or web and phone
 * asking at the same moment, both read "SHIP.M1.4 is missing" and both insert
 * it — and from then on every lookup by backbone id picks whichever row comes
 * back first, so finishing the milestone leaves its twin sitting open on the
 * board forever.
 *
 * A unique index would be the tighter fix, but the backbone id lives inside a
 * tags array rather than a column, so there is nothing to make unique without
 * a schema change that every other writer of that array would have to respect.
 * A Postgres advisory lock gives the same serialization with no schema at all:
 * the second caller waits at `pg_advisory_xact_lock` until the first has
 * committed, re-reads, and finds nothing missing.
 *
 * The lock is held by a transaction on its own connection while the body runs
 * its statements on the pool. That is deliberate: the body calls into
 * `storage`, which has no transaction to be handed, and serializing the
 * section is what prevents the duplicate — not atomicity of the insert.
 *
 * ## Why the lock has a pool of its own
 *
 * Because that arrangement deadlocks when the lock is held on a connection the
 * body then has to compete for.
 *
 * The main pool takes node-postgres's default of ten connections. Ten
 * simultaneous path syncs took ten connections to hold their locks, and every
 * one of their bodies then waited for an eleventh that could not exist —
 * nobody could finish, so nobody released. A load test wedged the server at
 * twelve concurrent requests to a path a dashboard polls every fifteen
 * seconds: one connection `idle in transaction` holding the advisory lock,
 * nine blocked on `wait_event = advisory`, Node at 0% CPU, and `/_health`
 * answering 200 throughout. It never recovered. Five concurrent requests were
 * fine; twelve killed it until it was restarted.
 *
 * A second pool fixes it by construction rather than by sizing: a lock holder
 * can never be waiting on a connection its own body needs, because they draw
 * from different places. Requests past this pool's size wait for a lock
 * connection instead — a wait that ends, because the holders ahead of them can
 * always finish.
 *
 * The timeouts below are the second half of it. The reason a wedge lasted
 * forever rather than a few seconds is that every wait here was unbounded.
 */
import pg from "pg";

/**
 * Advisory lock keys are two 32-bit ints. The first names the kind of work, so
 * two different guards on the same project id never collide; the second is a
 * stable hash of the id (`hashtext`, computed by Postgres so every caller
 * agrees).
 */
export type LockKind = "path-sync" | "audit-apply";
const CLASS: Record<LockKind, number> = { "path-sync": 4_201, "audit-apply": 4_202 };

/**
 * How many locks can be held at once. Past this, callers queue for a
 * connection — which is a wait rather than the deadlock, because every holder
 * ahead of them can still reach the main pool and finish.
 */
const LOCK_POOL_MAX = Number(process.env.PROJECT_LOCK_POOL_MAX ?? 12);

/** Long enough for any legitimate body, short enough that an abandoned lock frees itself. */
const ABANDONED_LOCK_MS = 120_000;
/** Waiting for the lock itself. A caller that waits this long is a symptom, not a queue. */
const LOCK_WAIT_MS = 15_000;
/** Waiting for a connection to hold a lock on. */
const CONNECT_WAIT_MS = 10_000;

/*
 * Its own pool, small: these connections only ever run BEGIN, a lock, and
 * COMMIT. They never carry a query of their own, which is why a handful is
 * plenty and why nothing here needs the main pool's UTC setting.
 */
const lockPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: LOCK_POOL_MAX,
  connectionTimeoutMillis: CONNECT_WAIT_MS,
  idleTimeoutMillis: 30_000,
});

/*
 * The backstop for a transaction nobody ever ends — a process killed mid-body,
 * a promise that never settles. Without it such a lock is held until the
 * connection dies, and every later caller for that project waits behind a
 * transaction that will never commit.
 */
lockPool.on("connect", (client) => {
  // `set_config` rather than SET: SET takes no bind parameters, and SQL built
  // by interpolation is SQL built by interpolation even when the value is a
  // constant of ours (test/unit/sql-parameterized.test.ts).
  client.query("select set_config('idle_in_transaction_session_timeout', $1, false)", [String(ABANDONED_LOCK_MS)])
    .catch((err) => console.error("[project-lock] couldn't set the abandoned-transaction timeout:", err));
});

/**
 * Runs `fn` with the project's lock of that kind held. Waits for whoever holds
 * it; the lock is released when the wrapping transaction ends, including when
 * the body throws, so a failure can never wedge a project.
 */
export async function withProjectLock<T>(kind: LockKind, id: string, fn: () => Promise<T>): Promise<T> {
  const client = await lockPool.connect();
  try {
    await client.query("BEGIN");
    // The `true` is SET LOCAL: it lasts exactly as long as this transaction.
    await client.query("select set_config('lock_timeout', $1, true)", [String(LOCK_WAIT_MS)]);
    await client.query("select pg_advisory_xact_lock($1::int, hashtext($2)::int)", [CLASS[kind], id]);
    try {
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      // The rollback's own failure must not replace the body's error, which is
      // the one that says what actually went wrong.
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}
