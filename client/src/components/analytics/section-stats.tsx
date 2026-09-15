import type { ReactNode } from "react";
import type { ProjectGoal } from "@shared/goals";
import { usePath, sectionDef } from "@/lib/sections";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";

/** The bits of GET /api/projects/:id/path this row reads. */
interface PathSummary {
  adopted: boolean;
  started: boolean;
  mainLine?: { done: number; total: number };
  pace?: {
    state: "active" | "nudge" | "decaying" | "dormant";
    mode: "date" | "range" | "none" | "pipeline";
    projectedAt: string | null; projectedLow: string | null; projectedHigh: string | null;
    note?: string;
  } | null;
  events?: { createdAt: string }[];
  next?: { title: string; step?: { title: string } | null } | null;
  existingTasks?: number; existingDone?: number;
}

const PACE: Record<string, { label: string; className: string }> = {
  active: { label: "On pace", className: "text-emerald-600" },
  nudge: { label: "Check in", className: "text-amber-600" },
  decaying: { label: "Slipping", className: "text-amber-600" },
  dormant: { label: "Stalled", className: "text-rose-600" },
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

function projection(p: NonNullable<PathSummary["pace"]>) {
  if (p.mode === "pipeline") return "Pipeline";
  if (p.mode === "none" || !p.projectedAt) return "No date yet";
  if (p.mode === "range" && p.projectedLow && p.projectedHigh) return `${day(p.projectedLow)} – ${day(p.projectedHigh)}`;
  return day(p.projectedAt);
}

function Stat({ label, children, sub, testId, hint }: { label: string; children: ReactNode; sub?: ReactNode; testId: string; hint?: string }) {
  const body = (
    <div className="min-w-0 space-y-1" data-testid={testId}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-lg font-semibold leading-tight truncate">{children}</div>
      {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
    </div>
  );
  if (!hint) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild><div className="min-w-0 cursor-default">{body}</div></TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

/** The section's own numbers, from its live path: progress, pace, this week, next. */
export function SectionStats({ projectId, goal }: { projectId: string; goal: ProjectGoal }) {
  const { data, isLoading } = usePath<PathSummary>(projectId, goal);
  const section = sectionDef(goal);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="section-stats">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
      </div>
    );
  }

  if (!data?.adopted) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="section-stats">
        <section.icon className="h-4 w-4" />
        {data?.started === false ? `${section.label} isn't started yet.` : "Not on a path yet — open the dashboard to set it up."}
      </div>
    );
  }

  const main = data.mainLine ?? { done: 0, total: 0 };
  const pct = main.total ? Math.round((main.done / main.total) * 100) : 0;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const thisWeek = (data.events ?? []).filter((e) => new Date(e.createdAt).getTime() >= weekAgo).length;
  const pace = data.pace ? PACE[data.pace.state] ?? PACE.active : null;
  const nextTitle = data.next?.step?.title ?? data.next?.title ?? null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4" data-testid="section-stats">
      <Stat label="Progress" testId="stat-progress" sub={
        <div className="h-1.5 mt-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
      }>
        {main.done}<span className="text-muted-foreground font-normal">/{main.total}</span>
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">milestones</span>
      </Stat>
      <Stat label="Pace" testId="stat-pace" hint={data.pace?.note} sub={data.pace ? projection(data.pace) : undefined}>
        {pace ? <span className={pace.className}>{pace.label}</span> : <span className="text-muted-foreground">—</span>}
      </Stat>
      <Stat label="This week" testId="stat-week" sub={thisWeek === 1 ? "milestone done" : "milestones done"}>
        {thisWeek >= 10 ? "10+" : thisWeek}
      </Stat>
      <Stat label="Next" testId="stat-next" hint={nextTitle ?? undefined} sub={data.next?.step ? data.next.title : undefined}>
        <span className="text-sm font-medium">{nextTitle ?? (main.total ? "Section complete" : "—")}</span>
      </Stat>
    </div>
  );
}
