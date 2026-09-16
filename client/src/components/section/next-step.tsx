/**
 * The one thing to do next on a section's path — the first thing on the
 * dashboard, so a builder knows where to start in a glance: what it is, who
 * does it, how long, and the button that starts it.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WorkView, refreshPath, useFail } from "@/components/path-work";
import { addableLoopTypes } from "@/components/loop-tree";
import { ShareStepDialog, PublishArtifactDialog, WeeklyUpdateDialog } from "@/components/continue-path-card";
import { InviteCollaboratorDialog } from "@/components/invite-collaborator-dialog";
import { LowCreditsNotice } from "@/components/upgrade-to-keep-generating";
import { sectionDef } from "@/lib/sections";
import { LOOP_TYPE_INFO, type LoopType } from "@shared/phase-trees";
import { PATH_FOCUS } from "@shared/notifications";
import { Chip, Clamp } from "./block";
import { ACTOR_SHORT, TIER_SHORT, estimate, NOVA_GRADIENT, type PathStatus } from "./path-types";
import { CheckCircle2, Circle, Clock, ListTree, Loader2, Plus, ShieldCheck, Sparkles, User, Share2, Globe, PartyPopper, ArrowRight, ListChecks, UserPlus } from "lucide-react";

export function NextStep({ projectId, data, onNavigate }: { projectId: string; data: PathStatus; onNavigate: (tab: string) => void }) {
  const { toast } = useToast();
  const fail = useFail();
  const refresh = () => refreshPath(projectId);
  const { data: projectInfo } = useQuery<{ title?: string; soloMode?: boolean | null }>({ queryKey: ["/api/projects", projectId], enabled: !!projectId });
  const title = projectInfo?.title ?? "your project";
  const [sharingStep, setSharingStep] = useState(false);
  const [publishingStep, setPublishingStep] = useState(false);
  const [postingWeek, setPostingWeek] = useState(false);
  const highlighted = usePathFocus(data, () => setPostingWeek(true));

  const { next, current } = data;
  const sources = new Set(data.phases.flatMap((p) => p.milestones).map((m) => m.expandsFrom).filter(Boolean));
  const isSource = (id: string) => sources.has(id);

  const markDone = useMutation({ mutationFn: (taskId: string) => apiRequest("PATCH", `/api/kanban/${taskId}`, { status: "done" }), onSuccess: refresh, onError: fail });
  // The builder's own answer, without Nova: it becomes the step's written answer — what Publish makes the artifact from.
  const [writing, setWriting] = useState<string | null>(null);
  const writeDone = useMutation({
    mutationFn: (b: { taskId: string; description: string }) => apiRequest("PATCH", `/api/kanban/${b.taskId}`, { status: "done", description: b.description }),
    onSuccess: () => { setWriting(null); refresh(); },
    onError: fail,
  });
  const [draft, setDraft] = useState<{ backboneId: string; loopTaskId: string | null; sourceTitle: string; text: string } | null>(null);
  const expand = useMutation({
    mutationFn: (body: { backboneId: string; artifact?: string; loopTaskId?: string | null }) => apiRequest("POST", `/api/projects/${projectId}/path/expand`, body).then((r) => r.json()),
    onSuccess: (r: any) => { setDraft(null); refresh(); toast({ title: r.created?.length ? `Nova broke it into ${r.created.length} steps` : "Steps already exist" }); },
    onError: async (e: any, body) => {
      // Nothing written yet: ask Nova to draft it, and let them edit before it becomes the source.
      if (String(e?.message ?? "").includes("artifact_missing")) {
        try {
          const r = await apiRequest("POST", `/api/projects/${projectId}/path/expand`, { backboneId: body.backboneId, loopTaskId: body.loopTaskId ?? null, draft: true }).then((x) => x.json());
          setDraft({ backboneId: body.backboneId, loopTaskId: body.loopTaskId ?? null, sourceTitle: r.sourceTitle, text: r.draft });
          return;
        } catch (err) { return fail(err); }
      }
      fail(e);
    },
  });
  const [loopForm, setLoopForm] = useState<{ title: string; description: string; type: LoopType } | null>(null);
  const addLoop = useMutation({
    mutationFn: (b: { backboneId: string; title: string; description: string; type: LoopType }) => apiRequest("POST", `/api/projects/${projectId}/path/loops`, b).then((r) => r.json()),
    onSuccess: () => { setLoopForm(null); refresh(); toast({ title: "Loop added" }); },
    onError: fail,
  });

  // On the route question, each route's fit score sits on its bubble.
  const routeNotes = next?.routeQuestion && data.capital && data.capital.answered >= 3
    ? { [next.routeQuestion]: Object.fromEntries(data.capital.routeFit.map((r) => [r.route, `fit ${r.score}`])) }
    : undefined;

  const followUps = (
    <>
      {data.lastDone && (
        <div className="flex items-center gap-x-3 gap-y-1 text-xs flex-wrap" data-testid="path-last-done">
          <span className="flex items-center gap-1.5 min-w-0"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /><span className="text-muted-foreground">Finished</span><span className="font-medium truncate max-w-[16rem]">{data.lastDone.title}</span></span>
          {data.lastDone.sharedPostId ? (
            <Link href={`/posts/${data.lastDone.sharedPostId}`} className="text-primary hover:underline" data-testid="link-shared-step">See feedback</Link>
          ) : (
            <span className="flex items-center gap-3">
              <button className="text-primary hover:underline flex items-center gap-1" onClick={() => setSharingStep(true)} data-testid="button-share-finished-step"><Share2 className="h-3 w-3" />Share</button>
              <button className="text-primary hover:underline flex items-center gap-1" onClick={() => setPublishingStep(true)} data-testid="button-publish-finished-step"><Globe className="h-3 w-3" />Publish</button>
            </span>
          )}
        </div>
      )}
      {/*
        * Finishing something is when bringing in the next person is a real
        * thought rather than an interruption: the work just showed what's
        * needed next. Anyone on the team can invite (server/invite-routes.ts),
        * so this is the means as well as the moment — and the loop's last leg,
        * which otherwise ends with whoever the owner happened to invite first.
        */}
      {data.lastDone && !projectInfo?.soloMode && (
        <div className="flex items-center gap-2 text-xs flex-wrap" data-testid="path-invite-next">
          <span className="text-muted-foreground">Need someone for what's next?</span>
          <InviteCollaboratorDialog projectId={projectId} projectTitle={title} trigger={
            <button className="text-primary hover:underline flex items-center gap-1" data-testid="button-invite-from-path"><UserPlus className="h-3 w-3" />Invite a collaborator</button>
          } />
        </div>
      )}
      {data.weekly?.due && data.weekly.steps.length > 1 && (
        <div className="flex items-center gap-2 text-xs flex-wrap" data-testid="path-weekly-update">
          <span className="text-muted-foreground">{data.weekly.steps.length} steps done this week, not shared</span>
          <button className="text-primary hover:underline" onClick={() => setPostingWeek(true)} data-testid="button-path-weekly-update">Post weekly update</button>
        </div>
      )}
      {postingWeek && data.weekly && <WeeklyUpdateDialog projectId={projectId} projectTitle={title} steps={data.weekly.steps} open onClose={() => setPostingWeek(false)} />}
      {publishingStep && data.lastDone && <PublishArtifactDialog projectId={projectId} projectTitle={title} step={data.lastDone} open onClose={() => setPublishingStep(false)} />}
      {sharingStep && data.lastDone && <ShareStepDialog projectId={projectId} projectTitle={title} step={data.lastDone} open onClose={() => setSharingStep(false)} />}
    </>
  );

  if (!next) {
    return (
      <div className="space-y-3">
        <div className={`rounded-xl border border-border p-5 space-y-3 transition-shadow ${highlighted ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`} data-testid="path-complete">
          <p className="font-semibold flex items-center gap-2"><PartyPopper className="h-4 w-4 text-primary" />Path complete</p>
          {data.proposal?.map((p) => (
            <div key={p.goal} className="flex items-center justify-between gap-3 text-sm border-t border-border pt-3">
              <div className="min-w-0"><p className="font-medium">{sectionDef(p.goal).label}</p><p className="text-xs text-muted-foreground line-clamp-2">{p.why}</p></div>
              <Button size="sm" variant="outline" asChild><a href={`/projects/${projectId}/manage?section=${p.goal}`}>Open<ArrowRight className="h-3.5 w-3.5 ml-1" /></a></Button>
            </div>
          ))}
        </div>
        {followUps}
      </div>
    );
  }

  const novaActs = next.actor !== "user-does";
  const [phaseHead] = current.title.split(" — ");
  const showWork = next.workTaskId && !(next.expandsFrom && !next.steps) && !(isSource(next.id) && next.loops.length > 0 && !next.step);

  return (
    <div className="space-y-3">
      <LowCreditsNotice />
      <div className={`rounded-xl p-[1.5px] ${NOVA_GRADIENT} shadow-sm transition-shadow ${highlighted ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`} data-testid="next-action-frame">
        <div className="rounded-[10.5px] bg-background p-4 sm:p-5 space-y-3" data-testid="next-action">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Chip className="bg-primary/10 text-primary font-medium" title={current.title} testid="path-phase">
              {phaseHead} · Step {current.step} of {current.of}
            </Chip>
            <Chip icon={novaActs ? Sparkles : User}>{ACTOR_SHORT[next.actor]}</Chip>
            <Chip icon={Clock}>{estimate(next.estimateMinutes)}</Chip>
            <Chip icon={ShieldCheck} title="How this counts as done">{TIER_SHORT[next.tier]}</Chip>
            {next.steps && <Chip icon={ListChecks} testid="next-steps">{next.steps.done}/{next.steps.total} steps</Chip>}
          </div>

          <div className="space-y-1">
            <h3 className="text-lg sm:text-xl font-semibold leading-snug tracking-tight" data-testid="next-action-title">{next.title}</h3>
            <Clamp text={next.description} />
          </div>

          {next.step && (
            <div className="rounded-lg bg-muted/50 px-3 py-2.5 space-y-0.5" data-testid="next-step">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{next.step.isLoop ? "Write this loop" : next.step.loop ? `Step · ${next.step.loop.title}` : "This step"}</p>
              <p className="font-medium text-sm">{next.step.title}</p>
              {next.step.description && <Clamp text={next.step.description} lines={1} />}
            </div>
          )}

          {/* Loops behind this milestone: written or not, broken into steps or not. */}
          {next.loops.length > 0 && (
            <div className="space-y-1.5" data-testid="next-loops">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Loops · {next.loops.filter((l) => l.status === "done").length}/{next.loops.length} written</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {next.loops.map((l) => (
                  <li key={l.taskId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    {l.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                    <span className="truncate">{l.title}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{LOOP_TYPE_INFO[l.type ?? "product"]?.label}</span>
                    {next.expandsFrom && !l.expanded && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs ml-auto" disabled={expand.isPending || !!draft} onClick={() => expand.mutate({ backboneId: next.id, loopTaskId: l.taskId })} data-testid={`button-expand-loop-${l.taskId}`}>
                        <ListTree className="h-3 w-3 mr-1" />Break down
                      </Button>
                    )}
                    {next.expandsFrom && l.expanded && <CheckCircle2 className="h-3 w-3 text-muted-foreground ml-auto" aria-label="Steps added" />}
                  </li>
                ))}
              </ul>
              {(next.missingLoopTypes?.length ?? 0) > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="next-missing-loops">
                  Missing: {(next.missingLoopTypes ?? []).map((t) => LOOP_TYPE_INFO[t].label.toLowerCase()).join(", ")}
                </p>
              )}
            </div>
          )}

          {/* Nova's work on it, inline. This is what makes the actor label true. */}
          {showWork && (
            <div className="pt-1">
              <WorkView projectId={projectId} taskId={next.workTaskId!} actor={next.step?.actor ?? next.actor} work={next.work} done={false}
                intake={next.step ? undefined : next.intake} workKind={next.step ? undefined : next.workKind ?? undefined}
                prefill={next.step ? undefined : next.prefill} optionNotes={routeNotes} />
            </div>
          )}

          <div className="flex gap-2 flex-wrap items-center border-t border-border pt-3">
            {next.expandsFrom && !next.steps && next.loops.length === 0 && (
              <Button size="sm" onClick={() => expand.mutate({ backboneId: next.id })} disabled={expand.isPending || !!draft} data-testid="button-next-expand">
                {expand.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ListTree className="h-3.5 w-3.5 mr-1.5" />}Break into steps with Nova
              </Button>
            )}
            {isSource(next.id) && !loopForm && (
              <Button size="sm" variant="outline" onClick={() => { const t = next.missingLoopTypes?.[0] ?? "product"; setLoopForm({ title: next.missingLoopTypes?.length ? LOOP_TYPE_INFO[t].label : "", description: "", type: t }); }} data-testid="button-add-loop">
                <Plus className="h-3.5 w-3.5 mr-1.5" />{next.missingLoopTypes?.length ? `Add ${LOOP_TYPE_INFO[next.missingLoopTypes[0]].label.toLowerCase()}` : "Add loop"}
              </Button>
            )}
            {next.taskId && (
              <Button size="sm" variant="outline" onClick={() => markDone.mutate(next.step?.taskId ?? next.taskId!)} disabled={markDone.isPending} data-testid="button-next-done">
                {markDone.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                {next.tier === "claimed" ? "I did this" : "Done"}
              </Button>
            )}
            {next.taskId && writing == null && (
              <Button size="sm" variant="ghost" onClick={() => setWriting("")} data-testid="button-next-write">Write it myself</Button>
            )}
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => onNavigate("kanban")} data-testid="button-next-open">Open in tasks</Button>
          </div>

          {writing != null && next.taskId && (
            <div className="space-y-2 border-t border-border pt-3" data-testid="next-write-form">
              <Textarea rows={5} className="text-sm" autoFocus placeholder="Your answer to this step. It's what Publish turns into a public page." value={writing} onChange={(e) => setWriting(e.target.value)} data-testid="input-next-answer" />
              <div className="flex gap-2">
                <Button size="sm" disabled={writeDone.isPending || !writing.trim()} onClick={() => writeDone.mutate({ taskId: next.step?.taskId ?? next.taskId!, description: writing.trim() })} data-testid="button-next-save-done">
                  {writeDone.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}Save and mark done
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setWriting(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {loopForm && (
            <div className="space-y-2 border-t border-border pt-3" data-testid="loop-form">
              <div className="flex gap-2">
                <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={loopForm.type} onChange={(e) => setLoopForm({ ...loopForm, type: e.target.value as LoopType })} data-testid="select-loop-type">
                  {addableLoopTypes(next.loops.map((l) => ({ type: l.type ?? "product" }))).map((t) => <option key={t} value={t}>{LOOP_TYPE_INFO[t].label}</option>)}
                </select>
                <input className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-1.5 text-sm" placeholder="Loop name" value={loopForm.title} onChange={(e) => setLoopForm({ ...loopForm, title: e.target.value })} data-testid="input-loop-title" />
              </div>
              <Textarea rows={3} className="text-sm" placeholder="Its 3–5 steps (optional)" value={loopForm.description} onChange={(e) => setLoopForm({ ...loopForm, description: e.target.value })} data-testid="input-loop-description" />
              <div className="flex gap-2">
                <Button size="sm" disabled={addLoop.isPending || !loopForm.title.trim()} onClick={() => addLoop.mutate({ backboneId: next.expandsFrom ?? next.id, ...loopForm })} data-testid="button-save-loop">Add loop</Button>
                <Button size="sm" variant="ghost" onClick={() => setLoopForm(null)}>Cancel</Button>
              </div>
            </div>
          )}
          {draft && (
            <div className="space-y-2 border-t border-border pt-3" data-testid="artifact-draft">
              <p className="text-xs text-muted-foreground">Nova drafted <span className="font-medium text-foreground">{draft.sourceTitle}</span>. Edit, then build the steps.</p>
              <Textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={6} className="text-sm" data-testid="input-artifact-draft" />
              <div className="flex gap-2">
                <Button size="sm" disabled={expand.isPending || !draft.text.trim()} onClick={() => expand.mutate({ backboneId: draft.backboneId, loopTaskId: draft.loopTaskId, artifact: draft.text })} data-testid="button-confirm-draft">
                  {expand.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ListTree className="h-3.5 w-3.5 mr-1.5" />}Build the steps
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </div>
      {followUps}
    </div>
  );
}

/**
 * Arriving from a notification or a "Continue" link (`?focus=`, shared/notifications.ts):
 * bring the Next Step card into view and light it up for a moment, so the
 * person lands on the thing to do rather than somewhere on the dashboard.
 *
 * `weekly` also opens the weekly update. A milestone id that's no longer the
 * next step says so — the step they were told about got done in the meantime.
 * The param is removed once handled, so a reload or a tab switch doesn't
 * replay it. Returns whether the card is highlighted right now.
 */
function usePathFocus(data: PathStatus, openWeekly: () => void): boolean {
  const { toast } = useToast();
  const search = useSearch();
  const focus = new URLSearchParams(search).get("focus");
  const handled = useRef<string | null>(null);
  const [highlighted, setHighlighted] = useState(false);

  useEffect(() => {
    if (!focus || handled.current === focus) return;
    handled.current = focus;

    // No cleanup: removing the param below re-runs this effect, and cancelling here would undo the scroll and leave the highlight on.
    requestAnimationFrame(() => {
      document.querySelector('[data-testid="next-action-frame"], [data-testid="path-complete"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setHighlighted(true);
    window.setTimeout(() => setHighlighted(false), 2500);

    if (focus === PATH_FOCUS.weekly) {
      if (data.weekly?.due && data.weekly.steps.length) openWeekly();
      else toast({ title: "Nothing new to share", description: "This week's finished steps are already posted." });
    } else if (focus !== PATH_FOCUS.next && data.next && data.next.id !== focus) {
      toast({ title: "That step's done", description: `Next up: ${data.next.step?.title ?? data.next.title}` });
    }

    const params = new URLSearchParams(window.location.search);
    params.delete("focus");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    // Once per focus value; the data is already loaded when this card renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  return highlighted;
}
