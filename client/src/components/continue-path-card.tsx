import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { pathHref } from "@shared/notifications";
import type { ProjectGoal } from "@shared/goals";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { MAX_ASKS } from "@shared/feedback-loop";
import { ArrowRight, ChevronDown, Compass, EyeOff, Globe, Loader2, Share2, Sparkles, User } from "lucide-react";
import { ARTIFACT_MAX_TAGS, ARTIFACT_TITLE_MAX, artifactPath } from "@shared/path-artifacts";
import { InviteCollaboratorDialog } from "@/components/invite-collaborator-dialog";

export interface NextStepItem {
  project: { id: string; title: string; logoUrl: string | null };
  phase: string;
  progress: { done: number; total: number };
  next: { id: string; title: string; actor: string; estimateMinutes: number | null; step: string | null } | null;
  daysSinceActivity: number;
  projectedAt: string | null;
  lastDone: { taskId: string; title: string; completedAt: string; sharedPostId: string | null } | null;
  weekly?: { due: boolean; steps: { taskId: string; title: string; completedAt: string }[] };
  /** The section this item is for — one item per started section. Absent from an older server. */
  track?: { goal: string; label: string; short: string; primary: boolean };
}

const ACTOR_SHORT: Record<string, string> = {
  "nova-builds": "Nova builds it",
  "nova-drafts": "Nova drafts it",
  "user-decides": "You choose",
  "user-does": "Only you",
};

const estimate = (m: number | null) => (m == null ? null : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`);

export function refreshNextSteps(projectId?: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/me/next-steps"] });
  queryClient.invalidateQueries({ queryKey: ["/api/feed"] });
  if (projectId) queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "path"] });
}

/**
 * Sharing a step you just finished, as a progress post tied to that step. What
 * comes back in the comments is feedback on the step's output — and each
 * comment is a notification that brings you back to it.
 */
export function ShareStepDialog({ projectId, projectTitle, step, open, onClose }: {
  projectId: string; projectTitle: string; step: { taskId: string; title: string }; open: boolean; onClose: () => void;
}) {
  const { toast } = useToast();
  const [content, setContent] = useState(`Just finished "${step.title}" on ${projectTitle}. `);
  const [asks, setAsks] = useState<string[]>([""]);
  const share = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/feed", {
      postType: "project_update", projectId, content: content.trim(), asks: asks.filter((a) => a.trim()), pathTaskId: step.taskId,
    })).json(),
    onSuccess: () => {
      toast({ title: "Shared", description: "Replies land in your notifications and your project's feedback inbox." });
      refreshNextSteps(projectId);
      onClose();
    },
    onError: (e) => toast({ title: "Couldn't share that", description: errorText(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="share-step-dialog">
        <DialogHeader>
          <DialogTitle>Share this step for feedback</DialogTitle>
          <DialogDescription>Post what you finished, with a question or two. Feedback on it comes back to you.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} data-testid="input-share-step-content" />
          {asks.map((a, i) => (
            <input
              key={i}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              placeholder={i === 0 ? "What do you want feedback on? e.g. Is this pricing clear?" : "Another question"}
              value={a}
              onChange={(e) => setAsks((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              data-testid={`input-share-step-ask-${i}`}
            />
          ))}
          {asks.length < MAX_ASKS && (
            <button className="text-xs text-primary hover:underline" onClick={() => setAsks((p) => [...p, ""])}>+ Another question</button>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Not now</Button>
          <Button disabled={!content.trim() || share.isPending} onClick={() => share.mutate()} data-testid="button-share-step">
            {share.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4 mr-1.5" />}Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Publishing a finished step as an artifact: Nova assembles it from the step's
 * own answer, you give it a title people would click and a few tags, and it
 * goes out as a public page (/a/:id) and a feed post. The public page is what
 * gets shared; strangers who sign up from it are credited back to you.
 *
 * Reopening it on a step that's already out lands on that same page — the link
 * and the button that takes it down again, since publishing shouldn't be a
 * one-way door.
 */
export function PublishArtifactDialog({ projectId, projectTitle, step, open, onClose }: {
  projectId: string; projectTitle?: string; step: { taskId: string; title: string }; open: boolean; onClose: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(step.title);
  const [tags, setTags] = useState("");
  const [ask, setAsk] = useState("");
  const [published, setPublished] = useState<string | null>(null);
  const [takingDown, setTakingDown] = useState(false);
  const draft = useQuery<{
    id: string; title: string; summary: string; body: string; files: { path: string }[]; tags: string[]; visibility: string;
    /** The step has changed since this page went live, and the change is being held back. */
    hasDraft?: boolean; draftBody?: string | null; draftSummary?: string | null;
  }>({
    queryKey: ["/api/projects", projectId, "path", "artifact", step.taskId],
    queryFn: async () => {
      const a = await (await apiRequest("POST", `/api/projects/${projectId}/path/tasks/${step.taskId}/artifact`)).json();
      setTitle(a.title);
      if (a.tags?.length) setTags(a.tags.join(", "));
      return a;
    },
    enabled: open,
    retry: false,
    staleTime: Infinity,
  });
  const publish = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/artifacts/${draft.data!.id}/publish`, {
      title: title.trim(), tags: tags.split(/[,\s]+/).filter(Boolean), asks: ask.trim() ? [ask.trim()] : [],
    })).json() as Promise<{ url: string; postId: string }>,
    onSuccess: (r) => {
      setPublished(`${window.location.origin}${r.url}`);
      // The held-back draft has just been promoted, so the "there's a newer
      // version" notice has to go with it rather than linger over live text.
      void draft.refetch();
      refreshNextSteps(projectId);
    },
    onError: (e) => toast({ title: "Couldn't publish that", description: errorText(e), variant: "destructive" }),
  });
  // The other direction. The feed post is a separate thing the author deletes from the feed.
  const unpublish = useMutation({
    mutationFn: async (removePost: boolean) =>
      (await apiRequest("POST", `/api/artifacts/${draft.data!.id}/unpublish`, { removePost })).json() as Promise<{ postId: string | null; post: string }>,
    onSuccess: (r) => {
      setTakingDown(false);
      toast({
        title: "The page is down",
        description: r.post === "deleted" || r.post === "kept"
          ? "The link leads nowhere now, and the post announcing it is gone from the feed."
          : r.post === "not_yours"
            ? "The link leads nowhere now. The post announcing it was written by someone else on the team, so it's theirs to delete."
            : "The link leads nowhere now. Your post about it is still on the feed until you delete it.",
      });
      refreshNextSteps(projectId);
      onClose();
    },
    onError: (e) => toast({ title: "Couldn't take it down", description: errorText(e), variant: "destructive" }),
  });
  // Just published, or opened on a step that was published earlier — the same page either way.
  const liveUrl = published ?? (draft.data?.visibility === "public" ? `${window.location.origin}${artifactPath(draft.data.id)}` : null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="publish-artifact-dialog">
        <DialogHeader>
          <DialogTitle>{liveUrl ? "Published" : "Publish what this step produced"}</DialogTitle>
          <DialogDescription>
            {liveUrl ? "It has a public page anyone can open, and a post on the feed." : "A public page with a title and tags, linked back to your project and its path, plus a feed post."}
          </DialogDescription>
        </DialogHeader>
        {liveUrl ? (
          <div className="space-y-2">
            <input readOnly value={liveUrl} className="w-full rounded-md border border-border bg-muted px-2 py-1.5 text-sm" onFocus={(e) => e.target.select()} data-testid="text-artifact-url" />
            {/*
              * The step has moved on since the page went out, and that change
              * is deliberately NOT live yet. Regenerating used to overwrite the
              * public page the instant this dialog opened, which put working
              * notes on the open internet with nobody's say-so. Now it waits
              * here until somebody presses this.
              */}
            {draft.data?.hasDraft && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-2" data-testid="artifact-draft-notice">
                <p className="text-xs">
                  This step has changed since the page went up. The public page still shows what you published.
                </p>
                <div className="rounded border border-border bg-background/60 p-2 text-xs max-h-28 overflow-y-auto whitespace-pre-wrap" data-testid="artifact-draft-preview">
                  {draft.data.draftBody || draft.data.draftSummary}
                </div>
                <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()} data-testid="button-publish-artifact-update">
                  {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4 mr-1.5" />}Publish this update
                </Button>
              </div>
            )}
            <div className="flex gap-3 text-sm">
              <button className="text-primary hover:underline" onClick={() => navigator.clipboard?.writeText(liveUrl)}>Copy link</button>
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" data-testid="link-open-artifact">Open the page</a>
              <button className="text-destructive hover:underline flex items-center gap-1 ml-auto" onClick={() => setTakingDown(true)} data-testid="button-unpublish-artifact">
                <EyeOff className="h-3.5 w-3.5" />Take the page down
              </button>
            </div>
            {/*
              * The loop's other half. A page worth sharing is the best moment to
              * ask someone in — the invite goes out with something finished
              * attached to it, rather than an empty project.
              */}
            <div className="border-t border-border pt-3 space-y-2">
              <p className="text-sm text-muted-foreground">Someone who'd want to work on this with you?</p>
              <InviteCollaboratorDialog projectId={projectId} projectTitle={projectTitle ?? "this project"} />
            </div>
          </div>
        ) : draft.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : draft.isError ? (
          <p className="text-sm text-destructive" data-testid="text-artifact-error">{errorText(draft.error)}</p>
        ) : draft.data && (
          <div className="space-y-2">
            <label className="block text-xs font-medium">Public title
              <input className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={title} maxLength={ARTIFACT_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} data-testid="input-artifact-title" />
            </label>
            <label className="block text-xs font-medium">Tags <span className="font-normal text-muted-foreground">(up to {ARTIFACT_MAX_TAGS}, comma separated)</span>
              <input className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" placeholder="pricing, landing-page" value={tags} onChange={(e) => setTags(e.target.value)} data-testid="input-artifact-tags" />
            </label>
            <div className="rounded-md border border-border bg-muted/40 p-2 text-xs max-h-40 overflow-y-auto whitespace-pre-wrap" data-testid="artifact-preview">
              {draft.data.body || draft.data.summary}
              {draft.data.files.length > 0 && `\n\n${draft.data.files.length} file${draft.data.files.length === 1 ? "" : "s"} built`}
            </div>
            <input className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" placeholder="Ask the feed something (optional)" value={ask} onChange={(e) => setAsk(e.target.value)} data-testid="input-artifact-ask" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{liveUrl ? "Done" : "Not now"}</Button>
          {!liveUrl && (
            <Button disabled={!draft.data || title.trim().length < 5 || publish.isPending} onClick={() => publish.mutate()} data-testid="button-publish-artifact">
              {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4 mr-1.5" />}Publish
            </Button>
          )}
        </DialogFooter>
        <AlertDialog open={takingDown} onOpenChange={setTakingDown}>
          <AlertDialogContent data-testid="unpublish-artifact-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>Take this page down?</AlertDialogTitle>
              <AlertDialogDescription>
                The page stops being reachable. Anyone who opens the link — including people who already have it — gets nothing,
                and you can publish the page again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {/*
              * The post is the other half of publishing, and leaving it up
              * leaves a post at the top of the feed whose link now goes
              * nowhere. Offered here rather than as a second errand.
              */}
            <AlertDialogFooter className="sm:justify-between">
              <AlertDialogCancel data-testid="button-unpublish-cancel">Leave it up</AlertDialogCancel>
              <div className="flex gap-2">
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={unpublish.isPending}
                  onClick={(e) => { e.preventDefault(); unpublish.mutate(true); }}
                  data-testid="button-unpublish-with-post"
                >
                  {unpublish.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}Take it down and delete the post
                </AlertDialogAction>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={unpublish.isPending}
                  onClick={(e) => { e.preventDefault(); unpublish.mutate(false); }}
                  data-testid="button-unpublish-confirm"
                >
                  Page only
                </AlertDialogAction>
              </div>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The weekly progress update — what replaced the check-in. Everything finished
 * on the path this week that nobody has shared yet, listed and ticked, with a
 * question or two. Posted, those steps leave the list; comments on it come back
 * as notifications, and the post links the team back to the next step.
 */
export function WeeklyUpdateDialog({ projectId, projectTitle, steps, open, onClose }: {
  projectId: string; projectTitle: string; steps: { taskId: string; title: string }[]; open: boolean; onClose: () => void;
}) {
  const { toast } = useToast();
  const [picked, setPicked] = useState<string[]>(steps.map((s) => s.taskId));
  const [content, setContent] = useState(`This week on ${projectTitle}:\n${steps.map((s) => `- ${s.title}`).join("\n")}\n\n`);
  const [ask, setAsk] = useState("");
  const post = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/feed", {
      postType: "project_update", projectId, content: content.trim(), asks: ask.trim() ? [ask.trim()] : [], pathStepIds: picked,
    })).json(),
    onSuccess: () => {
      toast({ title: "Weekly update posted", description: "Replies land in your notifications and your project's feedback inbox." });
      refreshNextSteps(projectId);
      onClose();
    },
    onError: (e) => toast({ title: "Couldn't post that", description: errorText(e), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="weekly-update-dialog">
        <DialogHeader>
          <DialogTitle>This week's progress</DialogTitle>
          <DialogDescription>What you finished on the path, ready to post. Ask something specific and the feedback comes back to you.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <ul className="space-y-1 text-sm" data-testid="weekly-update-steps">
            {steps.map((s) => (
              <li key={s.taskId}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={picked.includes(s.taskId)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, s.taskId] : p.filter((x) => x !== s.taskId))} data-testid={`weekly-step-${s.taskId}`} />
                  {s.title}
                </label>
              </li>
            ))}
          </ul>
          <Textarea rows={5} value={content} onChange={(e) => setContent(e.target.value)} data-testid="input-weekly-content" />
          <input
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="What do you want feedback on this week?"
            value={ask} onChange={(e) => setAsk(e.target.value)} data-testid="input-weekly-ask"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Not now</Button>
          <Button disabled={!content.trim() || !picked.length || post.isPending} onClick={() => post.mutate()} data-testid="button-post-weekly">
            {post.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4 mr-1.5" />}Post update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The top of the home feed: where each of your paths is and the one step
 * waiting on it. The retention loop's front door — opening the app lands you
 * one click from the next thing to do, not in the feed with your project three
 * screens away.
 */
/**
 * One project's place on its path: where it is, what's next, and the way in.
 *
 * Shared by the home feed's card and the path page (client/src/pages/path-home.tsx),
 * because two renderings of "what should I do next" would disagree within a
 * week — and this is the sentence the whole retention loop turns on.
 */
export function NextStepRow({ item, onShare, onWeekly }: {
  item: NextStepItem;
  onShare: (item: NextStepItem) => void;
  onWeekly: (item: NextStepItem) => void;
}) {
  const pct = item.progress.total ? Math.round((item.progress.done / item.progress.total) * 100) : 0;
  const novaActs = item.next?.actor.startsWith("nova");
  // The primary section keeps the plain ids; the others add their goal, so each is addressable.
  const idSuffix = item.track && !item.track.primary ? `${item.project.id}-${item.track.goal}` : item.project.id;
  // Straight to the step, with the card in view (shared/notifications.ts).
  const href = pathHref(item.project.id, { section: (item.track?.goal as ProjectGoal | undefined) ?? null });
  return (
    <li className="px-4 py-3 space-y-2" data-testid={`continue-path-${idSuffix}`}>
      <div className="flex items-center gap-2.5">
        {item.project.logoUrl
          ? <img src={item.project.logoUrl} alt="" className="h-8 w-8 object-contain shrink-0" />
          : <span className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-[11px] font-semibold text-muted-foreground shrink-0">{item.project.title.slice(0, 2).toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate flex items-center gap-1.5">
            <span className="truncate">{item.project.title}</span>
            {item.track && <span className="shrink-0 rounded-full bg-primary/10 text-primary px-1.5 py-px text-[10px] font-medium" title={item.track.label} data-testid={`continue-path-section-${idSuffix}`}>{item.track.short}</span>}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">{item.phase} · {item.progress.done}/{item.progress.total} steps{item.daysSinceActivity >= 2 ? ` · away ${item.daysSinceActivity} days` : ""}</p>
        </div>
        <Button asChild size="sm" className="h-8 gap-1" data-testid={`button-continue-path-${idSuffix}`}>
          <Link href={href}>Continue <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Button>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
      {item.next ? (
        <p className="flex items-center gap-1.5 flex-wrap" data-testid={`continue-path-next-${idSuffix}`}>
          {novaActs ? <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" /> : <User className="h-3.5 w-3.5 shrink-0" />}
          <span className="text-muted-foreground">Next:</span>
          <span className="font-medium">{item.next.step ?? item.next.title}</span>
          <span className="text-[11px] text-muted-foreground">· {ACTOR_SHORT[item.next.actor] ?? item.next.actor}{estimate(item.next.estimateMinutes) ? ` · ${estimate(item.next.estimateMinutes)}` : ""}</span>
        </p>
      ) : (
        <p className="text-muted-foreground">Main line done — pick what's next.</p>
      )}
      {/* Several steps this week: the weekly update. One: share that step. */}
      {item.weekly?.due && item.weekly.steps.length > 1 && (
        <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={() => onWeekly(item)} data-testid={`button-weekly-update-${idSuffix}`}>
          <Share2 className="h-3 w-3" /> {item.weekly.steps.length} steps this week — post an update
        </button>
      )}
      {item.lastDone && !item.lastDone.sharedPostId && !(item.weekly?.due && item.weekly.steps.length > 1) && (
        <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={() => onShare(item)} data-testid={`button-share-last-step-${idSuffix}`}>
          <Share2 className="h-3 w-3" /> Share "{item.lastDone.title}" for feedback
        </button>
      )}
    </li>
  );
}

export function ContinuePathCard() {
  const { data } = useQuery<{ items: NextStepItem[] }>({ queryKey: ["/api/me/next-steps"] });
  const [sharing, setSharing] = useState<NextStepItem | null>(null);
  const [weekly, setWeekly] = useState<NextStepItem | null>(null);
  // Closed until asked for: the home screen leads with Create Project, and the paths are one click away.
  const [open, setOpen] = useState(false);
  const items = data?.items ?? [];
  if (!items.length) return null;

  return (
    <>
      <Button
        variant="outline"
        className="w-full h-11 gap-2 text-[15px] font-semibold border-primary/30 bg-background dark:bg-card"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="continue-path-list"
        data-testid="button-toggle-continue-path"
      >
        <Compass className="h-4 w-4 text-primary" />
        Continue your path
        <span className="rounded-full bg-primary/10 text-primary px-2 py-px text-[11px] font-medium" data-testid="continue-path-count">{items.length}</span>
        <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {open && (
      <Card id="continue-path-list" className="rounded-lg shadow-none border-primary/30 bg-background dark:bg-card" data-testid="continue-path-card">
        <CardContent className="p-0 text-[13px]">
          <ul className="divide-y divide-border/60">
            {items.map((item) => (
              <NextStepRow key={`${item.project.id}:${item.track?.goal ?? ""}`} item={item} onShare={setSharing} onWeekly={setWeekly} />
            ))}
          </ul>
        </CardContent>
      </Card>
      )}
      {weekly?.weekly && (
        <WeeklyUpdateDialog projectId={weekly.project.id} projectTitle={weekly.project.title} steps={weekly.weekly.steps} open onClose={() => setWeekly(null)} />
      )}
      {sharing?.lastDone && (
        <ShareStepDialog
          projectId={sharing.project.id} projectTitle={sharing.project.title}
          step={sharing.lastDone} open onClose={() => setSharing(null)}
        />
      )}
    </>
  );
}
