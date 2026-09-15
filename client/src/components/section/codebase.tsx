/**
 * The dashboard's link to the code: when Nova last read it, what that read
 * moved on this path, what it left for you to approve, and whether the loops
 * close in the code — so the path and the repo read as one piece of work.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConnectEditorBar } from "@/components/editor-access";
import { LIVE_INTERVAL_MS } from "@/lib/sections";
import { useNow } from "./live";
import { ago, plural, type PathStatus } from "./path-types";
import { AlertTriangle, ArrowRight, CheckCircle2, GitCommitHorizontal, ScanSearch } from "lucide-react";

interface AuditListItem { id: string; createdAt: string; stage: string | null; completionPercent: number | null; summary: string | null; operationCount: number }

export function CodebaseSync({ projectId, data, onNavigate }: { projectId: string; data: PathStatus; onNavigate: (tab: string) => void }) {
  const now = useNow();
  const [all, setAll] = useState(false);
  const { data: audits } = useQuery<AuditListItem[]>({
    queryKey: ["/api/projects", projectId, "code-audits"],
    enabled: !!projectId,
    refetchInterval: LIVE_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
  const latest = audits?.[0] ?? null;
  const update = data.auditUpdate ?? null;
  const readAt = latest?.createdAt ?? update?.at ?? data.loopTree?.closureAuditAt ?? null;
  const loops = data.loopTree?.loops ?? [];
  const closing = loops.filter((l) => l.closure?.closure === "closed").length;
  const read = loops.filter((l) => l.closure).length;
  const days = data.pace ? Math.floor(data.pace.daysSinceActivity) : null;

  const facts = [
    { label: "Last read", value: readAt ? ago(readAt, now) : "Never", testid: "codebase-last-read" },
    { label: "Activity", value: days == null ? "—" : days === 0 ? "Today" : `${days}d ago` },
    ...(latest?.completionPercent != null ? [{ label: "Built", value: `${latest.completionPercent}%` }] : []),
    ...(read > 0 ? [{ label: "Loops closing", value: `${closing}/${loops.length}` }] : []),
  ];

  return (
    <div className="space-y-3" data-testid="codebase-sync">
      <div className="flex items-center gap-x-6 gap-y-2 flex-wrap">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.label}</p>
            <p className="text-sm font-semibold tabular-nums" data-testid={f.testid}>{f.value}</p>
          </div>
        ))}
        <Button size="sm" variant={readAt ? "outline" : "default"} className="ml-auto h-8" onClick={() => onNavigate("codebase")} data-testid="button-codebase-open">
          <ScanSearch className="h-3.5 w-3.5 mr-1.5" />{readAt ? "Re-read code" : "Read my code"}
        </Button>
      </div>

      {update && (
        <div className="rounded-lg border border-primary/25 bg-primary/[0.04] divide-y divide-primary/10" data-testid="path-audit-update">
          <div className="flex items-center gap-2 px-3 py-2 text-xs flex-wrap">
            <GitCommitHorizontal className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="font-medium">From your code</span>
            <span className="text-muted-foreground">{ago(update.at, now)}</span>
            {update.appliedCount > 0 && <span className="text-muted-foreground">· {plural(update.appliedCount, "change")} made</span>}
            {update.pendingCount > 0 && (
              <button className="ml-auto text-primary font-medium hover:underline flex items-center gap-1" onClick={() => onNavigate("codebase")} data-testid="button-review-audit-changes">
                Review {update.pendingCount} waiting<ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
          {update.applied.length > 0 && (
            <ul className="px-3 py-2 space-y-1">
              {(all ? update.applied : update.applied.slice(0, 3)).map((a, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs"><CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" /><span className="line-clamp-1">{a}</span></li>
              ))}
              {update.applied.length > 3 && (
                <li><button className="text-[11px] text-primary hover:underline" onClick={() => setAll(!all)}>{all ? "Less" : `+${update.appliedCount - 3} more`}</button></li>
              )}
            </ul>
          )}
          {update.pendingLoops.length > 0 && (
            <p className="px-3 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5" data-testid="path-audit-loop-changes">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" /><span className="line-clamp-2">Loops may have changed: {update.pendingLoops.join("; ")}</span>
            </p>
          )}
        </div>
      )}

      <ConnectEditorBar projectId={projectId} />
    </div>
  );
}
