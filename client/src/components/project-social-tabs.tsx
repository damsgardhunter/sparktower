import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { BackerWall } from "@/components/backer-wall";
import { FeedPostCard, type FeedPostWithDetails } from "@/components/feed-post-card";
import { FeedComposer } from "@/components/feed-composer";
import { FeedbackInbox, useNewFeedbackCount } from "@/components/feedback-inbox";
import { ProjectDiscussion, CommentCount } from "@/components/project-discussion";
import { ProjectOverview } from "@/components/project-overview";
import {
  Loader2, LayoutDashboard, Users, Newspaper, Briefcase, Heart,
  MessagesSquare, ArrowRight,
} from "lucide-react";
import { isSectionVisible } from "@shared/project-sections";
import { fitScale, MIN_FIT_SCALE } from "@/lib/fit-scale";
import type { Project, ProjectMember, User, UserProfile } from "@shared/schema";

type MemberWithUser = ProjectMember & { user: User; profile?: UserProfile };

type TabId = "overview" | "updates" | "backers" | "discussion" | "followers";

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
  { id: "backers", label: "Backer wall", icon: Heart },
  { id: "discussion", label: "Discussion", icon: MessagesSquare },
  { id: "followers", label: "Followers", icon: Heart },
];



/** 14px, the `text-sm` this row was designed at and the size it keeps when it fits. */
const TAB_BASE_PX = 14;

/**
 * A row of tabs that never wraps, scaled down until it fits.
 *
 * The scale is applied by writing a font size straight onto the row rather
 * than through state. Measuring is a layout read and applying is a layout
 * write, so routing it through a re-render means the browser paints the
 * unscaled row first — the tabs appear full size and snap smaller, which is
 * more noticeable than it sounds on a page that loads its counts a moment
 * after its tabs.
 *
 * Measuring needs the row's natural width, which is not observable while the
 * row is scaled, so each pass resets the size, reads `scrollWidth`, and writes
 * the answer. The reset is never painted: both happen inside one callback,
 * between the same two frames.
 *
 * Three things are given up, in this order: the type gets smaller, then the
 * icons go, then — on a phone narrower than the labels themselves — the row
 * scrolls sideways. Nothing is ever clipped and nothing wraps.
 */
function OneLineTabBar({ children, signature }: { children: React.ReactNode; signature: string }) {
  const row = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = row.current;
    if (!el) return;

    /*
     * Reset, measure, write — then check the answer.
     *
     * Sizing the row in `em` was meant to make one division enough: if every
     * part of the row scales with the type, the row scales with the type. It
     * very nearly does. What does not are the parts that are not type at all —
     * a border is one pixel whatever the font size, and a glyph's advance is
     * rounded rather than divided — which leaves the row about two per cent
     * wider than the arithmetic says. Two per cent of a tab bar is thirteen
     * pixels hanging off the right-hand edge, which is what this did at 820
     * pixels wide while fitting perfectly at 1280.
     *
     * So the first division gets most of the way there and each further pass
     * corrects against what the row actually measures. It is a search, but a
     * short one: two passes in practice, and bounded so a row that cannot be
     * made to fit at the readable floor stops being asked to.
     *
     * The write is never skipped when the scale comes out unchanged. An
     * earlier version returned early in that case, to stop a resize this
     * function caused from causing another — and left the row at full size,
     * because the reset at the top has already happened by the time the scale
     * is known. No guard is needed: writing a font size identical to the one
     * already there changes no layout, so the observer has nothing to report
     * and the chain ends on its own. That is what the quantising inside
     * `fitScale` is for.
     */
    const settle = () => {
      el.style.fontSize = `${TAB_BASE_PX}px`;
      let scale = fitScale({ available: el.clientWidth, natural: el.scrollWidth });
      el.style.fontSize = `${TAB_BASE_PX * scale}px`;

      for (let pass = 0; pass < 4 && el.scrollWidth > el.clientWidth; pass++) {
        const correction = fitScale({ available: el.clientWidth, natural: el.scrollWidth, min: 0 });
        const next = Math.max(MIN_FIT_SCALE, Math.floor(scale * correction * 200) / 200);
        if (next >= scale) break; // At the floor, or as small as it is going to get.
        scale = next;
        el.style.fontSize = `${TAB_BASE_PX * scale}px`;
      }
      return scale;
    };

    /*
     * On a phone the type runs out of room before the row does, and the icons
     * are what go.
     *
     * Five labels and their counts need about 340 pixels at the smallest
     * readable size, which is more than a 390-pixel screen has once the page's
     * own margins are taken out — so the row hit the floor and still hung 54
     * pixels off the edge. The icons are worth roughly that much: five of them
     * at a bit over one em, plus the gap each one sits in. They are also the
     * part nobody is reading. A tab called Followers does not need a heart next
     * to it to be understood, whereas a tab bar scrolled half out of view needs
     * a visitor to discover that it scrolls.
     *
     * Tried at full strength first on every pass, so widening the window brings
     * them straight back rather than leaving the row permanently stripped.
     */
    /*
     * Hidden rather than merely transparent: a `display: none` child is not a
     * flex item, so the gap it sat in goes with it. Set as a style on the
     * element instead of through a class, because this runs inside a layout
     * pass that then measures the result — a React state change would not have
     * taken effect by the time the next line reads `scrollWidth`.
     */
    const showIcons = (show: boolean) => {
      for (const icon of el.querySelectorAll<SVGElement>("svg")) {
        icon.style.display = show ? "" : "none";
      }
    };

    const fit = () => {
      showIcons(true);
      if (settle() <= MIN_FIT_SCALE && el.scrollWidth > el.clientWidth) {
        showIcons(false);
        settle();
      }
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    /*
     * And again once the real typeface is in. Before it loads the row is
     * measured in the fallback font, which is a different width — usually
     * narrower, so the row fits at full size and then overflows.
     */
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) fit(); }).catch(() => {});

    return () => { cancelled = true; observer.disconnect(); };
  }, [signature]);

  return (
    <div
      ref={row}
      className="flex flex-nowrap items-center gap-[0.25em] overflow-x-auto border-b border-border pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ fontSize: TAB_BASE_PX }}
      data-testid="project-tab-bar"
    >
      {children}
    </div>
  );
}

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
      /*
       * No count on the wall. It comes from a different endpoint than this
       * component reads, and a tab that said "Backer wall 0" before that request
       * landed would be announcing the project has no backers — the one thing a
       * visitor should not be told wrongly.
       */
      case "backers": return null;
      default: return null;
    }
  };

  // The team's count of feedback they haven't read, on the Updates tab where it lives.
  const newFeedback = useNewFeedbackCount(project.id, isMember);

  return (
    <div className="space-y-6">
      {/*
        * One line, always. The type shrinks to make it true.
        *
        * Every label and every count is part of what has to fit, so the row is
        * re-fitted whenever one of them changes rather than only on resize —
        * "Followers" becoming "Followers 156" is the change that used to push
        * the row onto a second line.
        */}
      <OneLineTabBar signature={TABS.map((t) => `${t.label}:${tabCount(t.id) ?? ""}`).join("|") + `:${newFeedback}`}>
        {TABS.map((t) => {
          const count = tabCount(t.id);
          return (
            <Button
              key={t.id}
              variant={tab === t.id ? "default" : "ghost"}
              size="sm"
              /*
               * Sized in `em` throughout, which is what lets a single font-size
               * on the row shrink the whole thing by one factor. With padding
               * fixed in pixels, scaling the text by 0.7 scales the row by
               * rather less, and fitting it would take a search instead of one
               * division.
               */
              className="h-auto shrink-0 gap-[0.35em] whitespace-nowrap rounded-[0.4em] px-[0.6em] py-[0.4em] text-[1em] leading-none"
              onClick={() => setTab(t.id)}
              data-testid={`project-tab-${t.id}`}
            >
              <t.icon className="h-[1.15em] w-[1.15em] shrink-0" />
              {t.label}
              {count !== null && count > 0 && (
                <Badge variant="secondary" className="h-[1.35em] rounded-[0.7em] px-[0.4em] text-[0.72em] leading-none">{count}</Badge>
              )}
              {/*
                * The team's unread count, as a number rather than "3 new
                * feedback". The words were the widest thing in the row by some
                * way, and they only ever appeared for members — so a creator
                * looking at their own project got a row scaled down to fit a
                * phrase that the tab it sits on already explains. The full
                * phrase is still read out and still in the tooltip.
                */}
              {t.id === "updates" && newFeedback > 0 && (
                <Badge
                  className="h-[1.35em] rounded-[0.7em] px-[0.4em] text-[0.72em] leading-none"
                  title={`${newFeedback} new piece${newFeedback === 1 ? "" : "s"} of feedback`}
                  aria-label={`${newFeedback} new feedback`}
                  data-testid="badge-new-feedback"
                >
                  {newFeedback} new
                </Badge>
              )}
            </Button>
          );
        })}
      </OneLineTabBar>

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

      {tab === "backers" && <BackerWall projectId={project.id} projectTitle={project.title} />}

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
