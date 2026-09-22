/**
 * Applying a reviewed batch of Nova operations exactly once.
 *
 * Three routes hand a raw array of operations to `applyProjectOperations` —
 * Nova's assist apply, the MCP bridge's apply, and the task planner's apply.
 * None of them could tell a first attempt from a replay, so a double click on
 * a slow apply, or a client retry after a timeout, ran the whole batch twice:
 * every create_task and create_milestone duplicated. The sharpest edge was
 * update_scope, which replaces a whole bucket — a replay carrying the array
 * the model proposed minutes ago silently threw away everything added since.
 *
 * The claim is made in the same statement that checks for one (INSERT … ON
 * CONFLICT DO NOTHING on a unique key), so two simultaneous requests cannot
 * both win. A caller that sends an `Idempotency-Key` gets exactly-once on its
 * own terms; one that doesn't still gets it, because the key falls back to a
 * fingerprint of the batch. The fingerprint is deliberately scoped by a short
 * window so that deliberately doing the same thing again tomorrow still works
 * — what it stops is the same batch arriving twice in the same sitting.
 */
import { createHash } from "crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "./db";
import { projectOperationApplications } from "@shared/schema";
import { applyProjectOperations } from "./project-operations";

/** Two identical batches this far apart are two intentions, not a double click. */
export const REPLAY_WINDOW_MS = 10 * 60_000;
/** Claims older than this are no use to anyone and are swept as they are noticed. */
const KEEP_MS = 24 * 3_600_000;

/** A caller-supplied key, or the batch's own fingerprint. */
export function idempotencyKeyFor(req: { headers?: Record<string, any>; body?: any }, operations: unknown[]): string {
  const given = String(req.headers?.["idempotency-key"] ?? req.body?.idempotencyKey ?? "").trim().slice(0, 200);
  if (given) return `given:${given}`;
  /*
   * No key from the client: fingerprint the batch itself. The claim is aged
   * out after REPLAY_WINDOW_MS, so applying the same plan again deliberately,
   * later, still works — what this catches is the same batch arriving twice in
   * the same sitting.
   */
  const hash = createHash("sha256").update(JSON.stringify(operations)).digest("hex").slice(0, 32);
  return `batch:${hash}`;
}

export interface AppliedOnce {
  changes: Awaited<ReturnType<typeof applyProjectOperations>>["changes"];
  skipped: string[];
  /** True when this exact batch had already been applied: the answer is the first one's. */
  replayed: boolean;
}

/**
 * Applies `operations` unless this key has already applied something on this
 * project, in which case the first attempt's answer comes back with
 * `replayed: true` and nothing is written.
 */
export async function applyOperationsOnce(opts: {
  projectId: string;
  userId: string;
  operations: unknown[];
  key: string;
  source: string;
  apply: Parameters<typeof applyProjectOperations>[3];
}): Promise<AppliedOnce> {
  const { projectId, userId, key, source } = opts;
  const cutoff = new Date(Date.now() - REPLAY_WINDOW_MS);

  // A stale claim for the same fingerprint must not block a fresh intention.
  await db.delete(projectOperationApplications)
    .where(and(eq(projectOperationApplications.projectId, projectId), eq(projectOperationApplications.key, key), lt(projectOperationApplications.createdAt, cutoff)))
    .catch(() => {});

  const claimed = await db.insert(projectOperationApplications)
    .values({ projectId, userId, key, source, result: {} } as any)
    .onConflictDoNothing()
    .returning({ id: projectOperationApplications.id });

  if (!claimed.length) {
    // Someone already has this key. Their answer is the truth about what happened.
    const [prior] = await db.select().from(projectOperationApplications)
      .where(and(eq(projectOperationApplications.projectId, projectId), eq(projectOperationApplications.key, key)));
    const result = (prior?.result as any) ?? {};
    return { changes: result.changes ?? [], skipped: result.skipped ?? [], replayed: true };
  }

  const id = claimed[0].id;
  try {
    const { changes, skipped } = await applyProjectOperations(projectId, userId, opts.operations, opts.apply);
    await db.update(projectOperationApplications).set({ result: { changes, skipped } as any })
      .where(eq(projectOperationApplications.id, id)).catch(() => {});
    void sweep();
    return { changes, skipped, replayed: false };
  } catch (err) {
    // Nothing was recorded, so the claim would block an honest retry. Drop it.
    await db.delete(projectOperationApplications).where(eq(projectOperationApplications.id, id)).catch(() => {});
    throw err;
  }
}

/** Old claims, cleared opportunistically rather than by a job nobody would remember to run. */
async function sweep(): Promise<void> {
  await db.delete(projectOperationApplications)
    .where(lt(projectOperationApplications.createdAt, new Date(Date.now() - KEEP_MS)))
    .catch(() => {});
}
