import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { MentionTextarea, FeedContent } from "@/components/mention-textarea";
import { Loader2, MessageSquare, Send, ThumbsUp } from "lucide-react";
import { MAX_COMMENT_LENGTH } from "@shared/feed";
import type { FeedMention, User, UserProfile } from "@shared/schema";

export type CommentTarget = "milestone" | "project" | "roadmap_phase";

interface Comment {
  id: string;
  authorId: string;
  content: string;
  mentions: FeedMention[];
  reactionCount: number;
  viewerReacted: boolean;
  createdAt: string;
  author: User;
  profile?: UserProfile;
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Suggested openers, so a blank box doesn't stop people engaging. */
const STARTERS: Record<CommentTarget, string[]> = {
  milestone: ["Congrats! 🎉", "How did you pull that off?", "I can help with what's next."],
  roadmap_phase: ["I can help with this.", "Have you considered…", "What's blocking this?"],
  project: ["This is interesting because…", "Have you considered…", "I'd use this if…"],
};

/**
 * Threaded discussion on a milestone, roadmap phase, or the project itself.
 *
 * Open to anyone who can see the project — that's the point of building in
 * public. Reuses the feed's mention input so @tagging works identically.
 */
export function ProjectDiscussion({
  projectId, targetType, targetId, compact,
}: {
  projectId: string;
  targetType: CommentTarget;
  targetId: string;
  /** Collapsed until opened — used inline under milestones. */
  compact?: boolean;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(!compact);
  const [content, setContent] = useState("");
  const [mentions, setMentions] = useState<FeedMention[]>([]);

  const { data: comments, isLoading } = useQuery<Comment[]>({
    queryKey: ["/api/projects", projectId, "comments", targetType, targetId],
    queryFn: async () => {
      const params = new URLSearchParams({ targetType, targetId });
      const res = await fetch(`/api/projects/${projectId}/comments?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load comments");
      return res.json();
    },
    enabled: open && !!projectId && !!targetId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "comments", targetType, targetId] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "comment-counts"] });
  };

  const post = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/comments`, {
        targetType, targetId, content, mentions,
      });
      return res.json();
    },
    onSuccess: () => {
      setContent("");
      setMentions([]);
      invalidate();
    },
    onError: () => toast({ title: "Couldn't post your comment", variant: "destructive" }),
  });

  const react = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/project-comments/${id}/react`); },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/project-comments/${id}`); },
    onSuccess: invalidate,
    onError: () => toast({ title: "Couldn't delete that comment", variant: "destructive" }),
  });

  const count = comments?.length ?? 0;

  if (compact && !open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
        data-testid={`button-open-discussion-${targetId}`}
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Discuss
      </Button>
    );
  }

  return (
    <div className="space-y-3" data-testid={`discussion-${targetType}-${targetId}`}>
      {isLoading ? (
        <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
      ) : (
        <>
          {count === 0 && (
            <p className="text-xs text-muted-foreground">
              No comments yet. {user ? "Start the conversation." : "Sign in to join the conversation."}
            </p>
          )}

          {(comments || []).map((c) => {
            const name = c.profile?.displayName || c.author?.firstName || "Someone";
            const mine = user?.id === c.authorId;
            return (
              <div key={c.id} className="flex items-start gap-2" data-testid={`project-comment-${c.id}`}>
                <Link href={`/profile/${c.authorId}`}>
                  <UserAvatar
                    src={c.profile?.avatarUrl || c.author?.profileImageUrl}
                    name={name}
                    className="h-7 w-7 shrink-0 mt-0.5"
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="rounded-lg bg-muted/60 px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Link href={`/profile/${c.authorId}`} className="text-xs font-semibold hover:underline">
                        {name}
                      </Link>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
                    </div>
                    <FeedContent content={c.content} mentions={c.mentions || []} />
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 ml-1">
                    <button
                      className={`text-[10px] flex items-center gap-1 hover:underline ${
                        c.viewerReacted ? "text-primary font-medium" : "text-muted-foreground"
                      }`}
                      disabled={!user || react.isPending}
                      onClick={() => react.mutate(c.id)}
                      data-testid={`button-like-comment-${c.id}`}
                    >
                      <ThumbsUp className="h-2.5 w-2.5" />
                      {c.reactionCount > 0 ? c.reactionCount : "Like"}
                    </button>
                    {mine && (
                      <button
                        className="text-[10px] text-muted-foreground hover:text-destructive"
                        onClick={() => remove.mutate(c.id)}
                        data-testid={`button-delete-comment-${c.id}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {user && (
        <div className="flex items-start gap-2">
          <UserAvatar
            src={user.profileImageUrl}
            name={user.firstName || "You"}
            className="h-7 w-7 shrink-0 mt-0.5"
          />
          <div className="flex-1 min-w-0 space-y-1.5">
            <MentionTextarea
              value={content}
              onChange={setContent}
              mentions={mentions}
              onMentionsChange={setMentions}
              placeholder="Add a comment… use @ to tag someone"
              className="min-h-[56px] text-sm"
              maxLength={MAX_COMMENT_LENGTH}
              testId={`textarea-comment-${targetId}`}
            />
            {content.length === 0 ? (
              <div className="flex flex-wrap gap-1">
                {STARTERS[targetType].map((s) => (
                  <button
                    key={s}
                    onClick={() => setContent(s)}
                    className="text-[10px] px-2 py-0.5 rounded-md bg-muted hover:bg-accent text-muted-foreground"
                    data-testid={`starter-${s.slice(0, 10)}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <Button
                size="sm"
                className="h-7 gap-1.5"
                disabled={post.isPending}
                onClick={() => post.mutate()}
                data-testid={`button-post-comment-${targetId}`}
              >
                {post.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Comment
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Small comment-count pill, for milestone rows and tab labels. */
export function CommentCount({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
      <MessageSquare className="h-2.5 w-2.5" /> {count}
    </Badge>
  );
}
