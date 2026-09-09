import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ACTOR_LABEL, type Actor, type VerificationTier } from "@shared/phase-trees";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Loader2, Sparkles, User, GitBranch } from "lucide-react";

interface PathMilestone {
  id: string; title: string; description: string; actor: Actor; estimateMinutes: number | null;
  tier: VerificationTier; done: boolean; taskId: string | null; taskStatus: string | null;
}
interface PathStatus {
  promise: string; target: string;
  phases: { id: string; title: string; optional: boolean; checkpoint: string | null; total: number; done: number; milestones: PathMilestone[] }[];
  current: { id: string; title: string; step: number; of: number };
  next: PathMilestone | null;
  mainLine: { done: number; total: number };
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

/**
 * The path, as the dashboard shows it: a pace strip, the one next action
 * with who acts on it, and the whole map one click away. Nova's voice
 * carries the narrative; this is the structure it talks about.
 */
export function PathPanel({ projectId, onNavigate }: { projectId: string; onNavigate: (tab: string) => void }) {
  const [showMap, setShowMap] = useState(false);
  const { data, isLoading } = useQuery<PathStatus>({
    queryKey: ["/api/projects", projectId, "path"],
    enabled: !!projectId,
  });
  const markDone = useMutation({
    mutationFn: (taskId: string) => apiRequest("PATCH", `/api/kanban/${taskId}`, { status: "done" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "path"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "nova-briefing"] });
    },
  });

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!data) return null; // Projects made before paths existed have none; nothing to show.

  const { current, next, mainLine } = data;
  const pct = mainLine.total ? Math.round((mainLine.done / mainLine.total) * 100) : 0;
  const novaActs = next && next.actor !== "user-does";

  return (
    <div className="space-y-3" data-testid="path-panel">
      {/* Pace strip: where you are, in the unit the path is authored in. */}
      <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
        <div className="min-w-0">
          <p className="font-medium truncate" data-testid="path-phase">{current.title}</p>
          <p className="text-muted-foreground">
            Step {current.step} of {current.of} · {mainLine.done}/{mainLine.total} on the main line · {data.target}
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

      {/* The one next action. */}
      {next ? (
        <Card className="border-primary/40" data-testid="next-action">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {novaActs ? <Sparkles className="h-3.5 w-3.5 text-primary" /> : <User className="h-3.5 w-3.5" />}
              <span>{ACTOR_LABEL[next.actor]}</span>
              <span>·</span><span>{estimate(next.estimateMinutes)}</span>
              <span>·</span><span>{TIER_LABEL[next.tier]}</span>
            </div>
            <p className="font-semibold leading-snug" data-testid="next-action-title">{next.title}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{next.description}</p>
            <div className="flex gap-2 pt-1 flex-wrap">
              {next.taskId && (
                <Button size="sm" onClick={() => markDone.mutate(next.taskId!)} disabled={markDone.isPending} data-testid="button-next-done">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  {next.tier === "claimed" ? "I did this" : "Done"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onNavigate("kanban")} data-testid="button-next-open">Open in tasks</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card><CardContent className="p-4 text-sm">The path is complete. Nova will make the case for what comes next.</CardContent></Card>
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
                    <span className={m.done ? "text-muted-foreground line-through" : ""}>{m.title}</span>
                    <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{m.actor === "user-does" ? "you" : "Nova"} · {estimate(m.estimateMinutes)}</span>
                  </li>
                ))}
              </ul>
              {phase.checkpoint && <p className="text-xs text-muted-foreground mt-1.5 italic">{phase.checkpoint}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
