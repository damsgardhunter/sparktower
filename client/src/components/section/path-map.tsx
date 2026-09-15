/**
 * Every phase and milestone of a section's path as a list: open any
 * milestone to work it, mark what's already done, ask Nova what a phase is
 * missing, or step into a branch.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { refreshPath, useFail } from "@/components/path-work";
import { MilestoneDetail } from "@/components/path-milestone";
import { PROJECT_GOALS, subcategoriesFor, type ProjectGoal } from "@shared/goals";
import { ACTOR_SHORT, estimate, NOVA_GRADIENT, type PathStatus } from "./path-types";
import { ArrowRightLeft, CheckCircle2, ChevronRight, Circle, Flag, GitBranch, Plus, Sparkles } from "lucide-react";

export function PathMap({ projectId, goal, data, flash, openId, onOpen, isPrimary }: {
  projectId: string; goal: ProjectGoal; data: PathStatus; flash: Set<string>;
  openId: string | null; onOpen: (id: string | null) => void; isPrimary: boolean;
}) {
  const { toast } = useToast();
  const fail = useFail();
  const refresh = () => refreshPath(projectId);
  const [showSwitch, setShowSwitch] = useState(false);

  const mark = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", `/api/projects/${projectId}/path/mark`, { ids, goal }).then((r) => r.json()),
    onSuccess: refresh, onError: fail,
  });
  const inject = useMutation({
    mutationFn: (phaseId: string) => apiRequest("POST", `/api/projects/${projectId}/path/inject`, { phaseId, goal }).then((r) => r.json()),
    onSuccess: (r: any) => {
      refresh();
      toast({ title: r.created?.length ? `Nova added ${r.created.length} task${r.created.length === 1 ? "" : "s"}` : "Nothing missing here", description: r.dropped?.length ? `${r.dropped.length} idea${r.dropped.length === 1 ? "" : "s"} left out — nothing to ground them in.` : undefined });
    },
    onError: fail,
  });
  const branch = useMutation({
    mutationFn: (b: { phaseId: string | null }) => apiRequest("POST", `/api/projects/${projectId}/path/branch`, { ...b, goal }).then((r) => r.json()),
    onSuccess: (_r, b) => { refresh(); toast({ title: b.phaseId ? "Working the branch" : "Back on the main line" }); },
    onError: fail,
  });
  const switchPath = useMutation({
    mutationFn: (body: { goal: ProjectGoal; subcategory: string }) => apiRequest("POST", `/api/projects/${projectId}/path/switch`, body).then((r) => r.json()),
    onSuccess: (r: any) => { refresh(); setShowSwitch(false); toast({ title: "Moved to the new path", description: r.carried ? `${r.carried} shared milestone${r.carried === 1 ? "" : "s"} carried across.` : undefined }); },
    onError: fail,
  });

  // Opened from the strip: bring it into view.
  useEffect(() => {
    if (!openId) return;
    const t = setTimeout(() => document.querySelector(`[data-testid="open-${CSS.escape(openId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    return () => clearTimeout(t);
  }, [openId]);

  const nextId = data.next?.id;

  return (
    <div className="space-y-4" data-testid="path-map">
      {data.phases.map((phase) => {
        const isCurrent = phase.id === data.current.id;
        const pct = phase.total ? Math.round((phase.done / phase.total) * 100) : 0;
        return (
          <div key={phase.id} className={`rounded-lg border ${phase.optional ? "border-dashed" : ""} ${isCurrent ? "border-primary/40" : "border-border"}`} data-testid={`map-phase-${phase.id}`}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              {phase.optional && <GitBranch className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              <p className={`text-sm font-medium truncate ${isCurrent ? "text-primary" : ""}`}>{phase.title}</p>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{phase.done}/{phase.total}</span>
              <div className="hidden sm:block h-1 w-16 rounded-full bg-muted overflow-hidden shrink-0"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
              {phase.optional && data.branch?.phaseId !== phase.id && (
                <Button size="sm" variant="ghost" className="h-6 text-xs ml-auto" disabled={branch.isPending} onClick={() => branch.mutate({ phaseId: phase.id })} data-testid={`button-enter-${phase.id}`}>Work this branch</Button>
              )}
            </div>
            <ul className="divide-y divide-border/70">
              {phase.milestones.map((m) => {
                const open = openId === m.id;
                const isNext = m.id === nextId;
                return (
                  <li key={m.id} className={`text-sm transition-colors ${flash.has(m.id) ? "bg-emerald-500/10" : ""}`}>
                    <div className="flex items-center gap-2 px-3 py-1.5">
                      {m.done
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        : isNext
                          ? <span className={`h-3.5 w-3.5 rounded-full p-[2px] shrink-0 ${NOVA_GRADIENT}`}><span className="block h-full w-full rounded-full bg-background" /></span>
                          : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                      <button className={`flex-1 min-w-0 text-left truncate hover:text-primary ${m.done ? "text-muted-foreground" : ""} ${isNext ? "font-medium" : ""}`} onClick={() => onOpen(open ? null : m.id)} data-testid={`open-${m.id}`} title={m.title}>
                        {m.title}{m.steps && <span className="text-muted-foreground font-normal"> · {m.steps.done}/{m.steps.total}</span>}
                      </button>
                      <span className="hidden sm:inline text-[11px] text-muted-foreground shrink-0">{ACTOR_SHORT[m.actor]} · {estimate(m.estimateMinutes)}</span>
                      {!m.done && (
                        <button className="text-[11px] text-primary hover:underline shrink-0" disabled={mark.isPending} onClick={() => mark.mutate([m.id])} data-testid={`mark-${m.id}`} title="Already done? Mark it.">done</button>
                      )}
                      <ChevronRight className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                    </div>
                    {open && <div className="px-3 pb-3"><MilestoneDetail projectId={projectId} backboneId={m.id} /></div>}
                  </li>
                );
              })}
              {phase.injected.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-sm" data-testid="injected-task">
                  {t.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <Sparkles className="h-3.5 w-3.5 text-primary/60 shrink-0" />}
                  <span className={`flex-1 min-w-0 truncate ${t.status === "done" ? "text-muted-foreground" : ""}`}>{t.title}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">Nova added</span>
                </li>
              ))}
            </ul>
            {(phase.checkpoint || !phase.optional) && (
              <div className="flex items-center gap-3 flex-wrap px-3 py-1.5 border-t border-border/70 text-[11px] text-muted-foreground">
                {phase.checkpoint && <span className="flex items-center gap-1 min-w-0" title={phase.checkpoint}><Flag className="h-3 w-3 shrink-0" /><span className="truncate max-w-[22rem]">{phase.checkpoint}</span></span>}
                {!phase.optional && (
                  <button className="ml-auto hover:text-foreground flex items-center gap-1 disabled:opacity-50" disabled={inject.isPending || phase.injectRoom <= 0} onClick={() => inject.mutate(phase.id)} data-testid={`inject-${phase.id}`} title="Nova reads your work and adds what this phase is missing">
                    <Plus className="h-3 w-3" />{phase.injectRoom > 0 ? `What's missing? (${phase.injectRoom})` : "Additions full"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {data.branch?.open && (
        <Button size="sm" variant="ghost" className="text-xs" disabled={branch.isPending} onClick={() => branch.mutate({ phaseId: null })}>Back to the main line</Button>
      )}

      {isPrimary && (
        <div className="pt-1">
          {!showSwitch ? (
            <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setShowSwitch(true)} data-testid="button-show-switch">
              <ArrowRightLeft className="h-3 w-3 mr-1" />Change primary path
            </Button>
          ) : (
            <SwitchForm current={data.goal} pending={switchPath.isPending} onSwitch={(b) => switchPath.mutate(b)} onCancel={() => setShowSwitch(false)} />
          )}
        </div>
      )}
    </div>
  );
}

function SwitchForm({ current, pending, onSwitch, onCancel }: { current: ProjectGoal; pending: boolean; onSwitch: (b: { goal: ProjectGoal; subcategory: string }) => void; onCancel: () => void }) {
  const [goal, setGoal] = useState<ProjectGoal>(PROJECT_GOALS.find((g) => g.id !== current)!.id);
  const [subcategory, setSubcategory] = useState<string>("other");
  return (
    <div className="space-y-2 text-sm rounded-lg border border-border p-3" data-testid="switch-form">
      <p className="text-xs text-muted-foreground">Finished shared milestones carry across. Tasks stay on the board.</p>
      <div className="flex gap-1 flex-wrap">
        {PROJECT_GOALS.filter((g) => g.id !== current).map((g) => (
          <Button key={g.id} size="sm" variant={goal === g.id ? "default" : "outline"} onClick={() => { setGoal(g.id); setSubcategory("other"); }} data-testid={`switch-goal-${g.id}`}>{g.label}</Button>
        ))}
      </div>
      <div className="flex gap-1 flex-wrap">
        {subcategoriesFor(goal).map((s) => (
          <Button key={s.id} size="sm" variant={subcategory === s.id ? "secondary" : "ghost"} onClick={() => setSubcategory(s.id)} data-testid={`switch-subcategory-${s.id}`}>{s.label}</Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => onSwitch({ goal, subcategory })} data-testid="button-switch-path">Switch path</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
