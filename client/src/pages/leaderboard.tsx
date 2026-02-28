import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Eye, DollarSign, Loader2, ArrowRight } from "lucide-react";
import type { Project } from "@shared/schema";
import type { User } from "@shared/models/auth";
import { Link } from "wouter";
import { SkillBadge } from "@/components/skill-badge";
import { Button } from "@/components/ui/button";

type ProjectWithStats = Project & { owner: User };

export default function Leaderboard() {
  const { data: mostVisited, isLoading: loadingVisited } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/leaderboard?sortBy=views"],
  });

  const { data: mostDonations, isLoading: loadingDonations } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/leaderboard?sortBy=donations"],
  });

  const isLoading = loadingVisited || loadingDonations;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
          <p className="text-secondary mt-1">
            Top projects making waves in the SparkTower community.
          </p>
        </div>

        <Tabs defaultValue="visited" className="space-y-8">
          <TabsList className="grid w-full max-w-[400px] grid-cols-2">
            <TabsTrigger value="visited">Most Visited</TabsTrigger>
            <TabsTrigger value="donations">Most Funded</TabsTrigger>
          </TabsList>

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

function ProjectRankings({ projects, metric }: { projects: ProjectWithStats[], metric: 'views' | 'donations' }) {
  const topThree = projects.slice(0, 3);
  const others = projects.slice(3);

  return (
    <div className="space-y-8">
      {/* Podium */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end pt-8">
        {/* 2nd Place */}
        {topThree[1] && (
          <div className="order-2 md:order-1">
            <PodiumCard project={topThree[1]} rank={2} metric={metric} />
          </div>
        )}
        {/* 1st Place */}
        {topThree[0] && (
          <div className="order-1 md:order-2">
            <PodiumCard project={topThree[0]} rank={1} metric={metric} isWinner />
          </div>
        )}
        {/* 3rd Place */}
        {topThree[2] && (
          <div className="order-3 md:order-3">
            <PodiumCard project={topThree[2]} rank={3} metric={metric} />
          </div>
        )}
      </div>

      {/* Table for the rest */}
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
                    <Link href={`/projects/${project.id}`} className="font-semibold hover:underline block truncate">
                      {project.title}
                    </Link>
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
        <Link href={`/projects/${project.id}`} className="block">
          <h3 className="font-bold text-lg line-clamp-1 hover:underline">{project.title}</h3>
        </Link>
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
