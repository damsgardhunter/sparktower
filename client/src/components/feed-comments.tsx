import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { errorText } from "@/lib/api-error";
import { MentionTextarea, FeedContent } from "@/components/mention-textarea";
import { ReportButton } from "@/components/report-button";
import { REACTIONS, REACTIONS_BY_KEY, MAX_COMMENT_LENGTH } from "@shared/feed";
import type { FeedMention, FeedReaction, User, UserProfile } from "@shared/schema";
import { Loader2, Send, CheckCircle2, ListPlus, EyeOff } from "lucide-react";

export interface FeedCommentRow {
  id: string;
  postId: string;
  authorId: string;
  content: string;
  mentions: FeedMention[];
  parentCommentId: string | null;
  createdAt: string;
  author: User;
  profile?: UserProfile;
  reactionCount: number;
  viewerReaction: FeedReaction | null;
  reactionBreakdown: { reaction: string; count: number }[];
  hidden: boolean;
  hiddenReason?: string | null;
  deleted: boolean;
  /** On the post's project's team: talk, not feedback. */
  byTeam?: boolean;
  appliedAt?: string | null;
  closedByPostId?: string | null;
}

interface Node extends FeedCommentRow { replies: Node[] }

/** Replies indent this many levels; deeper ones line up under the last indent, like LinkedIn and Reddit on a narrow card. */
const MAX_INDENT = 3;

function timeAgo(date: string | Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The flat list the server sends, as a tree. A reply whose parent isn't there (taken down) is shown at the top level rather than lost. */
export function buildCommentTree(rows: FeedCommentRow[]): Node[] {
  const byId = new Map<string, Node>(rows.map((r) => [r.id, { ...r, replies: [] }]));
  const roots: Node[] = [];
  for (const node of byId.values()) {
    const parent = node.parentCommentId ? byId.get(node.parentCommentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  // A deleted comment with nothing left under it has nothing to hold together.
  const prune = (nodes: Node[]): Node[] => nodes
    .map((n) => ({ ...n, replies: prune(n.replies) }))
    .filter((n) => !n.deleted || n.replies.length > 0);
  return prune(roots);
}

/** A box to write a comment or a reply in. */
function Composer({ postId, parentCommentId, placeholder, autoFocus, onDone }: {
  postId: string; parentCommentId?: string; placeholder: string; autoFocus?: boolean; onDone?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<FeedMention[]>([]);
  const send = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/feed/${postId}/comments`, { content: text, mentions, parentCommentId })).json(),
    onSuccess: () => {
      setText(""); setMentions([]);
      queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
      onDone?.();
    },
    onError: (e) => toast({ title: "Couldn't post that", description: errorText(e), variant: "destructive" }),
  });
  if (!user) return null;
  return (
    <div className="flex items-start gap-2" data-testid={parentCommentId ? `reply-composer-${parentCommentId}` : `comment-composer-${postId}`}>
      <UserAvatar src={user.profileImageUrl} name={user.firstName || "You"} className={`${parentCommentId ? "h-6 w-6" : "h-8 w-8"} shrink-0 mt-0.5`} />
      <div className="flex-1 space-y-1.5 min-w-0">
        <MentionTextarea
          value={text}
          onChange={setText}
          mentions={mentions}
          onMentionsChange={setMentions}
          placeholder={placeholder}
          className={`${parentCommentId ? "min-h-[44px]" : "min-h-[60px]"} text-[13px]`}
          maxLength={MAX_COMMENT_LENGTH}
          testId={parentCommentId ? `textarea-reply-${parentCommentId}` : `textarea-comment-${postId}`}
          autoFocus={autoFocus}
        />
        {(text.trim() || parentCommentId) && (
          <div className="flex gap-1.5">
            <Button size="sm" className="gap-1.5 h-7 text-xs" disabled={!text.trim() || send.isPending} onClick={() => send.mutate()} data-testid={parentCommentId ? `button-submit-reply-${parentCommentId}` : `button-submit-comment-${postId}`}>
              {send.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {parentCommentId ? "Reply" : "Comment"}
            </Button>
            {onDone && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onDone}>Cancel</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A post's comments as a thread: comment, reply to any comment, react to any
 * comment, report one that shouldn't be there. On a project's post, the team
 * also sees where each piece of outside feedback is in the build loop.
 */
export function FeedComments({ post }: {
  post: { id: string; projectId: string | null; viewerIsTeam?: boolean };
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null);

  const { data: rows, isLoading } = useQuery<FeedCommentRow[]>({
    queryKey: ["/api/feed", post.id, "comments"],
    // "Bob commented on your post" opens this: a list cached earlier wouldn't have Bob in it.
    refetchOnMount: "always",
  });
  const tree = useMemo(() => buildCommentTree(rows ?? []), [rows]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/feed", post.id, "comments"] });

  const react = useMutation({
    mutationFn: async ({ id, reaction }: { id: string; reaction: FeedReaction }) =>
      (await apiRequest("POST", `/api/feed/comments/${id}/react`, { reaction })).json(),
    onSuccess: () => { setPicker(null); refresh(); },
    onError: (e) => toast({ title: "Couldn't react", description: errorText(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/feed/comments/${id}`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/feed"] }),
    onError: (e) => toast({ title: "Couldn't delete that", description: errorText(e), variant: "destructive" }),
  });
  const apply = useMutation({
    mutationFn: async (commentId: string) => (await apiRequest("POST", `/api/feed/comments/${commentId}/apply`, {})).json(),
    onSuccess: (r: any) => {
      toast({ title: "Added to the board", description: `${r.task?.title ?? "A task"} — credit it in your next update once it's done.` });
      refresh();
      if (post.projectId) queryClient.invalidateQueries({ queryKey: ["/api/projects", post.projectId] });
    },
    onError: (e) => toast({ title: "Couldn't turn that into a task", description: errorText(e), variant: "destructive" }),
  });

  const renderNode = (c: Node, depth: number): JSX.Element => {
    const name = c.profile?.displayName || c.author?.firstName || "Someone";
    const mine = user?.id === c.authorId;
    const viewerDef = c.viewerReaction ? REACTIONS_BY_KEY[c.viewerReaction] : null;
    const top = [...c.reactionBreakdown].sort((a, b) => b.count - a.count).slice(0, 3);
    const small = depth > 0;

    return (
      <div key={c.id} className="space-y-2" data-testid={`comment-${c.id}`}>
        <div className="flex items-start gap-2">
          {c.deleted ? (
            <div className={`${small ? "h-6 w-6" : "h-8 w-8"} shrink-0 rounded-full bg-muted mt-0.5`} />
          ) : (
            <Link href={`/profile/${c.authorId}`}>
              <UserAvatar src={c.profile?.avatarUrl || c.author?.profileImageUrl} name={name} className={`${small ? "h-6 w-6" : "h-8 w-8"} shrink-0 mt-0.5`} />
            </Link>
          )}
          <div className="flex-1 min-w-0">
            <div className={`rounded-lg px-3 py-2 ${c.hidden ? "bg-destructive/5 border border-destructive/20" : "bg-muted/60"}`}>
              {c.deleted ? (
                <p className="text-[12px] italic text-muted-foreground" data-testid={`comment-deleted-${c.id}`}>This comment was deleted.</p>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <Link href={`/profile/${c.authorId}`} className="text-xs font-semibold hover:underline">{name}</Link>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
                  </div>
                  <FeedContent content={c.content} mentions={c.mentions || []} className="text-[14px]" />
                  {c.hidden && (
                    <p className="text-[11px] text-destructive flex items-center gap-1 mt-1"><EyeOff className="h-3 w-3" />Only you can see this — it was taken down{c.hiddenReason ? `: ${c.hiddenReason}` : "."}</p>
                  )}
                </>
              )}
            </div>

            {/* The comment's own actions: react, reply, report — then the build loop, for the team. */}
            {!c.deleted && !c.hidden && (
              <div className="flex items-center gap-2.5 mt-0.5 ml-1 text-[11px] text-muted-foreground flex-wrap">
                {user && (
                  <span className="relative">
                    <button
                      className={`hover:underline font-medium ${viewerDef ? viewerDef.color : ""}`}
                      onClick={() => setPicker(picker === c.id ? null : c.id)}
                      data-testid={`button-react-comment-${c.id}`}
                    >
                      {viewerDef ? `${viewerDef.emoji} ${viewerDef.label}` : "React"}
                    </button>
                    {picker === c.id && (
                      <span className="absolute bottom-full left-0 mb-1 flex gap-0.5 rounded-full border border-border bg-popover p-1 shadow-lg z-20" data-testid={`comment-reaction-picker-${c.id}`}>
                        {REACTIONS.map((r) => (
                          <button
                            key={r.reaction}
                            title={r.label}
                            onClick={() => react.mutate({ id: c.id, reaction: r.reaction })}
                            className={`h-7 w-7 rounded-full hover:bg-accent text-base transition-transform hover:scale-125 ${c.viewerReaction === r.reaction ? "bg-accent" : ""}`}
                            data-testid={`comment-reaction-${r.reaction}-${c.id}`}
                          >
                            {r.emoji}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )}
                {c.reactionCount > 0 && (
                  <span className="flex items-center gap-0.5" data-testid={`comment-reactions-${c.id}`}>
                    <span className="flex -space-x-0.5">{top.map((r) => <span key={r.reaction}>{REACTIONS_BY_KEY[r.reaction as FeedReaction]?.emoji}</span>)}</span>
                    {c.reactionCount}
                  </span>
                )}
                {user && (
                  <button className="hover:underline font-medium" onClick={() => setReplyingTo(replyingTo === c.id ? null : c.id)} data-testid={`button-reply-${c.id}`}>
                    Reply
                  </button>
                )}
                {c.replies.length > 0 && <span>{c.replies.length} repl{c.replies.length === 1 ? "y" : "ies"}</span>}
                {mine ? (
                  <button className="hover:text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(c.id)} data-testid={`button-delete-comment-${c.id}`}>Delete</button>
                ) : (
                  <ReportButton targetType="feed_comment" targetId={c.id} className="h-5 px-1" />
                )}

                {!c.byTeam && post.projectId && (c.closedByPostId ? (
                  <span className="text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-0.5" data-testid={`comment-closed-${c.id}`}><CheckCircle2 className="h-3 w-3" />Acted on in a later update</span>
                ) : c.appliedAt ? (
                  <span className="text-primary inline-flex items-center gap-0.5" data-testid={`comment-applied-${c.id}`}><ListPlus className="h-3 w-3" />On the team's board</span>
                ) : post.viewerIsTeam ? (
                  <button className="text-primary hover:underline inline-flex items-center gap-0.5" disabled={apply.isPending} onClick={() => apply.mutate(c.id)} data-testid={`button-apply-comment-${c.id}`}>
                    {apply.isPending && apply.variables === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />}Turn into a task
                  </button>
                ) : null)}
              </div>
            )}
          </div>
        </div>

        {(replyingTo === c.id || c.replies.length > 0) && (
          <div className={`space-y-2 ${depth < MAX_INDENT ? "ml-4 pl-3 border-l-2 border-border/70" : ""}`} data-testid={`replies-${c.id}`}>
            {c.replies.map((r) => renderNode(r, depth + 1))}
            {replyingTo === c.id && (
              <Composer postId={post.id} parentCommentId={c.id} placeholder={`Reply to ${name}…`} autoFocus onDone={() => setReplyingTo(null)} />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <Composer postId={post.id} placeholder="Add a comment… use @ to tag someone" />
      {isLoading ? (
        <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
      ) : (
        tree.map((c) => renderNode(c, 0))
      )}
    </div>
  );
}
