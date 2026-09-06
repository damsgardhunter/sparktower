import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import {
  Loader2, Sparkles, Wand2, Check, Flag, Clock, ArrowRight, Lock, X, FileText,
} from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";
import { DocumentStartDialog } from "@/components/document-start-dialog";
import type { ProjectKanbanTask } from "@shared/schema";

interface PlannedTask {
  title: string;
  estimateHours: number | null;
  why: string;
}

interface PlannedMilestone {
  id: string | null;
  title: string;
  goal: string;
  definitionOfDone: string;
  tasks: PlannedTask[];
}

interface Plan {
  summary: string;
  nextMilestone: { id: string | null; title: string; why: string } | null;
  milestones: PlannedMilestone[];
  totalEstimatedHours: number | null;
  /** Set when the work's deliverable is a document Nova could build. */
  suggestedDocument: { title: string; description: string; why: string } | null;
  operations: unknown[];
}

/**
 * The asks worth one tap.
 *
 * Deliberately phrased as the output the builder wants, not as a feature name
 * — "map my milestones into ordered task lists" is a thing you can picture,
 * "task decomposition" isn't.
 */
const PRESETS: { label: string; ask: string; needsTask?: boolean }[] = [
  {
    label: "Map my milestones into ordered task lists",
    ask: "Turn my milestones into ordered task lists, 5-10 tasks each. For every milestone give me the goal, the definition of done, and the ordered tasks with hour estimates. Then tell me the single milestone to work on next.",
  },
  {
    label: "Break this task into steps",
    ask: "Break the selected task into concrete, ordered steps I can actually finish, with hour estimates. Keep it to the work that task really needs.",
    needsTask: true,
  },
  {
    label: "Estimate everything on my board",
    ask: "Go through the tasks on my board and give each one a realistic hour estimate. Split anything bigger than about 8 hours into smaller tasks.",
  },
  {
    label: "Plan my next two weeks",
    ask: "Look at where the project actually is and plan the next two weeks of work: which tasks, in what order, with estimates that fit the time. Flag anything I should drop to make it fit.",
  },
];

export function NovaTaskPlanner({ projectId, selectedTask, onClose }: {
  projectId: string;
  /** Pre-selected when opened from a specific task, so "break this down" works. */
  selectedTask?: ProjectKanbanTask | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { can } = useEntitlements();
  const [ask, setAsk] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [docStartOpen, setDocStartOpen] = useState(false);

  const isBuilder = can("aiMilestones");

  const describeError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const body = JSON.parse(raw.slice(jsonStart));
        return { message: body.message || fallback, upgrade: body.code === "upgrade_required" };
      } catch { /* keep */ }
    }
    return { message: fallback, upgrade: false };
  };

  const planMutation = useMutation({
    mutationFn: async (question: string) => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/tasks/nova-assist`, {
        ask: question,
        taskId: selectedTask?.id,
      });
      return res.json() as Promise<Plan>;
    },
    onSuccess: (result) => {
      setPlan(result);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err: any) => {
      const { message, upgrade } = describeError(err, "Nova couldn't plan that.");
      toast({
        title: upgrade ? "Builder plan needed" : "Nova couldn't plan that",
        description: message,
        variant: upgrade ? "default" : "destructive",
      });
    },
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/tasks/nova-assist/apply`, {
        operations: plan?.operations || [],
      });
      return res.json() as Promise<{ changes: { description: string }[]; skipped: string[] }>;
    },
    onSuccess: (result) => {
      toast({
        title: `Plan applied — ${result.changes.length} change${result.changes.length === 1 ? "" : "s"}`,
        // Newly created tasks can't reference each other as blockers (they had
        // no ids when the plan was written), so point at the pass that can.
        description: result.skipped.length
          ? `${result.skipped.length} item(s) were skipped: ${result.skipped[0]}`
          : "Run \"Order my tasks\" next to link up dependencies.",
      });
      for (const key of ["kanban", "milestones", "task-history", "calendar", "activity"]) {
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
      }
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Couldn't apply that plan", description: describeError(err, "Try again.").message, variant: "destructive" });
    },
  });

  const taskCount = plan?.milestones.reduce((n, m) => n + m.tasks.length, 0) ?? 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Nova, help me with my tasks
          </DialogTitle>
          <DialogDescription>
            {plan
              ? "Nothing has been written to your board yet. Read it over, then apply it."
              : "Tell Nova what you need planned. It reads your roadmap, milestones and what you've already finished."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {/* Non-Builder accounts still see everything; the gate lands on the
              button, not on the door, so the capability is discoverable. */}
          {!isBuilder && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 mb-4">
              <Lock className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
              <div className="text-sm">
                <p className="font-medium">Nova task planning is on the Builder plan</p>
                <p className="text-muted-foreground text-xs">
                  You can still see what it does — asking will tell you what to upgrade to.
                </p>
              </div>
            </div>
          )}

          {!plan ? (
            <div className="space-y-4">
              {selectedTask && (
                <div className="rounded-md border border-border/60 bg-muted/40 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Working on
                  </p>
                  <p className="text-sm font-medium">{selectedTask.title}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs">Common asks</Label>
                <div className="grid gap-2">
                  {PRESETS.filter((p) => !p.needsTask || selectedTask).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="text-left rounded-md border border-border/60 p-2.5 text-sm hover:border-primary/60 transition-colors disabled:opacity-50"
                      disabled={planMutation.isPending}
                      onClick={() => { setAsk(preset.ask); planMutation.mutate(preset.ask); }}
                      data-testid={`preset-${preset.label.slice(0, 12).replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      <span className="flex items-center gap-2">
                        <Wand2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        {preset.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Or ask for something specific</Label>
                <Textarea
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  placeholder="e.g. Turn the 7 milestones into ordered task lists with a definition of done for each, and tell me which one to start on."
                  className="min-h-[100px]"
                  data-testid="textarea-nova-ask"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {plan.summary && (
                <p className="text-sm text-secondary leading-relaxed" data-testid="text-plan-summary">
                  {plan.summary}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="secondary">{plan.milestones.length} milestones</Badge>
                <Badge variant="secondary">{taskCount} tasks</Badge>
                {plan.totalEstimatedHours ? (
                  <Badge variant="outline" className="gap-1">
                    <Clock className="h-3 w-3" /> ~{plan.totalEstimatedHours}h total
                  </Badge>
                ) : null}
              </div>

              {plan.nextMilestone?.title && (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3" data-testid="card-next-milestone">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1">
                    <ArrowRight className="h-3 w-3" /> Work on this one next
                  </p>
                  <p className="text-sm font-medium">{plan.nextMilestone.title}</p>
                  {plan.nextMilestone.why && (
                    <p className="text-xs text-muted-foreground mt-0.5">{plan.nextMilestone.why}</p>
                  )}
                </div>
              )}

              {/* When the deliverable is a document, offer the thing that can
                  actually produce it rather than a task that says "write it". */}
              {plan.suggestedDocument && (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2" data-testid="card-suggested-document">
                  <div className="flex items-start gap-2">
                    <FileText className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-sm font-semibold">This one produces a document</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {plan.suggestedDocument.why || `Nova can build "${plan.suggestedDocument.title}" for you.`}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm" variant="outline" className="gap-1.5 text-xs w-full"
                    onClick={() => setDocStartOpen(true)}
                    data-testid="button-start-suggested-document"
                  >
                    <FileText className="h-3 w-3" /> Build it with Nova
                  </Button>
                </div>
              )}

              <div className="space-y-3">
                {plan.milestones.map((m, i) => (
                  <div key={i} className="rounded-md border border-border/60 p-3 space-y-2" data-testid={`plan-milestone-${i}`}>
                    <div className="flex items-start gap-2">
                      <Flag className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">{m.title}</p>
                        {!m.id && <Badge variant="outline" className="text-[10px] mt-0.5">new milestone</Badge>}
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {m.tasks.length} task{m.tasks.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {m.goal && (
                      <p className="text-xs"><span className="text-muted-foreground">Goal:</span> {m.goal}</p>
                    )}
                    {m.definitionOfDone && (
                      <p className="text-xs"><span className="text-muted-foreground">Done when:</span> {m.definitionOfDone}</p>
                    )}

                    {m.tasks.length > 0 && (
                      <ol className="space-y-1 pt-0.5">
                        {m.tasks.map((t, j) => (
                          <li key={j} className="flex items-start gap-2 text-xs">
                            <span className="h-4 w-4 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
                              {j + 1}
                            </span>
                            <span className="flex-1 min-w-0">
                              {t.title}
                              {t.why && <span className="text-muted-foreground"> — {t.why}</span>}
                            </span>
                            {t.estimateHours ? (
                              <span className="text-muted-foreground shrink-0 tabular-nums">{t.estimateHours}h</span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Tasks land on your board in this order. Dependencies between brand-new
                tasks get linked when you run <strong>Order my tasks</strong> afterwards.
              </p>

              {plan.operations.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nova didn't produce any changes to apply for that ask.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {plan ? (
            <>
              <Button
                variant="ghost"
                className="mr-auto gap-2"
                onClick={() => setPlan(null)}
                data-testid="button-plan-back"
              >
                <X className="h-4 w-4" /> Ask something else
              </Button>
              <Button variant="outline" onClick={onClose}>Discard</Button>
              <Button
                className="gap-2"
                disabled={applyMutation.isPending || plan.operations.length === 0}
                onClick={() => applyMutation.mutate()}
                data-testid="button-apply-plan"
              >
                {applyMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Applying…</>
                  : <><Check className="h-4 w-4" /> Apply this plan</>}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                className="gap-2"
                disabled={!ask.trim() || planMutation.isPending}
                onClick={() => planMutation.mutate(ask)}
                data-testid="button-ask-nova"
              >
                {planMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Nova is planning…</>
                  : <><Sparkles className="h-4 w-4" /> Ask Nova ({CREDIT_COSTS.taskAssist})</>}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      {plan?.suggestedDocument && (
        <DocumentStartDialog
          projectId={projectId}
          open={docStartOpen}
          onOpenChange={setDocStartOpen}
          initialTitle={plan.suggestedDocument.title}
          initialDescription={plan.suggestedDocument.description}
          sourceTaskId={selectedTask?.id}
        />
      )}
    </Dialog>
  );
}
