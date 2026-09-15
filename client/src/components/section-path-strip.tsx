/**
 * The whole path for the open section, always on screen under the section
 * tabs: every phase and milestone, done or not, with where the project is now.
 * Compact on purpose — numbers, nodes and a tooltip, never a paragraph.
 */
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sectionDef } from "@/lib/sections";
import type { ProjectGoal } from "@shared/goals";
import { useLivePath, SyncDot, requestOpenMilestone } from "@/components/section/live";
import { ACTOR_SHORT, estimate, NOVA_GRADIENT, type PathMilestone, type PathStatus } from "@/components/section/path-types";
import { GitBranch, Play } from "lucide-react";

export { requestOpenMilestone } from "@/components/section/live";

export interface SectionPathStripProps {
  projectId: string;
  goal: ProjectGoal;
  /** A milestone was clicked: open it (the manager decides where). Defaults to asking the dashboard to open it. */
  onOpenMilestone?: (backboneId: string) => void;
  /** The section isn't started: the strip offers to start it. */
  onStart?: () => void;
}

export function SectionPathStrip({ projectId, goal, onOpenMilestone, onStart }: SectionPathStripProps) {
  const { data, isLoading, isFetching, isError, dataUpdatedAt, flash } = useLivePath(projectId, goal);
  const def = sectionDef(goal);
  const Icon = def.icon;

  if (isLoading) {
    return <div className="h-[68px] rounded-lg border border-border bg-muted/30 animate-pulse" data-testid="section-path-strip-loading" />;
  }
  if (!data) return null;

  if (!data.adopted) {
    const notStarted = data.started === false;
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-background px-3 py-2 min-h-[44px]" data-testid="section-path-strip">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate">{def.label}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{notStarted ? "Not started" : "Path not set up"}</span>
        {notStarted && onStart && (
          <Button size="sm" className="ml-auto h-7 gap-1" onClick={onStart} data-testid="button-strip-start">
            <Play className="h-3 w-3" />Start
          </Button>
        )}
      </div>
    );
  }

  return <Strip data={data} flash={flash} fetching={isFetching} error={isError} updatedAt={dataUpdatedAt} onOpen={onOpenMilestone ?? requestOpenMilestone} />;
}

function Strip({ data, flash, fetching, error, updatedAt, onOpen }: {
  data: PathStatus; flash: Set<string>; fetching: boolean; error: boolean; updatedAt: number; onOpen: (id: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const nextId = data.next?.id ?? null;
  const { done, total } = data.mainLine;
  const pct = total ? Math.round((done / total) * 100) : 0;

  // Keep "you are here" in view when it moves.
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>("[data-here='true']");
    if (!box || !el) return;
    box.scrollTo({ left: Math.max(0, el.offsetLeft - box.clientWidth / 2), behavior: "smooth" });
  }, [nextId]);

  return (
    <div className="flex items-stretch rounded-lg border border-border bg-background" data-testid="section-path-strip">
      <div className="flex flex-col justify-center px-3 shrink-0 border-r border-border" title={`${done} of ${total} milestones on the main line`}>
        <span className="text-base font-semibold tabular-nums leading-none" data-testid="strip-progress">{pct}%</span>
        <span className="text-[10px] text-muted-foreground tabular-nums mt-1">{done}/{total}</span>
      </div>
      <div ref={scroller} className="relative flex-1 min-w-0 overflow-x-auto [scrollbar-width:thin]">
        <div className="flex min-w-max h-full">
          {data.phases.map((phase) => {
            const [head, tail] = phase.title.split(" — ");
            const isCurrent = phase.id === data.current.id;
            const dim = phase.optional && data.branch?.phaseId !== phase.id;
            const complete = phase.total > 0 && phase.done === phase.total;
            return (
              <div
                key={phase.id}
                className={`flex flex-col justify-center gap-2 px-3 pt-2 pb-3.5 border-r last:border-r-0 ${phase.optional ? "border-dashed" : ""} border-border ${dim ? "opacity-55" : ""} ${isCurrent ? "bg-primary/[0.04]" : ""}`}
                data-testid={`strip-phase-${phase.id}`}
              >
                <div className="flex items-center gap-1.5 text-[10px] leading-none whitespace-nowrap" title={phase.title}>
                  {phase.optional && <GitBranch className="h-2.5 w-2.5 text-muted-foreground" />}
                  <span className={`font-semibold ${isCurrent ? "text-primary" : complete ? "text-muted-foreground" : ""}`}>{head}</span>
                  {tail && <span className="text-muted-foreground max-w-[8.5rem] truncate">{tail}</span>}
                  <span className={`tabular-nums ${complete ? "text-emerald-600" : "text-muted-foreground"}`}>{phase.done}/{phase.total}</span>
                </div>
                <div className="flex items-center">
                  {phase.milestones.map((m, j) => (
                    <div key={m.id} className="flex items-center">
                      {j > 0 && <span className={`h-px w-2.5 ${m.done ? "bg-primary/60" : "bg-border"}`} />}
                      <Node m={m} next={m.id === nextId} flash={flash.has(m.id)} onOpen={onOpen} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="hidden sm:flex items-center px-3 shrink-0 border-l border-border">
        <SyncDot updatedAt={updatedAt} fetching={fetching} error={error} />
      </div>
    </div>
  );
}

function Node({ m, next, flash, onOpen }: { m: PathMilestone; next: boolean; flash: boolean; onOpen: (id: string) => void }) {
  const state = m.done ? "Done" : next ? "Next" : "To do";
  return (
    <Tooltip delayDuration={120}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen(m.id)}
          className="relative h-5 w-5 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`${m.title} — ${state}`}
          data-here={next ? "true" : undefined}
          data-state={m.done ? "done" : next ? "next" : "todo"}
          data-testid={`strip-node-${m.id}`}
        >
          {next ? (
            <>
              <span className={`absolute inset-0 rounded-full ${NOVA_GRADIENT} opacity-40 animate-ping`} />
              <span className={`relative h-4 w-4 rounded-full p-[2.5px] ${NOVA_GRADIENT}`}><span className="block h-full w-full rounded-full bg-background" /></span>
              <span className="absolute top-full left-1/2 -translate-x-1/2 mt-0.5 text-[9px] font-semibold leading-none text-emerald-600 whitespace-nowrap pointer-events-none">Here</span>
            </>
          ) : m.done ? (
            <span className={`h-3 w-3 rounded-full bg-primary transition-shadow ${flash ? "ring-2 ring-emerald-400 ring-offset-1 animate-pulse" : ""}`} />
          ) : (
            <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/35 bg-background hover:border-primary/60" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[16rem]">
        <p className="text-xs font-medium leading-snug">{m.title}</p>
        <p className="text-[10px] text-muted-foreground">{state} · {ACTOR_SHORT[m.actor]} · {estimate(m.estimateMinutes)}</p>
      </TooltipContent>
    </Tooltip>
  );
}
