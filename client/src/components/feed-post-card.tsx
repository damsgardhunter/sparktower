import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { ReportButton } from "@/components/report-button";
import { FeedComments } from "@/components/feed-comments";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { FeedContent } from "@/components/mention-textarea";
import { PrivateBadge } from "@/components/private-badge";
import {
  MessageSquare, Trash2, Sparkles, HelpCircle, Repeat, Compass, Globe,
} from "lucide-react";
import { creditLine } from "@shared/feedback-loop";
import * as Icons from "lucide-react";
import {
  POST_TYPES_BY_KEY, REACTIONS, REACTIONS_BY_KEY,
} from "@shared/feed";
import type { FeedMention, FeedPost, FeedReaction, User, UserProfile } from "@shared/schema";

export interface FeedPostWithDetails extends FeedPost {
  author: User;
  profile?: UserProfile;
  project: { id: string; title: string; isPrivate: boolean; logoUrl: string | null } | null;
  viewerReaction: FeedReaction | null;
  reactionBreakdown: { reaction: string; count: number }[];
  viewerIsTeam?: boolean;
  credits?: { commentId: string; authorId: string; name: string }[];
  pathStep?: { taskId: string; title: string } | null;
  artifact?: { id: string; title: string; tags: string[]; public: boolean } | null;
  pathWeek?: { steps: { taskId: string; title: string }[] } | null;
}


function TypeIcon({ name, className }: { name: string; className?: string }) {
  const Icon = (Icons as any)[name] || Icons.Circle;
  return <Icon className={className} />;
}

/** "3m", "5h", "2d", then a date. */
function timeAgo(date: string | Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * One post. In the feed it's compact, with its comments folded; on its own
 * page (`standalone`) the comments are open and nothing links to itself.
 */
export function FeedPostCard({ post, standalone = false }: { post: FeedPostWithDetails; standalone?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showComments, setShowComments] = useState(standalone);
  const [, setLocation] = useLocation();

  /*
   * In the feed, the whole card opens the post. Anything that does something
   * itself — a link, a button, a field, the open comments — keeps its own
   * click, and so does selecting text. A click from a dialog this card opened
   * (the report form) bubbles here through React's portal but isn't inside the
   * card's own DOM, so it's ignored.
   */
  const openPost = (e: React.MouseEvent<HTMLDivElement>) => {
    if (standalone) return;
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target)) return;
    if (target.closest("a, button, input, textarea, select, label, [role='menu'], [data-no-open]")) return;
    if (window.getSelection()?.toString()) return;
    setLocation(`/posts/${post.id}`);
  };
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  const def = POST_TYPES_BY_KEY[post.postType];
  const authorName = post.profile?.displayName || post.author?.firstName || post.author?.email || "Someone";
  const isMine = user?.id === post.authorId;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/feed"] });

  const react = useMutation({
    mutationFn: async (reaction: FeedReaction) => {
      const res = await apiRequest("POST", `/api/feed/${post.id}/react`, { reaction });
      return res.json();
    },
    onSuccess: () => { setShowReactionPicker(false); invalidate(); },
    onError: () => toast({ title: "Couldn't react", variant: "destructive" }),
  });

  const deletePost = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/feed/${post.id}`); },
    onSuccess: () => { toast({ title: "Post deleted" }); invalidate(); },
    onError: () => toast({ title: "Couldn't delete the post", variant: "destructive" }),
  });

  const topReactions = [...post.reactionBreakdown].sort((a, b) => b.count - a.count).slice(0, 3);
  const viewerDef = post.viewerReaction ? REACTIONS_BY_KEY[post.viewerReaction] : null;

  return (
    <Card
      className={`rounded-lg shadow-none bg-background dark:bg-card ${standalone ? "" : "cursor-pointer hover:border-foreground/20 transition-colors"}`}
      onClick={openPost}
      data-testid={`feed-post-${post.id}`}
    >
      <CardContent className="p-0 text-[13px]">
        {/* Author, and which project they're posting for */}
        <div className="flex items-start gap-3 px-4 pt-3.5 pb-2.5 border-b border-border">
          <Link href={`/profile/${post.authorId}`}>
            <UserAvatar
              src={post.profile?.avatarUrl || post.author?.profileImageUrl}
              name={authorName}
              className="h-11 w-11 shrink-0"
            />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link href={`/profile/${post.authorId}`} className="font-semibold text-[13px] hover:underline" data-testid={`post-author-${post.id}`}>
                {authorName}
              </Link>
              {/* What kind of post, on the same line as who posted it. */}
              <Badge variant="outline" className={`text-[10px] gap-1 font-normal ${def.accent}`} data-testid={`post-type-${post.id}`}>
                <TypeIcon name={def.icon} className="h-2.5 w-2.5" />
                {def.label}
              </Badge>
              {post.isSystemGenerated && (
                <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
                  <Sparkles className="h-2.5 w-2.5" /> Auto
                </Badge>
              )}
            </div>
            {post.profile?.headline && (
              <p className="text-[11px] text-muted-foreground truncate">{post.profile.headline}</p>
            )}
            <div className="flex items-center gap-1.5 mt-0.5">
              {standalone
                ? <span className="text-[11px] text-muted-foreground">{new Date(post.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                : <Link href={`/posts/${post.id}`} className="text-[11px] text-muted-foreground hover:underline" title="Open this post" data-testid={`post-link-${post.id}`}>{timeAgo(post.createdAt)}</Link>}
            </div>
          </div>
          {/* The project this post is about, top right: its logo (if uploaded) over its name, both opening the project. */}
          {post.project && (
            <Link
              href={`/projects/${post.project.id}`}
              className="shrink-0 max-w-[96px] flex flex-col items-center gap-1 text-center group"
              title={post.project.title}
              data-testid={`post-project-${post.id}`}
            >
              {post.project.logoUrl && (
                <img
                  src={post.project.logoUrl}
                  alt={`${post.project.title} logo`}
                  className="h-10 w-10 rounded-md object-contain border border-border/60 bg-background p-0.5"
                  data-testid={`post-project-logo-${post.id}`}
                />
              )}
              <span className="flex items-center gap-1 max-w-full text-[11px] font-medium text-primary group-hover:underline">
                <span className="truncate">{post.project.title}</span>
                {post.project.isPrivate && <PrivateBadge variant="icon" />}
              </span>
            </Link>
          )}
          {isMine && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              disabled={deletePost.isPending}
              onClick={() => deletePost.mutate()}
              data-testid={`button-delete-post-${post.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="px-4 pt-3 pb-3 space-y-3">
        <FeedContent content={post.content} mentions={(post.mentions as FeedMention[]) || []} className="text-[15px] leading-relaxed" />

        {/* The questions this update wants answered: what makes the feedback specific. */}
        {((post.asks as string[] | undefined)?.length ?? 0) > 0 && (
          <div className="rounded-md border border-primary/35 bg-primary/10 p-3 space-y-1.5" data-testid={`post-asks-${post.id}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1"><HelpCircle className="h-3 w-3" />Help answer</p>
            <ol className="list-decimal pl-5 text-sm space-y-0.5">
              {(post.asks as string[]).map((a) => <li key={a}>{a}</li>)}
            </ol>
            {!isMine && (
              <button className="text-xs text-primary hover:underline" onClick={() => setShowComments(true)} data-testid={`button-answer-asks-${post.id}`}>Answer in a comment</button>
            )}
          </div>
        )}

        {/* A step from the project's path, shared for feedback: back to the path for the team, to the project for everyone else. */}
        {post.pathStep && post.project && (
          <Link
            href={post.viewerIsTeam ? `/projects/${post.project.id}/manage` : `/projects/${post.project.id}`}
            className="inline-flex items-center gap-1.5 text-xs rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-primary hover:bg-primary/10"
            data-testid={`post-path-step-${post.id}`}
          >
            <Compass className="h-3 w-3" /> From the path: {post.pathStep.title}
          </Link>
        )}

        {/* A published artifact: its public page is the shareable one. */}
        {post.artifact?.public && (
          <a
            href={`/a/${post.artifact.id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 text-xs rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-primary hover:bg-primary/10"
            data-testid={`post-artifact-${post.id}`}
          >
            <Globe className="h-3 w-3" /> Public page{post.artifact.tags.length ? ` · ${post.artifact.tags.map((t) => `#${t}`).join(" ")}` : ""}
          </a>
        )}

        {post.pathWeek && post.project && (
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 space-y-1" data-testid={`post-path-week-${post.id}`}>
            <Link href={post.viewerIsTeam ? `/projects/${post.project.id}/manage` : `/projects/${post.project.id}`} className="text-xs text-primary hover:underline inline-flex items-center gap-1.5">
              <Compass className="h-3 w-3" /> This week on the path: {post.pathWeek.steps.length} step{post.pathWeek.steps.length === 1 ? "" : "s"}
            </Link>
            <ul className="text-xs text-muted-foreground list-disc pl-5">{post.pathWeek.steps.map((s) => <li key={s.taskId}>{s.title}</li>)}</ul>
          </div>
        )}

        {/* This update closes the loop on earlier feedback, and says whose. */}
        {(post.credits?.length ?? 0) > 0 && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5" data-testid={`post-credits-${post.id}`}>
            <Repeat className="h-3.5 w-3.5" />{creditLine(post.credits!.map((c) => c.name))}
          </p>
        )}

        {(post.mediaUrls?.length || 0) > 0 && (
          <div className={`grid gap-2 ${post.mediaUrls!.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {post.mediaUrls!.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md overflow-hidden bg-muted"
              >
                <img src={url} alt="" className="w-full object-cover max-h-80" loading="lazy" />
              </a>
            ))}
          </div>
        )}

        </div>

        {/* Reaction summary */}
        {(post.reactionCount > 0 || post.commentCount > 0) && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground px-4 pb-1.5">
            {post.reactionCount > 0 && (
              <span className="flex items-center gap-1" data-testid={`post-reactions-${post.id}`}>
                <span className="flex -space-x-1">
                  {topReactions.map((r) => (
                    <span key={r.reaction} className="text-sm">{REACTIONS_BY_KEY[r.reaction as FeedReaction]?.emoji}</span>
                  ))}
                </span>
                {post.reactionCount}
              </span>
            )}
            {post.commentCount > 0 && (
              <button className="hover:underline ml-auto" onClick={() => setShowComments(true)}>
                {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="mx-4 h-px bg-foreground/15" aria-hidden />
        <div className="flex items-center gap-1 px-2 py-1">
          <div className="relative flex-1">
            <Button
              variant="ghost"
              size="sm"
              className={`w-full gap-1.5 h-8 text-xs ${viewerDef ? viewerDef.color : "text-muted-foreground"}`}
              disabled={!user || react.isPending}
              onClick={() => setShowReactionPicker((v) => !v)}
              data-testid={`button-react-${post.id}`}
            >
              <span className="text-base leading-none">{viewerDef?.emoji || "👍"}</span>
              {viewerDef?.label || "React"}
            </Button>

            {showReactionPicker && (
              <div
                className="absolute bottom-full left-0 mb-1 flex gap-0.5 rounded-full border border-border bg-popover p-1 shadow-lg z-10"
                data-testid={`reaction-picker-${post.id}`}
              >
                {REACTIONS.map((r) => (
                  <button
                    key={r.reaction}
                    onClick={() => react.mutate(r.reaction)}
                    title={r.label}
                    className={`h-8 w-8 rounded-full hover:bg-accent text-lg transition-transform hover:scale-125 ${
                      post.viewerReaction === r.reaction ? "bg-accent" : ""
                    }`}
                    data-testid={`reaction-${r.reaction}-${post.id}`}
                  >
                    {r.emoji}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="flex-1 gap-1.5 h-8 text-xs text-muted-foreground"
            onClick={() => setShowComments((v) => !v)}
            data-testid={`button-comment-${post.id}`}
          >
            <MessageSquare className="h-4 w-4" />
            Comment
          </Button>
          {user && !isMine && (
            <div className="flex-1 flex">
              <ReportButton targetType="feed_post" targetId={post.id} variant="action" className="w-full" />
            </div>
          )}
        </div>

        {showComments && (
          <div className="px-4 pt-3 pb-3.5 border-t border-border/60 cursor-default" data-no-open>
            <FeedComments post={post} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
