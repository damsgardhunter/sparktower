import { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedComposer } from "@/components/feed-composer";
import { FeedPostCard, type FeedPostWithDetails } from "@/components/feed-post-card";
import { Heart, Loader2, Newspaper, Users } from "lucide-react";
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

  const { data, isLoading, isFetching } = useQuery<FeedPage>({
    queryKey: ["/api/feed", { filter, projectId, cursor, scope }],
    queryFn: async () => {
      const res = await fetch(`/api/feed?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the feed");
      return res.json();
    },
  });

  return (
    <div className="space-y-2">
      <FeedComposer defaultProjectId={projectId} />

      {!projectId && (
        <div className="flex gap-1.5" role="tablist" aria-label="Whose posts">
          {([["everyone", "Everyone", Users], ["following", "Following", Heart]] as const).map(([value, label, Icon]) => (
            <Button
              key={value}
              role="tab"
              aria-selected={scope === value}
              variant={scope === value ? "default" : "ghost"}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => { setScope(value); setPages([]); }}
              data-testid={`feed-scope-${value}`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </Button>
          ))}
        </div>
      )}

      {/*
        * Filters get their own container, tinted to the page rather than the
        * card surface. Sitting loose between the composer and the posts they
        * read as a third feed item; recessed a shade, they read as a control
        * strip — and every chip is the same height, so the rows line up.
        */}
      <div className="rounded-lg border border-border bg-muted/60 dark:bg-muted/40 px-2.5 py-2">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            className={`h-7 text-xs gap-1.5 rounded-full px-3 ${filter === "all" ? "btn-glossy border-0 text-primary-foreground" : "bg-background"}`}
            onClick={() => { setFilter("all"); setPages([]); }}
            data-testid="filter-all"
          >
            <Newspaper className="h-3.5 w-3.5" /> Everything
          </Button>
          {POST_TYPES.map((t) => (
            <Button
              key={t.type}
              variant={filter === t.type ? "default" : "outline"}
              size="sm"
              className={`h-7 text-xs gap-1.5 rounded-full px-3 ${filter === t.type ? "btn-glossy border-0 text-primary-foreground" : "bg-background"}`}
              onClick={() => { setFilter(t.type); setPages([]); }}
              data-testid={`filter-${t.type}`}
            >
              <TypeIcon name={t.icon} className="h-3.5 w-3.5" />
              {t.label}
            </Button>
          ))}
        </div>
      </div>

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
          {data!.posts.map((post) => (
            <FeedPostCard key={post.id} post={post} />
          ))}

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
