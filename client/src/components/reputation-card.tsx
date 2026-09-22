import { errorText } from "@/lib/api-error";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, RefreshCw, Zap, Users, TrendingUp, Brain, Trophy, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ReputationCardProps {
  userId: string;
  isOwnProfile?: boolean;
}

const SCORE_CONFIG = [
  {
    key: "executionScore" as const,
    label: "Execution",
    icon: Zap,
    color: "text-amber-500",
    bgColor: "bg-amber-500",
    tooltip: "Milestones and tasks you have actually finished, whether they landed by their date, how many weeks running you have shipped something, and how far your projects have got.",
  },
  {
    key: "contributionScore" as const,
    label: "Contribution",
    icon: Users,
    color: "text-blue-500",
    bgColor: "bg-blue-500",
    tooltip: "Work you have finished on other people's projects, how many of them, feedback you have given and whether people found it useful, and the updates you post about your own.",
  },
  {
    key: "marketSignalScore" as const,
    label: "Market Signal",
    icon: TrendingUp,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500",
    tooltip: "Money pledged to your projects, the people backing and following them, and traction you can point at outside the platform.",
  },
  {
    key: "strategicThinkingScore" as const,
    label: "Strategy",
    icon: Brain,
    color: "text-purple-500",
    bgColor: "bg-purple-500",
    tooltip: "How your companies do in the market simulation, and Nova's weekly read of the decisions you are making. Contests count too.",
  },
];

function getIndexTier(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Elite", color: "text-amber-400 border-amber-400" };
  if (score >= 60) return { label: "Advanced", color: "text-purple-400 border-purple-400" };
  if (score >= 40) return { label: "Rising", color: "text-blue-400 border-blue-400" };
  if (score >= 20) return { label: "Emerging", color: "text-emerald-400 border-emerald-400" };
  return { label: "New Builder", color: "text-muted-foreground border-muted-foreground" };
}

/** "3rd", for a finishing position. */
function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** Roughly how long ago, which is all this line needs to say. */
function timeAgo(at: string | Date): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export function ReputationCard({ userId, isOwnProfile }: ReputationCardProps) {
  const { toast } = useToast();

  const { data: reputation, isLoading } = useQuery<any>({
    queryKey: ["/api/reputation", userId],
    queryFn: async () => {
      const res = await fetch(`/api/reputation/${userId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch reputation");
      return res.json();
    },
  });

  const calculateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reputation/calculate");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reputation", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard/reputation"] });
      toast({ title: "Up to date", description: "Your Builder Index has been worked out again." });
    },
    onError: (error: any) => {
      toast({ title: "Calculation Failed", description: errorText(error, "Could not calculate reputation"), variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card data-testid="reputation-card-loading">
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const builderIndex = reputation?.builderIndex ?? 0;
  const tier = getIndexTier(builderIndex);
  const strategy = (reputation?.details?.strategy ?? {}) as any;

  return (
    <Card data-testid="reputation-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Builder Reputation Index
          </CardTitle>
          {/*
            * No "Recalculate" any more: the index is rebuilt on the hour for
            * everybody, so a button that asked people to keep their own score
            * current was asking them to do the server's job — and until they
            * did, their profile, the leaderboard and co-founder matching all
            * read a number that had quietly stopped being true. What's left is
            * a nudge for "I just finished something", and it costs nothing.
            */}
          {isOwnProfile && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Bring it up to date now"
              aria-label="Bring it up to date now"
              onClick={() => calculateMutation.mutate()}
              disabled={calculateMutation.isPending}
              data-testid="btn-calculate-reputation"
            >
              {calculateMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 flex items-center justify-center rounded-full border-2 border-primary/20 bg-primary/5">
            <span className="text-3xl font-bold text-primary" data-testid="text-builder-index">{builderIndex}</span>
          </div>
          <div>
            <Badge variant="outline" className={`text-sm font-medium ${tier.color}`} data-testid="badge-tier">
              {tier.label}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">out of 100</p>
          </div>
        </div>

        <TooltipProvider>
          <div className="space-y-3">
            {SCORE_CONFIG.map((cfg) => {
              const score = reputation?.[cfg.key] ?? 0;
              const Icon = cfg.icon;
              return (
                <div key={cfg.key} data-testid={`score-${cfg.key}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${cfg.color}`} />
                      <span className="text-sm font-medium">{cfg.label}</span>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-[250px]">
                          <p className="text-xs">{cfg.tooltip}</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span className="text-sm font-medium">{score}</span>
                  </div>
                  <Progress value={score} className="h-2" />
                </div>
              );
            })}
          </div>
        </TooltipProvider>

        {/* What the simulation and Nova made of them, under the pillar they feed. */}
        {(strategy?.seasonsPlayed > 0 || strategy?.aiSummary) && (
          <div className="rounded-lg border border-border/60 p-3 space-y-1.5" data-testid="strategy-detail">
            {strategy?.seasonsPlayed > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Simulation:</span>{" "}
                {strategy.seasonsPlayed} season{strategy.seasonsPlayed === 1 ? "" : "s"} played
                {typeof strategy.bestFinish === "number" && `, best finish ${ordinal(strategy.bestFinish)}`}
                {typeof strategy.simScore === "number" && ` · ${strategy.simScore}/100`}
              </p>
            )}
            {strategy?.aiSummary && (
              <p className="text-xs text-muted-foreground" data-testid="text-ai-summary">
                <span className="font-medium text-foreground">Nova:</span> {strategy.aiSummary}
              </p>
            )}
          </div>
        )}

        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground" data-testid="text-last-calculated">
            {reputation?.lastCalculatedAt
              ? `Updated ${timeAgo(reputation.lastCalculatedAt)} · rebuilt every hour`
              : "Worked out on the hour — nothing to show yet"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
