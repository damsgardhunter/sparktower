import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROADMAP_DEPTHS, ROADMAP_DEPTH_IDS, DEFAULT_ROADMAP_DEPTH, type RoadmapDepth } from "@shared/roadmap";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/use-entitlements";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { NovaActionButton } from "@/components/nova-action-button";
import { useNovaHandoff } from "@/components/nova-handoff";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2, Map, Sparkles, RefreshCw, Flag, CheckCircle2, Circle,
  CircleDot, Clock, Users2, Target, Compass, Hammer, X, Pencil,
} from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";
import type { ProjectRoadmap, RoadmapPhase } from "@shared/schema";

interface RoadmapResponse {
  roadmap: (ProjectRoadmap & { phases: RoadmapPhase[] }) | null;
  canGenerate: boolean;
  canUpdate: boolean;
  canCreateMilestones: boolean;
}

interface NextAction {
  title: string;
  why: string;
  effort: "quick" | "medium" | "heavy";
  impact: "high" | "medium";
  relatedPhase: string | null;
}

interface NextActionsResult {
  reasoning: string;
  actions: NextAction[];
}

const EFFORT_LABEL: Record<string, string> = {
  quick: "Quick win",
  medium: "A few sessions",
  heavy: "Big push",
};

const PHASE_STATUS = {
  completed: { label: "Done", icon: CheckCircle2, className: "text-emerald-500" },
  "in-progress": { label: "In progress", icon: CircleDot, className: "text-primary" },
  upcoming: { label: "Upcoming", icon: Circle, className: "text-muted-foreground" },
} as const;

export function RoadmapTab({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const { toast } = useToast();
  const { can, creditsRemaining, isUnlimited } = useEntitlements();

  const [goal, setGoal] = useState("");
  const [startingPoint, setStartingPoint] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [depth, setDepth] = useState<RoadmapDepth>(DEFAULT_ROADMAP_DEPTH);
  const [updateNote, setUpdateNote] = useState("");
  const [nextActions, setNextActions] = useState<NextActionsResult | null>(null);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [rebuildSummary, setRebuildSummary] = useState<string | null>(null);
  const [whatChanged, setWhatChanged] = useState("");
  const [newGoal, setNewGoal] = useState("");
  /** The phase open for hand-editing, held as a draft until saved. */
  const [editingPhase, setEditingPhase] = useState<
    { id: string; title: string; description: string; estimatedDuration: string; outcomes: string } | null
  >(null);

  const { data, isLoading } = useQuery<RoadmapResponse>({
    queryKey: ["/api/projects", projectId, "roadmap"],
    enabled: !!projectId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "roadmap"] });
    queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
  };

  /** Surfaces the server's 402/403 body, which names the plan that unlocks it. */
  const onMutationError = (err: any, fallback: string) => {
    const raw = err?.message || "";
    const jsonStart = raw.indexOf("{");
    let description = fallback;
    if (jsonStart >= 0) {
      try {
        description = JSON.parse(raw.slice(jsonStart)).message || fallback;
      } catch { /* keep fallback */ }
    }
    toast({ title: "Couldn't do that", description, variant: "destructive" });
  };

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/roadmap/generate`, {
        goal, startingPoint: startingPoint || undefined, targetDate: targetDate || undefined, depth,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Roadmap ready", description: "Nova mapped out your path. Review the phases below." });
      setGoal(""); setStartingPoint(""); setTargetDate("");
      invalidate();
    },
    onError: (err) => onMutationError(err, "Roadmap generation failed."),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/roadmap/update`, {
        note: updateNote || undefined,
      });
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({ title: "Roadmap updated", description: `Now at version ${result?.roadmap?.version ?? "?"}.` });
      setUpdateNote("");
      invalidate();
    },
    onError: (err) => onMutationError(err, "Roadmap update failed."),
  });

  /** Quote is fetched up front so the rebuild button can show the real cost. */
  const { data: quote } = useQuery<{ cost: number; min: number; max: number; counts: { phases: number; milestones: number; tasks: number } }>({
    queryKey: ["/api/projects", projectId, "roadmap", "rebuild-quote"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/roadmap/rebuild-quote`, { credentials: "include" });
      if (!res.ok) throw new Error("quote unavailable");
      return res.json();
    },
    enabled: !!projectId && !!data?.roadmap,
  });

  const nextActionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/roadmap/next-actions`);
      return res.json();
    },
    onSuccess: (result) => {
      setNextActions(result);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription"] });
    },
    onError: (err) => onMutationError(err, "Nova couldn't work out what's next."),
  });

  const rebuildMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/roadmap/rebuild`, {
        whatChanged: whatChanged || undefined,
        newGoal: newGoal || undefined,
      });
      return res.json();
    },
    onSuccess: (result) => {
      toast({
        title: `Roadmap rebuilt (v${result?.roadmap?.version ?? "?"})`,
        description: `${result.milestonesUpdated} milestones resequenced, ${result.tasksUpdated} tasks re-prioritised.`,
      });
      setRebuildSummary(result.changeSummary || null);
      setRebuildOpen(false);
      setWhatChanged("");
      setNewGoal("");
      // Nova may have reordered milestones and tasks too.
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "milestones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "kanban"] });
      invalidate();
    },
    onError: (err) => onMutationError(err, "Roadmap rebuild failed."),
  });

  /*
   * Work handed over from the Nova dashboard, picked up once the roadmap has
   * loaded — arriving mid-fetch would otherwise drop the job on the floor.
   *
   * The cheap, self-explanatory runs start on arrival. A rebuild opens its
   * dialog instead: it re-plans every phase, milestone and task and costs up
   * to 15 credits, so it gets the quote and the confirm step rather than a
   * charge the instant the page renders.
   */
  const canReplan = !!data?.roadmap && isOwner && can("roadmapUpdates");
  useNovaHandoff("roadmap.nextActions", () => nextActionsMutation.mutate(), !!data?.roadmap);
  useNovaHandoff("roadmap.update", () => updateMutation.mutate(), canReplan);
  useNovaHandoff("roadmap.rebuild", () => setRebuildOpen(true), canReplan);

  const phaseStatusMutation = useMutation({
    mutationFn: async ({ phaseId, status }: { phaseId: string; status: string }) => {
      await apiRequest("PATCH", `/api/roadmap-phases/${phaseId}`, { status });
    },
    onSuccess: invalidate,
    onError: (err) => onMutationError(err, "Couldn't update that phase."),
  });

  /**
   * Hand edits to a phase. Nova's plan is a draft — the builder knows things it
   * doesn't, and a phase they can't reword is one they stop trusting.
   */
  const phaseEditMutation = useMutation({
    mutationFn: async ({ phaseId, patch }: { phaseId: string; patch: Record<string, unknown> }) => {
      await apiRequest("PATCH", `/api/roadmap-phases/${phaseId}`, patch);
    },
    onSuccess: () => {
      toast({ title: "Phase updated" });
      setEditingPhase(null);
      invalidate();
    },
    onError: (err) => onMutationError(err, "Couldn't save that phase."),
  });

  const milestoneMutation = useMutation({
    mutationFn: async (phaseId: string) => {
      const res = await apiRequest("POST", `/api/roadmap-phases/${phaseId}/create-milestone`, { projectId });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Milestone created", description: "Find it on the Milestones tab." });
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "milestones"] });
    },
    onError: (err) => onMutationError(err, "Couldn't create a milestone."),
  });

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  // Gated: pitch the Builder plan by outcome rather than by entitlement.
  if (!can("aiRoadmap") && !data?.roadmap) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <UpgradePrompt
          feature="aiRoadmap"
          title="Turn your goal into a roadmap"
          description="Tell Nova where you want this project to end up. It'll break the path into phases, tell you what to work on next, and flag the skills you're missing."
        />
      </div>
    );
  }

  const roadmap = data?.roadmap;
  const notEnoughCredits = !isUnlimited && creditsRemaining < CREDIT_COSTS.roadmapGeneration;

  if (!roadmap) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <Map className="h-4 w-4 text-primary" /> Build your roadmap
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Nova plans backwards from your goal, using your project brief for context.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Where do you want to get to? *</Label>
              <Textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Launch to 500 students across 3 campuses by the end of the spring semester"
                className="min-h-[80px]"
                data-testid="textarea-roadmap-goal"
              />
            </div>
            <div className="space-y-2">
              <Label>Where are you now? (optional)</Label>
              <Textarea
                value={startingPoint}
                onChange={(e) => setStartingPoint(e.target.value)}
                placeholder="e.g. I have a Figma prototype and 12 interested students, no code yet"
                className="min-h-[60px]"
                data-testid="textarea-roadmap-start"
              />
            </div>
            <div className="space-y-2">
              <Label>Target date (optional)</Label>
              <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} data-testid="input-roadmap-date" />
            </div>

            {/*
              * How long a roadmap. This used to be fixed at about six phases
              * with no way to ask for more — fine for a weekend, useless for a
              * year. The builder is the only one who knows which they have.
              */}
            <div className="space-y-2">
              <Label>How detailed?</Label>
              <Select value={depth} onValueChange={(v) => setDepth(v as RoadmapDepth)}>
                <SelectTrigger data-testid="select-roadmap-depth"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROADMAP_DEPTH_IDS.map((id) => (
                    <SelectItem key={id} value={id} data-testid={`depth-${id}`}>
                      {ROADMAP_DEPTHS[id].label} · {ROADMAP_DEPTHS[id].min}–{ROADMAP_DEPTHS[id].max} phases
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROADMAP_DEPTHS[depth].hint}</p>
            </div>

            {notEnoughCredits && (
              <p className="text-xs text-destructive">
                Roadmap generation costs {CREDIT_COSTS.roadmapGeneration} credits and you have {creditsRemaining}.
              </p>
            )}

            <Button
              className="w-full gap-2"
              disabled={!goal.trim() || generateMutation.isPending || notEnoughCredits || !isOwner}
              onClick={() => generateMutation.mutate()}
              data-testid="button-generate-roadmap"
            >
              {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generateMutation.isPending ? "Nova is planning..." : "Build my roadmap"}
            </Button>
            {!isOwner && <p className="text-xs text-muted-foreground text-center">Only the project owner can build the roadmap.</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  const completed = roadmap.phases.filter((p) => p.status === "completed").length;
  const progress = roadmap.phases.length ? Math.round((completed / roadmap.phases.length) * 100) : 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Target className="h-3 w-3" /> Goal
                </Badge>
                <span className="text-xs text-muted-foreground">v{roadmap.version}</span>
              </div>
              <p className="text-lg font-semibold leading-snug" data-testid="text-roadmap-goal">{roadmap.goal}</p>
              {roadmap.summary && <p className="text-sm text-secondary leading-relaxed">{roadmap.summary}</p>}
            </div>
            <div className="text-right shrink-0">
              <p className="text-2xl font-bold" data-testid="text-roadmap-progress">{progress}%</p>
              <p className="text-xs text-muted-foreground">{completed} of {roadmap.phases.length} phases</p>
            </div>
          </div>

          {/* The headline action: Nova reads everything and tells you what
              to do right now. */}
          <div className="pt-3 border-t border-border/50">
            <Button
              className="w-full gap-2"
              disabled={nextActionsMutation.isPending}
              onClick={() => nextActionsMutation.mutate()}
              data-testid="button-next-actions"
            >
              {nextActionsMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Nova is reading your roadmap…</>
                : <><Compass className="h-4 w-4" /> What should I do next? ({CREDIT_COSTS.nextActions} credits)</>}
            </Button>
          </div>

          {isOwner && can("roadmapUpdates") && (
            <div className="space-y-2 pt-3 border-t border-border/50">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={updateNote}
                  onChange={(e) => setUpdateNote(e.target.value)}
                  placeholder="What changed? (optional — Nova already sees your tasks and milestones)"
                  className="flex-1"
                  data-testid="input-roadmap-note"
                />
                <NovaActionButton projectId={projectId} surface="roadmap" variant="outline" className="shrink-0" />
                <Button
                  variant="outline"
                  className="gap-2 shrink-0"
                  disabled={updateMutation.isPending}
                  onClick={() => updateMutation.mutate()}
                  data-testid="button-update-roadmap"
                >
                  {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Re-plan ({CREDIT_COSTS.roadmapUpdate})
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 border border-border/60 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Project changed direction?</p>
                  <p className="text-xs text-muted-foreground">
                    A rebuild re-plans phases, resequences milestones, and re-prioritises tasks from scratch.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="gap-2 shrink-0"
                  disabled={rebuildMutation.isPending}
                  onClick={() => setRebuildOpen(true)}
                  data-testid="button-open-rebuild"
                >
                  {rebuildMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
                  Rebuild
                  <Badge variant="secondary" className="ml-0.5 text-[10px]">
                    {quote?.cost ?? `${CREDIT_COSTS.roadmapRebuildMin}–${CREDIT_COSTS.roadmapRebuildMax}`}
                  </Badge>
                </Button>
              </div>
            </div>
          )}
          {isOwner && !can("roadmapUpdates") && (
            <UpgradePrompt
              variant="inline"
              feature="roadmapUpdates"
              title="Keep this roadmap current"
              description="Nova can re-plan the remaining phases as your project moves."
            />
          )}
        </CardContent>
      </Card>

      {/* Nova's three highest-impact actions, ranked. */}
      {nextActions && (
        <Card className="border-primary/40 bg-primary/5" data-testid="card-next-actions">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
            <div className="space-y-1 min-w-0">
              <CardTitle className="text-base flex items-center gap-2">
                <Compass className="h-4 w-4 text-primary" /> Do these next
              </CardTitle>
              {nextActions.reasoning && (
                <p className="text-sm text-secondary leading-relaxed">{nextActions.reasoning}</p>
              )}
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 h-7 px-2" onClick={() => setNextActions(null)} data-testid="button-dismiss-next-actions">
              <X className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {nextActions.actions.map((action, i) => (
              <div key={i} className="flex items-start gap-3 rounded-md bg-background/70 border border-border/60 p-3" data-testid={`next-action-${i}`}>
                <div className="h-6 w-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">
                  {i + 1}
                </div>
                <div className="min-w-0 space-y-1.5">
                  <p className="font-medium text-sm leading-snug">{action.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{action.why}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={action.impact === "high" ? "default" : "secondary"} className="text-[10px]">
                      {action.impact === "high" ? "High impact" : "Medium impact"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] font-normal">{EFFORT_LABEL[action.effort]}</Badge>
                    {action.relatedPhase && (
                      <span className="text-[10px] text-muted-foreground">· {action.relatedPhase}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {rebuildSummary && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/40 p-3" data-testid="banner-rebuild-summary">
          <div className="flex items-start gap-2 min-w-0">
            <Hammer className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What Nova restructured</p>
              <p className="text-sm leading-relaxed">{rebuildSummary}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-7 px-2 shrink-0" onClick={() => setRebuildSummary(null)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Dialog open={rebuildOpen} onOpenChange={setRebuildOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Hammer className="h-5 w-5 text-primary" /> Rebuild the roadmap
            </DialogTitle>
            <DialogDescription>
              Nova re-plans the whole path from scratch — phases, milestone order, and task priorities.
              Completed work stays completed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>What changed? (optional)</Label>
              <Textarea
                value={whatChanged}
                onChange={(e) => setWhatChanged(e.target.value)}
                placeholder="e.g. We pivoted from a marketplace to a single-campus tool after 20 interviews"
                className="min-h-[80px]"
                data-testid="textarea-what-changed"
              />
            </div>
            <div className="space-y-2">
              <Label>New goal (optional — leave blank to keep the current one)</Label>
              <Input
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder={roadmap.goal}
                data-testid="input-new-goal"
              />
            </div>
            {quote && (
              <div className="rounded-md bg-muted/40 border border-border/60 p-3 text-sm space-y-1">
                <p className="font-medium">This rebuild costs {quote.cost} credits</p>
                <p className="text-xs text-muted-foreground">
                  Priced between {quote.min} and {quote.max} based on how much there is to re-plan:{" "}
                  {quote.counts.phases} phases, {quote.counts.milestones} milestones, {quote.counts.tasks} tasks.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRebuildOpen(false)}>Cancel</Button>
            <Button
              disabled={rebuildMutation.isPending}
              onClick={() => rebuildMutation.mutate()}
              data-testid="button-confirm-rebuild"
            >
              {rebuildMutation.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Rebuilding…</>
                : <><Hammer className="h-4 w-4 mr-2" /> Rebuild for {quote?.cost ?? "8–15"} credits</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-3">
        {roadmap.phases.map((phase, i) => {
          const status = PHASE_STATUS[phase.status as keyof typeof PHASE_STATUS] || PHASE_STATUS.upcoming;
          const StatusIcon = status.icon;
          const outcomes = (phase.outcomes as string[]) || [];

          const isEditing = editingPhase?.id === phase.id;

          return (
            <Card key={phase.id} className={phase.status === "completed" && !isEditing ? "opacity-75" : ""} data-testid={`card-phase-${i}`}>
              <CardContent className="p-5 space-y-3">
                {isEditing ? (
                  <div className="space-y-3" data-testid={`form-edit-phase-${i}`}>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Phase title</Label>
                      <Input
                        value={editingPhase!.title}
                        onChange={(e) => setEditingPhase((p) => p && { ...p, title: e.target.value })}
                        data-testid={`input-phase-title-${i}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">What happens in this phase</Label>
                      <Textarea
                        value={editingPhase!.description}
                        onChange={(e) => setEditingPhase((p) => p && { ...p, description: e.target.value })}
                        className="min-h-[70px]"
                        data-testid={`textarea-phase-description-${i}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Outcomes — one per line</Label>
                      <Textarea
                        value={editingPhase!.outcomes}
                        onChange={(e) => setEditingPhase((p) => p && { ...p, outcomes: e.target.value })}
                        placeholder={"Working signup flow\nFirst 10 users onboarded"}
                        className="min-h-[80px]"
                        data-testid={`textarea-phase-outcomes-${i}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Estimated duration</Label>
                      <Input
                        value={editingPhase!.estimatedDuration}
                        onChange={(e) => setEditingPhase((p) => p && { ...p, estimatedDuration: e.target.value })}
                        placeholder="e.g. 2 weeks"
                        data-testid={`input-phase-duration-${i}`}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!editingPhase!.title.trim() || phaseEditMutation.isPending}
                        onClick={() => phaseEditMutation.mutate({
                          phaseId: phase.id,
                          patch: {
                            title: editingPhase!.title,
                            description: editingPhase!.description,
                            estimatedDuration: editingPhase!.estimatedDuration,
                            outcomes: editingPhase!.outcomes.split("\n").map((o) => o.trim()).filter(Boolean),
                          },
                        })}
                        data-testid={`button-save-phase-${i}`}
                      >
                        {phaseEditMutation.isPending
                          ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Saving…</>
                          : "Save phase"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingPhase(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                    <StatusIcon className={`h-5 w-5 ${status.className}`} />
                    <span className="text-[10px] font-medium text-muted-foreground">{i + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold" data-testid={`text-phase-title-${i}`}>{phase.title}</h3>
                      {phase.estimatedDuration && (
                        <Badge variant="outline" className="gap-1 text-[10px] font-normal">
                          <Clock className="h-2.5 w-2.5" /> {phase.estimatedDuration}
                        </Badge>
                      )}
                      {phase.milestoneId && (
                        <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
                          <Flag className="h-2.5 w-2.5" /> Milestone created
                        </Badge>
                      )}
                    </div>
                    {phase.description && (
                      <p className="text-sm text-secondary leading-relaxed">{phase.description}</p>
                    )}

                    {outcomes.length > 0 && (
                      <ul className="space-y-1">
                        {outcomes.map((outcome, j) => (
                          <li key={j} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-50" />
                            <span>{outcome}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {(phase.skillsNeeded?.length || 0) > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Users2 className="h-3 w-3" /> Skills you may need:
                        </span>
                        {phase.skillsNeeded!.map((skill) => (
                          <Badge key={skill} variant="outline" className="text-[10px] font-normal">{skill}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                )}

                {isOwner && !isEditing && (
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
                    <Select
                      value={phase.status}
                      onValueChange={(status) => phaseStatusMutation.mutate({ phaseId: phase.id, status })}
                    >
                      <SelectTrigger className="w-[9.5rem] h-8 text-xs" data-testid={`select-phase-status-${i}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="upcoming">Upcoming</SelectItem>
                        <SelectItem value="in-progress">In progress</SelectItem>
                        <SelectItem value="completed">Done</SelectItem>
                      </SelectContent>
                    </Select>
                    <NovaActionButton
                      projectId={projectId}
                      surface="roadmap"
                      entityId={phase.id}
                      entityLabel={phase.title}
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setEditingPhase({
                        id: phase.id,
                        title: phase.title,
                        description: phase.description || "",
                        estimatedDuration: phase.estimatedDuration || "",
                        outcomes: outcomes.join("\n"),
                      })}
                      data-testid={`button-edit-phase-${i}`}
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    {!phase.milestoneId && can("aiMilestones") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                        disabled={milestoneMutation.isPending}
                        onClick={() => milestoneMutation.mutate(phase.id)}
                        data-testid={`button-create-milestone-${i}`}
                      >
                        <Flag className="h-3 w-3" /> Make this a milestone
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
