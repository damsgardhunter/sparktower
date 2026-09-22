import { PinnedBadges } from "@/components/pinned-badges";
import { useQuery } from "@tanstack/react-query";
import { PrivateBadge } from "@/components/private-badge";
import { FounderFeed } from "@/components/founder-feed";
import { ContinuePathCard } from "@/components/continue-path-card";
import { useSurfaces } from "@/hooks/use-surfaces";
import { ProfileRailCard } from "@/components/profile-rail-card";
import { MyProjectsCard } from "@/components/my-projects-card";
import { RailCard, RailHeader, RailDivider } from "@/components/rail-card";
import { UserAvatar } from "@/components/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Eye, Plus, Trophy, UserPlus, Sparkles, Users2 } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
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
 *
 * The surface is `.home-modern` (see index.css), not the `.sharp-boxes` this
 * page used to carry. Sharp boxes are the LinkedIn look — 2px corners, no
 * depth — and the page reads as a directory. Soft corners, a little elevation
 * and rows that answer the pointer are what a feed people read on a phone
 * looks like now. The structure underneath is unchanged: same modules, same
 * order, same test ids.
 */
export default function Home() {
  const { user } = useAuth();

  const { data: projects, isLoading: projectsLoading } = useQuery<ProjectWithDetails[]>({
    queryKey: ["/api/projects"],
  });

  // The leaderboard and matches wait until the path loops are proven: shown, and fetched, only while their flags are on.
  const { on: surfaceOn } = useSurfaces();
  const { data: leaderboard, isLoading: leaderboardLoading } = useQuery<ProjectWithStats[]>({
    queryKey: ["/api/leaderboard?sortBy=views"],
    enabled: surfaceOn("leaderboard"),
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<MatchWithDetails[]>({
    queryKey: ["/api/matches"],
    enabled: surfaceOn("matches"),
  });

  const firstName = user?.firstName?.trim();

  return (
    <div className="home-modern h-full overflow-y-auto bg-muted dark:bg-background">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6 py-5 sm:py-7">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-5 lg:gap-6 items-start">
          {/* --- The feed --- */}
          <div className="min-w-0 space-y-3">
            {/*
              * The greeting and the one action that matters, on a single line.
              *
              * Sticky and blurred: on a long feed the way back to "start
              * something" shouldn't be a scroll to the top. It replaces a
              * full-width button that cost a whole row and said only "Create
              * Project" — the same entry point, with the page's one piece of
              * personality attached to it.
              */}
            <div className="home-sticky sticky top-0 z-20 -mx-1 px-1 py-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-[17px] sm:text-[19px] font-semibold tracking-[-0.01em] truncate">
                  {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
                </h1>
                <p className="text-xs text-muted-foreground truncate">
                  Pick up where you left off.
                </p>
              </div>
              <Button
                asChild
                size="sm"
                className="btn-glossy h-10 gap-1.5 px-4 text-[14px] font-semibold text-primary-foreground border-0 shrink-0 rounded-full"
                data-testid="button-create-project-home"
              >
                <Link href="/projects/new">
                  <Plus className="h-4 w-4" />
                  Create
                  <span className="sr-only"> project</span>
                </Link>
              </Button>
            </div>

            {/*
              * The path first, then everybody else's.
              *
              * This screen used to open on the feed with the paths folded into
              * a dropdown below "Create" — so somebody with a project in
              * flight was shown other people's work and left to go looking for
              * their own. The product's loop is come back, take the next step;
              * the page now opens on it, and the feed is what you read after.
              */}
            <ContinuePathCard lead />

            <div className="flex items-center gap-2 px-0.5 pt-1" data-testid="home-feed-heading">
              <Users2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-[15px] font-semibold">What people are building</h2>
            </div>
            <FounderFeed />
          </div>

          {/*
            * --- The rail. Sticky, so it stays with you down a long feed. ---
            * It's taller than the screen, and a sticky block can't scroll on its
            * own: scrolling over it moved the feed, and the bottom of the rail
            * was only reachable at the end of the feed. Capped to the viewport
            * and given its own scroll, the pointer's side is the side that moves.
            */}
          <aside
            className="space-y-3 lg:sticky lg:top-5 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pr-1 home-rail-scroll"
            data-testid="home-rail"
          >
            {/* Who you are leads the rail, then what you're building; the network cards follow, each behind its flag. */}
            <div className="home-rise" style={{ "--home-i": 0 } as React.CSSProperties}>
              <ProfileRailCard />
            </div>
            <div className="home-rise" style={{ "--home-i": 1 } as React.CSSProperties}>
              <MyProjectsCard />
            </div>

            <RailCard className="home-card home-card-interactive home-rise" style={{ "--home-i": 2 } as React.CSSProperties}>
              <RailHeader title="New projects" href="/discover" />
              {projectsLoading ? (
                <div className="space-y-2 pt-1">
                  {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}
                </div>
              ) : projects && projects.length > 0 ? (
                <div className="pt-0.5 space-y-0.5">
                  {projects.slice(0, 5).map((project) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="home-row flex items-center gap-2.5 px-2 py-2"
                      data-testid={`rail-new-project-${project.id}`}
                    >
                      <UserAvatar
                        src={project.profile?.avatarUrl}
                        name={project.owner?.firstName || project.title}
                        className="h-9 w-9 shrink-0"
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
            {surfaceOn("leaderboard") && (
              <RailCard className="home-card home-card-interactive home-rise" style={{ "--home-i": 3 } as React.CSSProperties}>
                <RailHeader title="Top projects" href="/discover" />
                {leaderboardLoading ? (
                  <div className="space-y-2 pt-1">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-lg" />)}
                  </div>
                ) : leaderboard && leaderboard.length > 0 ? (
                  <div className="pt-0.5 space-y-0.5">
                    {leaderboard.slice(0, 5).map((project, i) => (
                      <Link
                        key={project.id}
                        href={`/projects/${project.id}`}
                        className="home-row flex items-center gap-2.5 px-2 py-2"
                        data-testid={`rail-top-${project.id}`}
                      >
                        <span
                          className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${
                            i === 0
                              ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
                              : i === 1
                                ? "bg-slate-400/20 text-slate-600 dark:text-slate-300"
                                : i === 2
                                  ? "bg-amber-600/15 text-amber-700 dark:text-amber-500"
                                  : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {i === 0 ? <Trophy className="h-3.5 w-3.5" /> : i + 1}
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
            )}

            {surfaceOn("matches") && (
              <RailCard className="home-card home-card-interactive home-rise" style={{ "--home-i": 4 } as React.CSSProperties}>
                <RailHeader title="People to build with" href="/discover" />
                {matchesLoading ? (
                  <div className="space-y-2 pt-1">
                    {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
                  </div>
                ) : matches && matches.length > 0 ? (
                  <div className="pt-0.5 space-y-0.5">
                    {matches.slice(0, 4).map((match) => (
                      // The row opens the person; the badges under their name open their projects, so they sit beside the link, not inside it.
                      <div key={match.id} className="home-row px-2 py-2" data-testid={`rail-match-${match.id}`}>
                        <Link href={`/profile/${match.matchedUser.id}`} className="flex items-center gap-2.5">
                          <span className="home-avatar-ring shrink-0 inline-flex">
                            <UserAvatar
                              src={match.matchedProfile?.avatarUrl}
                              name={match.matchedProfile?.displayName || match.matchedUser.firstName || "Builder"}
                              className="h-9 w-9"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">
                              {match.matchedProfile?.displayName || match.matchedUser.firstName || "A builder"}
                            </span>
                            <span className="block text-xs text-muted-foreground truncate">
                              {match.matchedProfile?.headline || "Builder on SparkTower"}
                            </span>
                          </span>
                          {match.score !== null && match.score !== undefined && (
                            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
                              {match.score}%
                            </span>
                          )}
                        </Link>
                        <PinnedBadges userId={match.matchedUser.id} size="xs" max={5} className="pl-[46px] mt-1" />
                      </div>
                    ))}
                    <RailDivider />
                    <Link
                      href="/discover"
                      className="home-row flex items-center justify-center gap-1.5 text-xs font-medium text-primary py-1.5"
                      data-testid="rail-see-matches"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Find more collaborators
                    </Link>
                  </div>
                ) : (
                  /*
                   * Matches come from your profile, so the empty state is a
                   * link to the thing that fixes it rather than a sentence
                   * telling you to go find it.
                   */
                  <div className="pt-1 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      No matches yet — completing your profile is what makes these good.
                    </p>
                    <Button asChild variant="outline" size="sm" className="w-full gap-1.5 rounded-full h-8 text-xs">
                      <Link href="/profile">
                        <Sparkles className="h-3.5 w-3.5" /> Complete your profile
                      </Link>
                    </Button>
                  </div>
                )}
              </RailCard>
            )}

            <p className="text-[11px] text-muted-foreground text-center pt-1 pb-4">
              SparkTower · built for people who ship
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
