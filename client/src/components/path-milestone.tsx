import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type Actor, type VerificationTier, type IntakeQuestion, type WorkKind } from "@shared/phase-trees";
import { WorkView, refreshPath, useFail, type WorkRow } from "@/components/path-work";
import { Clamp } from "@/components/section/block";
import { ACTOR_SHORT, TIER_SHORT, estimate } from "@/components/section/path-types";
import { CheckCircle2, Circle, Clock, Loader2, RotateCcw, ShieldCheck, Sparkles, User, Plus } from "lucide-react";

type How = "not-done" | "verified" | "nova-recognised" | "you-marked" | "carried" | "done";
interface TaskView { taskId: string; title: string; status: string; completedAt: string | null; how: How; actor: Actor; answer: string | null; work: WorkRow | null }
interface Detail {
  phase: { id: string; title: string; optional: boolean };
  milestone: { id: string; title: string; description: string; actor: Actor; estimateMinutes: number | null; tier: VerificationTier; expandsFrom?: string; sharedId?: string; intake?: IntakeQuestion[]; work?: WorkKind; prefill?: "resume" };
  isSource: boolean;
  task: TaskView | null;
  loops: TaskView[];
  sourceLoops: { taskId: string; title: string; status: string; expanded: boolean }[];
  steps: (TaskView & { loopTaskId: string | null })[];
}

const HOW: Record<How, string> = {
  "not-done": "Not done",
  "verified": "Done · verified in code",
  "nova-recognised": "Done · Nova recognised it",
  "you-marked": "Done · marked by you",
  "carried": "Done · carried over",
  "done": "Done",
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

/**
 * One milestone, opened from the map: what it asks for, what's written on
 * it, what Nova produced, how it got done, and each of its steps with the
 * same — with the work controls right there, whether or not it's next.
 */
export function MilestoneDetail({ projectId, backboneId }: { projectId: string; backboneId: string }) {
  const fail = useFail();
  const { data, isLoading } = useQuery<Detail>({ queryKey: ["/api/projects", projectId, "path", "milestones", backboneId] });
  const setStatus = useMutation({
    mutationFn: (b: { taskId: string; status: "done" | "todo" }) => apiRequest("PATCH", `/api/kanban/${b.taskId}`, { status: b.status }),
    onSuccess: () => refreshPath(projectId), onError: fail,
  });

  const [form, setForm] = useState<{ kind: "loop" | "step"; loopTaskId: string | null; title: string; description: string } | null>(null);
  const add = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => f.kind === "loop"
      ? apiRequest("POST", `/api/projects/${projectId}/path/loops`, { backboneId, title: f.title, description: f.description }).then((r) => r.json())
      : apiRequest("POST", `/api/projects/${projectId}/path/steps`, { backboneId, loopTaskId: f.loopTaskId, title: f.title, description: f.description }).then((r) => r.json()),
    onSuccess: () => { setForm(null); refreshPath(projectId); }, onError: fail,
  });

  if (isLoading) return <div className="py-3 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>;
  if (!data) return null;
  const { milestone, task, steps, loops, sourceLoops, isSource } = data;
  const AddForm = () => form && (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid={`add-${form.kind}-form`}>
      <input className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm" placeholder={form.kind === "loop" ? "Name the loop" : "Name the step"} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-add-title" />
      <Textarea rows={3} className="text-sm" placeholder={form.kind === "loop" ? "Its 3–5 steps, if you know them" : "What exists when it's done"} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-add-description" />
      <div className="flex gap-2">
        <Button size="sm" disabled={add.isPending || !form.title.trim()} onClick={() => add.mutate(form)} data-testid="button-add-save">Add</Button>
        <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
      </div>
    </div>
  );

  const TaskBlock = ({ t, authored, label, own }: { t: TaskView; authored?: string; label?: string; own?: boolean }) => (
    <div className="space-y-2" data-testid={`milestone-task-${t.taskId}`}>
      {label && <p className="text-sm font-medium flex items-center gap-2">{t.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />}{label}</p>}
      {authored && <Clamp text={authored} />}
      <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
        {t.actor === "user-does" ? <User className="h-3 w-3" /> : <Sparkles className="h-3 w-3 text-primary" />}
        {ACTOR_SHORT[t.actor]} · <span className={t.status === "done" ? "text-emerald-600" : ""}>{HOW[t.how]}</span>{t.completedAt && t.status === "done" ? ` · ${day(t.completedAt)}` : ""}
      </p>
      {t.answer && (
        <div className="rounded-md bg-muted/50 p-3" data-testid="milestone-answer">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">What's written</p>
          <AnswerText text={t.answer} />
        </div>
      )}
      {!t.answer && t.status === "done" && !t.work && (
        <p className="text-xs text-muted-foreground" data-testid="milestone-empty">Nothing written yet — Re-evaluate fills it in, or have Nova draft it.</p>
      )}
      <WorkView projectId={projectId} taskId={t.taskId} actor={t.actor} work={t.work} done={t.status === "done"} compact
        intake={own ? milestone.intake : undefined} workKind={own ? milestone.work : undefined} prefill={own ? milestone.prefill : undefined} />
      <div className="flex gap-2 flex-wrap">
        {t.status === "done"
          ? <Button size="sm" variant="ghost" className="text-xs" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ taskId: t.taskId, status: "todo" })} data-testid="button-reopen"><RotateCcw className="h-3 w-3 mr-1" />Reopen</Button>
          : <Button size="sm" variant="ghost" className="text-xs" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ taskId: t.taskId, status: "done" })} data-testid="button-mark-done"><CheckCircle2 className="h-3 w-3 mr-1" />Mark done</Button>}
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-border p-4 space-y-4 bg-background" data-testid="milestone-detail">
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{estimate(milestone.estimateMinutes)}</span>
        <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />{TIER_SHORT[milestone.tier]}</span>
        <span className="truncate">{data.phase.title}</span>
      </div>
      {task ? <TaskBlock t={task} authored={milestone.description} own /> : <Clamp text={milestone.description} />}
      {(loops.length > 0 || isSource) && (
        <div className="space-y-3 border-t border-border pt-3" data-testid="milestone-loops">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Loops · {loops.filter((l) => l.status === "done").length}/{loops.length}</p>
          {loops.map((l) => <div key={l.taskId} className="pl-3 border-l-2 border-border"><TaskBlock t={l} label={l.title} /></div>)}
          {form?.kind === "loop" ? <AddForm /> : (
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setForm({ kind: "loop", loopTaskId: null, title: "", description: "" })} data-testid="button-detail-add-loop"><Plus className="h-3 w-3 mr-1" />Add another loop</Button>
          )}
        </div>
      )}
      {(steps.length > 0 || milestone.expandsFrom) && (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Steps · {steps.filter((s) => s.status === "done").length}/{steps.length}</p>
          {sourceLoops.length > 0 ? sourceLoops.map((l) => {
            const own = steps.filter((s) => s.loopTaskId === l.taskId);
            return (
              <div key={l.taskId} className="space-y-2" data-testid={`steps-loop-${l.taskId}`}>
                <p className="text-sm font-medium">{l.title} <span className="text-xs text-muted-foreground font-normal">· {own.filter((s) => s.status === "done").length}/{own.length}</span></p>
                {own.map((s) => <div key={s.taskId} className="pl-3 border-l-2 border-border"><TaskBlock t={s} label={s.title} /></div>)}
                {form?.kind === "step" && form.loopTaskId === l.taskId ? <AddForm /> : (
                  <Button size="sm" variant="ghost" className="text-xs" onClick={() => setForm({ kind: "step", loopTaskId: l.taskId, title: "", description: "" })} data-testid={`button-add-step-${l.taskId}`}><Plus className="h-3 w-3 mr-1" />Add a step</Button>
                )}
              </div>
            );
          }) : (
            <>
              {steps.map((s) => <div key={s.taskId} className="pl-3 border-l-2 border-border"><TaskBlock t={s} label={s.title} /></div>)}
              {form?.kind === "step" ? <AddForm /> : (
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => setForm({ kind: "step", loopTaskId: null, title: "", description: "" })} data-testid="button-add-step"><Plus className="h-3 w-3 mr-1" />Add a step</Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A long written answer: the first few lines, the rest on request. */
function AnswerText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280 || text.split("\n").length > 5;
  return (
    <>
      <p className={`text-sm whitespace-pre-wrap ${long && !open ? "line-clamp-5" : ""}`}>{text}</p>
      {long && <button className="text-xs text-primary hover:underline mt-1" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</button>}
    </>
  );
}
