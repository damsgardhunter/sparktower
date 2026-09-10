/**
 * Verified means verified by evidence. A few backbone milestones map
 * cleanly onto what an audit can see — the scaffold runs, the deploy
 * answers, persistence and auth exist, analytics is wired — and for those
 * the audit is the verifier: it marks the milestone done with the audit as
 * the reason, and stamps already-done ones as confirmed. Everything else
 * stays on the builder's word, which is honest.
 */
import { db } from "./db";
import { storage } from "./storage";
import { projects } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { CapabilityEntry } from "@shared/capabilities";
import type { RuntimeFacts } from "./runtime-probe";
import { backboneIdOf, isArchivedPath, refreshPace } from "./phase-trees";

interface AuditLike { id: string; signals: any; findings: any; runtime?: RuntimeFacts | null }

const cap = (a: AuditLike, area: string) => ((a.findings?.capabilities ?? []) as CapabilityEntry[]).find((c) => c.area === area)?.status;

/** backbone id → does this audit prove it. Each returns the evidence sentence, or null. */
export const VERIFIERS: Record<string, (a: AuditLike) => string | null> = {
  "SHIP.M1.5": (a) => (a.signals?.serverEntry && (a.signals?.stack ?? []).length) ? `scaffold present: ${a.signals.serverEntry}, stack ${(a.signals.stack as any[]).slice(0, 4).map((s) => s.name).join(", ")}` : null,
  "SHIP.M1.8": (a) => a.runtime?.liveUrl?.ok || a.runtime?.health?.ok ? `live URL answers ${a.runtime?.liveUrl?.status ?? a.runtime?.health?.status} (${a.runtime?.liveUrl?.url ?? a.runtime?.health?.url})` : null,
  "SHIP.M2.4": (a) => cap(a, "auth") === "built" && cap(a, "data") === "built" ? "auth and persistence both built per the capability inventory" : null,
  "SHIP.M3.5": (a) => cap(a, "analytics") === "built" ? "analytics built per the capability inventory" : null,
};

/**
 * Runs the verifiers for this project's path against an audit. Returns
 * what changed. Never undoes a done milestone: an audit that can't see
 * something is not proof it isn't there.
 */
export async function verifyMilestonesFromAudit(projectId: string, audit: AuditLike) {
  const [project] = await db.select({ goal: projects.goal }).from(projects).where(eq(projects.id, projectId));
  if (!project) return { verified: [], marked: [] };
  const tasks = (await storage.getProjectKanbanTasks(projectId)).filter((t) => !isArchivedPath(t.tags));
  const verified: string[] = [], marked: string[] = [];
  for (const [backboneId, check] of Object.entries(VERIFIERS)) {
    const task = tasks.find((t) => backboneIdOf(t.tags) === backboneId);
    if (!task) continue;
    const evidence = check(audit);
    if (!evidence) continue;
    const tag = `verified:${audit.id}`;
    if ((task.tags ?? []).some((x) => x.startsWith("verified:"))) continue;
    const tags = [...(task.tags ?? []).filter((x) => !x.startsWith("verified:")), tag];
    if (task.status === "done") {
      await storage.updateKanbanTask(task.id, { tags } as any);
      verified.push(backboneId);
    } else {
      await storage.updateKanbanTask(task.id, {
        status: "done", completedAt: new Date(), tags: [...tags, "carried:reconciled"],
        description: `${task.description ?? ""}\n\nVerified by the codebase audit: ${evidence}`.trim(),
      } as any);
      marked.push(backboneId); verified.push(backboneId);
    }
  }
  if (marked.length) await refreshPace(projectId);
  return { verified, marked };
}
