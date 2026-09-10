import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WorkView, refreshPath, useFail, type WorkRow } from "@/components/path-work";
import type { Actor } from "@shared/phase-trees";
import { CheckCircle2, Circle, Loader2, ListTree, Plus, Sparkles, ChevronRight, RotateCcw, Pencil, Trash2 } from "lucide-react";

export interface LoopStep { taskId: string; title: string; description: string; status: string; actor: Actor; estimateHours: number | null }
export interface LoopNode {
  taskId: string; title: string; description: string; written: boolean; status: string; actor: Actor;
  state: "unwritten" | "written" | "planned" | "building" | "built";
  steps: LoopStep[]; done: number; total: number;
}
export interface LoopTreeData { sourceId: string; sourceTitle: string; fanOutId: string; fanOutTitle: string; loops: LoopNode[]; unassigned: { taskId: string; title: string; status: string }[] }

const STATE: Record<LoopNode["state"], { label: string; cls: string }> = {
  unwritten: { label: "Not written", cls: "bg-muted text-muted-foreground" },
  written: { label: "Written", cls: "bg-primary/10 text-primary" },
  planned: { label: "Steps ready", cls: "bg-primary/10 text-primary" },
  building: { label: "Building", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  built: { label: "Built", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
};

export interface ProposedLoop { title: string; steps: string; state: "built" | "partly" | "planned"; evidence: string }

/**
 * Nova's proposed loops, reviewed before anything is recorded. Untick what
 * isn't a loop, edit names and steps, and accept — merging is editing one
 * entry to hold both and unticking the other.
 */
export function LoopReview({ projectId, proposals, onDone }: { projectId: string; proposals: ProposedLoop[]; onDone: () => void }) {
  const { toast } = useToast();
  const fail = useFail();
  const [rows, setRows] = useState(proposals.map((p) => ({ ...p, keep: true })));
  const accept = useMutation({
    mutationFn: (loops: ProposedLoop[]) => apiRequest("POST", `/api/projects/${projectId}/path/loops/accept`, { loops }).then((r) => r.json()),
    onSuccess: (r: any) => { toast({ title: `${r.created.length} loop${r.created.length === 1 ? "" : "s"} added${r.updated.length ? `, ${r.updated.length} updated` : ""}` }); onDone(); },
    onError: fail,
  });
  const kept = rows.filter((r) => r.keep && r.title.trim());
  return (
    <div className="rounded-lg border border-primary/40 p-3 space-y-2" data-testid="loop-review">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold">Nova thinks these might be your loops</p>
        <span className="text-xs text-muted-foreground">A loop is what one kind of user does over and over. Untick anything that's a feature or a setup path, fix names and steps, then add.</span>
      </div>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className={`rounded-md border p-2 space-y-1 ${r.keep ? "border-border" : "border-border/40 opacity-60"}`} data-testid={`proposal-${i}`}>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={r.keep} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, keep: e.target.checked } : x))} data-testid={`proposal-keep-${i}`} />
              <input className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm" value={r.title} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} data-testid={`proposal-title-${i}`} />
              <select className="rounded-md border border-border bg-background px-2 py-1 text-xs" value={r.state} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, state: e.target.value as ProposedLoop["state"] } : x))}>
                <option value="built">built</option><option value="partly">partly</option><option value="planned">planned</option>
              </select>
            </div>
            <Textarea rows={2} className="text-xs" value={r.steps} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, steps: e.target.value } : x))} data-testid={`proposal-steps-${i}`} />
            {r.evidence && <p className="text-[11px] text-muted-foreground">Why Nova thinks so: {r.evidence}</p>}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button size="sm" disabled={accept.isPending || kept.length === 0} onClick={() => accept.mutate(kept.map(({ keep: _k, ...l }) => l))} data-testid="button-accept-loops">
          {accept.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}Add {kept.length} loop{kept.length === 1 ? "" : "s"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Not now</Button>
      </div>
    </div>
  );
}

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
export function LoopTree({ projectId, tree }: { projectId: string; tree: LoopTreeData }) {
  const { toast } = useToast();
  const fail = useFail();
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: "loop" | "step"; loopTaskId: string | null; title: string; description: string } | null>(null);
  const [draft, setDraft] = useState<{ loopTaskId: string; title: string; text: string } | null>(null);

  const add = useMutation({
    mutationFn: (f: NonNullable<typeof form>) => f.kind === "loop"
      ? apiRequest("POST", `/api/projects/${projectId}/path/loops`, { backboneId: tree.sourceId, title: f.title, description: f.description }).then((r) => r.json())
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
  const [rename, setRename] = useState<{ taskId: string; title: string; description: string } | null>(null);
  const save = useMutation({
    mutationFn: (b: { taskId: string; title: string; description: string }) => apiRequest("PATCH", `/api/kanban/${b.taskId}`, { title: b.title, description: b.description }),
    onSuccess: () => { setRename(null); refreshPath(projectId); }, onError: fail,
  });
  const remove = useMutation({
    mutationFn: (taskId: string) => apiRequest("DELETE", `/api/projects/${projectId}/path/loops/${taskId}`).then((r) => r.json()),
    onSuccess: (r: any) => { refreshPath(projectId); toast({ title: "Loop removed", description: r.keptSteps ? `${r.keptSteps} finished step${r.keptSteps === 1 ? "" : "s"} kept on the board.` : undefined }); },
    onError: fail,
  });

  const built = tree.loops.filter((l) => l.state === "built").length;

  return (
    <div className="space-y-3" data-testid="loop-tree">
      {/* Root */}
      <div className="flex flex-col items-center">
        <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-center">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{tree.sourceTitle}</p>
          <p className="text-sm font-semibold">{tree.loops.length} loop{tree.loops.length === 1 ? "" : "s"} · {built} built</p>
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
                      <input className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" value={rename.title} onChange={(e) => setRename({ ...rename, title: e.target.value })} data-testid="input-rename-title" />
                      <Textarea rows={3} className="text-xs" value={rename.description} onChange={(e) => setRename({ ...rename, description: e.target.value })} data-testid="input-rename-steps" />
                      <div className="flex gap-1.5"><Button size="sm" className="h-7 text-xs" disabled={save.isPending || !rename.title.trim()} onClick={() => save.mutate(rename)} data-testid="button-rename-save">Save</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRename(null)}>Cancel</Button></div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <button className="text-left font-medium text-sm leading-snug hover:underline" onClick={() => setOpen(isOpen ? null : loop.taskId)} data-testid={`open-loop-${loop.taskId}`}>{loop.title}</button>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${st.cls}`} data-testid={`loop-state-${loop.taskId}`}>{st.label}</span>
                          <button className="text-muted-foreground hover:text-foreground" title="Rename or rewrite" onClick={() => setRename({ taskId: loop.taskId, title: loop.title, description: loop.description })} data-testid={`rename-loop-${loop.taskId}`}><Pencil className="h-3 w-3" /></button>
                          <button className="text-muted-foreground hover:text-destructive" title="Not a loop — remove it" disabled={remove.isPending} onClick={() => { if (window.confirm(`Remove "${loop.title}"? Unfinished steps go with it.`)) remove.mutate(loop.taskId); }} data-testid={`delete-loop-${loop.taskId}`}><Trash2 className="h-3 w-3" /></button>
                        </div>
                      </div>
                      {loop.description
                        ? <p className={`text-xs text-muted-foreground whitespace-pre-wrap ${isOpen ? "" : "line-clamp-3"}`}>{loop.description}</p>
                        : <p className="text-xs text-muted-foreground italic">What are its 3–5 steps? Write it, or have Nova draft it from your project.</p>}
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
                      <p className="text-xs text-muted-foreground">Nothing written for <span className="font-medium text-foreground">{draft.title}</span> yet, so Nova drafted it. Edit, then build the steps.</p>
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
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3 text-primary" />The loop itself</p>
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

          {/* Add a loop */}
          <div className="relative w-56 shrink-0">
            <div className="absolute -top-4 left-1/2 h-4 w-px bg-border" />
            {form?.kind === "loop" ? (
              <div className="rounded-lg border border-dashed border-border p-3 space-y-1.5" data-testid="add-loop-form">
                <input className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm" placeholder="Name the loop" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="input-add-title" />
                <Textarea rows={3} className="text-sm" placeholder="Its 3–5 steps, if you know them" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-add-description" />
                <div className="flex gap-1.5"><Button size="sm" className="h-7 text-xs" disabled={add.isPending || !form.title.trim()} onClick={() => add.mutate(form)} data-testid="button-add-save">Add loop</Button><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setForm(null)}>Cancel</Button></div>
              </div>
            ) : (
              <button className="w-full h-full min-h-[5rem] rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground flex items-center justify-center gap-1" onClick={() => setForm({ kind: "loop", loopTaskId: null, title: "", description: "" })} data-testid="button-tree-add-loop">
                <Plus className="h-4 w-4" />Another loop
              </button>
            )}
          </div>
        </div>
      </div>
      {tree.unassigned.length > 0 && (
        <p className="text-xs text-muted-foreground">{tree.unassigned.length} step{tree.unassigned.length === 1 ? "" : "s"} not under any loop: {tree.unassigned.map((u) => u.title).join(", ")}</p>
      )}
    </div>
  );
}
