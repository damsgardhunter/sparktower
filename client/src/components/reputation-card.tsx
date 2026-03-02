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
    tooltip: "Based on milestones completed, deadlines met, sprint consistency, and project completion rate",
  },
  {
    key: "contributionScore" as const,
    label: "Contribution",
    icon: Users,
    color: "text-blue-500",
    bgColor: "bg-blue-500",
    tooltip: "Based on projects involved in, tasks completed, projects followed, and solo build completions",
  },
  {
    key: "marketSignalScore" as const,
    label: "Market Signal",
    icon: TrendingUp,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500",
    tooltip: "Based on donations received, project applications, build log engagement, and external traction",
  },
  {
    key: "strategicThinkingScore" as const,
    label: "Strategic Thinking",
    icon: Brain,
    color: "text-purple-500",
    bgColor: "bg-purple-500",
    tooltip: "Based on contest wins, game scores, and AI evaluation of project strategies",
  },
];

function getIndexTier(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Elite", color: "text-amber-400 border-amber-400" };
  if (score >= 60) return { label: "Advanced", color: "text-purple-400 border-purple-400" };
  if (score >= 40) return { label: "Rising", color: "text-blue-400 border-blue-400" };
  if (score >= 20) return { label: "Emerging", color: "text-emerald-400 border-emerald-400" };
  return { label: "New Builder", color: "text-muted-foreground border-muted-foreground" };
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
      toast({ title: "Reputation Updated", description: "Your Builder Index has been recalculated" });
    },
    onError: (error: any) => {
      toast({ title: "Calculation Failed", description: error.message || "Could not calculate reputation", variant: "destructive" });
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

  return (
    <Card data-testid="reputation-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Builder Reputation Index
          </CardTitle>
          {isOwnProfile && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => calculateMutation.mutate()}
              disabled={calculateMutation.isPending}
              data-testid="btn-calculate-reputation"
            >
              {calculateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
              )}
              {calculateMutation.isPending ? "Calculating..." : "Recalculate"}
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

        {reputation?.details && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              {reputation.lastCalculatedAt
                ? `Last updated: ${new Date(reputation.lastCalculatedAt).toLocaleDateString()}`
                : "Not yet calculated"}
            </p>
          </div>
        )}

        {!reputation?.builderIndex && isOwnProfile && (
          <div className="text-center py-2">
            <p className="text-sm text-muted-foreground mb-2">Calculate your Builder Reputation Index to see your scores</p>
            <Button
              size="sm"
              onClick={() => calculateMutation.mutate()}
              disabled={calculateMutation.isPending}
              data-testid="btn-calculate-first"
            >
              {calculateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Zap className="h-3.5 w-3.5 mr-1" />}
              Calculate Now (1 credit)
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
