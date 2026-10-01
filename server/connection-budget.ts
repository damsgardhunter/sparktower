/**
 * How many web instances this database will take.
 *
 * The scaling plan turns on one number — the database's `max_connections` —
 * and it is the one number that lived only in a dashboard. That matters because
 * exceeding it does not degrade: Postgres refuses new connections outright, so
 * the failure mode of guessing is an outage rather than a slowdown, and it
 * arrives at the moment traffic is highest.
 *
 * Each instance of this app opens two pools (see server/db.ts and
 * server/project-lock.ts), so the arithmetic is simple and worth having the
 * running system do rather than a person:
 *
 *     instances = (max_connections − reserved) ÷ per instance
 *
 * `reserved` is not padding. Postgres keeps `superuser_reserved_connections`
 * back, the platform's own backups and metrics hold some, `preDeployCommand`
 * runs migrations against the same database during a deploy, and an operator
 * with psql open is one more. A budget computed to the last connection is a
 * budget that fails during a deploy, which is exactly when nobody wants to be
 * reading this.
 */
import { pool } from "./db";

/** Kept back for migrations during a deploy, the platform's own connections, and a person with psql open. */
export const RESERVED_CONNECTIONS = 10;

export interface ConnectionBudget {
  /** The server's own ceiling. Null when it could not be read. */
  maxConnections: number | null;
  /** Connections in use right now, across every client of this database. */
  inUse: number | null;
  /** What one instance of this app can open: main pool + project-lock pool. */
  perInstance: number;
  mainPoolMax: number;
  lockPoolMax: number;
  /** How many instances fit, with the reservation held back. Null when unknown. */
  safeInstances: number | null;
  /** Instances currently fitting in what is already in use, for a sanity check against the dashboard. */
  note: string;
}

export async function connectionBudget(): Promise<ConnectionBudget> {
  const mainPoolMax = Number(process.env.DB_POOL_MAX ?? 20);
  const lockPoolMax = Number(process.env.PROJECT_LOCK_POOL_MAX ?? 12);
  const perInstance = mainPoolMax + lockPoolMax;

  let maxConnections: number | null = null;
  let inUse: number | null = null;
  try {
    const limit: any = await pool.query("SHOW max_connections");
    maxConnections = Number(limit?.rows?.[0]?.max_connections) || null;
    const used: any = await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity");
    inUse = Number(used?.rows?.[0]?.n);
    if (!Number.isFinite(inUse)) inUse = null;
  } catch {
    /*
     * A managed Postgres may refuse either of these to a non-superuser. Not
     * knowing is reported as not knowing — a budget invented from a default
     * would be worse than a blank, because somebody would scale on it.
     */
  }

  const safeInstances = maxConnections == null
    ? null
    : Math.max(0, Math.floor((maxConnections - RESERVED_CONNECTIONS) / perInstance));

  return {
    maxConnections, inUse, perInstance, mainPoolMax, lockPoolMax, safeInstances,
    note: maxConnections == null
      ? "max_connections could not be read from this database; size instances from the provider's own figure."
      : `${perInstance} connections per instance (DB_POOL_MAX ${mainPoolMax} + PROJECT_LOCK_POOL_MAX ${lockPoolMax}); ${RESERVED_CONNECTIONS} held back for deploy migrations, platform connections and an operator.`,
  };
}
