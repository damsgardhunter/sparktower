import { useRef, useState } from "react";

/** Held longer than this, a press is a selection or a long press, not a click. */
const LONG_PRESS_MS = 350;
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, CircleMinus, Plus, ShieldCheck, ShieldAlert, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { SECURITY_CATEGORY_LABEL, type SecurityCheckResult, type SecurityReport, type SecuritySeverity } from "@shared/security-checks";

interface PlanItem { title: string; severity: SecuritySeverity; why: string; fix: string; files: string[]; checkId: string | null }
type Report = SecurityReport & { plan?: PlanItem[] };

const SEVERITY_PILL: Record<SecuritySeverity, string> = {
  high: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};
const scoreTone = (s: number) => (s >= 85 ? "text-emerald-600" : s >= 60 ? "text-amber-600" : "text-rose-600");

function StatusIcon({ status }: { status: SecurityCheckResult["status"] }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" aria-label="Pass" />;
  if (status === "partial") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" aria-label="Partly done" />;
  if (status === "missing") return <XCircle className="h-4 w-4 text-rose-500 shrink-0" aria-label="Missing" />;
  return <CircleMinus className="h-4 w-4 text-muted-foreground shrink-0" aria-label="Doesn't apply" />;
}

/** One fix onto the board as a task, tagged security. */
function useAddToBoard(projectId: string) {
  const { toast } = useToast();
  const [added, setAdded] = useState<string[]>([]);
  // Already on the board — from an earlier visit, the app, or a teammate — by its title.
  const { data: board } = useQuery<{ title: string; tags?: string[] | null }[]>({ queryKey: ["/api/projects", projectId, "kanban"] });
  const onBoard = (title: string) => (board ?? []).some((t) => t.title.trim().toLowerCase() === `security: ${title}`.trim().toLowerCase() && !(t.tags ?? []).some((x) => x.startsWith("archived:")));
  const add = useMutation({
    mutationFn: async (item: { key: string; title: string; fix: string; why: string; severity: SecuritySeverity }) => {
      await apiRequest("POST", `/api/projects/${projectId}/kanban`, {
        title: `Security: ${item.title}`, description: `${item.fix}\n\nWhy: ${item.why}`,
        priority: item.severity === "high" ? "high" : "medium", status: "todo", tags: ["security"],
      });
      return item.key;
    },
    onSuccess: (key) => {
      setAdded((a) => [...a, key]);
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
      toast({ title: "Added to your board" });
    },
    onError: () => toast({ title: "Couldn't add that task", variant: "destructive" }),
  });
  return { add, added, onBoard };
}

function AddButton({ onClick, done, busy, testId }: { onClick: () => void; done: boolean; busy: boolean; testId: string }) {
  return (
    <Button size="sm" variant="outline" className="h-7 px-2 sm:px-3 text-xs gap-1 shrink-0" aria-label={done ? "On your board" : "Add to board"} disabled={done || busy} onClick={(e) => { e.stopPropagation(); onClick(); }} data-testid={testId}>
      {done ? <><Check className="h-3.5 w-3.5" /><span className="hidden sm:inline">On your board</span></> : <><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Add to board</span></>}
    </Button>
  );
}

/**
 * Security before release: the audit's deterministic checklist (read off the
 * code) with the score, the release blockers, Nova's prioritised fixes for
 * this codebase, and a one-click way to put any fix on the board.
 */
export function SecurityReportPanel({ projectId, report }: { projectId: string; report: Report | undefined }) {
  const [showPassed, setShowPassed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { add, added, onBoard } = useAddToBoard(projectId);
  /*
   * A row opens and closes on a click — but not on the click that ends a
   * text selection, a long press, or anything inside the open details:
   * someone selecting a fix to copy it must not have the block snap shut.
   *
   * Declared with the other hooks, above the early return: a hook after one
   * runs on some renders and not others, which is the order React relies on.
   */
  const pressedAt = useRef(0);
  if (!report?.checks?.length) {
    return <p className="text-xs text-muted-foreground" data-testid="security-report-none">Run a new read of the code to check security before release.</p>;
  }
  const gaps = report.checks.filter((c) => c.status === "missing" || c.status === "partial");
  const rest = report.checks.filter((c) => c.status === "pass" || c.status === "n/a");
  const plan = report.plan ?? [];
  const onPressStart = () => { pressedAt.current = Date.now(); };
  const toggle = (key: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-toggle]")) return;
    if (window.getSelection()?.toString()) return;
    if (Date.now() - pressedAt.current > LONG_PRESS_MS) return;
    setOpen((o) => (o === key ? null : key));
  };

  return (
    <section className="space-y-3" data-testid="security-report">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {report.blockers ? <ShieldAlert className="h-5 w-5 text-rose-500" /> : <ShieldCheck className="h-5 w-5 text-emerald-500" />}
        <h3 className="text-sm font-semibold">Security before release</h3>
        <span className={`text-lg font-bold tabular-nums ${scoreTone(report.score)}`} data-testid="security-score">{report.score}<span className="text-xs font-medium text-muted-foreground">/100</span></span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${report.blockers ? SEVERITY_PILL.high : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"}`} data-testid="security-blockers">
          {report.blockers ? `${report.blockers} release blocker${report.blockers === 1 ? "" : "s"}` : "No release blockers"}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">{report.counts.pass} pass · {report.counts.partial} partial · {report.counts.missing} missing</span>
      </div>

      {plan.length > 0 && (
        <div className="rounded-lg border border-border" data-testid="security-plan">
          <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fix first</p>
          <ol className="divide-y divide-border">
            {plan.map((p, i) => {
              const key = `plan-${i}`;
              return (
                <li key={key} className="px-3 py-2">
                  <div className="flex items-start gap-2 cursor-pointer" onMouseDown={onPressStart} onClick={(e) => toggle(key, e)}>
                    <span className="mt-0.5 h-5 w-5 rounded-full bg-muted text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{p.title} <span className={`ml-1 align-middle rounded-full border px-1.5 py-0 text-[9px] uppercase ${SEVERITY_PILL[p.severity]}`}>{p.severity}</span></p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{p.why}</p>
                      {open === key && (
                        <div className="mt-1.5 space-y-1 text-xs cursor-text select-text" data-no-toggle>
                          <p><span className="font-medium">Fix:</span> {p.fix}</p>
                          {p.files.length > 0 && <p className="font-mono text-[10px] break-all text-muted-foreground">{p.files.join(" · ")}</p>}
                        </div>
                      )}
                    </div>
                    <AddButton testId={`security-plan-add-${i}`} busy={add.isPending} done={added.includes(key) || onBoard(p.title)}
                      onClick={() => add.mutate({ key, title: p.title, fix: p.fix, why: p.why, severity: p.severity })} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border" data-testid="security-checks">
        {[...gaps, ...(showPassed ? rest : [])].map((c) => {
          const key = `check-${c.id}`;
          const gap = c.status === "missing" || c.status === "partial";
          return (
            <li key={c.id} className="px-3 py-2" data-testid={`security-check-${c.id}`}>
              <div className="flex items-start gap-2 cursor-pointer" onMouseDown={onPressStart} onClick={(e) => toggle(key, e)}>
                <StatusIcon status={c.status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    <span className="font-medium">{c.label}</span>
                    {gap && <span className={`ml-1.5 align-middle rounded-full border px-1.5 py-0 text-[9px] uppercase ${SEVERITY_PILL[c.severity]}`}>{c.severity}</span>}
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{SECURITY_CATEGORY_LABEL[c.category]}</span>
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{c.detail}</p>
                  {open === key && (
                    <div className="mt-1.5 space-y-1 text-xs cursor-text select-text" data-no-toggle>
                      <p><span className="font-medium">Why:</span> {c.why}</p>
                      {gap && <p><span className="font-medium">Fix:</span> {c.fix}</p>}
                      {c.evidence.length > 0 && <p className="font-mono text-[10px] break-all text-muted-foreground">{c.evidence.join(" · ")}</p>}
                    </div>
                  )}
                </div>
                {gap && <AddButton testId={`security-check-add-${c.id}`} busy={add.isPending} done={added.includes(key) || onBoard(c.label)}
                  onClick={() => add.mutate({ key, title: c.label, fix: c.fix, why: c.why, severity: c.severity })} />}
                {open === key ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />}
              </div>
            </li>
          );
        })}
        {!gaps.length && !showPassed && <li className="px-3 py-3 text-sm text-muted-foreground">Every applicable check passes.</li>}
      </ul>
      {rest.length > 0 && (
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setShowPassed((s) => !s)} data-testid="security-toggle-passed">
          {showPassed ? "Hide passed checks" : `Show passed checks (${rest.length})`}
        </button>
      )}
    </section>
  );
}
