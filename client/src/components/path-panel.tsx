import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ACTOR_LABEL, type Actor, type VerificationTier, type PaceState, type ProjectionMode } from "@shared/phase-trees";
import { PROJECT_GOALS, subcategoriesFor, type ProjectGoal } from "@shared/goals";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Loader2, Sparkles, User, GitBranch, ListTree, Plus, ArrowRightLeft } from "lucide-react";

interface PathMilestone {
  id: string; title: string; description: string; actor: Actor; estimateMinutes: number | null;
  tier: VerificationTier; done: boolean; taskId: string | null; taskStatus: string | null;
  expandsFrom?: string; steps: { done: number; total: number } | null;
}
interface PathPhase {
  id: string; title: string; optional: boolean; checkpoint: string | null; total: number; done: number;
  milestones: PathMilestone[];
  injected: { id: string; title: string; status: string; artifact: string | null }[];
  injectRoom: number;
}
interface NoPath { adopted: false; goal: ProjectGoal; subcategory: string; promise: string; existingTasks: number; existingDone: number }
interface PathStatus {
  adopted: true;
  goal: ProjectGoal; subcategory: string; promise: string; target: string;
  phases: PathPhase[];
  current: { id: string; title: string; step: number; of: number };
  next: PathMilestone | null;
  mainLine: { done: number; total: number };
  pace: { state: PaceState; multiplier: number | null; mode: ProjectionMode; projectedAt: string | null; projectedLow: string | null; projectedHigh: string | null; note: string; daysSinceActivity: number } | null;
  events: { id: string; title: string; estimateMinutes: number | null; actualMinutes: number | null; projectedBefore: string | null; projectedAfter: string | null; createdAt: string }[];
  proposal: { goal: ProjectGoal; why: string }[] | null;
}

const TIER_LABEL: Record<VerificationTier, string> = {
  verified: "Nova checks this itself",
  artifact: "Done when the artifact exists",
  evidence: "Done when you show it",
  claimed: "Your word counts",
};

function estimate(minutes: number | null) {
  if (minutes == null) return "open-ended";
  if (minutes === 0) return "automatic";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)}h`;
}
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

function projection(p: NonNullable<PathStatus["pace"]>) {
  if (p.mode === "pipeline") return "Pipeline mode";
  if (p.mode === "none" || !p.projectedAt) return "No date yet";
  if (p.mode === "range" && p.projectedLow && p.projectedHigh) return `${day(p.projectedLow)} – ${day(p.projectedHigh)}`;
  return day(p.projectedAt);
}

/**
 * The path as the dashboard shows it, one shape across every path and phase:
 * pace strip, Nova panel, the one next action, and the map one click away.
 */
export function PathPanel({ projectId, onNavigate }: { projectId: string; onNavigate: (tab: string) => void }) {
  const [showMap, setShowMap] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const { toast } = useToast();
  const { data: raw, isLoading } = useQuery<PathStatus | NoPath>({ queryKey: ["/api/projects", projectId, "path"], enabled: !!projectId });

  const refresh = () => {
    for (const key of ["path", "kanban", "nova-briefing", "milestones", "roadmap"]) queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
  };
  const fail = (e: any) => toast({ title: String(e?.message ?? "Something went wrong").replace(/^\d+:\s*/, ""), variant: "destructive" });

  const markDone = useMutation({ mutationFn: (taskId: string) => apiRequest("PATCH", `/api/kanban/${taskId}`, { status: "done" }), onSuccess: refresh, onError: fail });
  const expand = useMutation({
    mutationFn: (backboneId: string) => apiRequest("POST", `/api/projects/${projectId}/path/expand`, { backboneId }).then((r) => r.json()),
    onSuccess: (r: any) => { refresh(); toast({ title: r.created?.length ? `Nova broke it into ${r.created.length} steps` : "Steps already exist" }); },
    onError: fail,
  });
  const inject = useMutation({
    mutationFn: (phaseId: string) => apiRequest("POST", `/api/projects/${projectId}/path/inject`, { phaseId }).then((r) => r.json()),
    onSuccess: (r: any) => {
      refresh();
      toast({ title: r.created?.length ? `Nova added ${r.created.length} task${r.created.length === 1 ? "" : "s"} for this phase` : "Nothing in your artifacts calls for more here", description: r.dropped?.length ? `${r.dropped.length} idea${r.dropped.length === 1 ? "" : "s"} left out — no artifact to ground them in.` : undefined });
    },
    onError: fail,
  });
  const adopt = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/path/adopt`, {}).then((r) => r.json()),
    onSuccess: (r: any) => {
      refresh();
      toast({ title: r.recognised?.length ? `Nova recognised ${r.recognised.length} milestone${r.recognised.length === 1 ? "" : "s"} as already done` : "Your project is on its path", description: r.read || undefined });
    },
    onError: fail,
  });
  const mark = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", `/api/projects/${projectId}/path/mark`, { ids }).then((r) => r.json()),
    onSuccess: refresh, onError: fail,
  });
  const switchPath = useMutation({
    mutationFn: (body: { goal: ProjectGoal; subcategory: string }) => apiRequest("POST", `/api/projects/${projectId}/path/switch`, body).then((r) => r.json()),
    onSuccess: (r: any) => { refresh(); setShowSwitch(false); toast({ title: "Moved to the new path", description: r.carried ? `${r.carried} shared milestone${r.carried === 1 ? "" : "s"} carried across as done.` : undefined }); },
    onError: fail,
  });

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!raw) return null;
  if (!raw.adopted) {
    // Made before paths existed. Offer the path, and Nova's read of where the work already is.
    return (
      <Card className="border-primary/40" data-testid="path-adopt">
        <CardContent className="p-4 space-y-2">
          <p className="font-semibold">Put this project on its path</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {raw.promise}. You already have {raw.existingDone} of {raw.existingTasks} tasks done — Nova will read those, your audits and check-ins, and mark what's already finished so the path starts where you are.
          </p>
          <Button size="sm" onClick={() => adopt.mutate()} disabled={adopt.isPending} data-testid="button-adopt-path">
            {adopt.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            {adopt.isPending ? "Nova is reading your project…" : "Start the path and read my progress"}
          </Button>
        </CardContent>
      </Card>
    );
  }
  const data = raw;

  const { current, next, mainLine, pace } = data;
  const pct = mainLine.total ? Math.round((mainLine.done / mainLine.total) * 100) : 0;
  const novaActs = next && next.actor !== "user-does";
  const currentPhase = data.phases.find((p) => p.id === current.id);
  const goalLabel = (g: ProjectGoal) => PROJECT_GOALS.find((x) => x.id === g)?.label ?? g;

  return (
    <div className="space-y-3" data-testid="path-panel">
      {/* Pace strip */}
      <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
        <div className="min-w-0">
          <p className="font-medium truncate" data-testid="path-phase">{current.title}</p>
          <p className="text-muted-foreground">
            Step {current.step} of {current.of} · {mainLine.done}/{mainLine.total} on the main line
            {pace && <> · <span data-testid="pace-projection">{projection(pace)}</span></>}
            {pace?.multiplier != null && <> · <span data-testid="pace-multiplier">{pace.multiplier}×</span></>}
          </p>
        </div>
        <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => setShowMap(!showMap)} data-testid="button-toggle-path">
          {showMap ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showMap ? "Hide the path" : "See the whole path"}
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Nova panel: what it noticed, what it recalculated, one or two actions. */}
      {pace && (
        <div className="rounded-lg border border-border/60 p-3 space-y-2 text-sm" data-testid="nova-panel">
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <p className="text-muted-foreground leading-relaxed" data-testid="pace-note">
              {pace.state === "nudge" && "A week without a check-in. The date is unchanged — one small step keeps it that way. "}
              {pace.note}
            </p>
          </div>
          {data.events.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5 pl-5" data-testid="pace-events">
              {data.events.slice(0, 3).map((e) => (
                <li key={e.id}>
                  {e.title}: {e.estimateMinutes != null ? `estimated ${estimate(e.estimateMinutes)}` : "no estimate"}
                  {e.actualMinutes != null && `, took ${estimate(e.actualMinutes)}`}
                  {e.projectedBefore && e.projectedAfter && day(e.projectedBefore) !== day(e.projectedAfter) && ` → ${day(e.projectedAfter)}`}
                </li>
              ))}
            </ul>
          )}
          {currentPhase && (
            <div className="flex gap-2 flex-wrap pl-5">
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={inject.isPending || currentPhase.injectRoom <= 0}
                onClick={() => inject.mutate(currentPhase.id)} data-testid="button-inject">
                <Plus className="h-3 w-3 mr-1" />
                {currentPhase.injectRoom > 0 ? `Ask Nova what this phase is missing (${currentPhase.injectRoom} left)` : "Nova's additions for this phase are full"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* The one next action. */}
      {next ? (
        <Card className="border-primary/40" data-testid="next-action">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {novaActs ? <Sparkles className="h-3.5 w-3.5 text-primary" /> : <User className="h-3.5 w-3.5" />}
              <span>{ACTOR_LABEL[next.actor]}</span>
              <span>·</span><span>{estimate(next.estimateMinutes)}</span>
              <span>·</span><span>{TIER_LABEL[next.tier]}</span>
              {next.steps && <><span>·</span><span data-testid="next-steps">{next.steps.done}/{next.steps.total} steps</span></>}
            </div>
            <p className="font-semibold leading-snug" data-testid="next-action-title">{next.title}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{next.description}</p>
            <div className="flex gap-2 pt-1 flex-wrap">
              {next.expandsFrom && !next.steps && (
                <Button size="sm" onClick={() => expand.mutate(next.id)} disabled={expand.isPending} data-testid="button-next-expand">
                  <ListTree className="h-3.5 w-3.5 mr-1.5" />Break into steps with Nova
                </Button>
              )}
              {next.taskId && (
                <Button size="sm" variant={next.expandsFrom && !next.steps ? "outline" : "default"} onClick={() => markDone.mutate(next.taskId!)} disabled={markDone.isPending} data-testid="button-next-done">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  {next.tier === "claimed" ? "I did this" : "Done"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onNavigate("kanban")} data-testid="button-next-open">Open in tasks</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="path-complete"><CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium">The path is complete.</p>
          {data.proposal?.map((p) => (
            <div key={p.goal} className="flex items-start justify-between gap-3 text-sm">
              <div><p className="font-medium">{goalLabel(p.goal)}</p><p className="text-muted-foreground">{p.why}</p></div>
              <Button size="sm" variant="outline" onClick={() => { setShowSwitch(true); setShowMap(true); }}>Go</Button>
            </div>
          ))}
        </CardContent></Card>
      )}

      {showMap && (
        <div className="space-y-4 pt-2" data-testid="path-map">
          <p className="text-sm text-muted-foreground">{data.promise}.</p>
          {data.phases.map((phase) => (
            <div key={phase.id} className={phase.optional ? "border-l-2 border-dashed border-border pl-3" : ""}>
              <div className="flex items-center gap-2 mb-1.5">
                {phase.optional && <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />}
                <p className="text-sm font-medium">{phase.title}</p>
                <Badge variant="secondary" className="text-[10px]">{phase.done}/{phase.total}</Badge>
              </div>
              <ul className="space-y-1">
                {phase.milestones.map((m) => (
                  <li key={m.id} className="flex items-start gap-2 text-sm">
                    {m.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />}
                    <span className={m.done ? "text-muted-foreground line-through" : ""}>{m.title}{m.steps && <span className="text-muted-foreground"> ({m.steps.done}/{m.steps.total} steps)</span>}</span>
                    <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{m.actor === "user-does" ? "you" : "Nova"} · {estimate(m.estimateMinutes)}</span>
                    {!m.done && (
                      <button className="text-[11px] text-primary hover:underline shrink-0" disabled={mark.isPending} onClick={() => mark.mutate([m.id])} data-testid={`mark-${m.id}`} title="Already done? Mark it.">
                        done
                      </button>
                    )}
                  </li>
                ))}
                {phase.injected.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-sm" data-testid="injected-task">
                    {t.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /> : <Sparkles className="h-3.5 w-3.5 text-primary/60 mt-0.5 shrink-0" />}
                    <span className={t.status === "done" ? "text-muted-foreground line-through" : ""}>{t.title}</span>
                    <span className="text-[11px] text-muted-foreground ml-auto shrink-0">Nova added</span>
                  </li>
                ))}
              </ul>
              {phase.checkpoint && <p className="text-xs text-muted-foreground mt-1.5 italic">{phase.checkpoint}</p>}
            </div>
          ))}

          {/* Switching is visible, not hidden. */}
          <div className="border-t border-border pt-3 space-y-2">
            {!showSwitch ? (
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowSwitch(true)} data-testid="button-show-switch">
                <ArrowRightLeft className="h-3 w-3 mr-1" />Move this project to another path
              </Button>
            ) : (
              <SwitchForm current={data} pending={switchPath.isPending} onSwitch={(b) => switchPath.mutate(b)} onCancel={() => setShowSwitch(false)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SwitchForm({ current, pending, onSwitch, onCancel }: { current: PathStatus; pending: boolean; onSwitch: (b: { goal: ProjectGoal; subcategory: string }) => void; onCancel: () => void }) {
  const [goal, setGoal] = useState<ProjectGoal>(PROJECT_GOALS.find((g) => g.id !== current.goal)!.id);
  const [subcategory, setSubcategory] = useState<string>("other");
  return (
    <div className="space-y-2 text-sm" data-testid="switch-form">
      <p className="text-muted-foreground">Shared milestones you've already finished carry across as done. The current path's tasks stay on the board, marked.</p>
      <div className="flex gap-1 flex-wrap">
        {PROJECT_GOALS.filter((g) => g.id !== current.goal).map((g) => (
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
