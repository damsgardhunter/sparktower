/**
 * One instance does the scheduled work, not all of them.
 *
 * Every `setInterval` in this directory runs in every web process. On one
 * instance that is the same thing as running once, which is why none of it
 * needed saying until now. Add a second instance and each job fires twice an
 * hour instead of once — and the cost is not uniform:
 *
 *   - `reputation-jobs.ts` calls `refreshDueNovaReads`, which asks the model
 *     with `forceAi: true`. Two instances pay OpenAI twice for the same
 *     answers, four pay four times, and nothing in the logs says so — the work
 *     succeeds, it just succeeds repeatedly. This is the one with a bill.
 *   - `promotion-sync.ts` re-fetches every promotion. Wasted work and wasted
 *     rate-limit budget against someone else's API.
 *   - deletes and other idempotent sweeps are merely redundant.
 *
 * The simulation already solved this for itself with a Postgres advisory lock
 * (`withLock` in simulation-tick.ts). This is the same mechanism given a name,
 * so a job can be made single-flight by wrapping it rather than by each file
 * inventing its own key.
 *
 * Why advisory locks rather than a `jobs` table with a leader row: they are
 * held by a connection and released when it closes, so an instance that is
 * killed mid-job does not leave the lock held and the job stuck for everyone.
 * There is no lease to expire and no heartbeat to get wrong. The trade is that
 * the lock says nothing once released — it prevents concurrent runs, not
 * duplicate runs an hour apart — which is exactly the guarantee these jobs
 * need, because each one is due-driven: the rows carry when they were last
 * done, so a skipped tick is picked up by the next.
 *
 * ## Before you put PgBouncer in front of Postgres
 *
 * `pg_try_advisory_lock` is a *session* lock: it is held by the connection
 * until that connection unlocks it or closes. In PgBouncer's **transaction**
 * pooling mode a client is only pinned to a server connection for the length
 * of a transaction, so the connection this holds the lock on is not reliably
 * the one the unlock arrives on — and the lock can be left held on a server
 * connection that is handed to somebody else. The scaling plan calls for
 * PgBouncer in transaction mode at ~2,000 concurrent, so this matters there
 * and not before.
 *
 * Two ways through it, when that day comes:
 *
 *   - point this pool at the **direct** database URL rather than the pooler.
 *     Two or three connections for the jobs is not what the pooler is for.
 *   - or switch to `pg_advisory_xact_lock`, which is released at commit and is
 *     safe under transaction pooling — at the cost of holding a transaction
 *     open for the whole job, which for the Nova refresh is minutes.
 *
 * The first is the better trade. `withLock` in simulation-tick.ts has the same
 * property and wants the same treatment at the same time.
 */
import { pool } from "./db";

/**
 * A stable 32-bit key from a job's name.
 *
 * Postgres advisory locks take a bigint, so any hash would do; this one is
 * FNV-1a, kept deliberately boring and deterministic because the keys must
 * agree across instances and across restarts. Names live in `JOB` below rather
 * than at call sites so two jobs cannot quietly pick the same string.
 */
function keyOf(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Signed 32-bit: pg_try_advisory_lock(int) is the two-argument form's half,
  // and a value that fits an int4 keeps the key readable in pg_locks.
  return h | 0;
}

/** The jobs that must not run twice at once. One place, so no two can collide. */
export const JOB = {
  reputation: "sparktower/reputation-refresh",
  promotions: "sparktower/promotion-sync",
  rhythm: "sparktower/company-rhythm",
  retention: "sparktower/retention-sweep",
  pushReceipts: "sparktower/push-receipts",
  adRenders: "sparktower/ad-renders",
  simEarnings: "sparktower/sim-earnings",
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

/**
 * Runs `work` only if no other process is running it.
 *
 * Returns what the work returned, or null when another instance holds the
 * lock. Null is the ordinary case on every instance but one, so callers must
 * not treat it as a failure.
 */
export async function withJobLock<T>(name: JobName, work: () => Promise<T>): Promise<T | null> {
  const key = keyOf(name);
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    if (!rows[0]?.ok) return null; // Another instance has it. Nothing to say.
    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    }
  } finally {
    /*
     * Released even if the unlock above threw: the lock dies with the
     * connection, so giving the connection back is the backstop. Holding a
     * pooled client open on a thrown unlock would leak one connection per
     * tick, which on a 20-connection pool is an outage by morning.
     */
    client.release();
  }
}

/** The key a job will use, so a test can assert two jobs do not share one. */
export const jobLockKey = keyOf;
