import { useQuery } from "@tanstack/react-query";
import { ProjectCard } from "@/components/project-card";
import { UserCard } from "@/components/user-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Project, UserProfile, User, UserMatch } from "@shared/schema";

type ProjectWithDetails = Project & { owner: User; profile?: UserProfile };
type MatchWithDetails = UserMatch & { matchedUser: User; matchedProfile: UserProfile };

export default function Home() {
  const { data: projects, isLoading: projectsLoading } = useQuery<ProjectWithDetails[]>({
    queryKey: ["/api/projects"],
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<MatchWithDetails[]>({
    queryKey: ["/api/matches"],
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-12 h-full overflow-y-auto">
      <section className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-3xl font-bold tracking-tight">Recent Projects</h2>
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
