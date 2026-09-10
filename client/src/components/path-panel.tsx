import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { WorkView, refreshPath, useFail, type WorkRow } from "@/components/path-work";
import { MilestoneDetail } from "@/components/path-milestone";
import { LoopTree, type LoopTreeData } from "@/components/loop-tree";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ACTOR_LABEL, type Actor, type VerificationTier, type PaceState, type ProjectionMode } from "@shared/phase-trees";
import { PROJECT_GOALS, subcategoriesFor, type ProjectGoal } from "@shared/goals";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, Loader2, Sparkles, User, GitBranch, ListTree, Plus, ArrowRightLeft, Repeat, LogOut } from "lucide-react";

interface PathMilestone {
  id: string; title: string; description: string; actor: Actor; estimateMinutes: number | null;
  tier: VerificationTier; done: boolean; taskId: string | null; taskStatus: string | null;
  expandsFrom?: string; steps: { done: number; total: number } | null;
}
interface Loop { taskId: string; title: string; description: string; status: string; expanded: boolean }
interface NextAction extends PathMilestone {
  step: { taskId: string; title: string; description: string; actor: Actor; isLoop: boolean; loop: { taskId: string; title: string } | null } | null;
  loops: Loop[];
  workTaskId: string | null;
  work: WorkRow | null;
}
interface PathPhase {
  id: string; title: string; optional: boolean; checkpoint: string | null; total: number; done: number;
  milestones: PathMilestone[];
  injected: { id: string; title: string; status: string; artifact: string | null }[];
  injectRoom: number;
}
interface NoPath { adopted: false; goal: ProjectGoal; subcategory: string; promise: string; existingTasks: number; existingDone: number }
interface PathStatus {
  adopted: true;
  goal: ProjectGoal; subcategory: string; promise: string; target: string;
  phases: PathPhase[];
  current: { id: string; title: string; optional: boolean; step: number; of: number };
  branch: { phaseId: string; title: string; open: boolean; round: number } | null;
  offer: { phaseId: string; title: string; milestones: string[] } | null;
  next: NextAction | null;
  mainLine: { done: number; total: number };
  plan: { loops: number; authoredDays: number; totalMinutes: number; doneMinutes: number } | null;
  loopTree: LoopTreeData | null;
  pace: { state: PaceState; multiplier: number | null; mode: ProjectionMode; projectedAt: string | null; projectedLow: string | null; projectedHigh: string | null; note: string; daysSinceActivity: number } | null;
  events: { id: string; title: string; estimateMinutes: number | null; actualMinutes: number | null; projectedBefore: string | null; projectedAfter: string | null; createdAt: string }[];
  proposal: { goal: ProjectGoal; why: string }[] | null;
}

const TIER_LABEL: Record<VerificationTier, string> = {
  verified: "Nova checks this itself",
  artifact: "Done when the artifact exists",
  evidence: "Done when you show it",
  claimed: "Your word counts",
};

function estimate(minutes: number | null) {
  if (minutes == null) return "open-ended";
  if (minutes === 0) return "automatic";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)}h`;
}
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

function projection(p: NonNullable<PathStatus["pace"]>) {
  if (p.mode === "pipeline") return "Pipeline mode";
  if (p.mode === "none" || !p.projectedAt) return "No date yet";
  if (p.mode === "range" && p.projectedLow && p.projectedHigh) return `${day(p.projectedLow)} – ${day(p.projectedHigh)}`;
  return day(p.projectedAt);
}

/**
 * The path as the dashboard shows it, one shape across every path and phase:
 * pace strip, Nova panel, the one next action, and the map one click away.
 */
export function PathPanel({ projectId, onNavigate }: { projectId: string; onNavigate: (tab: string) => void }) {
  const [showMap, setShowMap] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { toast } = useToast();
  const { data: raw, isLoading } = useQuery<PathStatus | NoPath>({ queryKey: ["/api/projects", projectId, "path"], enabled: !!projectId });

  const refresh = () => refreshPath(projectId);
  const fail = useFail();

  const markDone = useMutation({ mutationFn: (taskId: string) => apiRequest("PATCH", `/api/kanban/${taskId}`, { status: "done" }), onSuccess: refresh, onError: fail });
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
  const inject = useMutation({
    mutationFn: (phaseId: string) => apiRequest("POST", `/api/projects/${projectId}/path/inject`, { phaseId }).then((r) => r.json()),
    onSuccess: (r: any) => {
      refresh();
      toast({ title: r.created?.length ? `Nova added ${r.created.length} task${r.created.length === 1 ? "" : "s"} for this phase` : "Nothing in your artifacts calls for more here", description: r.dropped?.length ? `${r.dropped.length} idea${r.dropped.length === 1 ? "" : "s"} left out — no artifact to ground them in.` : undefined });
    },
    onError: fail,
  });
  const adopt = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/path/adopt`, {}).then((r) => r.json()),
    onSuccess: (r: any) => {
      refresh();
      const bits = [
        r.recognised?.length ? `${r.recognised.length} milestone${r.recognised.length === 1 ? "" : "s"} marked done` : null,
        r.filled?.length ? `${r.filled.length} written in from your brief and audit` : null,
        r.loops?.created?.length ? `${r.loops.created.length} loop${r.loops.created.length === 1 ? "" : "s"} found (${r.loops.found.map((l: any) => l.title).join(", ")})` : null,
        r.plan && r.plan.loops > 1 ? `plan re-sized for ${r.plan.loops} loops: ${Math.round(r.plan.authoredDays / 7)} weeks` : null,
      ].filter(Boolean);
      toast({ title: bits.length ? `Nova re-read your project: ${bits.join(", ")}` : (r.built ? "Your project is on its path" : "Nothing new — the path already matches what Nova can see"), description: r.read || undefined });
    },
    onError: fail,
  });
  const mark = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", `/api/projects/${projectId}/path/mark`, { ids }).then((r) => r.json()),
    onSuccess: refresh, onError: fail,
  });
  const branch = useMutation({
    mutationFn: (b: { phaseId: string | null; extend?: boolean }) => apiRequest("POST", `/api/projects/${projectId}/path/branch`, b).then((r) => r.json()),
    onSuccess: (r: any, b) => { refresh(); toast({ title: b.phaseId ? (b.extend ? `Extending again — round ${r.round}` : "Keep building it is. Nova works the extension now.") : "Back on the main line" }); },
    onError: fail,
  });
  const [loopForm, setLoopForm] = useState<{ title: string; description: string } | null>(null);
  const addLoop = useMutation({
    mutationFn: (b: { backboneId: string; title: string; description: string }) => apiRequest("POST", `/api/projects/${projectId}/path/loops`, b).then((r) => r.json()),
    onSuccess: () => { setLoopForm(null); refresh(); toast({ title: "Loop added — write it down, then break it into steps" }); },
    onError: fail,
  });
  const switchPath = useMutation({
    mutationFn: (body: { goal: ProjectGoal; subcategory: string }) => apiRequest("POST", `/api/projects/${projectId}/path/switch`, body).then((r) => r.json()),
    onSuccess: (r: any) => { refresh(); setShowSwitch(false); toast({ title: "Moved to the new path", description: r.carried ? `${r.carried} shared milestone${r.carried === 1 ? "" : "s"} carried across as done.` : undefined }); },
    onError: fail,
  });

  if (isLoading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  if (!raw) return null;
  if (!raw.adopted) {
    // Made before paths existed. Offer the path, and Nova's read of where the work already is.
    return (
      <Card className="border-primary/40" data-testid="path-adopt">
        <CardContent className="p-4 space-y-2">
          <p className="font-semibold">Put this project on its path</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {raw.promise}. You already have {raw.existingDone} of {raw.existingTasks} tasks done — Nova will read those, your audits and check-ins, and mark what's already finished so the path starts where you are.
          </p>
          <Button size="sm" onClick={() => adopt.mutate()} disabled={adopt.isPending} data-testid="button-adopt-path">
            {adopt.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            {adopt.isPending ? "Nova is reading your project…" : "Start the path and read my progress"}
          </Button>
        </CardContent>
      </Card>
    );
  }
  const data = raw;

  const { current, next, mainLine, pace } = data;
  const pct = mainLine.total ? Math.round((mainLine.done / mainLine.total) * 100) : 0;
  const novaActs = next && next.actor !== "user-does";
  const goalLabel = (g: ProjectGoal) => PROJECT_GOALS.find((x) => x.id === g)?.label ?? g;
  const sources = new Set(data.phases.flatMap((p) => p.milestones).map((m) => m.expandsFrom).filter(Boolean));
  const isSource = (id: string) => sources.has(id);

  return (
    <div className="space-y-3" data-testid="path-panel">
      {/* Pace strip */}
      <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
        <div className="min-w-0">
          <p className="font-medium truncate flex items-center gap-2" data-testid="path-phase">
            {current.optional && <GitBranch className="h-3.5 w-3.5 text-primary shrink-0" />}{current.title}
            {data.branch?.open && data.branch.round > 1 && <Badge variant="secondary" className="text-[10px]">round {data.branch.round}</Badge>}
          </p>
          <p className="text-muted-foreground">
            Step {current.step} of {current.of} · {mainLine.done}/{mainLine.total} on the main line
            {data.plan && data.plan.loops > 1 && <> · <span data-testid="plan-loops">{data.plan.loops} loops · {Math.round(data.plan.authoredDays / 7)}-week plan</span></>}
            {pace && <> · <span data-testid="pace-projection">{projection(pace)}</span></>}
            {pace?.multiplier != null && <> · <span data-testid="pace-multiplier">{pace.multiplier}×</span></>}
          </p>
        </div>
        <button className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1" onClick={() => setShowMap(!showMap)} data-testid="button-toggle-path">
          {showMap ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showMap ? "Hide the path" : "See the whole path"}
        </button>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      {/* Nova panel: one line on pace, and the button that re-reads the project. */}
      {pace && (
        <div className="rounded-lg border border-border/60 p-3 flex items-center gap-3 flex-wrap text-sm" data-testid="nova-panel">
          <div className="flex items-start gap-2 flex-1 min-w-[16rem]">
            <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
            <p className="text-muted-foreground leading-relaxed" data-testid="pace-note">
              {pace.state === "nudge" && "A week without a check-in. The date is unchanged — one small step keeps it that way. "}
              {pace.note}
            </p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" disabled={adopt.isPending} onClick={() => adopt.mutate()} data-testid="button-reevaluate" title="Nova re-reads your brief, setup, audits and tasks, marks what's done and writes in what it finds.">
            {adopt.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            {adopt.isPending ? "Nova is re-reading…" : "Re-evaluate where I'm at"}
          </Button>
        </div>
      )}

      {/* The fork after week 2: keep building, or go to users. Chosen, never drifted into. */}
      {data.offer && (
        <Card className="border-primary/40" data-testid="branch-offer">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><GitBranch className="h-3.5 w-3.5 text-primary" /><span>Your product does its main thing. Two ways forward.</span></div>
            <p className="font-semibold leading-snug">{data.offer.title}</p>
            <p className="text-sm text-muted-foreground">Most builders want more in before anyone else sees it. Nova sorts what's left into what serves the loop and what starts its own, you pick, set a length, and the projected date moves live. Extending is activity — no decay, no penalty.</p>
            <div className="flex gap-2 pt-1 flex-wrap">
              <Button size="sm" disabled={branch.isPending} onClick={() => branch.mutate({ phaseId: data.offer!.phaseId })} data-testid="button-keep-building"><GitBranch className="h-3.5 w-3.5 mr-1.5" />Keep building</Button>
              <Button size="sm" variant="outline" onClick={() => toast({ title: "On to " + current.title })} data-testid="button-go-main">Go to {current.title.split(" — ")[1] ?? current.title}</Button>
            </div>
          </CardContent>
        </Card>
      )}
      {data.branch?.open && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap" data-testid="branch-strip">
          <GitBranch className="h-3.5 w-3.5 text-primary" /><span>Extending. When this round is built:</span>
          <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={branch.isPending} onClick={() => branch.mutate({ phaseId: data.branch!.phaseId, extend: true })} data-testid="button-extend-again"><Repeat className="h-3 w-3 mr-1" />Extend again</Button>
          <Button size="sm" variant="ghost" className="h-6 text-xs" disabled={branch.isPending} onClick={() => branch.mutate({ phaseId: null })} data-testid="button-leave-branch"><LogOut className="h-3 w-3 mr-1" />Go to users</Button>
        </div>
      )}

      {/* Week 2's screen: the product as a tree of loops, each with its steps. */}
      {data.loopTree && (
        <div className="space-y-2 pt-1" data-testid="loop-tree-section">
          <div className="flex items-center gap-2">
            <ListTree className="h-4 w-4 text-primary" />
            <p className="font-semibold text-sm">Your loops</p>
            <span className="text-xs text-muted-foreground">Each is written, broken into steps, and built — click any node.</span>
          </div>
          <LoopTree projectId={projectId} tree={data.loopTree} />
        </div>
      )}

      {/* The one next action. */}
      {next ? (
        <Card className="border-primary/40" data-testid="next-action">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
              {novaActs ? <Sparkles className="h-3.5 w-3.5 text-primary" /> : <User className="h-3.5 w-3.5" />}
              <span>{ACTOR_LABEL[next.actor]}</span>
              <span>·</span><span>{estimate(next.estimateMinutes)}</span>
              <span>·</span><span>{TIER_LABEL[next.tier]}</span>
              {next.steps && <><span>·</span><span data-testid="next-steps">{next.steps.done}/{next.steps.total} steps</span></>}
            </div>
            <p className="font-semibold leading-snug" data-testid="next-action-title">{next.title}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{next.description}</p>
            {/* Loops behind this milestone: written or not, broken into steps or not. */}
            {next.loops.length > 0 && (
              <div className="space-y-1" data-testid="next-loops">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Loops · {next.loops.length}</p>
                <ul className="text-sm space-y-1">
                  {next.loops.map((l) => (
                    <li key={l.taskId} className="flex items-center gap-2 flex-wrap">
                      {l.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                      <span>{l.title}</span>
                      {l.status !== "done" && <span className="text-xs text-muted-foreground">not written yet</span>}
                      {next.expandsFrom && !l.expanded && (
                        <Button size="sm" variant="outline" className="h-6 text-xs ml-auto" disabled={expand.isPending || !!draft} onClick={() => expand.mutate({ backboneId: next.id, loopTaskId: l.taskId })} data-testid={`button-expand-loop-${l.taskId}`}>
                          <ListTree className="h-3 w-3 mr-1" />Break into steps
                        </Button>
                      )}
                      {next.expandsFrom && l.expanded && <span className="text-xs text-muted-foreground ml-auto">steps added</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {next.step && (
              <div className="rounded-md bg-muted/50 p-3 space-y-1" data-testid="next-step">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{next.step.isLoop ? "Write this loop" : next.step.loop ? `Step · ${next.step.loop.title}` : "This step"}</p>
                <p className="font-medium text-sm">{next.step.title}</p>
                {next.step.description && <p className="text-sm text-muted-foreground">{next.step.description}</p>}
              </div>
            )}

            {/* Nova's work on it, inline. This is what makes the actor label true. */}
            {next.workTaskId && !(next.expandsFrom && !next.steps) && !(isSource(next.id) && next.loops.length > 0 && !next.step) && (
              <div className="pt-2 border-t border-border">
                <WorkView projectId={projectId} taskId={next.workTaskId} actor={next.step?.actor ?? next.actor} work={next.work} done={false} />
              </div>
            )}

            <div className="flex gap-2 pt-1 flex-wrap">
              {isSource(next.id) && !loopForm && (
                <Button size="sm" variant="outline" onClick={() => setLoopForm({ title: "", description: "" })} data-testid="button-add-loop"><Plus className="h-3.5 w-3.5 mr-1.5" />Add another loop</Button>
              )}
              {next.expandsFrom && !next.steps && next.loops.length === 0 && (
                <Button size="sm" onClick={() => expand.mutate({ backboneId: next.id })} disabled={expand.isPending || !!draft} data-testid="button-next-expand">
                  {expand.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ListTree className="h-3.5 w-3.5 mr-1.5" />}Break into steps with Nova
                </Button>
              )}
              {next.taskId && (
                <Button size="sm" variant="outline" onClick={() => markDone.mutate(next.step?.taskId ?? next.taskId!)} disabled={markDone.isPending} data-testid="button-next-done">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  {next.tier === "claimed" ? "I did this" : "Done"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onNavigate("kanban")} data-testid="button-next-open">Open in tasks</Button>
            </div>
            {loopForm && (
              <div className="space-y-2 pt-2 border-t border-border" data-testid="loop-form">
                <p className="text-xs text-muted-foreground">Name the loop and, if you can, its 3–5 steps. Nova can draft the steps from the name later.</p>
                <input className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm" placeholder="e.g. The feed — explore what others are building" value={loopForm.title} onChange={(e) => setLoopForm({ ...loopForm, title: e.target.value })} data-testid="input-loop-title" />
                <Textarea rows={3} className="text-sm" placeholder="1. Open the feed 2. Read a check-in 3. React or reply 4. Follow the project" value={loopForm.description} onChange={(e) => setLoopForm({ ...loopForm, description: e.target.value })} data-testid="input-loop-description" />
                <div className="flex gap-2">
                  <Button size="sm" disabled={addLoop.isPending || !loopForm.title.trim()} onClick={() => addLoop.mutate({ backboneId: next.expandsFrom ?? next.id, ...loopForm })} data-testid="button-save-loop">Add loop</Button>
                  <Button size="sm" variant="ghost" onClick={() => setLoopForm(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {draft && (
              <div className="space-y-2 pt-2 border-t border-border" data-testid="artifact-draft">
                <p className="text-xs text-muted-foreground">Nothing was written under <span className="font-medium text-foreground">{draft.sourceTitle}</span> yet, so Nova drafted it from your project. Edit anything that's wrong, then build the steps from it.</p>
                <Textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={6} className="text-sm" data-testid="input-artifact-draft" />
                <div className="flex gap-2">
                  <Button size="sm" disabled={expand.isPending || !draft.text.trim()} onClick={() => expand.mutate({ backboneId: draft.backboneId, loopTaskId: draft.loopTaskId, artifact: draft.text })} data-testid="button-confirm-draft">
                    {expand.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ListTree className="h-3.5 w-3.5 mr-1.5" />}Looks right — build the steps
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card data-testid="path-complete"><CardContent className="p-4 space-y-3">
          <p className="text-sm font-medium">The path is complete.</p>
          {data.proposal?.map((p) => (
            <div key={p.goal} className="flex items-start justify-between gap-3 text-sm">
              <div><p className="font-medium">{goalLabel(p.goal)}</p><p className="text-muted-foreground">{p.why}</p></div>
              <Button size="sm" variant="outline" onClick={() => { setShowSwitch(true); setShowMap(true); }}>Go</Button>
            </div>
          ))}
        </CardContent></Card>
      )}

      {showMap && (
        <div className="space-y-4 pt-2" data-testid="path-map">
          <p className="text-sm text-muted-foreground">{data.promise}.</p>
          {data.phases.map((phase) => (
            <div key={phase.id} className={phase.optional ? "border-l-2 border-dashed border-border pl-3" : ""}>
              <div className="flex items-center gap-2 mb-1.5">
                {phase.optional && <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />}
                <p className="text-sm font-medium">{phase.title}</p>
                <Badge variant="secondary" className="text-[10px]">{phase.done}/{phase.total}</Badge>
                {phase.optional && data.branch?.phaseId !== phase.id && (
                  <Button size="sm" variant="ghost" className="h-6 text-xs ml-auto" disabled={branch.isPending} onClick={() => branch.mutate({ phaseId: phase.id })} data-testid={`button-enter-${phase.id}`}>Work this branch</Button>
                )}
              </div>
              <ul className="space-y-1">
                {phase.milestones.map((m) => (
                  <li key={m.id} className="text-sm">
                  <div className="flex items-start gap-2">
                    {m.done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 mt-0.5 shrink-0" />}
                    <button className={`text-left hover:underline ${m.done ? "text-muted-foreground line-through" : ""}`} onClick={() => setOpen(open === m.id ? null : m.id)} data-testid={`open-${m.id}`}>
                      {m.title}{m.steps && <span className="text-muted-foreground no-underline"> ({m.steps.done}/{m.steps.total} steps)</span>}
                    </button>
                    <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{m.actor === "user-does" ? "you" : "Nova"} · {estimate(m.estimateMinutes)}</span>
                    {!m.done && (
                      <button className="text-[11px] text-primary hover:underline shrink-0" disabled={mark.isPending} onClick={() => mark.mutate([m.id])} data-testid={`mark-${m.id}`} title="Already done? Mark it.">
                        done
                      </button>
                    )}
                  </div>
                  {open === m.id && <div className="mt-2 mb-3 ml-5"><MilestoneDetail projectId={projectId} backboneId={m.id} /></div>}
                  </li>
                ))}
                {phase.injected.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 text-sm" data-testid="injected-task">
                    {t.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /> : <Sparkles className="h-3.5 w-3.5 text-primary/60 mt-0.5 shrink-0" />}
                    <span className={t.status === "done" ? "text-muted-foreground line-through" : ""}>{t.title}</span>
                    <span className="text-[11px] text-muted-foreground ml-auto shrink-0">Nova added</span>
                  </li>
                ))}
              </ul>
              {phase.checkpoint && <p className="text-xs text-muted-foreground mt-1.5 italic">{phase.checkpoint}</p>}
              {!phase.optional && (
                <button className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1.5" disabled={inject.isPending || phase.injectRoom <= 0} onClick={() => inject.mutate(phase.id)} data-testid={`inject-${phase.id}`}>
                  <Plus className="h-3 w-3" />{phase.injectRoom > 0 ? `Ask Nova what this phase is missing (${phase.injectRoom} left)` : "Nova's additions for this phase are full"}
                </button>
              )}
            </div>
          ))}

          {/* Switching is visible, not hidden. */}
          <div className="border-t border-border pt-3 space-y-2">
            {!showSwitch ? (
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setShowSwitch(true)} data-testid="button-show-switch">
                <ArrowRightLeft className="h-3 w-3 mr-1" />Move this project to another path
              </Button>
            ) : (
              <SwitchForm current={data} pending={switchPath.isPending} onSwitch={(b) => switchPath.mutate(b)} onCancel={() => setShowSwitch(false)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SwitchForm({ current, pending, onSwitch, onCancel }: { current: PathStatus; pending: boolean; onSwitch: (b: { goal: ProjectGoal; subcategory: string }) => void; onCancel: () => void }) {
  const [goal, setGoal] = useState<ProjectGoal>(PROJECT_GOALS.find((g) => g.id !== current.goal)!.id);
  const [subcategory, setSubcategory] = useState<string>("other");
  return (
    <div className="space-y-2 text-sm" data-testid="switch-form">
      <p className="text-muted-foreground">Shared milestones you've already finished carry across as done. The current path's tasks stay on the board, marked.</p>
      <div className="flex gap-1 flex-wrap">
        {PROJECT_GOALS.filter((g) => g.id !== current.goal).map((g) => (
          <Button key={g.id} size="sm" variant={goal === g.id ? "default" : "outline"} onClick={() => { setGoal(g.id); setSubcategory("other"); }} data-testid={`switch-goal-${g.id}`}>{g.label}</Button>
        ))}
      </div>
      <div className="flex gap-1 flex-wrap">
        {subcategoriesFor(goal).map((s) => (
          <Button key={s.id} size="sm" variant={subcategory === s.id ? "secondary" : "ghost"} onClick={() => setSubcategory(s.id)} data-testid={`switch-subcategory-${s.id}`}>{s.label}</Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => onSwitch({ goal, subcategory })} data-testid="button-switch-path">Switch path</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
