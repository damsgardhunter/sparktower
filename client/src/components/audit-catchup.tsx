import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import {
  CATCHUP_SECTIONS, AUDIT_AUTO_APPLY, AUDIT_AUTO_APPLY_LABEL, describeOp,
  type CatchUpSection, type AuditAutoApply,
} from "@shared/audit-catchup";
import { Check, ChevronDown, ChevronRight, GitCommit, Loader2, RefreshCcw, Wand2 } from "lucide-react";

interface CatchUpFindings {
  note?: string;
  summary?: string;
  since?: string | null;
  files?: { added: number; modified: number; removed: number } | null;
  commits?: { count: number; recent: string[] };
  dropped?: { reason: string; count: number }[];
  applied?: string[];
}

/** Everything the project is refreshed from once changes land. */
export function refreshAfterCatchUp(projectId: string, auditId: string) {
  for (const key of ["kanban", "milestones", "roadmap", "code-audits", "task-history", "activity", "path", "feedback"]) {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
  }
  queryClient.invalidateQueries({ queryKey: ["/api/code-audits", auditId] });
  queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
}

/**
 * The top of an audit: what you did since last time, in a sentence; what Nova
 * already brought up to date on its own; and the rest, by section, to apply
 * with one click. Brief first — the lists open only if you want them.
 */
export function AuditCatchUp({ projectId, audit }: {
  projectId: string;
  audit: { id: string; operations: unknown; findings: unknown; appliedAt: string | Date | null };
}) {
  const { toast } = useToast();
  const catchUp = (audit.findings as any)?.catchUp as CatchUpFindings | undefined;
  const ops = (Array.isArray(audit.operations) ? audit.operations : []) as any[];
  const pending = ops.filter((o) => !o._status || o._status === "pending");
  const bySection = CATCHUP_SECTIONS
    .map((s) => ({ ...s, ops: pending.filter((o) => (o._section ?? "plan") === s.id) }))
    .filter((s) => s.ops.length);
  const [chosen, setChosen] = useState<Set<CatchUpSection> | null>(null);
  const selected = chosen ?? new Set(bySection.map((s) => s.id));
  const [open, setOpen] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const { data: project } = useQuery<{ auditAutoApply?: AuditAutoApply }>({ queryKey: ["/api/projects", projectId] });
  const mode = project?.auditAutoApply ?? "safe";

  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/code-audits/${audit.id}/apply`, { sections: [...selected] })).json() as Promise<{ changes: { description: string }[]; skipped: string[] }>,
    onSuccess: (r) => {
      toast({ title: `Project updated — ${r.changes.length} change${r.changes.length === 1 ? "" : "s"}`, description: r.skipped.length ? `${r.skipped.length} couldn't be applied.` : undefined });
      setChosen(null);
      refreshAfterCatchUp(projectId, audit.id);
    },
    onError: (e) => toast({ title: "Couldn't apply that", description: errorText(e), variant: "destructive" }),
  });
  const setMode = useMutation({
    mutationFn: async (autoApply: AuditAutoApply) => (await apiRequest("PUT", `/api/projects/${projectId}/audit-settings`, { autoApply })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] }),
    onError: (e) => toast({ title: "Couldn't save that", description: errorText(e), variant: "destructive" }),
  });

  if (!catchUp) return null;
  const applied = catchUp.applied ?? [];
  const pendingCount = bySection.filter((s) => selected.has(s.id)).reduce((n, s) => n + s.ops.length, 0);
  const since = catchUp.since ? new Date(catchUp.since).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const files = catchUp.files;

  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2.5" data-testid="audit-catchup">
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1.5">
          <RefreshCcw className="h-3 w-3" />{since ? `Since ${since}` : "Catching your project up"}
        </p>
        {catchUp.note && <p className="text-sm">{catchUp.note}</p>}
        <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          {files && <span>{files.added} files added · {files.modified} changed · {files.removed} removed</span>}
          {!!catchUp.commits?.count && <span className="flex items-center gap-1"><GitCommit className="h-3 w-3" />{catchUp.commits.count} commits</span>}
        </p>
      </div>

      {applied.length > 0 && (
        <div className="text-xs" data-testid="audit-catchup-applied">
          <button className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400" onClick={() => setShowDone((v) => !v)}>
            {showDone ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <Check className="h-3 w-3" />Nova brought {applied.length} thing{applied.length === 1 ? "" : "s"} up to date
          </button>
          {showDone && <ul className="mt-1 ml-5 space-y-0.5 text-muted-foreground list-disc">{applied.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </div>
      )}

      {bySection.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Waiting for you: {catchUp.summary}</p>
          <ul className="space-y-1">
            {bySection.map((s) => (
              <li key={s.id} className="rounded border border-border bg-background/60" data-testid={`catchup-section-${s.id}`}>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <input
                    type="checkbox" checked={selected.has(s.id)}
                    onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(s.id); else next.delete(s.id); setChosen(next); }}
                    data-testid={`catchup-check-${s.id}`}
                  />
                  <button className="flex-1 flex items-center gap-1.5 text-left text-xs" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    <span className="font-medium">{s.label}</span>
                    <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{s.ops.length}</Badge>
                    <span className="text-muted-foreground truncate">{s.hint}</span>
                    {open === s.id ? <ChevronDown className="h-3 w-3 ml-auto" /> : <ChevronRight className="h-3 w-3 ml-auto" />}
                  </button>
                </div>
                {open === s.id && (
                  <ul className="px-8 pb-2 space-y-0.5 text-xs text-muted-foreground list-disc">
                    {s.ops.map((o, i) => <li key={i}>{describeOp(o)}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" className="gap-1.5" disabled={!pendingCount || apply.isPending} onClick={() => apply.mutate()} data-testid="button-apply-catchup">
              {apply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Update my project ({pendingCount})
            </Button>
            {selected.size < bySection.length && <span className="text-[11px] text-muted-foreground">Unticked sections are skipped, and Nova won't suggest them again.</span>}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="audit-catchup-clear">{applied.length ? "Nothing else is waiting." : "Your project already matches the code."}</p>
      )}

      {!!catchUp.dropped?.length && (
        <p className="text-[11px] text-muted-foreground">Left out to keep this short: {catchUp.dropped.map((d) => `${d.count} ${d.reason}`).join(", ")}.</p>
      )}

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/50">
        <span>After each audit:</span>
        <select
          className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
          value={mode} disabled={setMode.isPending}
          onChange={(e) => setMode.mutate(e.target.value as AuditAutoApply)}
          data-testid="select-audit-auto-apply"
        >
          {AUDIT_AUTO_APPLY.map((m) => <option key={m} value={m}>{AUDIT_AUTO_APPLY_LABEL[m]}</option>)}
        </select>
      </div>
    </div>
  );
}
