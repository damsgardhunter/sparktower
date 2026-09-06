import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedComposer } from "@/components/feed-composer";
import { FeedPostCard, type FeedPostWithDetails } from "@/components/feed-post-card";
import { Newspaper } from "lucide-react";
import { useLocation } from "wouter";

/**
 * One person's posts, for their profile page.
 *
 * Reuses the feed card so a post looks identical wherever it appears, and
 * shows the composer inline on your own profile — posting from where you're
 * already looking is easier than being sent to the home feed.
 */
export function ProfileFeed({ userId, isOwnProfile }: { userId: string; isOwnProfile: boolean }) {
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<{ posts: FeedPostWithDetails[] }>({
    queryKey: ["/api/feed", { authorId: userId }],
    queryFn: async () => {
      const res = await fetch(`/api/feed?authorId=${encodeURIComponent(userId)}&limit=10`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load posts");
      return res.json();
    },
    enabled: !!userId,
  });

  return (
    <div className="space-y-4">
      {isOwnProfile && <FeedComposer />}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : !data?.posts?.length ? (
        <Card className="border-dashed bg-transparent">
          <CardContent className="py-8 text-center space-y-2">
            <Newspaper className="h-8 w-8 mx-auto text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {isOwnProfile
                ? "You haven't posted yet. Share an update, ask for help, or announce a milestone."
                : "No posts yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {data.posts.map((post) => (
            <FeedPostCard key={post.id} post={post} />
          ))}
          {data.posts.length >= 10 && (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setLocation("/")}
              data-testid="button-see-feed"
            >
              See the whole feed
            </Button>
          )}
        </>
      )}
    </div>
  );
}
