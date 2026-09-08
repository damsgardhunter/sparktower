import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { useEntitlements } from "@/hooks/use-entitlements";
import { useRequestNovaHandoff } from "@/components/nova-handoff";
import { novaHandoffTab, type NovaHandoff } from "@shared/nova-handoff";
import {
  Loader2, Sparkles, ArrowRight, CheckCircle2, Circle, AlertTriangle,
  Users, ListChecks, Flag, Map, ChevronDown, ChevronUp,
} from "lucide-react";

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
  stats: {
    phases: number;
    completedPhases: number;
    milestones: number;
    tasks: number;
    doneTasks: number;
    openTasks: number;
    members: number;
    teamSize: number | null;
    roadmapUpdatedDaysAgo: number | null;
  };
  project: { id: string; title: string };
}

/** "Good morning" / "Good afternoon" / "Good evening" by local time. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const SEVERITY_ACCENT: Record<string, string> = {
  critical: "border-l-rose-500",
  important: "border-l-amber-500",
  suggested: "border-l-primary/50",
};

/**
 * The landing screen when an owner opens Manage.
 *
 * The briefing itself is free — completion and recommendations are computed
 * from real project state, not an AI call. Only the action on each
 * recommendation costs credits, and every one shows its price on the button.
 *
 * Acting on a recommendation always takes you to the tab that owns the work,
 * and hands the job to that tab to run. See shared/nova-handoff.ts.
 */
export function NovaDashboard({
  projectId, onNavigate,
}: {
  projectId: string;
  onNavigate: (tab: string) => void;
}) {
  const { user } = useAuth();
  const { creditsRemaining, isUnlimited } = useEntitlements();
  const requestHandoff = useRequestNovaHandoff();
  const [showBreakdown, setShowBreakdown] = useState(false);

  const { data, isLoading } = useQuery<Briefing>({
    queryKey: ["/api/projects", projectId, "nova-briefing"],
    enabled: !!projectId,
  });

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!data) return null;

  const firstName = user?.firstName || "there";
  const { stats } = data;

  return (
    <div className="space-y-6 max-w-3xl mx-auto" data-testid="nova-dashboard">
      {/* Greeting + completion */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-greeting">
            {greeting()}, {firstName}
          </h1>
          <p className="text-lg text-secondary" data-testid="text-completion">
            Your project is <span className="font-semibold text-foreground">{data.completion}% complete</span>
          </p>
        </div>

        <div className="space-y-2">
          <Progress value={data.completion} className="h-2" data-testid="progress-completion" />
          <button
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            onClick={() => setShowBreakdown(!showBreakdown)}
            data-testid="button-toggle-breakdown"
          >
            {showBreakdown ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showBreakdown ? "Hide" : "What's counted"}
          </button>
          {showBreakdown && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1" data-testid="completion-breakdown">
              {data.breakdown.map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-sm">
                  {item.done
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                  <span className={item.done ? "" : "text-muted-foreground"}>{item.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* At-a-glance numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { icon: Map, label: "Phases done", value: `${stats.completedPhases}/${stats.phases}`, tab: "roadmap" },
          { icon: Flag, label: "Milestones", value: String(stats.milestones), tab: "milestones" },
          { icon: ListChecks, label: "Tasks done", value: `${stats.doneTasks}/${stats.tasks}`, tab: "kanban" },
          { icon: Users, label: "Team", value: `${stats.members}/${stats.teamSize ?? "?"}`, tab: "team" },
        ].map(({ icon: Icon, label, value, tab }) => (
          <button
            key={label}
            onClick={() => onNavigate(tab)}
            className="text-left rounded-lg border border-border/60 p-3 hover:border-primary/40 transition-colors"
            data-testid={`stat-${tab}`}
          >
            <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
              <Icon className="h-3.5 w-3.5" />
              <span className="text-[11px]">{label}</span>
            </div>
            <p className="text-lg font-semibold">{value}</p>
          </button>
        ))}
      </div>

      {/* Nova's recommendations */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Nova recommends:</h2>
          {data.totalRecommendations > data.recommendations.length && (
            <Badge variant="secondary" className="text-[10px]">
              +{data.totalRecommendations - data.recommendations.length} more
            </Badge>
          )}
        </div>

        {data.recommendations.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center space-y-2">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
              <p className="font-medium">Nothing needs your attention</p>
              <p className="text-sm text-muted-foreground">
                Your brief, roadmap, tasks and team are all in good shape. Keep shipping.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5">
            {data.recommendations.map((rec, i) => {
              const cantAfford = !isUnlimited && rec.credits > 0 && creditsRemaining < rec.credits;
              const destination = rec.action ? novaHandoffTab(rec.action) : rec.tab;
              return (
                <Card
                  key={rec.id}
                  className={`border-l-4 ${SEVERITY_ACCENT[rec.severity]}`}
                  data-testid={`recommendation-${rec.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
                      <div className="flex items-start gap-3 min-w-0">
                        <span className="text-sm font-semibold text-muted-foreground shrink-0 mt-0.5">
                          {i + 1}.
                        </span>
                        <div className="min-w-0 space-y-1">
                          <p className="font-medium leading-snug" data-testid={`rec-title-${rec.id}`}>
                            {rec.title}
                          </p>
                          {rec.detail && (
                            <p className="text-sm text-muted-foreground leading-relaxed">{rec.detail}</p>
                          )}
                          {cantAfford && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Needs {rec.credits} credits, you have {creditsRemaining}
                            </p>
                          )}
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant={rec.severity === "critical" ? "default" : "outline"}
                        className="gap-1.5 shrink-0 w-full sm:w-auto"
                        disabled={cantAfford || !destination}
                        onClick={() => {
                          // Always land on the tab the work happens in, and let
                          // that tab run it. Running it here left the builder on
                          // the dashboard while their credits were spent on a
                          // result they had to go hunting for.
                          if (rec.action) requestHandoff(rec.action);
                          if (destination) onNavigate(destination);
                        }}
                        data-testid={`rec-action-${rec.id}`}
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                        {rec.actionLabel}
                        {rec.credits > 0 && (
                          <Badge variant="secondary" className="ml-0.5 text-[10px] px-1.5">
                            {rec.credits}
                          </Badge>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Recommendations are free — you only spend credits when you run one.
        </p>
      </div>
    </div>
  );
}
