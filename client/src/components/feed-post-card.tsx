import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { MentionTextarea, FeedContent } from "@/components/mention-textarea";
import { PrivateBadge } from "@/components/private-badge";
import {
  Loader2, MessageSquare, Trash2, Sparkles, Send, MoreHorizontal, Lock,
} from "lucide-react";
import * as Icons from "lucide-react";
import {
  POST_TYPES_BY_KEY, REACTIONS, REACTIONS_BY_KEY, MAX_COMMENT_LENGTH,
} from "@shared/feed";
import type { FeedMention, FeedPost, FeedReaction, User, UserProfile } from "@shared/schema";

export interface FeedPostWithDetails extends FeedPost {
  author: User;
  profile?: UserProfile;
  project: { id: string; title: string; isPrivate: boolean } | null;
  viewerReaction: FeedReaction | null;
  reactionBreakdown: { reaction: string; count: number }[];
}

interface CommentWithAuthor {
  id: string;
  postId: string;
  authorId: string;
  content: string;
  mentions: FeedMention[];
  createdAt: string;
  author: User;
  profile?: UserProfile;
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

export function FeedPostCard({ post }: { post: FeedPostWithDetails }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showComments, setShowComments] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [comment, setComment] = useState("");
  const [commentMentions, setCommentMentions] = useState<FeedMention[]>([]);

  const def = POST_TYPES_BY_KEY[post.postType];
  const authorName = post.profile?.displayName || post.author?.firstName || post.author?.email || "Someone";
  const isMine = user?.id === post.authorId;

  const { data: comments, isLoading: commentsLoading } = useQuery<CommentWithAuthor[]>({
    queryKey: ["/api/feed", post.id, "comments"],
    enabled: showComments,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/feed"] });

  const react = useMutation({
    mutationFn: async (reaction: FeedReaction) => {
      const res = await apiRequest("POST", `/api/feed/${post.id}/react`, { reaction });
      return res.json();
    },
    onSuccess: () => { setShowReactionPicker(false); invalidate(); },
    onError: () => toast({ title: "Couldn't react", variant: "destructive" }),
  });

  const addComment = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/feed/${post.id}/comments`, {
        content: comment, mentions: commentMentions,
      });
      return res.json();
    },
    onSuccess: () => {
      setComment("");
      setCommentMentions([]);
      queryClient.invalidateQueries({ queryKey: ["/api/feed", post.id, "comments"] });
      invalidate();
    },
    onError: () => toast({ title: "Couldn't post your comment", variant: "destructive" }),
  });

  const deletePost = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/feed/${post.id}`); },
    onSuccess: () => { toast({ title: "Post deleted" }); invalidate(); },
    onError: () => toast({ title: "Couldn't delete the post", variant: "destructive" }),
  });

  const deleteComment = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/feed/comments/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feed", post.id, "comments"] });
      invalidate();
    },
  });

  const topReactions = [...post.reactionBreakdown].sort((a, b) => b.count - a.count).slice(0, 3);
  const viewerDef = post.viewerReaction ? REACTIONS_BY_KEY[post.viewerReaction] : null;

  return (
    <Card className="rounded-lg shadow-none bg-background dark:bg-card" data-testid={`feed-post-${post.id}`}>
      <CardContent className="p-4 space-y-3">
        {/* Author, and which project they're posting for */}
        <div className="flex items-start gap-3">
          <Link href={`/profile/${post.authorId}`}>
            <UserAvatar
              src={post.profile?.avatarUrl || post.author?.profileImageUrl}
              name={authorName}
              className="h-11 w-11 shrink-0"
            />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link href={`/profile/${post.authorId}`} className="font-semibold text-sm hover:underline" data-testid={`post-author-${post.id}`}>
                {authorName}
              </Link>
              {post.project && (
                <>
                  <span className="text-muted-foreground text-sm">·</span>
                  <Link
                    href={`/projects/${post.project.id}`}
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                    data-testid={`post-project-${post.id}`}
                  >
                    {post.project.title}
                  </Link>
                  {post.project.isPrivate && <PrivateBadge variant="icon" />}
                </>
              )}
            </div>
            {post.profile?.headline && (
              <p className="text-xs text-muted-foreground truncate">{post.profile.headline}</p>
            )}
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-muted-foreground">{timeAgo(post.createdAt)}</span>
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
          </div>
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

        <FeedContent content={post.content} mentions={(post.mentions as FeedMention[]) || []} />

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

        {/* Reaction summary */}
        {(post.reactionCount > 0 || post.commentCount > 0) && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
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
              <button className="hover:underline" onClick={() => setShowComments(true)}>
                {post.commentCount} comment{post.commentCount === 1 ? "" : "s"}
              </button>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 pt-2 border-t border-border/50">
          <div className="relative flex-1">
            <Button
              variant="ghost"
              size="sm"
              className={`w-full gap-1.5 ${viewerDef ? viewerDef.color : "text-muted-foreground"}`}
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
            className="flex-1 gap-1.5 text-muted-foreground"
            onClick={() => setShowComments((v) => !v)}
            data-testid={`button-comment-${post.id}`}
          >
            <MessageSquare className="h-4 w-4" />
            Comment
          </Button>
        </div>

        {showComments && (
          <div className="space-y-3 pt-2 border-t border-border/50">
            {user && (
              <div className="flex items-start gap-2">
                <UserAvatar
                  src={user.profileImageUrl}
                  name={user.firstName || "You"}
                  className="h-8 w-8 shrink-0 mt-0.5"
                />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <MentionTextarea
                    value={comment}
                    onChange={setComment}
                    mentions={commentMentions}
                    onMentionsChange={setCommentMentions}
                    placeholder="Add a comment… use @ to tag someone"
                    className="min-h-[60px] text-sm"
                    maxLength={MAX_COMMENT_LENGTH}
                    testId={`textarea-comment-${post.id}`}
                  />
                  {comment.trim() && (
                    <Button
                      size="sm"
                      className="gap-1.5 h-7"
                      disabled={addComment.isPending}
                      onClick={() => addComment.mutate()}
                      data-testid={`button-submit-comment-${post.id}`}
                    >
                      {addComment.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                      Comment
                    </Button>
                  )}
                </div>
              </div>
            )}

            {commentsLoading ? (
              <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
            ) : (comments || []).map((c) => {
              const cName = c.profile?.displayName || c.author?.firstName || "Someone";
              return (
                <div key={c.id} className="flex items-start gap-2" data-testid={`comment-${c.id}`}>
                  <Link href={`/profile/${c.authorId}`}>
                    <UserAvatar
                      src={c.profile?.avatarUrl || c.author?.profileImageUrl}
                      name={cName}
                      className="h-8 w-8 shrink-0 mt-0.5"
                    />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="rounded-lg bg-muted/60 px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <Link href={`/profile/${c.authorId}`} className="text-xs font-semibold hover:underline">
                          {cName}
                        </Link>
                        <span className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
                      </div>
                      <FeedContent content={c.content} mentions={c.mentions || []} />
                    </div>
                    {user?.id === c.authorId && (
                      <button
                        className="text-[10px] text-muted-foreground hover:text-destructive mt-0.5 ml-1"
                        onClick={() => deleteComment.mutate(c.id)}
                        data-testid={`button-delete-comment-${c.id}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
