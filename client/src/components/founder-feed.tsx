import { Fragment, useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedComposer } from "@/components/feed-composer";
import { FeedbackUsedCard } from "@/components/feedback-inbox";
import { ContinuePathCard } from "@/components/continue-path-card";
import { DiscoverNewsLink } from "@/components/discover-news";
import { useSurfaces } from "@/hooks/use-surfaces";
import { PromotionCard } from "@/components/promotion-card";
import { useFeedPromotions } from "@/hooks/use-feed-promotions";
import { useNotificationCounts, refreshNotifications } from "@/components/notification-bell";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FeedPostCard, type FeedPostWithDetails } from "@/components/feed-post-card";
import { Heart, Loader2, Newspaper, Users, SlidersHorizontal, ChevronDown, X, Sparkles } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import * as Icons from "lucide-react";
import { POST_TYPES } from "@shared/feed";
import type { FeedPostType } from "@shared/schema";

function TypeIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as any)[name] || Icons.Circle;
  return <Icon className={className} />;
}

interface FeedPage {
  posts: FeedPostWithDetails[];
  nextCursor: string | null;
  /** Only on the Following feed: how many builders and projects you follow. */
  followingCount?: number;
  /**
   * The server ordered this page by relevance to you rather than purely by
   * time. Worth saying out loud: a feed that isn't in the order you expect,
   * with nothing explaining why, reads as a bug.
   */
  ranked?: boolean;
}

type Scope = "everyone" | "following";

/**
 * The founder feed.
 *
 * Cursor-paginated on createdAt so new posts arriving at the top never cause
 * the "load more" page to skip or repeat entries.
 */
export function FounderFeed({ projectId }: { projectId?: string }) {
  const [filter, setFilter] = useState<FeedPostType | "all">("all");
  const [pages, setPages] = useState<string[]>([]);

  /*
   * Everyone, or only the builders and projects you follow. `?feed=following`
   * opens straight to the second — it's where "Open Following" goes after a
   * follow, so following something visibly changes what you see. A project's
   * own page shows its feed only, so it has no such choice.
   */
  const wanted = new URLSearchParams(useSearch()).get("feed");
  const [scope, setScope] = useState<Scope>(wanted === "following" && !projectId ? "following" : "everyone");
  useEffect(() => {
    if (wanted === "following" && !projectId) { setScope("following"); setPages([]); }
  }, [wanted, projectId]);

  const params = new URLSearchParams({ limit: "20" });
  if (scope === "following") params.set("scope", "following");
  if (filter !== "all") params.set("postType", filter);
  if (projectId) params.set("projectId", projectId);
  const cursor = pages[pages.length - 1];
  if (cursor) params.set("before", cursor);

  /*
   * New from people you follow, counted on the server — so the prompt to look
   * is the same on every device. Opening Following reads them.
   */
  const { data: counts } = useNotificationCounts();
  const newFromFollowing = projectId ? 0 : counts?.followedPosts ?? 0;
  useEffect(() => {
    if (scope === "following" && newFromFollowing > 0) {
      apiRequest("POST", "/api/notifications/read", { kind: "followed_post" }).then(refreshNotifications).catch(() => {});
    }
  }, [scope, newFromFollowing]);

  const { data, isLoading, isFetching } = useQuery<FeedPage>({
    queryKey: ["/api/feed", { filter, projectId, cursor, scope }],
    queryFn: async () => {
      const res = await fetch(`/api/feed?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the feed");
      return res.json();
    },
  });
  const { on: surfaceOn } = useSurfaces();
  // On the home feed only — a project's own page is that project's.
  const { promotionBefore, onSeen, onHide } = useFeedPromotions(data?.posts?.length ?? 0, !projectId);

  return (
    <div className="space-y-2">
      {/* Your paths first; what's new on Discover after them, and only while Discover is on. */}
      {!projectId && <ContinuePathCard />}
      {!projectId && surfaceOn("discover") && <DiscoverNewsLink />}
      {!projectId && <FeedbackUsedCard />}
      <FeedComposer defaultProjectId={projectId} />

      {/*
        * One line: whose posts on the left, and a small Filter at the end that
        * opens the post types. Eight chips across two rows took more room than
        * the choice was worth.
        */}
      <div className="flex items-center gap-1 py-0.5" data-testid="feed-filter-bar">
        {!projectId && (
          <div className="flex gap-0.5" role="tablist" aria-label="Whose posts">
            {([["everyone", "Everyone", Users], ["following", "Following", Heart]] as const).map(([value, label, Icon]) => (
              <Button
                key={value}
                role="tab"
                aria-selected={scope === value}
                variant={scope === value ? "secondary" : "ghost"}
                size="sm"
                className="h-7 gap-1.5 text-xs px-2.5"
                onClick={() => { setScope(value); setPages([]); }}
                data-testid={`feed-scope-${value}`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
                {value === "following" && newFromFollowing > 0 && scope !== "following" && (
                  <span className="ml-0.5 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 leading-4" data-testid="following-new-count">{newFromFollowing}</span>
                )}
              </Button>
            ))}
          </div>
        )}
        <span className="flex-1 h-px bg-foreground/15 mx-2" aria-hidden />
        <div className="flex items-center gap-1">
          {/* Only where it's true: the Everyone feed, signed in, unfiltered by author or project. */}
          {data?.ranked && (
            <span
              className="hidden sm:inline-flex items-center gap-1 text-[11px] text-muted-foreground mr-1"
              title="Posts about what you build, and from people you follow, come first. Newer posts still lead."
              data-testid="feed-ranked-hint"
            >
              <Sparkles className="h-3 w-3" /> Sorted for you
            </span>
          )}
          {filter !== "all" && (
            <button
              className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
              onClick={() => { setFilter("all"); setPages([]); }}
              data-testid="filter-clear"
            >
              {POST_TYPES.find((t) => t.type === filter)?.label} <X className="h-3 w-3" />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 px-1.5 py-1 rounded" data-testid="button-feed-filter">
                <SlidersHorizontal className="h-3 w-3" /> Filter <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">Show posts</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={filter} onValueChange={(v) => { setFilter(v as FeedPostType | "all"); setPages([]); }}>
                <DropdownMenuRadioItem value="all" className="text-xs gap-2" data-testid="filter-all">
                  <Newspaper className="h-3.5 w-3.5" /> Everything
                </DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {POST_TYPES.map((t) => (
                  <DropdownMenuRadioItem key={t.type} value={t.type} className="text-xs gap-2" data-testid={`filter-${t.type}`}>
                    <TypeIcon name={t.icon} className="h-3.5 w-3.5" /> {t.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* The way back into the loop: progress from people you follow, since you last looked. */}
      {!projectId && scope === "everyone" && newFromFollowing > 0 && (
        <button
          className="w-full rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-[13px] text-left flex items-center gap-2 hover:bg-primary/10"
          onClick={() => {
            /*
             * Refetch the Following feed before showing it. Its first page is
             * cached from whenever it was last opened and never goes stale, so
             * "See them" showed the old page — and opening it marks the new
             * posts read, so the banner went too and they were never seen.
             */
            queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "/api/feed" && (q.queryKey[1] as any)?.scope === "following" });
            setScope("following"); setPages([]);
          }}
          data-testid="button-new-from-following"
        >
          <Heart className="h-3.5 w-3.5 text-primary shrink-0" />
          <span><span className="font-semibold">{newFromFollowing} new update{newFromFollowing === 1 ? "" : "s"}</span> from people and projects you follow since you last looked</span>
          <span className="ml-auto text-xs text-primary">See them</span>
        </button>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-lg" />)}
        </div>
      ) : !data?.posts?.length && scope === "following" ? (
        /*
         * Two different empties. Following nobody is a thing to fix, so it says
         * how; following people who haven't posted is just quiet.
         */
        <Card className="rounded-lg shadow-none bg-background dark:bg-card" data-testid="following-empty">
          <CardContent className="py-12 text-center space-y-2">
            <Heart className="h-10 w-10 mx-auto text-muted-foreground/30" />
            {!data?.followingCount ? (
              <>
                <p className="font-medium">Follow builders to see updates</p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  Follow people and projects, and what they post shows up here — nothing else.
                </p>
                <Button asChild size="sm" className="mt-2" data-testid="button-find-builders">
                  <Link href="/discover">Find builders to follow</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="font-medium">Nothing new from who you follow yet</p>
                <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                  You follow {data.followingCount} {data.followingCount === 1 ? "builder or project" : "builders and projects"}. Their next update lands here.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : !data?.posts?.length ? (
        <Card className="rounded-lg shadow-none bg-background dark:bg-card">
          <CardContent className="py-12 text-center space-y-2">
            <Newspaper className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p className="font-medium">
              {filter === "all" ? "Nothing here yet" : `No ${POST_TYPES.find((t) => t.type === filter)?.label} posts yet`}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {filter === "all"
                ? "Be the first to share what you're building. Create a project or hit a milestone and it'll show up here automatically."
                : "Try a different filter, or write the first one."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Featured tools woven through the posts: usually one first, then one every few posts. */}
          {data!.posts.map((post, i) => {
            const promo = promotionBefore(i);
            return (
              <Fragment key={post.id}>
                {promo && <PromotionCard promotion={promo.promotion} slot={promo.slot} onSeen={onSeen} onHide={onHide} />}
                <FeedPostCard post={post} />
              </Fragment>
            );
          })}
          {(() => { const promo = promotionBefore(data!.posts.length); return promo && <PromotionCard promotion={promo.promotion} slot={promo.slot} onSeen={onSeen} onHide={onHide} />; })()}

          {data!.nextCursor && (
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={isFetching}
              onClick={() => setPages((p) => [...p, data!.nextCursor!])}
              data-testid="button-load-more"
            >
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Load older posts
            </Button>
          )}

          {pages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => setPages([])}
              data-testid="button-back-to-top"
            >
              Back to the latest
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
