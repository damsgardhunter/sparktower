import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WorkView, refreshPath, useFail, type WorkRow } from "@/components/path-work";
import { LOOP_TYPE_INFO, LOOP_ORDER, MAX_PRODUCT_LOOPS, LOOP_CAP, type Actor, type LoopType, type LoopCoverage, type LoopCompetitiveAudit, type LoopClosureRead, type LoopVerdict } from "@shared/phase-trees";
import { CheckCircle2, Circle, Loader2, ListTree, Plus, Sparkles, ChevronRight, RotateCcw, Pencil, Trash2, Swords, RefreshCw, CircleDashed, CircleAlert } from "lucide-react";

export interface LoopStep { taskId: string; title: string; description: string; status: string; actor: Actor; estimateHours: number | null }
export interface LoopNode {
  taskId: string; title: string; description: string; written: boolean; status: string; actor: Actor;
  type: LoopType;
  state: "unwritten" | "written" | "planned" | "building" | "built";
  steps: LoopStep[]; done: number; total: number;
  /** From the latest codebase audit: does this loop close in the code. */
  closure: LoopClosureRead | null;
}
export interface LoopTreeData {
  sourceId: string; sourceTitle: string; fanOutId: string; fanOutTitle: string; loops: LoopNode[]; unassigned: { taskId: string; title: string; status: string }[];
  coverage: LoopCoverage;
  competition: { id: string; createdAt: string; audit: LoopCompetitiveAudit; stale: boolean } | null;
  competitionDue: boolean;
  closureAuditAt: string | null;
}

const TYPE_CLS: Record<LoopType, string> = {
  product: "bg-primary/10 text-primary",
  growth: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  retention: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  revenue: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  referral: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

const VERDICT_CLS: Record<LoopVerdict, string> = {
  strong: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  competitive: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  weak: "bg-destructive/15 text-destructive",
};

/** The kinds a new loop could be: product while there's room, and any business kind not yet on the tree. */
export function addableLoopTypes(loops: { type: LoopType }[]): LoopType[] {
  if (loops.length >= LOOP_CAP) return [];
  return LOOP_ORDER.filter((t) => t === "product" ? loops.filter((l) => l.type === "product").length < MAX_PRODUCT_LOOPS : !loops.some((l) => l.type === t));
}

/**
 * A server a deploy behind (or a dev server not yet restarted) answers without
 * the loop kinds, coverage or audits. Read those as absent rather than letting
 * one missing field take the whole page down.
 */
function withLoopDefaults(tree: LoopTreeData): LoopTreeData {
  const loops = (tree.loops ?? []).map((l) => ({ ...l, type: l.type && LOOP_TYPE_INFO[l.type] ? l.type : "product" as LoopType, closure: l.closure ?? null }));
  return {
    ...tree, loops,
    coverage: tree.coverage ?? { missing: [], unwritten: [], productLoops: loops.length, complete: false },
    competition: tree.competition ?? null,
    competitionDue: !!tree.competitionDue,
    closureAuditAt: tree.closureAuditAt ?? null,
  };
}

function ClosureBadge({ closure }: { closure: LoopClosureRead }) {
  if (closure.closure === "closed") {
    return <p className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-start gap-1" data-testid="loop-closure-closed"><CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" /><span>Closes in code{closure.returnPath ? ` — back via ${closure.returnPath.mechanism}` : ""}</span></p>;
  }
  return (
    <div className="text-[11px] space-y-0.5" data-testid={`loop-closure-${closure.closure}`}>
      <p className={`flex items-start gap-1 ${closure.closure === "open" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
        {closure.closure === "open" ? <CircleAlert className="h-3 w-3 mt-0.5 shrink-0" /> : <CircleDashed className="h-3 w-3 mt-0.5 shrink-0" />}
        <span>{closure.closure === "open" ? "Open in code" : "Not built yet"}{closure.breaksAt ? ` — breaks at: ${closure.breaksAt}` : ""}</span>
      </p>
      {closure.fix && <p className="text-muted-foreground pl-4 line-clamp-2" title={closure.fix}>Fix: {closure.fix}</p>}
      {closure.note && <p className="text-muted-foreground pl-4 italic line-clamp-1" title={closure.note}>{closure.note}</p>}
    </div>
  );
}

const STATE: Record<LoopNode["state"], { label: string; cls: string }> = {
  unwritten: { label: "Not written", cls: "bg-muted text-muted-foreground" },
  written: { label: "Written", cls: "bg-primary/10 text-primary" },
  planned: { label: "Steps ready", cls: "bg-primary/10 text-primary" },
  building: { label: "Building", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  built: { label: "Built", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
};

/** The latest work on one task, fetched when a node is opened. */
function NodeWork({ projectId, taskId, actor, done }: { projectId: string; taskId: string; actor: Actor; done: boolean }) {
  const { data, isLoading } = useQuery<{ work: WorkRow | null }>({
    queryKey: ["/api/projects", projectId, "path", "work", taskId],
    queryFn: () => fetch(`/api/projects/${projectId}/path/work/${taskId}`, { credentials: "include" }).then((r) => r.json()),
  });
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  return <WorkView projectId={projectId} taskId={taskId} actor={actor} work={data?.work ?? null} done={done} compact />;
}

/**
 * Week 2 as a tree: the core loop at the top, each loop as a branch with its
 * state, its steps beneath. Any node opens to Nova's work on it. This is the
 * screen for building the product, so it shows the product's shape.
 */
export function LoopTree({ projectId, tree: raw }: { projectId: string; tree: LoopTreeData }) {
  const tree = withLoopDefaults(raw);
  const { toast } = useToast();
  const fail = useFail();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: "loop" | "step"; loopTaskId: string | null; title: string; description: string; type?: LoopType } | null>(null);
  const [draft, setDraft] = useState<{ loopTaskId: string; title: string; text: string } | null>(null);

  const add = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => f.kind === "loop"
      ? apiRequest("POST", `/api/projects/${projectId}/path/loops`, { backboneId: tree.sourceId, title: f.title, description: f.description, type: f.type ?? "product" }).then((r) => r.json())
      : apiRequest("POST", `/api/projects/${projectId}/path/steps`, { backboneId: tree.fanOutId, loopTaskId: f.loopTaskId, title: f.title, description: f.description }).then((r) => r.json()),
    onSuccess: () => { setForm(null); refreshPath(projectId); }, onError: fail,
  });
  const expand = useMutation({
    mutationFn: (b: { loopTaskId: string; artifact?: string }) => apiRequest("POST", `/api/projects/${projectId}/path/expand`, { backboneId: tree.fanOutId, ...b }).then((r) => r.json()),
    onSuccess: (r: any) => { setDraft(null); refreshPath(projectId); toast({ title: r.created?.length ? `Nova broke it into ${r.created.length} steps` : "Steps already exist" }); },
    onError: async (e: any, b) => {
      if (String(e?.message ?? "").includes("artifact_missing")) {
        try {
          const r = await apiRequest("POST", `/api/projects/${projectId}/path/expand`, { backboneId: tree.fanOutId, loopTaskId: b.loopTaskId, draft: true }).then((x) => x.json());
          setDraft({ loopTaskId: b.loopTaskId, title: r.sourceTitle, text: r.draft });
          return;
        } catch (err) { return fail(err); }
      }
      fail(e);
    },
  });
  const setStatus = useMutation({
    mutationFn: (b: { taskId: string; status: "done" | "todo" }) => apiRequest("PATCH", `/api/kanban/${b.taskId}`, { status: b.status }),
    onSuccess: () => refreshPath(projectId), onError: fail,
  });
  const [rename, setRename] = useState<{ taskId: string; title: string; description: string; type: LoopType; was: LoopType } | null>(null);
  const save = useMutation({
    mutationFn: async (b: NonNullable<typeof rename>) => {
      if (b.type !== b.was) await apiRequest("PATCH", `/api/projects/${projectId}/path/loops/${b.taskId}`, { type: b.type });
      return apiRequest("PATCH", `/api/kanban/${b.taskId}`, { title: b.title, description: b.description });
    },
    onSuccess: () => { setRename(null); refreshPath(projectId); }, onError: (e) => { refreshPath(projectId); fail(e); },
  });
  const audit = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/path/loops/audit`, {}).then((r) => r.json()),
    /*
     * No "1 credits" under the score. A loop audit is a small action, which
     * means it comes out of the month's allowance and costs no money at all —
     * the sidebar already shows what is left of that, and quoting a credit is
     * the one thing shared/plans.ts says never to do.
     */
    onSuccess: (r: any) => { refreshPath(projectId); toast({ title: `Nova scored your loops ${r.audit?.overallScore ?? ""}/100` }); },
    onError: fail,
  });
  const write = useMutation({
    mutationFn: (loopTaskIds?: string[]) => apiRequest("POST", `/api/projects/${projectId}/path/loops/write`, loopTaskIds ? { loopTaskIds } : {}).then((r) => r.json()),
    onSuccess: (r: any) => {
      refreshPath(projectId);
      const n = (r.written?.length ?? 0) + (r.created?.length ?? 0);
      toast({ title: `Nova wrote ${n} loop${n === 1 ? "" : "s"}`, description: r.skipped?.length ? `Left alone: ${r.skipped.map((x: any) => x.title).join(", ")}` : "Read them over — edit or reopen any you'd put differently." });
    },
    onError: fail,
  });
  const reads = new Map((tree.competition?.audit.loops ?? []).map((r) => [r.loopTaskId, r]));
  const addable = addableLoopTypes(tree.loops);
  const missing = tree.coverage.missing;
  const remove = useMutation({
    mutationFn: (taskId: string) => apiRequest("DELETE", `/api/projects/${projectId}/path/loops/${taskId}`).then((r) => r.json()),
    onSuccess: (r: any) => { refreshPath(projectId); toast({ title: "Loop removed", description: r.keptSteps ? `${r.keptSteps} finished step${r.keptSteps === 1 ? "" : "s"} kept on the board.` : undefined }); },
    onError: fail,
  });

  const built = tree.loops.filter((l) => l.state === "built").length;
  const written = tree.loops.filter((l) => l.written).length;

  return (
    <div className="space-y-3" data-testid="loop-tree">
      {/* Root */}
      <div className="flex flex-col items-center">
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{tree.sourceTitle}</p>
          <p className="text-sm font-semibold tabular-nums">{tree.loops.length} loop{tree.loops.length === 1 ? "" : "s"} · {written} written · {built} built</p>
          <p className="text-[11px] text-muted-foreground" data-testid="loop-coverage">
            {tree.coverage.complete ? "All five kinds written" : `To write: ${[...missing, ...tree.coverage.unwritten].map((t) => LOOP_TYPE_INFO[t].label.toLowerCase()).join(", ")}`}
          </p>
          {(!tree.coverage.complete || tree.loops.some((l) => !l.written)) && (
            <Button size="sm" variant="outline" className="h-7 text-xs mt-1.5" disabled={write.isPending} onClick={() => write.mutate(undefined)} data-testid="button-nova-write-loops">
              {write.isPending && write.variables === undefined ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}Nova writes the rest
            </Button>
          )}
        </div>
        <div className="h-4 w-px bg-border" />
      </div>

      {/* Branches */}
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max items-start border-t border-border pt-4 px-2">
          {tree.loops.map((loop) => {
            const st = STATE[loop.state];
            const isOpen = open === loop.taskId;
            return (
              <div key={loop.taskId} className="relative w-72 shrink-0" data-testid={`loop-${loop.taskId}`}>
                <div className="absolute -top-4 left-1/2 h-4 w-px bg-border" />
                <div className={`rounded-lg border p-3 space-y-2 bg-background ${isOpen ? "border-primary" : "border-border"}`}>
                  {rename?.taskId === loop.taskId ? (
                    <div className="space-y-1.5" data-testid={`rename-${loop.taskId}`}>
                      <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs" value={rename.type} onChange={(e) => setRename({ ...rename, type: e.target.value as LoopType })} data-testid="select-rename-type">
                        {LOOP_ORDER.filter((t) => t === rename.was || addableLoopTypes(tree.loops.filter((l) => l.taskId !== loop.taskId)).includes(t)).map((t) => <option key={t} value={t}>{LOOP_TYPE_INFO[t].label}</option>)}
                      </select>
                      <input className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={rename.title} onChange={(e) => setRename({ ...rename, title: e.target.value })} data-testid="input-rename-title" />
                      <Textarea rows={3} className="text-xs" value={rename.description} onChange={(e) => setRename({ ...rename, description: e.target.value })} data-testid="input-rename-steps" />
                      <div className="flex gap-1.5"><Button size="sm" className="h-7 text-xs" disabled={save.isPending || !rename.title.trim()} onClick={() => save.mutate(rename)} data-testid="button-rename-save">Save</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRename(null)}>Cancel</Button></div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${TYPE_CLS[loop.type]}`} data-testid={`loop-type-${loop.taskId}`}>{LOOP_TYPE_INFO[loop.type].label}</span>
                        {reads.get(loop.taskId) && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${VERDICT_CLS[reads.get(loop.taskId)!.verdict]}`} title="Nova's competitive score" data-testid={`loop-score-${loop.taskId}`}>
                            {reads.get(loop.taskId)!.score}/100 · {reads.get(loop.taskId)!.verdict}
                          </span>
                        )}
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <button className="text-left font-medium text-sm leading-snug hover:underline" onClick={() => setOpen(isOpen ? null : loop.taskId)} data-testid={`open-loop-${loop.taskId}`}>{loop.title}</button>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${st.cls}`} data-testid={`loop-state-${loop.taskId}`}>{st.label}</span>
                          <button className="text-muted-foreground hover:text-foreground" title="Rename or rewrite" onClick={() => setRename({ taskId: loop.taskId, title: loop.title, description: loop.description, type: loop.type, was: loop.type })} data-testid={`rename-loop-${loop.taskId}`}><Pencil className="h-3 w-3" /></button>
                          <button className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-0.5" title="Remove it, and Nova never proposes it again" disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove "${loop.title}"? Unfinished steps go with it, and Nova won't propose it again.`)) remove.mutate(loop.taskId); }} data-testid={`delete-loop-${loop.taskId}`}><Trash2 className="h-3 w-3" />Not a loop</button>
                        </div>
                      </div>
                      {loop.description
                        ? <p className={`text-xs text-muted-foreground whitespace-pre-wrap ${isOpen ? "" : "line-clamp-3"}`}>{loop.description}</p>
                        : (
                          <p className="text-xs text-muted-foreground line-clamp-2" title={`${LOOP_TYPE_INFO[loop.type].asks} Closes when: ${LOOP_TYPE_INFO[loop.type].closes} e.g. ${LOOP_TYPE_INFO[loop.type].example}`}>
                            Not written yet. {LOOP_TYPE_INFO[loop.type].asks}
                          </p>
                        )}
                      {loop.closure && <ClosureBadge closure={loop.closure} />}
                    </>
                  )}

                  {/* Steps beneath the loop */}
                  {loop.steps.length > 0 && (
                    <ul className="space-y-1 border-l-2 border-border ml-1 pl-3" data-testid={`steps-${loop.taskId}`}>
                      {loop.steps.map((s) => {
                        const sOpen = open === s.taskId;
                        return (
                          <li key={s.taskId} className="text-sm">
                            <div className="flex items-center gap-2">
                              {s.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />}
                              <button className={`text-left hover:underline flex-1 min-w-0 truncate ${s.status === "done" ? "text-muted-foreground line-through" : ""}`} onClick={() => setOpen(sOpen ? null : s.taskId)} data-testid={`open-step-${s.taskId}`}>{s.title}</button>
                              <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${sOpen ? "rotate-90" : ""}`} />
                            </div>
                            {sOpen && (
                              <div className="mt-2 mb-2 rounded-md border border-border p-2 space-y-2" data-testid={`step-detail-${s.taskId}`}>
                                {s.description && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{s.description}</p>}
                                <NodeWork projectId={projectId} taskId={s.taskId} actor={s.actor} done={s.status === "done"} />
                                <div className="flex gap-2">
                                  {s.status === "done"
                                    ? <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setStatus.mutate({ taskId: s.taskId, status: "todo" })}><RotateCcw className="h-3 w-3 mr-1" />Reopen</Button>
                                    : <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setStatus.mutate({ taskId: s.taskId, status: "done" })} data-testid={`step-done-${s.taskId}`}><CheckCircle2 className="h-3 w-3 mr-1" />Mark done</Button>}
                                </div>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {loop.total > 0 && <p className="text-[11px] text-muted-foreground">{loop.done}/{loop.total} steps</p>}

                  {/* Actions on the loop */}
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {!loop.written && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={write.isPending} onClick={() => write.mutate([loop.taskId])} data-testid={`nova-write-loop-${loop.taskId}`}>
                        {write.isPending && write.variables?.includes(loop.taskId) ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}Nova writes it
                      </Button>
                    )}
                    {loop.steps.length === 0 && (
                      <Button size="sm" variant="default" className="h-7 text-xs" disabled={expand.isPending || !!draft} onClick={() => expand.mutate({ loopTaskId: loop.taskId })} data-testid={`expand-loop-${loop.taskId}`}>
                        {expand.isPending && expand.variables?.loopTaskId === loop.taskId ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ListTree className="h-3 w-3 mr-1" />}Break into steps
                      </Button>
                    )}
                    {form?.kind === "step" && form.loopTaskId === loop.taskId ? null : (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setForm({ kind: "step", loopTaskId: loop.taskId, title: "", description: "" })} data-testid={`add-step-${loop.taskId}`}><Plus className="h-3 w-3 mr-1" />Step</Button>
                    )}
                  </div>
                  {form?.kind === "step" && form.loopTaskId === loop.taskId && (
                    <div className="space-y-1.5" data-testid="add-step-form">
                      <input className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" placeholder="Name the step" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-add-title" />
                      <div className="flex gap-1.5"><Button size="sm" className="h-7 text-xs" disabled={add.isPending || !form.title.trim()} onClick={() => add.mutate(form)} data-testid="button-add-save">Add</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setForm(null)}>Cancel</Button></div>
                    </div>
                  )}
                  {draft?.loopTaskId === loop.taskId && (
                    <div className="space-y-1.5 border-t border-border pt-2" data-testid="loop-draft">
                      <p className="text-xs text-muted-foreground">Nova drafted <span className="font-medium text-foreground">{draft.title}</span>. Edit, then build.</p>
                      <Textarea rows={5} className="text-sm" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} data-testid="input-loop-draft" />
                      <div className="flex gap-1.5">
                        <Button size="sm" className="h-7 text-xs" disabled={expand.isPending || !draft.text.trim()} onClick={() => expand.mutate({ loopTaskId: loop.taskId, artifact: draft.text })} data-testid="button-loop-draft-confirm"><ListTree className="h-3 w-3 mr-1" />Looks right — build the steps</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDraft(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                  {/* The loop node itself: Nova writing it, or the write-up already chosen. */}
                  {isOpen && (
                    <div className="border-t border-border pt-2 space-y-2" data-testid={`loop-detail-${loop.taskId}`}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3 text-primary" />The loop itself</p>
                      <NodeWork projectId={projectId} taskId={loop.taskId} actor={loop.actor} done={loop.status === "done"} />
                      {loop.status === "done"
                        ? <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setStatus.mutate({ taskId: loop.taskId, status: "todo" })}><RotateCcw className="h-3 w-3 mr-1" />Reopen</Button>
                        : <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setStatus.mutate({ taskId: loop.taskId, status: "done" })} data-testid={`loop-done-${loop.taskId}`}><CheckCircle2 className="h-3 w-3 mr-1" />Written — mark done</Button>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Kinds of loop this business doesn't have yet: each is required. */}
          {missing.filter((t) => !(form?.kind === "loop" && form.type === t)).map((t) => (
            <div key={t} className="relative w-56 shrink-0" data-testid={`missing-loop-${t}`}>
              <div className="absolute -top-4 left-1/2 h-4 w-px bg-border" />
              <button className="w-full min-h-[5rem] rounded-lg border border-dashed border-amber-500/60 p-3 text-left space-y-1 hover:border-primary/50" onClick={() => setForm({ kind: "loop", loopTaskId: null, title: LOOP_TYPE_INFO[t].label, description: "", type: t })} data-testid={`button-add-missing-${t}`}>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TYPE_CLS[t]}`}>{LOOP_TYPE_INFO[t].label}</span>
                <p className="text-xs text-muted-foreground line-clamp-2">Missing. {LOOP_TYPE_INFO[t].asks}</p>
                <p className="text-xs flex items-center gap-1"><Plus className="h-3 w-3" />Add it</p>
              </button>
            </div>
          ))}

          {/* Add a loop */}
          {(addable.length > 0 || form?.kind === "loop") && (
          <div className="relative w-56 shrink-0">
            <div className="absolute -top-4 left-1/2 h-4 w-px bg-border" />
            {form?.kind === "loop" ? (
              <div className="rounded-lg border border-dashed border-border p-3 space-y-1.5" data-testid="add-loop-form">
                <select className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs" value={form.type ?? "product"} onChange={(e) => setForm({ ...form, type: e.target.value as LoopType })} data-testid="select-add-type">
                  {addable.map((t) => <option key={t} value={t}>{LOOP_TYPE_INFO[t].label}</option>)}
                </select>
                <input className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" placeholder="Name the loop" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-add-title" />
                <Textarea rows={3} className="text-sm" placeholder={`Its 3–5 steps, if you know them — e.g. ${LOOP_TYPE_INFO[form.type ?? "product"].example}`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-add-description" />
                <div className="flex gap-1.5"><Button size="sm" className="h-7 text-xs" disabled={add.isPending || !form.title.trim()} onClick={() => add.mutate(form)} data-testid="button-add-save">Add loop</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setForm(null)}>Cancel</Button></div>
              </div>
            ) : (
              <button className="w-full h-full min-h-[5rem] rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground flex items-center justify-center gap-1" onClick={() => setForm({ kind: "loop", loopTaskId: null, title: "", description: "", type: addable.includes("product") ? "product" : addable[0] })} data-testid="button-tree-add-loop">
                <Plus className="h-4 w-4" />{addable.includes("product") ? "Another product loop" : "Another loop"}
              </button>
            )}
          </div>
          )}
        </div>
      </div>
      <CompetitionPanel tree={tree} running={audit.isPending} onRun={() => audit.mutate()} />
      {tree.unassigned.length > 0 && (
        <p className="text-xs text-muted-foreground truncate" title={tree.unassigned.map((u) => u.title).join(", ")}>{tree.unassigned.length} step{tree.unassigned.length === 1 ? "" : "s"} not under a loop: {tree.unassigned.map((u) => u.title).join(", ")}</p>
      )}
    </div>
  );
}

/**
 * Nova's read of the loops against the competition. Offered once all five
 * kinds are written; re-offered when a loop has been added or replaced since.
 */
function CompetitionPanel({ tree, running, onRun }: { tree: LoopTreeData; running: boolean; onRun: () => void }) {
  const c = tree.competition;
  const button = (label: string, icon: JSX.Element) => (
    <Button size="sm" variant={c ? "outline" : "default"} className="h-7 text-xs" disabled={running || !tree.coverage.complete} onClick={onRun} data-testid="button-loop-audit">
      {running ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : icon}{label}
    </Button>
  );
  if (!c) {
    return (
      <div className={`rounded-lg border px-3 py-2 flex items-center gap-3 flex-wrap ${tree.competitionDue ? "border-primary/40 bg-primary/5" : "border-dashed border-border"}`} data-testid="loop-competition-empty">
        <Swords className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Loops vs. the competition</p>
          <p className="text-xs text-muted-foreground">{tree.coverage.complete ? "Scores each loop against what competitors run" : "Unlocks when all five loops are written"}</p>
        </div>
        {button("Run audit", <Swords className="h-3 w-3 mr-1" />)}
      </div>
    );
  }
  const a = c.audit;
  const overall: LoopVerdict = a.overallScore >= 70 ? "strong" : a.overallScore >= 45 ? "competitive" : "weak";
  return (
    <div className="rounded-lg border border-border p-3 space-y-3" data-testid="loop-competition">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-0.5">
          <p className="text-sm font-medium flex items-center gap-1.5"><Swords className="h-4 w-4 text-primary" />Loops vs. the competition</p>
          <p className="text-[11px] text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}{c.stale ? " · your loops have changed since" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${VERDICT_CLS[overall]}`} data-testid="loop-competition-score">{a.overallScore}/100</span>
          {button(c.stale ? "Audit again" : "Re-run", <RefreshCw className="h-3 w-3 mr-1" />)}
        </div>
      </div>
      {a.summary && <p className="text-sm text-muted-foreground line-clamp-2" title={a.summary}>{a.summary}</p>}
      {a.competitors.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Who customers use today</p>
          <div className="flex flex-wrap gap-1">{a.competitors.map((x) => <span key={x.name} className="text-[11px] rounded-full bg-muted px-2 py-0.5" title={x.why}>{x.name}</span>)}</div>
        </div>
      )}
      <ul className="space-y-2">
        {a.loops.map((r) => (
          <li key={r.loopTaskId} className={`rounded-md border p-2 space-y-1 text-xs ${r.loopTaskId === a.weakestLoopTaskId ? "border-destructive/40" : "border-border"}`} data-testid={`loop-read-${r.loopTaskId}`}>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TYPE_CLS[r.type]}`}>{LOOP_TYPE_INFO[r.type].label}</span>
              <span className="font-medium text-sm">{r.title}</span>
              <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${VERDICT_CLS[r.verdict]}`}>{r.score}/100 · {r.verdict}</span>
              {r.loopTaskId === a.weakestLoopTaskId && <span className="text-[10px] text-destructive">fix first</span>}
            </div>
            {r.recommendation && <p className="line-clamp-2"><span className="font-medium">Do this:</span> {r.recommendation}</p>}
            {(r.competitors.length > 0 || r.advantage || r.gap || r.breakRisk) && (
              <details className="text-muted-foreground">
                <summary className="cursor-pointer text-primary text-[11px]">Details</summary>
                <div className="space-y-1 pt-1">
                  {r.competitors.length > 0 && <p>{r.competitors.map((x) => `${x.name}: ${x.howTheirLoopWorks}`).join(" · ")}</p>}
                  {r.advantage && <p><span className="font-medium text-foreground">Edge:</span> {r.advantage}</p>}
                  {r.gap && <p><span className="font-medium text-foreground">Gap:</span> {r.gap}</p>}
                  {r.breakRisk && <p><span className="font-medium text-foreground">Likely to break at:</span> {r.breakRisk}</p>}
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
      {a.caveat && <p className="text-[11px] text-muted-foreground italic line-clamp-1" title={a.caveat}>{a.caveat}</p>}
    </div>
  );
}
