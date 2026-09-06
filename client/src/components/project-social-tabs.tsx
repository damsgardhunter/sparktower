import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { SkillBadge } from "@/components/skill-badge";
import { MediaGallery } from "@/components/media-gallery";
import { FeedPostCard, type FeedPostWithDetails } from "@/components/feed-post-card";
import { FeedComposer } from "@/components/feed-composer";
import { ProjectDiscussion, CommentCount } from "@/components/project-discussion";
import { ProjectOverview } from "@/components/project-overview";
import {
  Loader2, LayoutDashboard, Users, Map, Newspaper, Briefcase, Heart,
  Flag, Images, MessagesSquare, CheckCircle2, CircleDot, Circle, Clock,
  Send, ArrowRight, Rocket,
} from "lucide-react";
import { isSectionVisible } from "@shared/project-sections";
import type {
  Project, ProjectMember, ProjectMilestone, ProjectRoadmap, RoadmapPhase,
  User, UserProfile,
} from "@shared/schema";

type MemberWithUser = ProjectMember & { user: User; profile?: UserProfile };

type TabId =
  | "overview" | "updates" | "roadmap" | "milestones" | "team"
  | "roles" | "media" | "discussion" | "followers";

const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "updates", label: "Updates", icon: Newspaper },
  { id: "roadmap", label: "Roadmap", icon: Map },
  { id: "milestones", label: "Milestones", icon: Flag },
  { id: "team", label: "Team", icon: Users },
  { id: "roles", label: "Open Roles", icon: Briefcase },
  { id: "media", label: "Media", icon: Images },
  { id: "discussion", label: "Discussion", icon: MessagesSquare },
  { id: "followers", label: "Followers", icon: Heart },
];

const PHASE_ICON = {
  completed: { icon: CheckCircle2, className: "text-emerald-500" },
  "in-progress": { icon: CircleDot, className: "text-primary" },
  upcoming: { icon: Circle, className: "text-muted-foreground/50" },
} as const;

const MILESTONE_ICON = {
  completed: { icon: CheckCircle2, className: "text-emerald-500" },
  "in-progress": { icon: CircleDot, className: "text-primary" },
  planned: { icon: Circle, className: "text-muted-foreground/50" },
} as const;

/**
 * The project's public social page — a LinkedIn company page crossed with a
 * Kickstarter campaign and a GitHub repo.
 *
 * Every tab is readable by anyone who can see the project, and the milestone
 * and roadmap tabs carry their own discussion threads so progress becomes a
 * conversation rather than a status report.
 */
export function ProjectSocialTabs({
  project, members, isOwner, isMember, followerCount, onApply, onManage,
}: {
  project: Project;
  members: MemberWithUser[];
  isOwner: boolean;
  isMember: boolean;
  followerCount: number;
  onApply: () => void;
  onManage: () => void;
}) {
  const [tab, setTab] = useState<TabId>("overview");

  const { data: commentCounts } = useQuery<Record<string, number>>({
    queryKey: ["/api/projects", project.id, "comment-counts"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${project.id}/comment-counts`, { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
  });

  const { data: milestones, isLoading: milestonesLoading } = useQuery<ProjectMilestone[]>({
    queryKey: ["/api/projects", project.id, "milestones"],
    enabled: tab === "milestones" || tab === "overview",
  });

  const { data: roadmapData, isLoading: roadmapLoading } = useQuery<{
    roadmap: (ProjectRoadmap & { phases: RoadmapPhase[] }) | null;
  }>({
    queryKey: ["/api/projects", project.id, "roadmap"],
    enabled: tab === "roadmap",
  });

  const { data: updates, isLoading: updatesLoading } = useQuery<{ posts: FeedPostWithDetails[] }>({
    queryKey: ["/api/feed", { projectId: project.id }],
    queryFn: async () => {
      const res = await fetch(`/api/feed?projectId=${project.id}&limit=20`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load updates");
      return res.json();
    },
    enabled: tab === "updates" || tab === "overview",
  });

  const { data: followers, isLoading: followersLoading } = useQuery<
    { userId: string; user: User; profile?: UserProfile }[]
  >({
    queryKey: ["/api/projects", project.id, "followers"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${project.id}/followers`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: tab === "followers",
  });

  const totalComments = Object.values(commentCounts || {}).reduce((a, b) => a + b, 0);
  /*
   * A Solo Builder project isn't recruiting, full stop.
   *
   * `rolesNeeded` can still hold values on a solo project — either it was
   * created before Solo Builder Mode existed, or roles were picked before the
   * toggle was flipped. Treating solo as "no open roles" here means the badge,
   * the overview section, and the Apply buttons all fall away together,
   * regardless of what's left in the column.
   */
  const soloMode = !!(project as any).soloMode;
  const openRoles = project.rolesNeeded || [];
  const filledRoles = new Set(members.map((m) => (m.role || "").toLowerCase()));
  const unfilledRoles = soloMode
    ? []
    : openRoles.filter((r) => !filledRoles.has(r.toLowerCase()));

  const tabCount = (id: TabId): number | null => {
    switch (id) {
      case "milestones": return milestones?.length ?? null;
      case "team": return members.length || null;
      case "roles": return unfilledRoles.length || null;
      case "followers": return followerCount || null;
      case "discussion": return totalComments || null;
      case "updates": return updates?.posts?.length ?? null;
      case "media": return project.mediaUrls?.length || null;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Wrapping tab bar so every section stays reachable on any width. */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-3">
        {TABS.map((t) => {
          const count = tabCount(t.id);
          return (
            <Button
              key={t.id}
              variant={tab === t.id ? "default" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setTab(t.id)}
              data-testid={`project-tab-${t.id}`}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
              {count !== null && count > 0 && (
                <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">{count}</Badge>
              )}
            </Button>
          );
        })}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <ProjectOverview project={project} isOwner={isOwner} onManage={onManage} />

          {isSectionVisible(project, "rolesNeeded") && unfilledRoles.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Open Roles</h2>
                {!isMember && !isOwner && (
                  <Button size="sm" className="gap-1.5" onClick={onApply} data-testid="button-overview-apply">
                    <Send className="h-3.5 w-3.5" /> Apply
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {unfilledRoles.map((r) => <SkillBadge key={r} skill={r} variant="outline" />)}
              </div>
            </section>
          )}

          {(updates?.posts?.length || 0) > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Latest updates</h2>
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => setTab("updates")}>
                  See all <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
              {updates!.posts.slice(0, 2).map((p) => <FeedPostCard key={p.id} post={p} />)}
            </section>
          )}
        </div>
      )}

      {tab === "updates" && (
        <div className="space-y-4">
          {isMember && <FeedComposer defaultProjectId={project.id} />}
          {updatesLoading ? (
            <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
          ) : !updates?.posts?.length ? (
            <Card className="border-dashed bg-transparent">
              <CardContent className="py-10 text-center space-y-2">
                <Newspaper className="h-8 w-8 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  {isMember ? "No updates yet. Share what you're building." : "No updates yet."}
                </p>
              </CardContent>
            </Card>
          ) : (
            updates.posts.map((p) => <FeedPostCard key={p.id} post={p} />)
          )}
        </div>
      )}

      {tab === "roadmap" && (
        <div className="space-y-4">
          {roadmapLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : !roadmapData?.roadmap ? (
            <Card className="border-dashed bg-transparent">
              <CardContent className="py-10 text-center space-y-2">
                <Map className="h-8 w-8 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No public roadmap yet.</p>
                {isOwner && (
                  <Button size="sm" variant="outline" onClick={onManage}>Build one</Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="p-5 space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The goal</p>
                  <p className="text-lg font-semibold leading-snug">{roadmapData.roadmap.goal}</p>
                  {roadmapData.roadmap.summary && (
                    <p className="text-sm text-secondary leading-relaxed">{roadmapData.roadmap.summary}</p>
                  )}
                </CardContent>
              </Card>

              {roadmapData.roadmap.phases.map((phase, i) => {
                const s = PHASE_ICON[phase.status as keyof typeof PHASE_ICON] || PHASE_ICON.upcoming;
                const Icon = s.icon;
                const count = commentCounts?.[`roadmap_phase:${phase.id}`] || 0;
                return (
                  <Card key={phase.id} data-testid={`public-phase-${i}`}>
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${s.className}`} />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold">{phase.title}</h3>
                            {phase.estimatedDuration && (
                              <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                                <Clock className="h-2.5 w-2.5" /> {phase.estimatedDuration}
                              </Badge>
                            )}
                            <CommentCount count={count} />
                          </div>
                          {phase.description && (
                            <p className="text-sm text-secondary leading-relaxed">{phase.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="pt-2 border-t border-border/40">
                        <ProjectDiscussion
                          projectId={project.id}
                          targetType="roadmap_phase"
                          targetId={phase.id}
                          compact={count === 0}
                        />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      )}

      {tab === "milestones" && (
        <div className="space-y-3">
          {milestonesLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : !milestones?.length ? (
            <Card className="border-dashed bg-transparent">
              <CardContent className="py-10 text-center space-y-2">
                <Flag className="h-8 w-8 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No milestones yet.</p>
              </CardContent>
            </Card>
          ) : (
            milestones.map((m, i) => {
              const s = MILESTONE_ICON[m.status as keyof typeof MILESTONE_ICON] || MILESTONE_ICON.planned;
              const Icon = s.icon;
              const count = commentCounts?.[`milestone:${m.id}`] || 0;
              return (
                <Card key={m.id} data-testid={`public-milestone-${i}`}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start gap-3">
                      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${s.className}`} />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{m.title}</h3>
                          <Badge variant="outline" className="text-[10px] font-normal capitalize">
                            {m.status}
                          </Badge>
                          <CommentCount count={count} />
                        </div>
                        {m.description && (
                          <p className="text-sm text-secondary leading-relaxed">{m.description}</p>
                        )}
                        {m.targetDate && (
                          <p className="text-xs text-muted-foreground">
                            Target {new Date(m.targetDate).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Anyone can congratulate or offer help — this is the
                        "building in public" part. */}
                    <div className="pt-2 border-t border-border/40">
                      <ProjectDiscussion
                        projectId={project.id}
                        targetType="milestone"
                        targetId={m.id}
                        compact={count === 0}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {tab === "team" && (
        <div className="space-y-3">
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members listed yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {members.map((m) => {
                const name = m.profile?.displayName || m.user?.firstName || m.user?.email || "Member";
                return (
                  <Card key={m.id} data-testid={`team-member-${m.userId}`}>
                    <CardContent className="p-4 flex items-center gap-3">
                      <Link href={`/profile/${m.userId}`}>
                        <UserAvatar src={m.profile?.avatarUrl} name={name} className="h-11 w-11 shrink-0" />
                      </Link>
                      <div className="min-w-0">
                        <Link href={`/profile/${m.userId}`} className="font-medium text-sm hover:underline block truncate">
                          {name}
                        </Link>
                        <p className="text-xs text-muted-foreground capitalize">{m.role}</p>
                        {m.profile?.headline && (
                          <p className="text-xs text-muted-foreground truncate">{m.profile.headline}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "roles" && (
        <div className="space-y-4">
          {unfilledRoles.length === 0 ? (
            <Card className="border-dashed bg-transparent">
              <CardContent className="py-10 text-center space-y-2">
                {soloMode ? (
                  <>
                    <Rocket className="h-8 w-8 mx-auto text-primary/40" />
                    <p className="text-sm font-medium">Solo Builder project</p>
                    <p className="text-sm text-muted-foreground">
                      The owner is building this one solo and isn't recruiting teammates.
                    </p>
                  </>
                ) : (
                  <>
                    <Briefcase className="h-8 w-8 mx-auto text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      {openRoles.length > 0 ? "Every role is filled." : "No open roles listed."}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {unfilledRoles.length} role{unfilledRoles.length === 1 ? "" : "s"} still open on this project.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {unfilledRoles.map((role) => (
                  <Card key={role} data-testid={`open-role-${role}`}>
                    <CardContent className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm">{role}</p>
                        <p className="text-xs text-muted-foreground">
                          {project.estimatedWeeks ? `~${project.estimatedWeeks} week project` : "Open-ended"}
                        </p>
                      </div>
                      {!isMember && !isOwner && (
                        <Button size="sm" variant="outline" className="shrink-0" onClick={onApply} data-testid={`button-apply-${role}`}>
                          Apply
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "media" && (
        <MediaGallery projectId={project.id} mediaUrls={project.mediaUrls || []} isOwner={isOwner} />
      )}

      {tab === "discussion" && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="space-y-1">
              <h2 className="font-semibold">Project discussion</h2>
              <p className="text-sm text-muted-foreground">
                Ask questions, offer help, or share what you'd want from this.
              </p>
            </div>
            <ProjectDiscussion projectId={project.id} targetType="project" targetId={project.id} />
          </CardContent>
        </Card>
      )}

      {tab === "followers" && (
        <div className="space-y-3">
          {followersLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : !followers?.length ? (
            <Card className="border-dashed bg-transparent">
              <CardContent className="py-10 text-center space-y-2">
                <Heart className="h-8 w-8 mx-auto text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No followers yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {followers.map((f) => {
                const name = f.profile?.displayName || f.user?.firstName || "Someone";
                return (
                  <Card key={f.userId} data-testid={`follower-${f.userId}`}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <Link href={`/profile/${f.userId}`}>
                        <UserAvatar src={f.profile?.avatarUrl} name={name} className="h-9 w-9 shrink-0" />
                      </Link>
                      <div className="min-w-0">
                        <Link href={`/profile/${f.userId}`} className="text-sm font-medium hover:underline block truncate">
                          {name}
                        </Link>
                        {f.profile?.headline && (
                          <p className="text-xs text-muted-foreground truncate">{f.profile.headline}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
