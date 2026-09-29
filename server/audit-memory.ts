/**
 * What the last audit read, so the next one does not read it again.
 *
 * An audit re-read the whole repository every time. On a measured day six of
 * them came to 2.19M tokens and $3.40 — 44% of everything Nova spent — and
 * almost none of that repository had changed between runs. Reading a file to
 * conclude what you concluded about it yesterday is the clearest waste there
 * was.
 *
 * The rule is deliberately strict: an area is reused only when the exact
 * bytes it would read are the bytes it read last time. Anything else — a file
 * changed, a file added to its selection, a file gone — and it is read again
 * in full. Being wrong in the cheap direction (an unnecessary re-read) costs
 * money; being wrong in the other direction would mean reporting a verdict
 * about code that no longer exists, which is the thing an audit is for.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { codeAuditMemory } from "@shared/schema";
import type { CapabilityDetail } from "@shared/capabilities";

/** A file as the audit sees it: a path and the text that was actually sent. */
export interface ReadFile { path: string; text: string }

/**
 * One value standing for "these files, with this content, in this order".
 *
 * The text hashed is the text the model is sent — already truncated to the
 * per-file cap — so a change beyond the cap, which the model never saw and
 * could not have reasoned about, correctly does not invalidate anything.
 */
export function fingerprintOf(files: ReadFile[]): string {
  const h = createHash("sha256");
  // Sorted, because file selection order is not part of what was concluded.
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(f.path);
    h.update("\0");
    h.update(createHash("sha256").update(f.text).digest("hex"));
    h.update("\0");
  }
  return h.digest("hex");
}

/** What was concluded last time these exact bytes were read, if they were. */
export async function recallArea(
  projectId: string, area: string, fingerprint: string,
): Promise<CapabilityDetail | null> {
  try {
    const [row] = await db.select({ fingerprint: codeAuditMemory.fingerprint, detail: codeAuditMemory.detail })
      .from(codeAuditMemory)
      .where(and(eq(codeAuditMemory.projectId, projectId), eq(codeAuditMemory.area, area)));
    if (!row || row.fingerprint !== fingerprint) return null;
    return row.detail as CapabilityDetail;
  } catch (err) {
    // A memory that cannot be read is a re-read, not a failure.
    console.error("[audit] could not recall an area:", (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * Remember what this read concluded, against the bytes it read.
 *
 * One row per area per project, replaced rather than appended: the only
 * question ever asked of it is "what did you conclude about *these* bytes",
 * and history is in `code_audit_runs` where it belongs.
 */
export async function rememberArea(
  projectId: string, area: string, fingerprint: string, detail: CapabilityDetail,
): Promise<void> {
  try {
    await db.insert(codeAuditMemory)
      .values({ projectId, area, fingerprint, detail })
      .onConflictDoUpdate({
        target: [codeAuditMemory.projectId, codeAuditMemory.area],
        set: { fingerprint, detail, createdAt: new Date() },
      });
  } catch (err) {
    // Same rule: failing to remember costs a re-read, never an audit.
    console.error("[audit] could not remember an area:", (err as Error)?.message ?? err);
  }
}

/** Forget everything known about a project's code. For a re-audit somebody asked to be thorough. */
export async function forgetProject(projectId: string): Promise<void> {
  try {
    await db.delete(codeAuditMemory).where(eq(codeAuditMemory.projectId, projectId));
  } catch (err) {
    console.error("[audit] could not forget a project:", (err as Error)?.message ?? err);
  }
}
