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
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Advisory lock keys are two 32-bit ints. The first names the kind of work, so
 * two different guards on the same project id never collide; the second is a
 * stable hash of the id (`hashtext`, computed by Postgres so every caller
 * agrees).
 */
export type LockKind = "path-sync" | "audit-apply";
const CLASS: Record<LockKind, number> = { "path-sync": 4_201, "audit-apply": 4_202 };

/**
 * Runs `fn` with the project's lock of that kind held. Waits for whoever holds
 * it; the lock is released when the wrapping transaction ends, including when
 * the body throws, so a failure can never wedge a project.
 */
export async function withProjectLock<T>(kind: LockKind, id: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CLASS[kind]}::int, hashtext(${id})::int)`);
    return fn();
  });
}
