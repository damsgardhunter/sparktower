import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trophy, Eye, DollarSign, Loader2, ArrowRight, Zap, Users, TrendingUp, Brain, Crown, Filter } from "lucide-react";
import type { Project } from "@shared/schema";
import type { User } from "@shared/models/auth";
import { Link } from "wouter";
import { SkillBadge } from "@/components/skill-badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";

type ProjectWithStats = Project & { owner: User };

function getIndexTier(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Elite", color: "text-amber-400" };
  if (score >= 60) return { label: "Advanced", color: "text-purple-400" };
  if (score >= 40) return { label: "Rising", color: "text-blue-400" };
  if (score >= 20) return { label: "Emerging", color: "text-emerald-400" };
  return { label: "New Builder", color: "text-muted-foreground" };
}

export default function Leaderboard() {
  const [filter, setFilter] = useState<"all" | "solo" | "team">("all");

  const { data: mostVisited, isLoading: loadingVisited } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/leaderboard", "views", filter],
    queryFn: async () => {
      const res = await fetch(`/api/leaderboard?sortBy=views&filter=${filter}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: mostDonations, isLoading: loadingDonations } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/leaderboard", "donations", filter],
    queryFn: async () => {
      const res = await fetch(`/api/leaderboard?sortBy=donations&filter=${filter}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const { data: reputationLeaderboard, isLoading: loadingReputation } = useQuery<any[]>({
    queryKey: ["/api/leaderboard/reputation", filter],
    queryFn: async () => {
      const res = await fetch(`/api/leaderboard/reputation?filter=${filter}&limit=20`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const isLoading = loadingVisited || loadingDonations || loadingReputation;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="leaderboard-loading" />
      </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight" data-testid="text-leaderboard-title">Leaderboard</h1>
            <p className="text-secondary mt-1">
              Top projects and builders making waves in the SparkTower community.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
              <SelectTrigger className="w-[140px]" data-testid="select-leaderboard-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                <SelectItem value="solo">Solo Builds</SelectItem>
                <SelectItem value="team">Team Builds</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs defaultValue="builder" className="space-y-8">
          <TabsList className="grid w-full max-w-[600px] grid-cols-3">
            <TabsTrigger value="builder" data-testid="tab-builder-index">
              <Crown className="h-4 w-4 mr-1.5" /> Builder Index
            </TabsTrigger>
            <TabsTrigger value="visited" data-testid="tab-most-visited">Most Visited</TabsTrigger>
            <TabsTrigger value="donations" data-testid="tab-most-funded">Most Funded</TabsTrigger>
          </TabsList>

          <TabsContent value="builder" className="space-y-8">
            <BuilderIndexRankings users={reputationLeaderboard || []} />
          </TabsContent>

          <TabsContent value="visited" className="space-y-8">
            <ProjectRankings projects={mostVisited || []} metric="views" />
          </TabsContent>

          <TabsContent value="donations" className="space-y-8">
            <ProjectRankings projects={mostDonations || []} metric="donations" />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function BuilderIndexRankings({ users }: { users: any[] }) {
  const topThree = users.slice(0, 3);
  const others = users.slice(3);

  if (users.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Builder Scores Yet</h3>
          <p className="text-muted-foreground">Calculate your Builder Reputation Index from your profile to appear here.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end pt-8">
        {topThree[1] && (
          <div className="order-2 md:order-1">
            <BuilderPodiumCard user={topThree[1]} rank={2} />
          </div>
        )}
        {topThree[0] && (
          <div className="order-1 md:order-2">
            <BuilderPodiumCard user={topThree[0]} rank={1} isWinner />
          </div>
        )}
        {topThree[2] && (
          <div className="order-3 md:order-3">
            <BuilderPodiumCard user={topThree[2]} rank={3} />
          </div>
        )}
      </div>

      {others.length > 0 && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {others.map((entry, index) => {
                const tier = getIndexTier(entry.builderIndex);
                return (
                  <div
                    key={entry.userId}
                    className="flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors"
                    data-testid={`row-builder-${index + 4}`}
                  >
                    <div className="w-8 text-center font-bold text-tertiary">
                      {index + 4}
                    </div>
                    <UserAvatar user={entry.user} size="sm" />
                    <div className="flex-1 min-w-0">
                      <Link href={`/profile/${entry.userId}`} className="font-semibold hover:underline block truncate">
                        {entry.user?.firstName || entry.user?.email || "Unknown"}
                      </Link>
                      <Badge variant="outline" className={`text-[10px] ${tier.color}`}>{tier.label}</Badge>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                      <MiniScoreBar icon={Zap} score={entry.executionScore} color="text-amber-500" />
                      <MiniScoreBar icon={Users} score={entry.contributionScore} color="text-blue-500" />
                      <MiniScoreBar icon={TrendingUp} score={entry.marketSignalScore} color="text-emerald-500" />
                      <MiniScoreBar icon={Brain} score={entry.strategicThinkingScore} color="text-purple-500" />
                    </div>
                    <div className="flex items-center gap-1 font-mono text-lg font-bold whitespace-nowrap min-w-[60px] justify-end text-primary">
                      {entry.builderIndex}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MiniScoreBar({ icon: Icon, score, color }: { icon: any; score: number; color: string }) {
  return (
    <div className="flex items-center gap-1 w-16">
      <Icon className={`h-3 w-3 ${color} flex-shrink-0`} />
      <Progress value={score} className="h-1.5 flex-1" />
    </div>
  );
}

function BuilderPodiumCard({ user, rank, isWinner }: { user: any; rank: number; isWinner?: boolean }) {
  const rankColors = {
    1: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    2: "bg-slate-400/10 text-slate-400 border-slate-400/20",
    3: "bg-amber-600/10 text-amber-600 border-amber-600/20",
  }[rank as 1 | 2 | 3];

  const tier = getIndexTier(user.builderIndex);

  return (
    <Card className={`relative overflow-visible transition-all hover-elevate ${isWinner ? 'border-primary ring-2 ring-primary/20' : ''}`} data-testid={`podium-builder-${rank}`}>
      <div className={`absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full flex items-center justify-center font-bold border ${rankColors} z-10`}>
        {rank}
      </div>
      <CardContent className={`pt-8 text-center flex flex-col items-center ${isWinner ? 'pb-10' : 'pb-6'}`}>
        {isWinner && <Crown className="h-8 w-8 text-yellow-500 mb-3" />}
        <UserAvatar user={user.user} size="lg" />
        <Link href={`/profile/${user.userId}`} className="block mt-3">
          <h3 className="font-bold text-lg line-clamp-1 hover:underline">
            {user.user?.firstName || user.user?.email || "Unknown"}
          </h3>
        </Link>
        <Badge variant="outline" className={`mt-1 text-xs ${tier.color}`}>{tier.label}</Badge>

        <div className="text-4xl font-bold text-primary mt-4 mb-2">{user.builderIndex}</div>
        <p className="text-xs text-muted-foreground mb-4">Builder Index</p>

        <div className="w-full space-y-1.5 px-2 mb-4">
          <div className="flex items-center gap-2">
            <Zap className="h-3 w-3 text-amber-500" />
            <Progress value={user.executionScore} className="h-1.5 flex-1" />
            <span className="text-[10px] w-6 text-right">{user.executionScore}</span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-3 w-3 text-blue-500" />
            <Progress value={user.contributionScore} className="h-1.5 flex-1" />
            <span className="text-[10px] w-6 text-right">{user.contributionScore}</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-3 w-3 text-emerald-500" />
            <Progress value={user.marketSignalScore} className="h-1.5 flex-1" />
            <span className="text-[10px] w-6 text-right">{user.marketSignalScore}</span>
          </div>
          <div className="flex items-center gap-2">
            <Brain className="h-3 w-3 text-purple-500" />
            <Progress value={user.strategicThinkingScore} className="h-1.5 flex-1" />
            <span className="text-[10px] w-6 text-right">{user.strategicThinkingScore}</span>
          </div>
        </div>

        <Link href={`/profile/${user.userId}`} className="w-full">
          <Button variant={isWinner ? "default" : "outline"} className="w-full" data-testid={`btn-view-builder-${rank}`}>
            View Profile <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function ProjectRankings({ projects, metric }: { projects: ProjectWithStats[], metric: 'views' | 'donations' }) {
  const topThree = projects.slice(0, 3);
  const others = projects.slice(3);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end pt-8">
        {topThree[1] && (
          <div className="order-2 md:order-1">
            <PodiumCard project={topThree[1]} rank={2} metric={metric} />
          </div>
        )}
        {topThree[0] && (
          <div className="order-1 md:order-2">
            <PodiumCard project={topThree[0]} rank={1} metric={metric} isWinner />
          </div>
        )}
        {topThree[2] && (
          <div className="order-3 md:order-3">
            <PodiumCard project={topThree[2]} rank={3} metric={metric} />
          </div>
        )}
      </div>

      {others.length > 0 && (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {others.map((project, index) => (
                <div
                  key={project.id}
                  className="flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="w-8 text-center font-bold text-tertiary">
                    {index + 4}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/projects/${project.id}`} className="font-semibold hover:underline block truncate">
                        {project.title}
                      </Link>
                      {(project as any).soloMode && (
                        <Badge variant="outline" className="text-[10px] border-primary/30 text-primary flex-shrink-0">Solo</Badge>
                      )}
                    </div>
                    <p className="text-xs text-secondary">by {project.owner.firstName || project.owner.email}</p>
                  </div>
                  <div className="hidden sm:flex flex-wrap gap-1 max-w-[200px]">
                    {project.rolesNeeded?.slice(0, 2).map((role: string) => (
                      <SkillBadge key={role} skill={role} />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-sm whitespace-nowrap min-w-[100px] justify-end">
                    {metric === 'views' ? (
                      <>
                        <Eye className="h-4 w-4 text-secondary" />
                        {project.views}
                      </>
                    ) : (
                      <>
                        <DollarSign className="h-4 w-4 text-secondary" />
                        {(project.totalDonations / 100).toFixed(0)}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PodiumCard({ project, rank, metric, isWinner }: { project: ProjectWithStats, rank: number, metric: 'views' | 'donations', isWinner?: boolean }) {
  const rankColors = {
    1: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    2: "bg-slate-400/10 text-slate-400 border-slate-400/20",
    3: "bg-amber-600/10 text-amber-600 border-amber-600/20",
  }[rank as 1 | 2 | 3];

  return (
    <Card className={`relative overflow-visible transition-all hover-elevate ${isWinner ? 'border-primary ring-2 ring-primary/20' : ''}`}>
      <div className={`absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full flex items-center justify-center font-bold border ${rankColors} z-10`}>
        {rank}
      </div>
      <CardContent className={`pt-8 text-center flex flex-col items-center ${isWinner ? 'pb-10' : 'pb-6'}`}>
        {isWinner && <Trophy className="h-8 w-8 text-yellow-500 mb-4" />}
        <div className="flex items-center gap-2 justify-center mb-1">
          <Link href={`/projects/${project.id}`} className="block">
            <h3 className="font-bold text-lg line-clamp-1 hover:underline">{project.title}</h3>
          </Link>
          {(project as any).soloMode && (
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Solo</Badge>
          )}
        </div>
        <p className="text-sm text-secondary mb-4">by {project.owner.firstName || project.owner.email}</p>

        <div className="flex items-center gap-2 bg-muted px-3 py-1 rounded-full text-sm font-mono mb-6">
          {metric === 'views' ? (
            <>
              <Eye className="h-4 w-4" />
              {project.views.toLocaleString()} views
            </>
          ) : (
            <>
              <DollarSign className="h-4 w-4" />
              ${(project.totalDonations / 100).toLocaleString()} raised
            </>
          )}
        </div>

        <Link href={`/projects/${project.id}`} className="w-full">
          <Button variant={isWinner ? "default" : "outline"} className="w-full">
            View Project <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
