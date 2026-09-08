import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { ReportButton } from "@/components/report-button";

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  authorId: string;
  author?: { id: string; firstName: string | null; email: string | null } | null;
  profile?: { displayName: string | null; avatarUrl: string | null } | null;
}

const MAX = 2000;

/** "3 days ago" — a check-in is a weekly artifact, so relative time reads better. */
function ago(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Feedback on a check-in — step 5 of the weekly loop.
 *
 * Readable by anyone, because a check-in permalink gets sent to people who
 * have never signed in. Writing needs an account, so a logged-out reader gets
 * the thread plus a prompt rather than a box that fails when they submit.
 *
 * Comments are stored against the project with `targetType: "check_in"`, which
 * reuses the threading, mentions and moderation the rest of the app already
 * has instead of growing a second comment system.
 */
export function CheckInComments({
  projectId, checkInId, authorName, canModerate = false,
}: {
  projectId: string;
  checkInId: string;
  /** Used only to make the empty state specific to whose week this is. */
  authorName: string;
  /** True for the project owner, who can remove comments on their own project. */
  canModerate?: boolean;
}) {
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");

  const key = ["/api/projects", projectId, "comments", "check_in", checkInId];

  const { data: comments, isLoading } = useQuery<Comment[]>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/comments?targetType=check_in&targetId=${checkInId}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!projectId && !!checkInId,
    retry: false,
  });

  const post = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/comments`, {
        targetType: "check_in", targetId: checkInId, content: draft.trim(),
      });
      return res.json();
    },
    onSuccess: (fresh: Comment[]) => {
      setDraft("");
      queryClient.setQueryData(key, fresh);
      // The page header shows "received feedback" off the count.
      queryClient.invalidateQueries({ queryKey: ["/api/check-ins", checkInId] });
      toast({ title: "Feedback posted" });
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Try again.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Couldn't post that", description, variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/project-comments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["/api/check-ins", checkInId] });
    },
    onError: () => toast({ title: "Couldn't delete that", variant: "destructive" }),
  });

  const list = comments ?? [];
  const nameOf = (c: Comment) =>
    c.profile?.displayName || c.author?.firstName || "A builder";

  return (
    <section className="space-y-4" aria-labelledby="feedback-h">
      <h2 id="feedback-h" className="text-sm font-semibold flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        {list.length === 0
          ? "Feedback"
          : `${list.length} ${list.length === 1 ? "comment" : "comments"}`}
      </h2>

      {isAuthenticated ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Tell ${authorName} what you think — what's working, what you'd push on.`}
            className="min-h-[80px]"
            maxLength={MAX}
            data-testid="input-checkin-comment"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {draft.trim().length}/{MAX}
            </span>
            <Button
              size="sm" className="gap-1.5"
              disabled={!draft.trim() || post.isPending}
              onClick={() => post.mutate()}
              data-testid="button-post-comment"
            >
              {post.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Posting…</>
                : <><Send className="h-3.5 w-3.5" /> Post</>}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-border/60 bg-muted/30 p-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            Sign in to leave feedback on this week.
          </p>
          <Button size="sm" variant="outline" onClick={() => { window.location.href = "/"; }}>
            Sign in
          </Button>
        </div>
      )}

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No feedback yet. First one to read this can change that.
        </p>
      ) : (
        <div className="space-y-3">
          {list.map((c) => (
            <div key={c.id} className="flex gap-2.5" data-testid={`comment-${c.id}`}>
              <UserAvatar
                src={c.profile?.avatarUrl} name={nameOf(c)}
                className="h-7 w-7 shrink-0 mt-0.5"
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-xs">
                  <span className="font-medium">{nameOf(c)}</span>
                  <span className="text-muted-foreground"> · {ago(c.createdAt)}</span>
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                  {c.content}
                </p>
              </div>
              <ReportButton targetType="comment" targetId={c.id} />
              {/* Author, or the project owner moderating their own project —
                  the same rule the server applies, so nobody is shown a
                  button that 404s and nobody with the power lacks one. */}
              {(user?.id === c.authorId || canModerate) && (
                <Button
                  variant="ghost" size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => remove.mutate(c.id)}
                  title="Delete"
                  data-testid={`button-delete-comment-${c.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
