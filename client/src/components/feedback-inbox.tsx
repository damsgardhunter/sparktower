import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { errorText } from "@/lib/api-error";
import type { FeedbackState } from "@shared/feedback-loop";
import { Loader2, ListPlus, CheckCircle2, Repeat, MessageSquareQuote, X } from "lucide-react";

export interface FeedbackInboxItem {
  commentId: string;
  content: string;
  createdAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
  post: { id: string; excerpt: string; asks: string[]; createdAt: string };
  state: FeedbackState;
  isNew: boolean;
  task: { id: string; title: string; status: string } | null;
  closedByPostId: string | null;
}
export interface FeedbackInboxData {
  items: FeedbackInboxItem[];
  counts: { new: number; open: number; applied: number; readyToClose: number; closed: number };
}

const STATE: Record<FeedbackState, { label: string; cls: string }> = {
  open: { label: "Not acted on", cls: "bg-muted text-muted-foreground" },
  applied: { label: "On the board", cls: "bg-primary/10 text-primary" },
  closed: { label: "Credited in an update", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
};

/** The team's new-feedback count for a project, for a badge wherever the project is. */
export function useNewFeedbackCount(projectId: string, enabled = true) {
  const { data } = useQuery<FeedbackInboxData>({ queryKey: ["/api/projects", projectId, "feedback"], enabled });
  return data?.counts.new ?? 0;
}

/**
 * The build loop, from the team's side: feedback on the project's updates,
 * what's new since you looked, one click to turn it into work, and a nudge to
 * credit it in the next update once the work is done.
 */
export function FeedbackInbox({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<FeedbackInboxData>({ queryKey: ["/api/projects", projectId, "feedback"] });

  const seen = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/feedback/seen`, {}),
  });
  // Reading the inbox is seeing it. Marked once the list is on screen; the "new" badges stay for this visit.
  const newCount = data?.counts.new ?? 0;
  useEffect(() => {
    if (newCount > 0 && !seen.isPending && !seen.isSuccess) seen.mutate();
  }, [newCount]);

  const apply = useMutation({
    mutationFn: async (commentId: string) => (await apiRequest("POST", `/api/feed/comments/${commentId}/apply`, {})).json(),
    onSuccess: () => {
      toast({ title: "Added to the board", description: "Once it's done, credit it in your next update." });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    },
    onError: (e) => toast({ title: "Couldn't turn that into a task", description: errorText(e), variant: "destructive" }),
  });

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>;
  const items = data?.items ?? [];
  const counts = data?.counts;

  return (
    <Card className="rounded-lg shadow-none" data-testid="feedback-inbox">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <MessageSquareQuote className="h-4 w-4 text-primary" />
          <p className="font-semibold text-sm">Feedback on your updates</p>
          {counts && counts.new > 0 && <Badge className="text-[10px]" data-testid="feedback-new-count">{counts.new} new</Badge>}
          {counts && (
            <span className="text-xs text-muted-foreground ml-auto">
              {counts.open} to act on · {counts.applied} on the board · {counts.closed} credited
            </span>
          )}
        </div>

        {counts && counts.readyToClose > 0 && (
          <p className="text-xs rounded-md bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 px-3 py-2 flex items-center gap-1.5" data-testid="feedback-ready-to-close">
            <Repeat className="h-3.5 w-3.5 shrink-0" />
            {counts.readyToClose === 1 ? "One piece of feedback is" : `${counts.readyToClose} pieces of feedback are`} done. Post an update and credit {counts.readyToClose === 1 ? "it" : "them"} — the people who gave it will see it was used.
          </p>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No feedback yet. Post an update for this project with a specific question or two — that's what gets answered.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.commentId} className={`rounded-md border p-2.5 space-y-1.5 ${i.isNew ? "border-primary/40 bg-primary/5" : "border-border"}`} data-testid={`feedback-item-${i.commentId}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <UserAvatar src={i.author.avatarUrl} name={i.author.name} className="h-6 w-6" />
                  <Link href={`/profile/${i.author.id}`} className="text-xs font-medium hover:underline">{i.author.name}</Link>
                  {i.isNew && <Badge variant="outline" className="text-[10px]">new</Badge>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ml-auto ${STATE[i.state].cls}`}>{STATE[i.state].label}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{i.content}</p>
                <Link href={`/posts/${i.post.id}`} className="block text-[11px] text-muted-foreground truncate hover:underline">On: {i.post.excerpt}</Link>
                <div className="flex items-center gap-2 flex-wrap">
                  {i.state === "open" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={apply.isPending} onClick={() => apply.mutate(i.commentId)} data-testid={`button-apply-${i.commentId}`}>
                      {apply.isPending && apply.variables === i.commentId ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />}Turn into a task
                    </Button>
                  )}
                  {i.task && (
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      {i.task.status === "done" ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : <ListPlus className="h-3 w-3" />}
                      {i.task.title} · {i.task.status === "done" ? "done" : "in progress"}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The other half of closing the loop: the people who gave feedback hear that
 * a project acted on it — and are handed the update's own questions, which is
 * the loop starting again. Answering the update puts the card away; so does
 * dismissing it.
 */
export function FeedbackUsedCard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { data } = useQuery<{ items: { commentId: string; comment: string; project: { id: string; title: string }; update: { id: string; excerpt: string; asks?: string[] } }[] }>({
    queryKey: ["/api/me/feedback-used"],
    enabled: !!user,
  });
  const dismiss = useMutation({
    mutationFn: (commentIds: string[]) => apiRequest("POST", "/api/me/feedback-used/seen", { commentIds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/me/feedback-used"] }),
  });
  const items = data?.items ?? [];
  if (!items.length) return null;

  return (
    <Card className="rounded-lg shadow-none border-emerald-500/40 bg-emerald-500/5" data-testid="feedback-used-card">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Repeat className="h-4 w-4 text-emerald-600" />
          <p className="font-semibold text-sm">Your feedback was used</p>
          <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" disabled={dismiss.isPending} onClick={() => dismiss.mutate(items.map((i) => i.commentId))} data-testid="button-dismiss-feedback-used"><X className="h-4 w-4" /></Button>
        </div>
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.commentId} className="text-sm space-y-1" data-testid={`feedback-used-${i.commentId}`}>
              <p>
                <Link href={`/projects/${i.project.id}`} className="font-medium hover:underline">{i.project.title}</Link>
                <span className="text-muted-foreground"> acted on "{i.comment}" — </span>
                <Link href={`/posts/${i.update.id}`} className="hover:underline" data-testid={`link-used-update-${i.update.id}`}>{i.update.excerpt}</Link>
              </p>
              {!!i.update.asks?.length && (
                <div className="rounded-md bg-background/70 border border-border px-2.5 py-1.5 text-xs space-y-0.5" data-testid={`feedback-used-asks-${i.update.id}`}>
                  <p className="text-muted-foreground">Now they're asking:</p>
                  <ul className="list-disc pl-4">{i.update.asks.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              )}
              <Button
                size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                onClick={() => setLocation(`/posts/${i.update.id}`)}
                data-testid={`button-answer-update-${i.update.id}`}
              >
                <MessageSquareQuote className="h-3.5 w-3.5" />
                {i.update.asks?.length ? "Answer their questions" : "See the update"}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
