import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { MediaGallery } from "@/components/media-gallery";
import { FeedPostCard, type FeedPostWithDetails } from "@/components/feed-post-card";
import { FeedComposer } from "@/components/feed-composer";
import { FeedbackInbox, useNewFeedbackCount } from "@/components/feedback-inbox";
import { ProjectDiscussion, CommentCount } from "@/components/project-discussion";
import { ProjectOverview } from "@/components/project-overview";
import {
  Loader2, LayoutDashboard, Users, Newspaper, Briefcase, Heart,
  Images, MessagesSquare, ArrowRight,
} from "lucide-react";
import { isSectionVisible } from "@shared/project-sections";
import type { Project, ProjectMember, User, UserProfile } from "@shared/schema";

type MemberWithUser = ProjectMember & { user: User; profile?: UserProfile };

type TabId = "overview" | "updates" | "media" | "discussion" | "followers";

/*
 * Five tabs, not nine.
 *
 * The page used to open with a row reading Overview, Updates 7, Roadmap,
 * Milestones 100, Team 1, Open Roles, Media, Discussion 1, Followers 2 — a
 * navigation bar that published the project's internals to anyone who
 * wandered past. A visitor does not need the hundred milestones; the team
 * does, and the team has the manage page, where the roadmap, the milestones
 * and the team all still are.
 *
 * Open Roles was the one of the four worth keeping in public, because it is
 * the only thing on this page a stranger can act on. It moved into the
 * overview, where somebody is already reading about the project, rather than
 * waiting behind a tab most people never pressed.
 */
const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "updates", label: "Updates", icon: Newspaper },
  { id: "media", label: "Media", icon: Images },
  { id: "discussion", label: "Discussion", icon: MessagesSquare },
  { id: "followers", label: "Followers", icon: Heart },
];



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
  /** Opens the application. The role is the one pressed, if any. */
  onApply: (role?: string) => void;
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

  /** Only a signed-in stranger can apply; the team and the owner cannot. */
  const canApply = !isMember && !isOwner;
  const questionCount = ((project as any).applicationQuestions as unknown[] | null)?.length ?? 0;

  const tabCount = (id: TabId): number | null => {
    switch (id) {
      case "followers": return followerCount || null;
      case "discussion": return totalComments || null;
      case "updates": return updates?.posts?.length ?? null;
      case "media": return project.mediaUrls?.length || null;
      default: return null;
    }
  };

  // The team's count of feedback they haven't read, on the Updates tab where it lives.
  const newFeedback = useNewFeedbackCount(project.id, isMember);

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
              {t.id === "updates" && newFeedback > 0 && (
                <Badge className="ml-0.5 h-4 px-1.5 text-[10px]" data-testid="badge-new-feedback">{newFeedback} new feedback</Badge>
              )}
            </Button>
          );
        })}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <ProjectOverview project={project} isOwner={isOwner} onManage={onManage} />

          {/*
            * Open roles, on the overview, one card each.
            *
            * They were a row of read-only skill badges with a single Apply
            * button beside them, which asked somebody to apply to the project
            * in general and left the owner guessing which job they meant. A
            * role is now the thing you press: it opens the application with
            * that role attached, and with whatever questions the owner set.
            */}
          {isSectionVisible(project, "rolesNeeded") && unfilledRoles.length > 0 && (
            <section className="space-y-3" data-testid="overview-open-roles">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-xl font-semibold">Open roles</h2>
                {canApply && (
                  <p className="text-sm text-muted-foreground">
                    {questionCount > 0
                      ? `Pick one — there ${questionCount === 1 ? "is 1 question" : `are ${questionCount} questions`} to answer.`
                      : "Pick the one you want."}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {unfilledRoles.map((role) => {
                  const detail = project.estimatedWeeks ? `~${project.estimatedWeeks} week project` : "Open-ended";
                  const body = (
                    <>
                      <span className="nova-chip flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                        <Briefcase className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm font-medium">{role}</span>
                        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                      </span>
                      {canApply && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    </>
                  );
                  /*
                   * A card only becomes a button for somebody who could
                   * actually apply. The owner and the team see the same list,
                   * because it is the public page, but nothing there offers
                   * them an action they would be refused.
                   */
                  return canApply ? (
                    <button
                      key={role}
                      type="button"
                      onClick={() => onApply(role)}
                      className="nova-ring-soft nova-hover-glow flex items-center gap-3 rounded-xl p-4"
                      data-testid={`open-role-${role}`}
                    >
                      {body}
                    </button>
                  ) : (
                    <div key={role} className="nova-ring-soft flex items-center gap-3 rounded-xl p-4" data-testid={`open-role-${role}`}>
                      {body}
                    </div>
                  );
                })}
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
          {isMember && <FeedbackInbox projectId={project.id} />}
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
