import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import {
  CATCHUP_SECTIONS, AUDIT_AUTO_APPLY, AUDIT_AUTO_APPLY_LABEL, describeOp,
  type CatchUpSection, type AuditAutoApply,
} from "@shared/audit-catchup";
import { PATH_TREES } from "@shared/phase-trees";
import { goalOfBackboneId, PROJECT_GOALS, type ProjectGoal } from "@shared/goals";
import { ArrowUpRight, Check, ChevronDown, ChevronRight, CircleDashed, GitCommit, Loader2, Wand2, X } from "lucide-react";

interface CatchUpFindings {
  note?: string;
  summary?: string;
  since?: string | null;
  files?: { added: number; modified: number; removed: number } | null;
  commits?: { count: number; recent: string[] };
  dropped?: { reason: string; count: number; items?: string[] }[];
  applied?: string[];
  /** Edits that were applied for but didn't take, each with why. */
  skipped?: string[];
}

/**
 * Everything the project is refreshed from once changes land — the board, the
 * path (every section's), the section summaries — so the dashboard and the
 * always-visible path strip move the moment the code does.
 */
export function refreshAfterCatchUp(projectId: string, auditId?: string | null) {
  for (const key of ["kanban", "milestones", "roadmap", "code-audits", "task-history", "activity", "path", "tracks", "feedback"]) {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
  }
  if (auditId) queryClient.invalidateQueries({ queryKey: ["/api/code-audits", auditId] });
  queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
}

type Op = Record<string, any>;
type KanbanTask = { id: string; title: string; tags?: string[] | null };

const SHORT: Record<ProjectGoal, string> = Object.fromEntries(PROJECT_GOALS.map((g) => [g.id, g.short])) as Record<ProjectGoal, string>;
const tagValue = (tags: string[] | null | undefined, prefix: string) => tags?.find((t) => t.startsWith(prefix))?.slice(prefix.length) ?? null;

function milestoneTitle(backboneId: string): string | null {
  const goal = goalOfBackboneId(backboneId);
  if (!goal) return null;
  for (const phase of PATH_TREES[goal].phases) {
    const m = phase.milestones.find((x) => x.id === backboneId);
    if (m) return m.title;
  }
  return null;
}

/** The section a task belongs to, by the same tags the manager reads. */
function goalOfTags(tags: string[] | null | undefined): ProjectGoal | null {
  const track = tagValue(tags, "track:");
  if (PROJECT_GOALS.some((g) => g.id === track)) return track as ProjectGoal;
  return goalOfBackboneId(tagValue(tags, "backbone:") ?? tagValue(tags, "parent:"));
}

/** Operations that move the path: milestones reached, work recorded, tasks closed, loop steps built. */
const PATH_SECTIONS: readonly CatchUpSection[] = ["path", "shipped", "closed"];

function pathRow(op: Op, tasks: KanbanTask[]): { key: string; title: string; kind: string; goal: ProjectGoal | null } {
  const task = (id: string) => tasks.find((t) => t.id === id);
  switch (op.op) {
    case "complete_path_milestone": {
      const id = String(op.backboneId ?? "");
      return { key: `m-${id}`, title: milestoneTitle(id) ?? id, kind: "Milestone", goal: goalOfBackboneId(id) };
    }
    case "create_task":
      return { key: `c-${op.title}`, title: String(op.title ?? "Task"), kind: op.status === "done" ? "Shipped" : "New task", goal: goalOfTags(op.tags) };
    case "update_task": {
      const t = task(op.id);
      return { key: `u-${op.id}`, title: t?.title ?? op.title ?? describeOp(op), kind: op.status === "done" ? "Done" : "Task", goal: goalOfTags(t?.tags) };
    }
    case "add_loop_steps": {
      const t = task(op.loopId);
      const n = Array.isArray(op.steps) ? op.steps.length : 0;
      return { key: `l-${op.loopId}`, title: t?.title ?? describeOp(op), kind: `${n} step${n === 1 ? "" : "s"} built`, goal: goalOfTags(t?.tags) };
    }
    default:
      return { key: `o-${describeOp(op)}`, title: describeOp(op), kind: "Change", goal: null };
  }
}

const STATUS_ICON = {
  applied: { icon: Check, className: "text-emerald-600 bg-emerald-500/10", label: "Done" },
  pending: { icon: CircleDashed, className: "text-primary bg-primary/10", label: "Waiting" },
  skipped: { icon: X, className: "text-amber-600 bg-amber-500/10", label: "Didn't take" },
  declined: { icon: X, className: "text-muted-foreground bg-muted", label: "Declined" },
} as const;

/**
 * "What changed on your path": one compact row per milestone or task the
 * latest read completed or proposed, each linking to its section.
 */
export function PathChanges({ projectId, audit, limit = 6 }: {
  projectId: string;
  audit: { operations: unknown };
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const ops = ((Array.isArray(audit.operations) ? audit.operations : []) as Op[])
    .filter((o) => PATH_SECTIONS.includes((o._section ?? "plan") as CatchUpSection) || o.op === "complete_path_milestone");
  const needsTasks = ops.some((o) => o.op === "update_task" || o.op === "add_loop_steps");
  const { data: tasks = [] } = useQuery<KanbanTask[]>({
    queryKey: ["/api/projects", projectId, "kanban"],
    enabled: needsTasks,
    staleTime: 15_000,
  });
  if (!ops.length) return null;

  // Waiting first — they're the ones asking for something.
  const order = (o: Op) => (!o._status || o._status === "pending" ? 0 : o._status === "applied" ? 1 : 2);
  const sorted = [...ops].sort((a, b) => order(a) - order(b));
  const shown = all ? sorted : sorted.slice(0, limit);

  return (
    <ul className="divide-y divide-black/[0.08] dark:divide-white/10 rounded-lg border border-black/[0.08] dark:border-white/10" data-testid="path-changes">
      {shown.map((op, i) => {
        const row = pathRow(op, Array.isArray(tasks) ? tasks : []);
        const status = STATUS_ICON[(op._status as keyof typeof STATUS_ICON) ?? "pending"] ?? STATUS_ICON.pending;
        const href = row.goal ? `/projects/${projectId}/manage?section=${row.goal}&tab=nova` : `/projects/${projectId}/manage?tab=nova`;
        return (
          <li key={`${row.key}-${i}`} className="flex items-center gap-2.5 px-3 py-2 text-sm" data-testid="path-change-row">
            <span className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 ${status.className}`} title={status.label}>
              <status.icon className="h-3 w-3" />
            </span>
            <span className="min-w-0 flex-1 truncate">{row.title}</span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground shrink-0">{row.kind}</span>
            <a href={href} className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-black/[0.08] dark:border-white/10 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40" data-testid="path-change-link">
              {row.goal ? SHORT[row.goal] : "Path"}<ArrowUpRight className="h-3 w-3" />
            </a>
          </li>
        );
      })}
      {sorted.length > limit && (
        <li>
          <button type="button" className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground text-left" onClick={() => setAll((v) => !v)}>
            {all ? "Show fewer" : `Show all ${sorted.length}`}
          </button>
        </li>
      )}
    </ul>
  );
}

/**
 * The rest of the catch-up: what's waiting, by section, applied with one
 * click; what Nova already did; and what it does after each read. Short by
 * default — every list opens only if you ask.
 */
export function AuditCatchUp({ projectId, audit }: {
  projectId: string;
  audit: { id: string; operations: unknown; findings: unknown; appliedAt: string | Date | null };
}) {
  const { toast } = useToast();
  const catchUp = (audit.findings as any)?.catchUp as CatchUpFindings | undefined;
  const ops = (Array.isArray(audit.operations) ? audit.operations : []) as Op[];
  const pending = ops.filter((o) => !o._status || o._status === "pending");
  const bySection = CATCHUP_SECTIONS
    .map((s) => ({ ...s, ops: pending.filter((o) => (o._section ?? "plan") === s.id) }))
    .filter((s) => s.ops.length);
  const [chosen, setChosen] = useState<Set<CatchUpSection> | null>(null);
  const selected = chosen ?? new Set(bySection.map((s) => s.id));
  const [open, setOpen] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showMore, setShowMore] = useState(false);

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
  const extras = (catchUp.skipped?.length ?? 0) + (catchUp.dropped?.length ?? 0);

  return (
    <div className="space-y-3" data-testid="audit-catchup">
      {/* Since last time, as numbers. */}
      {(since || files || catchUp.commits?.count) && (
        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-muted-foreground">
          {since && <span className="font-medium text-foreground">Since {since}</span>}
          {files && <span className="tabular-nums"><span className="text-emerald-600">+{files.added}</span> · ~{files.modified} · <span className="text-rose-600">−{files.removed}</span> files</span>}
          {!!catchUp.commits?.count && <span className="flex items-center gap-1 tabular-nums"><GitCommit className="h-3 w-3" />{catchUp.commits.count} commits</span>}
        </div>
      )}
      {catchUp.note && <p className="text-sm text-muted-foreground line-clamp-2" title={catchUp.note}>{catchUp.note}</p>}

      {bySection.length > 0 ? (
        <div className="rounded-lg border border-primary/30 bg-primary/[0.03]" data-testid="catchup-waiting">
          <ul className="divide-y divide-black/[0.08] dark:divide-white/10">
            {bySection.map((s) => (
              <li key={s.id} data-testid={`catchup-section-${s.id}`}>
                <div className="flex items-center gap-2.5 px-3 py-2">
                  <input
                    type="checkbox" className="accent-[#9745B5]" checked={selected.has(s.id)}
                    onChange={(e) => { const next = new Set(selected); if (e.target.checked) next.add(s.id); else next.delete(s.id); setChosen(next); }}
                    aria-label={s.label}
                    data-testid={`catchup-check-${s.id}`}
                  />
                  <button className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    <span className="font-medium truncate">{s.label}</span>
                    <span className="rounded-full bg-primary/10 text-primary px-1.5 text-[10px] font-semibold tabular-nums">{s.ops.length}</span>
                    {open === s.id ? <ChevronDown className="h-3.5 w-3.5 ml-auto shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto shrink-0 text-muted-foreground" />}
                  </button>
                </div>
                {open === s.id && (
                  <ul className="px-10 pb-2 space-y-0.5 text-xs text-muted-foreground list-disc">
                    {s.ops.map((o, i) => <li key={i} className="truncate">{describeOp(o)}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-t border-black/[0.08] dark:border-white/10">
            <Button size="sm" className="gap-1.5" disabled={!pendingCount || apply.isPending} onClick={() => apply.mutate()} data-testid="button-apply-catchup">
              {apply.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Update my project ({pendingCount})
            </Button>
            {selected.size < bySection.length && <span className="text-[11px] text-muted-foreground">Unticked ones won't be suggested again.</span>}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5" data-testid="audit-catchup-clear">
          <Check className="h-3.5 w-3.5 text-emerald-600" />{applied.length ? "Nothing else is waiting." : "Your project matches the code."}
        </p>
      )}

      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap text-xs text-muted-foreground">
        {applied.length > 0 && (
          <button className="flex items-center gap-1 hover:text-foreground" onClick={() => setShowDone((v) => !v)} data-testid="audit-catchup-applied">
            {showDone ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Nova updated {applied.length}
          </button>
        )}
        {extras > 0 && (
          <button className="flex items-center gap-1 hover:text-foreground" onClick={() => setShowMore((v) => !v)}>
            {showMore ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {catchUp.skipped?.length ? `${catchUp.skipped.length} didn't take` : "Left out"}
          </button>
        )}
        <label className="flex items-center gap-1.5 ml-auto">
          <span>After each read</span>
          <select
            className="rounded-md border border-black/[0.08] dark:border-white/10 bg-background px-1.5 py-1 text-[11px] max-w-[14rem]"
            value={mode} disabled={setMode.isPending}
            onChange={(e) => setMode.mutate(e.target.value as AuditAutoApply)}
            data-testid="select-audit-auto-apply"
          >
            {AUDIT_AUTO_APPLY.map((m) => <option key={m} value={m}>{AUDIT_AUTO_APPLY_LABEL[m]}</option>)}
          </select>
        </label>
      </div>

      {showDone && applied.length > 0 && (
        <ul className="ml-4 space-y-0.5 text-xs text-muted-foreground list-disc">{applied.map((a, i) => <li key={i}>{a}</li>)}</ul>
      )}
      {showMore && (
        <div className="space-y-2 text-xs">
          {!!catchUp.skipped?.length && (
            <ul className="ml-4 list-disc text-amber-800 dark:text-amber-300" data-testid="audit-catchup-skipped">
              {catchUp.skipped.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
          {!!catchUp.dropped?.length && (
            <ul className="ml-4 space-y-1 text-muted-foreground" data-testid="audit-catchup-dropped">
              {catchUp.dropped.map((d) => (
                <li key={d.reason}>
                  <span className="font-medium">{d.count} {d.reason}</span>
                  {d.items?.length ? <ul className="ml-3 list-disc">{d.items.map((it, i) => <li key={i}>{it}</li>)}</ul> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
