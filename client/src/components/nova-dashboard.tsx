import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useRequestNovaHandoff } from "@/components/nova-handoff";
import { PathPanel } from "@/components/path-panel";
import { Block } from "@/components/section/block";
import { useSections } from "@/lib/sections";
import { novaHandoffTab, type NovaHandoff } from "@shared/nova-handoff";
import type { ProjectGoal } from "@shared/goals";
import { ArrowRight, CheckCircle2, Circle, ChevronDown, ChevronUp, Lightbulb } from "lucide-react";

interface Recommendation {
  id: string;
  title: string;
  detail?: string;
  actionLabel: string;
  credits: number;
  tab?: string;
  /** The job the destination tab picks up on arrival, if there is one. */
  action?: NovaHandoff;
  severity: "critical" | "important" | "suggested";
}

interface Briefing {
  completion: number;
  breakdown: { label: string; done: boolean; weight: number }[];
  recommendations: Recommendation[];
  totalRecommendations: number;
  project: { id: string; title: string };
}

const SEVERITY_DOT: Record<string, string> = {
  critical: "bg-rose-500",
  important: "bg-amber-500",
  suggested: "bg-primary/50",
};

/**
 * A section's dashboard — Ship, Systemize or Raise — on its own path.
 *
 * It leads with the one next step, so there is never a question of where to
 * start; progress, the section's own block, the codebase link, activity and
 * the whole path follow, each between thin rules. Everything reads the
 * section's live path, so work done on the board, in an audit or from the
 * editor shows up without a reload.
 *
 * The project-wide briefing (setup completeness and Nova's suggestions) sits
 * last, on the primary section only: it is about the project, not the path.
 */
export function NovaDashboard({
  projectId, goal, onNavigate, onStartSection,
}: {
  projectId: string;
  goal: ProjectGoal;
  onNavigate: (tab: string) => void;
  onStartSection?: () => void;
}) {
  const { data: sections } = useSections(projectId);
  const isPrimary = sections ? sections.primary === goal : false;

  return (
    <div className="max-w-3xl mx-auto" data-testid="nova-dashboard">
      <PathPanel projectId={projectId} goal={goal} onNavigate={onNavigate} onStartSection={onStartSection} isPrimary={isPrimary} />
      {isPrimary && <ProjectBriefing projectId={projectId} onNavigate={onNavigate} />}
    </div>
  );
}

/**
 * Nova's project-wide suggestions, as a short list. The briefing is free —
 * computed from real project state; only acting on one costs credits, and the
 * button shows the price. Acting always lands on the tab that owns the work.
 */
function ProjectBriefing({ projectId, onNavigate }: { projectId: string; onNavigate: (tab: string) => void }) {
  const { creditsRemaining, isUnlimited } = useEntitlements();
  const requestHandoff = useRequestNovaHandoff();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { data } = useQuery<Briefing>({ queryKey: ["/api/projects", projectId, "nova-briefing"], enabled: !!projectId });
  if (!data) return null;
  const recs = showAll ? data.recommendations : data.recommendations.slice(0, 3);

  return (
    <div className="border-t border-border mt-6 pt-6">
      <Block
        title="Project setup"
        icon={Lightbulb}
        testid="project-briefing"
        right={
          <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => setShowBreakdown(!showBreakdown)} data-testid="button-toggle-breakdown">
            <span className="font-semibold text-foreground tabular-nums" data-testid="text-completion">{data.completion}%</span>
            {showBreakdown ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        }
      >
        {showBreakdown && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" data-testid="completion-breakdown">
            {data.breakdown.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-sm">
                {item.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                <span className={item.done ? "" : "text-muted-foreground"}>{item.label}</span>
              </div>
            ))}
          </div>
        )}

        {data.recommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />All set.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {recs.map((rec) => {
              const cantAfford = !isUnlimited && rec.credits > 0 && creditsRemaining < rec.credits;
              const destination = rec.action ? novaHandoffTab(rec.action) : rec.tab;
              return (
                <li key={rec.id} className="flex items-center gap-3 px-3 py-2.5" data-testid={`recommendation-${rec.id}`}>
                  <span className={`h-2 w-2 rounded-full shrink-0 ${SEVERITY_DOT[rec.severity]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" title={rec.detail} data-testid={`rec-title-${rec.id}`}>{rec.title}</p>
                    {cantAfford && <p className="text-[11px] text-destructive">Needs {rec.credits} credits</p>}
                  </div>
                  <Button
                    size="sm"
                    variant={rec.severity === "critical" ? "default" : "ghost"}
                    className="h-7 gap-1 shrink-0 text-xs"
                    disabled={cantAfford || !destination}
                    onClick={() => {
                      if (rec.action) requestHandoff(rec.action);
                      if (destination) onNavigate(destination);
                    }}
                    data-testid={`rec-action-${rec.id}`}
                  >
                    {rec.actionLabel}
                    {rec.credits > 0 && <Badge variant="secondary" className="text-[10px] px-1.5">{rec.credits}</Badge>}
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {data.recommendations.length > 3 && (
          <button className="text-xs text-primary hover:underline" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show less" : `+${data.recommendations.length - 3} more`}
          </button>
        )}
      </Block>
    </div>
  );
}
