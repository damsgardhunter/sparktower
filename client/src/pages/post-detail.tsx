import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { refreshNotifications } from "@/components/notification-bell";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { FeedPostCard, type FeedPostWithDetails } from "@/components/feed-post-card";
import { REACTIONS, REACTIONS_BY_KEY } from "@shared/feed";
import type { FeedReaction } from "@shared/schema";
import { ArrowLeft, ArrowRight, Compass, Newspaper } from "lucide-react";

interface Reactor { userId: string; reaction: FeedReaction; name: string; headline: string | null; avatarUrl: string | null }

/**
 * A post on its own page: the post, every comment open, and who reacted.
 * What a shared link or "your feedback was used" lands on, and where a
 * conversation on an update is easiest to follow.
 */
/** The project's next step, for someone on its team reading feedback on a shared step. */
function NextStepLink({ projectId }: { projectId: string }) {
  const { data } = useQuery<{ adopted?: boolean; next?: { title: string; step?: { title: string } | null } | null }>({ queryKey: ["/api/projects", projectId, "path"] });
  if (!data?.adopted) return null;
  return (
    <Link
      href={`/projects/${projectId}/manage`}
      className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[13px] hover:bg-primary/10"
      data-testid="post-next-step"
    >
      <Compass className="h-4 w-4 text-primary shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {data.next ? <>Your next step: <span className="font-medium">{data.next.step?.title ?? data.next.title}</span></> : "Back to your path"}
      </span>
      <span className="text-xs text-primary shrink-0 flex items-center gap-1">Continue <ArrowRight className="h-3 w-3" /></span>
    </Link>
  );
}

export default function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<FeedReaction | "all">("all");

  const { data: post, isLoading, error } = useQuery<FeedPostWithDetails>({ queryKey: ["/api/feed", id], retry: false });
  const notFound = (error as { status?: number } | null)?.status === 404;
  // Opening the post is seeing what the bell said about it.
  useEffect(() => {
    if (post?.id) apiRequest("POST", "/api/notifications/read", { postId: post.id }).then(refreshNotifications).catch(() => {});
  }, [post?.id]);
  const { data: reactors } = useQuery<Reactor[]>({ queryKey: ["/api/feed", id, "reactions"], enabled: !!post });

  const shown = (reactors ?? []).filter((r) => tab === "all" || r.reaction === tab);
  const counts = REACTIONS.map((r) => ({ ...r, count: (reactors ?? []).filter((x) => x.reaction === r.reaction).length })).filter((r) => r.count > 0);

  return (
    <div className="h-full overflow-y-auto bg-muted dark:bg-background">
      <div className="mx-auto max-w-[680px] px-4 py-5 space-y-3">
        <Link href="/" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" data-testid="link-back-to-feed">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the feed
        </Link>

        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : error || !post ? (
          /*
           * Two different failures. A 404 is a post that's gone or private; anything
           * else is us failing to load it, which must not be dressed up as the
           * post not existing — that sent people looking for a permissions problem.
           */
          <Card className="rounded-lg shadow-none" data-testid={notFound ? "post-not-found" : "post-load-failed"}>
            <CardContent className="py-12 text-center space-y-2">
              <Newspaper className="h-10 w-10 mx-auto text-muted-foreground/30" />
              {notFound ? (
                <>
                  <p className="font-medium">This post isn't here</p>
                  <p className="text-sm text-muted-foreground">It was deleted, or it's on a private project you're not part of.</p>
                </>
              ) : (
                <>
                  <p className="font-medium">Couldn't load this post</p>
                  <p className="text-sm text-muted-foreground">Something went wrong on our side. Refresh to try again.</p>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* A step shared from the path: feedback read, back to the next one. Team only. */}
            {post.project && post.viewerIsTeam && (post.pathStep || post.pathWeek) && <NextStepLink projectId={post.project.id} />}

            <FeedPostCard post={post} standalone />

            {/* The interactions: everyone who reacted, by reaction. */}
            <Card className="rounded-lg shadow-none bg-background dark:bg-card" data-testid="post-reactions">
              <CardContent className="p-0 text-[13px]">
                <div className="flex items-center gap-1 px-3 py-2 border-b border-border/60 overflow-x-auto">
                  <button
                    className={`text-xs px-2.5 py-1 rounded-full ${tab === "all" ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent"}`}
                    onClick={() => setTab("all")}
                    data-testid="reactions-tab-all"
                  >
                    All {reactors?.length ?? 0}
                  </button>
                  {counts.map((r) => (
                    <button
                      key={r.reaction}
                      className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${tab === r.reaction ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent"}`}
                      onClick={() => setTab(r.reaction)}
                      data-testid={`reactions-tab-${r.reaction}`}
                    >
                      {r.emoji} {r.count}
                    </button>
                  ))}
                </div>
                {!reactors?.length ? (
                  <p className="text-xs text-muted-foreground px-4 py-4">No reactions yet.</p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {shown.map((r) => (
                      <li key={r.userId}>
                        <Link href={`/profile/${r.userId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50" data-testid={`reactor-${r.userId}`}>
                          <span className="relative">
                            <UserAvatar src={r.avatarUrl} name={r.name} className="h-9 w-9" />
                            <span className="absolute -bottom-1 -right-1 text-sm leading-none">{REACTIONS_BY_KEY[r.reaction]?.emoji}</span>
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium truncate">{r.name}</span>
                            {r.headline && <span className="block text-[11px] text-muted-foreground truncate">{r.headline}</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
