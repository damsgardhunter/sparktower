/**
 * A section's path laid out as a roadmap: each phase a column, its milestones
 * in order with done / next / to-do, the checkpoint that closes the phase, and
 * optional branches drawn dashed. Any milestone opens beside the roadmap to be
 * worked, without leaving it.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MilestoneDetail } from "@/components/path-milestone";
import { refreshPath, useFail } from "@/components/path-work";
import { sectionDef } from "@/lib/sections";
import type { ProjectGoal } from "@shared/goals";
import { useLivePath, useOpenMilestoneRequests } from "./live";
import { Chip } from "./block";
import { ACTOR_SHORT, estimate, projection, NOVA_GRADIENT, type PathStatus, type PathPhase } from "./path-types";
import { CheckCircle2, ChevronRight, Circle, Clock, Flag, GitBranch, Loader2, Plus, Sparkles, Target } from "lucide-react";

export function SectionRoadmap({ projectId, goal }: { projectId: string; goal: ProjectGoal }) {
  const { data, isLoading, flash } = useLivePath(projectId, goal);
  const [open, setOpen] = useState<string | null>(null);
  const def = sectionDef(goal);
  useOpenMilestoneRequests((id) => setOpen(id));

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!data) return null;
  if (!data.adopted) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center space-y-1" data-testid="section-roadmap-empty">
        <p className="font-medium">{def.label}</p>
        <p className="text-sm text-muted-foreground">{data.started === false ? "Not started yet — start it to see its roadmap." : "Set up this path on the Dashboard to see its roadmap."}</p>
      </div>
    );
  }

  const openMilestone = open ? data.phases.flatMap((p) => p.milestones.map((m) => ({ m, p }))).find((x) => x.m.id === open) : null;

  return (
    <div className="space-y-5" data-testid="section-roadmap">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2"><Target className="h-4 w-4 text-primary" />{def.label}</h2>
          <p className="text-sm text-muted-foreground line-clamp-1" title={data.promise}>{data.promise}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Chip>{data.mainLine.done}/{data.mainLine.total} milestones</Chip>
            <Chip>{data.phases.filter((p) => !p.optional).length} phases</Chip>
            {data.pace && <Chip icon={Clock}>Finish {projection(data.pace)}</Chip>}
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-5">
        <div className="flex flex-col md:flex-row gap-3 md:overflow-x-auto md:pb-3 md:snap-x">
          {data.phases.map((phase, i) => (
            <PhaseColumn key={phase.id} projectId={projectId} goal={goal} data={data} phase={phase} index={data.phases.slice(0, i).filter((p) => !p.optional).length} flash={flash} onOpen={setOpen} />
          ))}
        </div>
      </div>

      <Sheet open={!!openMilestone} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto" data-testid="roadmap-milestone-sheet">
          {openMilestone && (
            <>
              <SheetHeader className="text-left pr-6">
                <SheetDescription className="text-xs">{openMilestone.p.title}</SheetDescription>
                <SheetTitle className="leading-snug">{openMilestone.m.title}</SheetTitle>
              </SheetHeader>
              <div className="mt-4"><MilestoneDetail projectId={projectId} backboneId={openMilestone.m.id} /></div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PhaseColumn({ projectId, goal, data, phase, index, flash, onOpen }: {
  projectId: string; goal: ProjectGoal; data: PathStatus; phase: PathPhase; index: number; flash: Set<string>; onOpen: (id: string) => void;
}) {
  const { toast } = useToast();
  const fail = useFail();
  const inject = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/path/inject`, { phaseId: phase.id, goal }).then((r) => r.json()),
    onSuccess: (r: any) => { refreshPath(projectId); toast({ title: r.created?.length ? `Nova added ${r.created.length} task${r.created.length === 1 ? "" : "s"}` : "Nothing missing here" }); },
    onError: fail,
  });
  const branch = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/path/branch`, { phaseId: phase.id, goal }).then((r) => r.json()),
    onSuccess: () => { refreshPath(projectId); toast({ title: "Working the branch" }); },
    onError: fail,
  });

  const isCurrent = phase.id === data.current.id;
  const complete = phase.total > 0 && phase.done === phase.total;
  const pct = phase.total ? Math.round((phase.done / phase.total) * 100) : 0;
  const [head, tail] = phase.title.split(" — ");
  const status = phase.optional ? "Branch" : complete ? "Done" : isCurrent ? "Now" : phase.done > 0 ? "Started" : "Up next";
  const statusCls = phase.optional ? "bg-muted text-muted-foreground" : complete ? "bg-emerald-500/15 text-emerald-700" : isCurrent ? `${NOVA_GRADIENT} text-white` : "bg-muted text-muted-foreground";

  return (
    <div
      className={`md:w-72 md:shrink-0 md:snap-start rounded-xl border bg-background flex flex-col ${phase.optional ? "border-dashed" : ""} ${isCurrent ? "border-primary/50 ring-1 ring-primary/15" : "border-border"} ${complete ? "bg-muted/20" : ""}`}
      data-testid={`roadmap-phase-${phase.id}`}
    >
      <div className="p-3 space-y-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className={`h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${complete ? "bg-emerald-500 text-white" : isCurrent ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : phase.optional ? <GitBranch className="h-3 w-3" /> : index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight truncate" title={phase.title}>{head}</p>
            {tail && <p className="text-[11px] text-muted-foreground truncate">{tail}</p>}
          </div>
          <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 shrink-0 ${statusCls}`}>{status}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} /></div>
          <span className="text-[10px] text-muted-foreground tabular-nums">{phase.done}/{phase.total}</span>
        </div>
      </div>

      <ul className="divide-y divide-border/70 flex-1">
        {phase.milestones.map((m) => {
          const isNext = m.id === data.next?.id;
          return (
            <li key={m.id}>
              <button
                className={`w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-muted/40 transition-colors ${flash.has(m.id) ? "bg-emerald-500/10" : ""} ${isNext ? "bg-primary/[0.04]" : ""}`}
                onClick={() => onOpen(m.id)}
                data-testid={`roadmap-open-${m.id}`}
              >
                <span className="mt-0.5 shrink-0">
                  {m.done
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    : isNext
                      ? <span className={`block h-3.5 w-3.5 rounded-full p-[2px] ${NOVA_GRADIENT}`}><span className="block h-full w-full rounded-full bg-background" /></span>
                      : <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm leading-snug line-clamp-2 ${m.done ? "text-muted-foreground" : ""} ${isNext ? "font-medium" : ""}`}>{m.title}</span>
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    {isNext && <span className="text-emerald-600 font-semibold">Next · </span>}
                    {ACTOR_SHORT[m.actor]} · {estimate(m.estimateMinutes)}{m.steps ? ` · ${m.steps.done}/${m.steps.total} steps` : ""}
                  </span>
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground mt-1 shrink-0" />
              </button>
            </li>
          );
        })}
        {phase.injected.map((t) => (
          <li key={t.id} className="flex items-start gap-2 px-3 py-2 text-sm">
            {t.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /> : <Sparkles className="h-3.5 w-3.5 text-primary/60 mt-0.5 shrink-0" />}
            <span className={`line-clamp-2 ${t.status === "done" ? "text-muted-foreground" : ""}`}>{t.title}</span>
          </li>
        ))}
      </ul>

      {(phase.checkpoint || phase.optional || phase.injectRoom > 0) && (
        <div className="px-3 py-2 border-t border-border space-y-1.5">
          {phase.checkpoint && (
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5" title={phase.checkpoint}>
              <Flag className="h-3 w-3 mt-0.5 shrink-0" /><span className="line-clamp-2">{phase.checkpoint}</span>
            </p>
          )}
          {phase.optional ? (
            data.branch?.phaseId !== phase.id && (
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" disabled={branch.isPending} onClick={() => branch.mutate()} data-testid={`roadmap-enter-${phase.id}`}>
                <GitBranch className="h-3 w-3 mr-1" />Work this branch
              </Button>
            )
          ) : phase.injectRoom > 0 && !complete && (
            <button className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50" disabled={inject.isPending} onClick={() => inject.mutate()} data-testid={`roadmap-inject-${phase.id}`}>
              {inject.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}What's missing?
            </button>
          )}
        </div>
      )}
    </div>
  );
}
