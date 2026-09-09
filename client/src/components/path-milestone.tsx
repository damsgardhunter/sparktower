import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { ACTOR_LABEL, type Actor, type VerificationTier } from "@shared/phase-trees";
import { WorkView, refreshPath, useFail, type WorkRow } from "@/components/path-work";
import { CheckCircle2, Circle, Loader2, RotateCcw, Sparkles, User } from "lucide-react";

type How = "not-done" | "nova-recognised" | "you-marked" | "carried" | "done";
interface TaskView { taskId: string; title: string; status: string; completedAt: string | null; how: How; actor: Actor; answer: string | null; work: WorkRow | null }
interface Detail {
  phase: { id: string; title: string; optional: boolean };
  milestone: { id: string; title: string; description: string; actor: Actor; estimateMinutes: number | null; tier: VerificationTier; expandsFrom?: string; sharedId?: string };
  task: TaskView | null;
  steps: TaskView[];
}

const HOW: Record<How, string> = {
  "not-done": "Not done yet",
  "nova-recognised": "Nova recognised this as already done when the project joined its path",
  "you-marked": "You marked this done",
  "carried": "Carried over from another path",
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

  if (isLoading) return <div className="py-3 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>;
  if (!data) return null;
  const { milestone, task, steps } = data;

  const TaskBlock = ({ t, authored, label }: { t: TaskView; authored?: string; label?: string }) => (
    <div className="space-y-2" data-testid={`milestone-task-${t.taskId}`}>
      {label && <p className="text-sm font-medium flex items-center gap-2">{t.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />}{label}</p>}
      {authored && <p className="text-sm text-muted-foreground leading-relaxed">{authored}</p>}
      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
        {t.actor === "user-does" ? <User className="h-3 w-3" /> : <Sparkles className="h-3 w-3 text-primary" />}
        {ACTOR_LABEL[t.actor]} · {HOW[t.how]}{t.completedAt && t.status === "done" ? ` · ${day(t.completedAt)}` : ""}
      </p>
      {t.answer && (
        <div className="rounded-md bg-muted/50 p-3" data-testid="milestone-answer">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">What's written</p>
          <p className="text-sm whitespace-pre-wrap">{t.answer}</p>
        </div>
      )}
      <WorkView projectId={projectId} taskId={t.taskId} actor={t.actor} work={t.work} done={t.status === "done"} compact />
      <div className="flex gap-2 flex-wrap">
        {t.status === "done"
          ? <Button size="sm" variant="ghost" className="text-xs" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ taskId: t.taskId, status: "todo" })} data-testid="button-reopen"><RotateCcw className="h-3 w-3 mr-1" />Reopen</Button>
          : <Button size="sm" variant="ghost" className="text-xs" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ taskId: t.taskId, status: "done" })} data-testid="button-mark-done"><CheckCircle2 className="h-3 w-3 mr-1" />Mark done</Button>}
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-border p-4 space-y-4 bg-background" data-testid="milestone-detail">
      {task ? <TaskBlock t={task} authored={milestone.description} /> : <p className="text-sm text-muted-foreground">{milestone.description}</p>}
      {steps.length > 0 && (
        <div className="space-y-3 border-t border-border pt-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Steps · {steps.filter((s) => s.status === "done").length}/{steps.length}</p>
          {steps.map((s) => <div key={s.taskId} className="pl-3 border-l-2 border-border"><TaskBlock t={s} label={s.title} /></div>)}
        </div>
      )}
    </div>
  );
}
