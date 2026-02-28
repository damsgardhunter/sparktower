import { useQuery } from "@tanstack/react-query";
import { ProjectCard } from "@/components/project-card";
import { UserCard } from "@/components/user-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trophy, Eye, ArrowRight, Plus } from "lucide-react";
import { Link } from "wouter";
import type { Project, UserProfile, User, UserMatch } from "@shared/schema";

type ProjectWithDetails = Project & { owner: User; profile?: UserProfile };
type ProjectWithStats = Project & { owner: User };
type MatchWithDetails = UserMatch & { matchedUser: User; matchedProfile: UserProfile };

export default function Home() {
  const { data: projects, isLoading: projectsLoading } = useQuery<ProjectWithDetails[]>({
    queryKey: ["/api/projects"],
  });

  const { data: leaderboard, isLoading: leaderboardLoading } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/leaderboard?sortBy=views"],
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<MatchWithDetails[]>({
    queryKey: ["/api/matches"],
  });

  const topThree = leaderboard?.slice(0, 3) || [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-12 h-full overflow-y-auto">
      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-3xl font-bold tracking-tight">Recent Projects</h2>
          <Button asChild className="gap-2" data-testid="button-create-project-home">
            <Link href="/projects/new">
              <Plus className="h-4 w-4" />
              Create Project
            </Link>
          </Button>
        </div>
        {projectsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-[280px] w-full rounded-2xl" />
            ))}
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.slice(0, 6).map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-card rounded-2xl border border-card-border">
            <p className="text-secondary">No projects found yet. Be the first to start one!</p>
          </div>
        )}
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-3xl font-bold tracking-tight">Top Projects</h2>
          <Link href="/leaderboard">
            <Button variant="outline" size="sm" data-testid="link-view-leaderboard">
              View Leaderboard <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
        {leaderboardLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-[220px] w-full rounded-2xl" />
            ))}
          </div>
        ) : topThree.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            {topThree[1] && (
              <div className="order-2 md:order-1" data-testid={`podium-card-2`}>
                <HomePodiumCard project={topThree[1]} rank={2} />
              </div>
            )}
            {topThree[0] && (
              <div className="order-1 md:order-2" data-testid={`podium-card-1`}>
                <HomePodiumCard project={topThree[0]} rank={1} isWinner />
              </div>
            )}
            {topThree[2] && (
              <div className="order-3" data-testid={`podium-card-3`}>
                <HomePodiumCard project={topThree[2]} rank={3} />
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12 bg-card rounded-2xl border border-card-border">
            <p className="text-secondary">No projects on the leaderboard yet.</p>
          </div>
        )}
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-3xl font-bold tracking-tight">Recommended Matches</h2>
        </div>
        {matchesLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-[280px] w-full rounded-2xl" />
            ))}
          </div>
        ) : matches && matches.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {matches.slice(0, 3).map((match) => (
              <UserCard
                key={match.id}
                profile={match.matchedProfile}
                userName={(match.matchedUser.firstName || match.matchedUser.email || "Anonymous") as string}
                matchScore={match.score ?? undefined}
                matchReasons={match.reasons ?? undefined}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-card rounded-2xl border border-card-border">
            <p className="text-secondary">No matches found. Make sure your profile is complete!</p>
          </div>
        )}
      </section>
    </div>
  );
}

function HomePodiumCard({ project, rank, isWinner }: { project: ProjectWithStats; rank: number; isWinner?: boolean }) {
  const rankColors = {
    1: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    2: "bg-slate-400/10 text-slate-400 border-slate-400/20",
    3: "bg-amber-600/10 text-amber-600 border-amber-600/20",
  }[rank as 1 | 2 | 3];

  return (
    <Card className={`relative overflow-visible transition-all hover-elevate ${isWinner ? "border-primary ring-2 ring-primary/20" : ""}`}>
      <div className={`absolute -top-4 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full flex items-center justify-center font-bold border ${rankColors} z-10`}>
        {rank}
      </div>
      <CardContent className={`pt-8 text-center flex flex-col items-center ${isWinner ? "pb-10" : "pb-6"}`}>
        {isWinner && <Trophy className="h-8 w-8 text-yellow-500 mb-4" />}
        <Link href={`/projects/${project.id}`}>
          <h3 className="font-bold text-lg line-clamp-1 hover:underline">{project.title}</h3>
        </Link>
        <p className="text-sm text-secondary mb-4">by {project.owner.firstName || project.owner.email}</p>
        <div className="flex items-center gap-2 bg-muted px-3 py-1 rounded-full text-sm font-mono mb-6">
          <Eye className="h-4 w-4" />
          {project.views.toLocaleString()} views
        </div>
        <Link href={`/projects/${project.id}`} className="w-full">
          <Button variant={isWinner ? "default" : "outline"} className="w-full" data-testid={`button-view-project-rank-${rank}`}>
            View Project <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
