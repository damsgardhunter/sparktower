/**
 * Whether Nova is reading the project's code right now — an audit started from
 * the Codebase tab, the editor bridge or a teammate — and how the last one
 * ended. One hook, shared by the tab, the rail, the dashboard and the path
 * strip: they share one cache entry, so polling costs one request.
 *
 * When a run finishes, the audit list, the path, the sections, the board and
 * the milestones are re-read once (whichever mounted copy sees it first), and a
 * failed run is toasted once.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";

export type AuditStage = "fetching" | "reading" | "saving";

export interface AuditRunning {
  id: string;
  source: string;
  stage: AuditStage | string;
  startedAt: string;
  startedBy: { id: string; firstName: string | null } | null;
  elapsedSeconds: number;
}

export interface AuditStatus {
  running: AuditRunning | null;
  last: { id: string; source: string; finishedAt: string | null; auditId: string | null; error: string | null } | null;
}

export const RUNNING_POLL_MS = 4_000;
export const IDLE_POLL_MS = 20_000;

export const auditStatusKey = (projectId: string | undefined) => ["/api/projects", projectId, "code-audit", "status"];

export const AUDIT_STAGE_LABEL: Record<string, string> = {
  fetching: "Fetching the code",
  reading: "Nova is reading it",
  saving: "Saving what it found",
};
export const auditStageLabel = (stage: string | null | undefined) => AUDIT_STAGE_LABEL[stage ?? ""] ?? "Nova is reading it";

/** "github:owner/repo@main" → "GitHub"; "upload:…" → "zip"; "worktree:…" → "your editor". */
export function auditSourceLabel(source: string | null | undefined) {
  const kind = String(source ?? "").split(":")[0];
  if (kind === "github") return "GitHub";
  if (kind === "worktree") return "your editor";
  if (kind === "upload") return "zip";
  return null;
}

/** "1:05", "42s". */
export function formatElapsed(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What each project's status last looked like, so a finish is acted on once however many copies are mounted. */
const seen = new Map<string, { runningId: string | null; lastId: string | null; finishedAt: string | null }>();
/** Until when a run's error is left to the screen that started it (it toasts its own failure). */
const quietUntil = new Map<string, number>();

/** The Codebase tab calls this around its own POST, so its failure isn't toasted twice. */
export function quietAuditErrors(projectId: string, ms: number) {
  quietUntil.set(projectId, Date.now() + ms);
}

export function useAuditStatus(projectId: string | undefined, opts: { expectRunning?: boolean } = {}) {
  const query = useQuery<AuditStatus>({
    queryKey: auditStatusKey(projectId),
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/code-audit/status`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
      return res.json();
    },
    enabled: !!projectId,
    refetchInterval: (q) => (opts.expectRunning || q.state.data?.running ? RUNNING_POLL_MS : IDLE_POLL_MS),
    refetchOnWindowFocus: true,
    staleTime: 2_000,
  });

  const data = query.data;
  useEffect(() => {
    if (!projectId || !data) return;
    const next = { runningId: data.running?.id ?? null, lastId: data.last?.id ?? null, finishedAt: data.last?.finishedAt ?? null };
    const prev = seen.get(projectId);
    seen.set(projectId, next);
    if (!prev) return; // first look: nothing has changed yet
    const stopped = !!prev.runningId && !next.runningId;
    const finished = next.finishedAt !== prev.finishedAt || next.lastId !== prev.lastId;
    if (!stopped && !finished) return;

    for (const key of ["code-audits", "path", "tracks", "kanban", "milestones", "roadmap", "activity"]) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
    }
    if (data.last?.auditId) queryClient.invalidateQueries({ queryKey: ["/api/code-audits", data.last.auditId] });
    queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });

    if (finished && data.last?.error && (quietUntil.get(projectId) ?? 0) < Date.now()) {
      toast({ title: "The code read didn't finish", description: data.last.error, variant: "destructive" });
    }
  }, [projectId, data]);

  return { ...query, running: data?.running ?? null, last: data?.last ?? null };
}
