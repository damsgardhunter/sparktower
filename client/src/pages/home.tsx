import { useQuery } from "@tanstack/react-query";
import { PrivateBadge } from "@/components/private-badge";
import { FounderFeed } from "@/components/founder-feed";
import { ProfileRailCard } from "@/components/profile-rail-card";
import { MyProjectsCard } from "@/components/my-projects-card";
import { RailCard, RailHeader, RailDivider } from "@/components/rail-card";
import { UserAvatar } from "@/components/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Eye, Plus, Trophy, UserPlus } from "lucide-react";
import { Link } from "wouter";
import type { Project, UserProfile, User, UserMatch } from "@shared/schema";

type ProjectWithDetails = Project & { owner: User; profile?: UserProfile };
type ProjectWithStats = Project & { owner: User };
type MatchWithDetails = UserMatch & { matchedUser: User; matchedProfile: UserProfile };

/**
 * The home page, laid out like a social feed.
 *
 * One scrolling column of posts with a sticky rail beside it, which is the
 * shape every feed product has converged on: the timeline gets the attention
 * and everything else is a compact module you glance at. What used to be three
 * full-width sections stacked under the feed — leaderboard podium, match cards
 * — now live in the rail, so discovery is visible while you read rather than
 * two screens down.
 */
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

  return (
    <div className="h-full overflow-y-auto bg-muted dark:bg-background">
      <div className="mx-auto max-w-[1128px] px-4 py-5">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
          {/* --- The feed --- */}
          <div className="min-w-0 space-y-2">
            {/*
              * Starting a project is what sits at the top of the feed.
              *
              * A check-in button lived here for a while, on the reasoning that
              * the weekly loop is what the page should ask for. It isn't the
              * right trade: this bar is the entry point for the whole product,
              * and someone with nothing to check in on has no use for it. The
              * check-in shortcuts belong on the project cards in the rail,
              * where they sit next to the project they act on.
              *
              * Full-width rather than a heading plus a button, so it doesn't
              * cost a row of vertical space above the composer.
              */}
            <Button
              asChild
              className="btn-glossy w-full h-11 gap-2 text-[15px] font-semibold text-primary-foreground border-0"
              data-testid="button-create-project-home"
            >
              <Link href="/projects/new">
                <Plus className="h-4 w-4" />
                Create Project
              </Link>
            </Button>
            <FounderFeed />
          </div>

          {/* --- The rail. Sticky, so it stays with you down a long feed. --- */}
          <aside className="space-y-2 lg:sticky lg:top-5" data-testid="home-rail">
            <ProfileRailCard />
            <MyProjectsCard />

            <RailCard>
              <RailHeader title="New projects" href="/projects" />
              {projectsLoading ? (
                <div className="space-y-2 pt-1">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
                </div>
              ) : projects && projects.length > 0 ? (
                <div className="pt-0.5">
                  {projects.slice(0, 5).map((project) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="flex items-center gap-2 -mx-3 px-3 py-1.5 hover:bg-accent transition-colors"
                      data-testid={`rail-project-${project.id}`}
                    >
                      <UserAvatar
                        src={project.profile?.avatarUrl}
                        name={project.owner?.firstName || project.title}
                        className="h-8 w-8 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 min-w-0">
                          {project.isPrivate && <PrivateBadge variant="icon" className="shrink-0" />}
                          <span className="text-sm font-medium truncate">{project.title}</span>
                        </span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {project.category} · by {project.owner?.firstName || "a builder"}
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground pt-1">No projects yet. Start the first one.</p>
              )}
            </RailCard>

            {/* The podium, compacted. Ranked rows read faster in a rail than
                three stacked cards did full-width. */}
            <RailCard>
              <RailHeader title="Top projects" href="/leaderboard" />
              {leaderboardLoading ? (
                <div className="space-y-2 pt-1">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full rounded-md" />)}
                </div>
              ) : leaderboard && leaderboard.length > 0 ? (
                <div className="pt-0.5">
                  {leaderboard.slice(0, 5).map((project, i) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="flex items-center gap-2 -mx-3 px-3 py-1.5 hover:bg-accent transition-colors"
                      data-testid={`rail-top-${project.id}`}
                    >
                      <span
                        className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          i === 0
                            ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
                            : i === 1
                              ? "bg-slate-400/20 text-slate-600 dark:text-slate-300"
                              : i === 2
                                ? "bg-amber-600/15 text-amber-700 dark:text-amber-500"
                                : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {i === 0 ? <Trophy className="h-3 w-3" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{project.title}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          by {project.owner?.firstName || project.owner?.email || "a builder"}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1 tabular-nums">
                        <Eye className="h-3 w-3" />{project.views.toLocaleString()}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground pt-1">Nothing on the leaderboard yet.</p>
              )}
            </RailCard>

            <RailCard>
              <RailHeader title="People to build with" href="/matches" />
              {matchesLoading ? (
                <div className="space-y-2 pt-1">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
                </div>
              ) : matches && matches.length > 0 ? (
                <div className="pt-0.5">
                  {matches.slice(0, 4).map((match) => (
                    <Link
                      key={match.id}
                      href={`/profile/${match.matchedUser.id}`}
                      className="flex items-center gap-2 -mx-3 px-3 py-1.5 hover:bg-accent transition-colors"
                      data-testid={`rail-match-${match.id}`}
                    >
                      <UserAvatar
                        src={match.matchedProfile?.avatarUrl}
                        name={match.matchedProfile?.displayName || match.matchedUser.firstName || "Builder"}
                        className="h-8 w-8 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">
                          {match.matchedProfile?.displayName || match.matchedUser.firstName || "A builder"}
                        </span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {match.matchedProfile?.headline || "Builder on SparkTower"}
                        </span>
                      </span>
                      {match.score !== null && match.score !== undefined && (
                        <span className="text-xs font-semibold text-primary shrink-0 tabular-nums">
                          {match.score}%
                        </span>
                      )}
                    </Link>
                  ))}
                  <RailDivider />
                  <Link
                    href="/matches"
                    className="flex items-center justify-center gap-1.5 text-xs text-primary hover:underline py-0.5"
                    data-testid="rail-see-matches"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Find more collaborators
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground pt-1">
                  No matches yet — completing your profile is what makes these good.
                </p>
              )}
            </RailCard>

            <p className="text-[11px] text-muted-foreground text-center pt-1 pb-4">
              SparkTower · built for people who ship
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
