import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedComposer } from "@/components/feed-composer";
import { FeedPostCard, type FeedPostWithDetails } from "@/components/feed-post-card";
import { Loader2, Newspaper } from "lucide-react";
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
}

/**
 * The founder feed.
 *
 * Cursor-paginated on createdAt so new posts arriving at the top never cause
 * the "load more" page to skip or repeat entries.
 */
export function FounderFeed({ projectId }: { projectId?: string }) {
  const [filter, setFilter] = useState<FeedPostType | "all">("all");
  const [pages, setPages] = useState<string[]>([]);

  const params = new URLSearchParams({ limit: "20" });
  if (filter !== "all") params.set("postType", filter);
  if (projectId) params.set("projectId", projectId);
  const cursor = pages[pages.length - 1];
  if (cursor) params.set("before", cursor);

  const { data, isLoading, isFetching } = useQuery<FeedPage>({
    queryKey: ["/api/feed", { filter, projectId, cursor }],
    queryFn: async () => {
      const res = await fetch(`/api/feed?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load the feed");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <FeedComposer defaultProjectId={projectId} />

      {/* Type filter */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant={filter === "all" ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs gap-1.5"
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
            className="h-7 text-xs gap-1.5"
            onClick={() => { setFilter(t.type); setPages([]); }}
            data-testid={`filter-${t.type}`}
          >
            <TypeIcon name={t.icon} className="h-3.5 w-3.5" />
            {t.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      ) : !data?.posts?.length ? (
        <Card>
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
        <div className="space-y-4">
          {data.posts.map((post) => (
            <FeedPostCard key={post.id} post={post} />
          ))}

          {data.nextCursor && (
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={isFetching}
              onClick={() => setPages((p) => [...p, data.nextCursor!])}
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
