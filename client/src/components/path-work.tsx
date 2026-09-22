import { RunBlocks } from "@/components/run-blocks";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { workActionLabel, type Actor, type WorkPayload, type WorkKind, type IntakeQuestion, type PlanPayload } from "@shared/phase-trees";
import { CheckCircle2, Copy, Loader2, Wrench, ListPlus, AlertTriangle, ShieldCheck, Wand2 } from "lucide-react";

export interface WorkRow { id: string; kind: WorkPayload["kind"]; payload: WorkPayload; chosenIndex: number | null; createdAt: string }

/**
 * Every path query on the manage page, so a change anywhere shows everywhere.
 *
 * Including the home card's, which this used to leave alone: finishing a step
 * on the project page moved the path but left "Continue your path" showing the
 * step you had just finished until its own poll came round. The phone had
 * always invalidated it (mobile/src/components/manage/shared.ts); the web had
 * not, so the same action told two different stories depending on the device.
 */
export function refreshPath(projectId: string) {
  for (const key of ["path", "kanban", "nova-briefing", "milestones", "roadmap"]) queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
  queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
  queryClient.invalidateQueries({ queryKey: ["/api/me/next-steps"] });
}

export function useFail() {
  const { toast } = useToast();
  return (e: any) => {
    // apiRequest throws "<status>: <body>"; the body is our JSON with a sentence in it.
    const raw = String(e?.message ?? "Something went wrong").replace(/^\d+:\s*/, "");
    let message = raw;
    try { message = JSON.parse(raw).message ?? raw; } catch { /* plain text */ }
    toast({ title: message, variant: "destructive" });
  };
}

/**
 * Nova's work on one task, and the controls to act on it: the work button
 * when there is none yet, then options to pick, a build to accept, or a
 * template to use. Shared by the next-action card and the milestone view.
 */
export function WorkView({ projectId, taskId, actor, work, done, compact, intake, workKind, prefill, optionNotes }: {
  projectId: string; taskId: string; actor: Actor; work: WorkRow | null; done: boolean; compact?: boolean;
  /** The step's questions, when it's answered by tapping rather than by Nova. */
  intake?: IntakeQuestion[];
  /** What Nova produces here, when it isn't the actor's default. */
  workKind?: WorkKind;
  prefill?: "resume";
  optionNotes?: Record<string, Record<string, string>>;
}) {
  if (intake?.length) {
    return <IntakeView projectId={projectId} taskId={taskId} questions={intake} work={work} done={done} prefill={prefill} optionNotes={optionNotes} />;
  }
  return <NovaWorkView projectId={projectId} taskId={taskId} actor={actor} work={work} done={done} compact={compact} workKind={workKind} />;
}

function NovaWorkView({ projectId, taskId, actor, work, done, compact, workKind }: {
  projectId: string; taskId: string; actor: Actor; work: WorkRow | null; done: boolean; compact?: boolean; workKind?: WorkKind;
}) {
  const { toast } = useToast();
  const fail = useFail();
  const [edit, setEdit] = useState<{ index: number; text: string } | null>(null);
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast({ title: "Copied" })).catch(() => {});

  const run = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/path/work`, { taskId }).then((r) => r.json()),
    onSuccess: () => { setEdit(null); refreshPath(projectId); },
    onError: fail,
  });
  const choose = useMutation({
    mutationFn: (b: { workId: string; index?: number; text?: string }) => apiRequest("POST", `/api/projects/${projectId}/path/work/${b.workId}/choose`, b).then((r) => r.json()),
    onSuccess: () => { setEdit(null); refreshPath(projectId); toast({ title: "Saved as your answer" }); },
    onError: fail,
  });

  const runButton = (
    <Button size="sm" variant={work ? "outline" : "default"} disabled={run.isPending} onClick={() => run.mutate()} data-testid="button-work">
      {run.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5 mr-1.5" />}
      {run.isPending ? "Nova is on it…" : work ? "Have Nova redo it" : workActionLabel(actor, workKind)}
    </Button>
  );

  if (!work) return <div className="flex gap-2 flex-wrap">{runButton}</div>;
  const p = work.payload;

  return (
    <div className="space-y-2" data-testid="nova-work">
      {(p.kind === "options" || p.kind === "build") && p.existing && (
        <p className="text-xs rounded-md bg-muted/50 px-2 py-1.5" data-testid="work-existing"><span className="font-medium">Already in place:</span> {p.existing}</p>
      )}
      {p.kind === "options" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{p.intro}</p>
          {p.options.map((o, i) => {
            const chosen = work.chosenIndex === i;
            return (
              <div key={i} className={`rounded-md border p-3 space-y-1 ${chosen || edit?.index === i ? "border-primary" : "border-border"}`} data-testid={`work-option-${i}`}>
                <p className="font-medium text-sm flex items-center gap-2">{o.title}{chosen && <span className="text-[10px] uppercase tracking-wide text-primary">chosen</span>}</p>
                {edit?.index === i
                  ? <Textarea value={edit.text} onChange={(e) => setEdit({ index: i, text: e.target.value })} rows={5} className="text-sm" data-testid="input-work-edit" />
                  : <p className={`text-sm whitespace-pre-wrap ${compact && !chosen ? "line-clamp-3" : ""}`}>{o.body}</p>}
                {o.why && <p className="text-xs text-muted-foreground">{o.why}</p>}
                {!done && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" disabled={choose.isPending} onClick={() => choose.mutate({ workId: work.id, index: i, text: edit?.index === i ? edit.text : undefined })} data-testid={`button-pick-${i}`}>
                      {edit?.index === i ? "Use my edit" : "Use this one"}
                    </Button>
                    {edit?.index !== i && <Button size="sm" variant="ghost" onClick={() => setEdit({ index: i, text: o.body })}>Edit</Button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {p.kind === "build" && (
        <div className="space-y-2" data-testid="work-build">
          <p className="text-sm">{p.summary}</p>
          {p.assumptions.length > 0 && <p className="text-xs text-muted-foreground">Assumed: {p.assumptions.join(" · ")}</p>}
          {p.files.map((f, i) => (
            <details key={i} className="rounded-md border border-border" data-testid={`work-file-${i}`}>
              <summary className="cursor-pointer px-3 py-2 text-sm flex items-center gap-2">
                <code className="text-xs">{f.path}</code>
                {f.purpose && <span className="text-xs text-muted-foreground truncate">{f.purpose}</span>}
                <button className="ml-auto text-xs text-primary flex items-center gap-1" onClick={(e) => { e.preventDefault(); copy(f.content); }}><Copy className="h-3 w-3" />copy</button>
              </summary>
              <pre className="text-xs p-3 overflow-x-auto bg-muted/40 max-h-80"><code>{f.content}</code></pre>
            </details>
          ))}
          {p.runSteps.length > 0 && <RunBlocks groups={p.runGroups} steps={p.runSteps} />}
          {p.verify && <p className="text-sm"><span className="font-medium">It works when:</span> {p.verify}</p>}
          {!done && (
            <Button size="sm" disabled={choose.isPending} onClick={() => choose.mutate({ workId: work.id })} data-testid="button-build-works">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />It runs — mark done
            </Button>
          )}
        </div>
      )}
      {p.kind === "plan" && (
        <PlanView projectId={projectId} workId={work.id} plan={p} done={done} compact={compact}
          onAccept={() => choose.mutate({ workId: work.id })} accepting={choose.isPending} />
      )}
      {p.kind === "template" && (
        <div className="space-y-2" data-testid="work-template">
          <p className="text-sm text-muted-foreground">{p.intro}</p>
          <pre className="text-sm whitespace-pre-wrap rounded-md border border-border p-3 bg-muted/40">{p.template}</pre>
          <p className="text-xs text-muted-foreground"><span className="font-medium">Nova did:</span> {p.whatNovaDid} <span className="font-medium ml-2">You do:</span> {p.whatIsLeft}</p>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => copy(p.template)}><Copy className="h-3.5 w-3.5 mr-1.5" />Copy</Button>
            {!done && (
              <Button size="sm" disabled={choose.isPending} onClick={() => choose.mutate({ workId: work.id })} data-testid="button-template-done">
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />I did this
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="flex gap-2 flex-wrap pt-1">{runButton}</div>
    </div>
  );
}

/**
 * A step answered by tapping: each question's choices as bubbles. Saving marks
 * the step done and Nova reads the answers on every step after it; answers can
 * be changed later from the same place.
 */
export function IntakeView({ projectId, taskId, questions, work, done, onSaved, prefill, optionNotes }: {
  projectId: string; taskId: string; questions: IntakeQuestion[]; work: WorkRow | null; done: boolean;
  /** Called once the answers are saved — the Nova guide closes itself here. */
  onSaved?: () => void;
  /** Where answers can be suggested from: the résumé on your profile. */
  prefill?: "resume";
  /** A short note beside an option — a route's fit score, say — keyed by question then option. */
  optionNotes?: Record<string, Record<string, string>>;
}) {
  const fail = useFail();
  const { toast } = useToast();
  const saved = work?.payload.kind === "intake" ? work.payload.answers : null;
  const [answers, setAnswers] = useState<Record<string, string[]>>(saved ?? {});
  const [editing, setEditing] = useState(!done || !saved);
  const [prefilled, setPrefilled] = useState<string[] | null>(null);

  const save = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/path/intake`, { taskId, answers: visibleAnswers() }).then((r) => r.json()),
    onSuccess: (r: { route?: string | null }) => {
      setEditing(false); refreshPath(projectId);
      toast({ title: r?.route ? "Route chosen — your roadmap is ready" : "Saved — Nova will build from this" });
      onSaved?.();
    },
    onError: fail,
  });

  const fill = useMutation({
    mutationFn: () => apiRequest("GET", `/api/projects/${projectId}/path/prefill/${taskId}`).then((r) => r.json()),
    onSuccess: (r: { hasResume: boolean; answers: Record<string, string[]> | null; found: string[] }) => {
      if (!r.hasResume) { toast({ title: "No résumé on your profile yet", description: "Upload one on your profile and Nova can fill this in." }); return; }
      if (r.answers) setAnswers((prev) => ({ ...prev, ...r.answers }));
      setPrefilled(r.found);
      toast({
        title: r.found.length ? "Filled in from your résumé — check it" : "Your résumé doesn't show a business you owned",
        description: r.found.length ? "Revenue, profit and size aren't on résumés, so those are still yours to pick." : undefined,
      });
    },
    onError: fail,
  });

  const asked = (q: IntakeQuestion) => !q.showIf || (answers[q.showIf.question] ?? []).some((a) => q.showIf!.in.includes(a));
  const visibleAnswers = () => Object.fromEntries(questions.filter(asked).map((q) => [q.id, answers[q.id] ?? []]));
  const pick = (q: IntakeQuestion, id: string) => setAnswers((prev) => {
    const current = prev[q.id] ?? [];
    if (q.multi) return { ...prev, [q.id]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] };
    return { ...prev, [q.id]: current[0] === id ? [] : [id] };
  });
  const missing = questions.filter((q) => asked(q) && !q.optional && !(answers[q.id]?.length));

  if (!editing && work?.payload.kind === "intake") {
    const savedAnswers = work.payload.answers;
    return (
      <div className="space-y-2" data-testid="intake-answers">
        <div className="rounded-md bg-muted/50 p-3 space-y-1">
          {questions.filter((q) => !q.showIf || (savedAnswers[q.showIf.question] ?? []).some((a) => q.showIf!.in.includes(a))).map((q) => {
            const values = savedAnswers[q.id] ?? [];
            const labels = q.kind === "text" ? values : values.map((id) => q.options.find((o) => o.id === id)?.label ?? id);
            return (
              <p key={q.id} className="text-sm"><span className="text-muted-foreground">{q.prompt}</span> <span className="font-medium">{labels.length ? labels.join(", ") : "Not sure yet"}</span></p>
            );
          })}
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)} data-testid="button-intake-change">Change my answers</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="intake-form">
      {prefill === "resume" && (
        <div className="flex items-center gap-3 flex-wrap rounded-md border border-dashed border-border p-2.5">
          <Button size="sm" variant="outline" disabled={fill.isPending} onClick={() => fill.mutate()} data-testid="button-intake-prefill">
            {fill.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
            Fill from my résumé
          </Button>
          <span className="text-xs text-muted-foreground">
            {prefilled?.length ? `Found: ${prefilled.join("; ")}` : "Nova reads the roles on your profile. You check everything before it's saved."}
          </span>
        </div>
      )}
      {questions.filter(asked).map((q) => (
        <fieldset key={q.id} className="space-y-2" data-testid={`intake-q-${q.id}`}>
          <legend className="text-sm font-medium">
            {q.prompt}
            {q.optional && <span className="ml-1.5 text-xs font-normal text-muted-foreground">optional</span>}
            {q.multi && <span className="ml-1.5 text-xs font-normal text-muted-foreground">pick any</span>}
          </legend>
          {q.help && <p className="text-xs text-muted-foreground -mt-1">{q.help}</p>}
          {q.kind === "text" ? (
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder={q.placeholder}
              maxLength={300}
              value={answers[q.id]?.[0] ?? ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value ? [e.target.value] : [] }))}
              data-testid={`intake-${q.id}-text`}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => {
                const on = (answers[q.id] ?? []).includes(o.id);
                const note = optionNotes?.[q.id]?.[o.id];
                return (
                  <button
                    key={o.id} type="button" aria-pressed={on}
                    onClick={() => pick(q, o.id)}
                    className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/60"}`}
                    data-testid={`intake-${q.id}-${o.id}`}
                  >
                    {o.label}
                    {note && <span className={`ml-1.5 text-xs ${on ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{note}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
      ))}
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" disabled={missing.length > 0 || save.isPending} onClick={() => save.mutate()} data-testid="button-intake-save">
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
          {saved ? "Save my answers" : "Save and continue"}
        </Button>
        {missing.length > 0 && <span className="text-xs text-muted-foreground">{missing.length} to answer</span>}
        {saved && <Button size="sm" variant="ghost" onClick={() => { setAnswers(saved); setEditing(false); }}>Cancel</Button>}
      </div>
    </div>
  );
}

/** A plan Nova built: the numbers, the tables, what it assumed, what's weak, and what to do next. */
function PlanView({ projectId, workId, plan, done, compact, onAccept, accepting }: {
  projectId: string; workId: string; plan: PlanPayload; done: boolean; compact?: boolean; onAccept: () => void; accepting: boolean;
}) {
  const fail = useFail();
  const { toast } = useToast();
  const addTasks = useMutation({
    mutationFn: () => apiRequest("POST", `/api/projects/${projectId}/path/work/${workId}/tasks`, {}).then((r) => r.json()),
    onSuccess: (r: { created: string[]; skipped: number }) => {
      refreshPath(projectId);
      toast({ title: r.created.length ? `Added ${r.created.length} task${r.created.length === 1 ? "" : "s"} to your board` : "Those are already on your board" });
    },
    onError: fail,
  });

  return (
    <div className="space-y-3" data-testid="work-plan">
      <p className="text-sm leading-relaxed">{plan.summary}</p>
      {plan.figures.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {plan.figures.map((f, i) => (
            <div key={i} className="rounded-md border border-border p-2" data-testid={`plan-figure-${i}`}>
              <p className="text-[11px] text-muted-foreground">{f.label}</p>
              <p className="text-base font-semibold tabular-nums">{f.value}</p>
              {f.note && <p className="text-[11px] text-muted-foreground leading-snug">{f.note}</p>}
            </div>
          ))}
        </div>
      )}
      {plan.tables.map((t, i) => (
        <div key={i} className="space-y-1">
          {t.title && <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t.title}</p>}
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50"><tr>{t.columns.map((c, j) => <th key={j} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">{c}</th>)}</tr></thead>
              <tbody>{t.rows.map((r, j) => <tr key={j} className="border-t border-border/60">{r.map((c, k) => <td key={k} className="px-2 py-1.5 align-top">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </div>
      ))}
      {plan.sections.map((s, i) => (
        <details key={i} className="rounded-md border border-border" open={!compact && i === 0}>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{s.heading || "Detail"}</summary>
          <p className="px-3 pb-3 text-sm whitespace-pre-wrap leading-relaxed">{s.body}</p>
        </details>
      ))}
      {plan.gaps.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-1" data-testid="plan-gaps">
          <p className="text-xs font-medium flex items-center gap-1.5 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> What's weak</p>
          <ul className="text-sm list-disc pl-5 space-y-0.5">{plan.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </div>
      )}
      {plan.actions.length > 0 && (
        <div className="space-y-1.5" data-testid="plan-actions">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">What to do</p>
          <ol className="space-y-1.5">
            {plan.actions.map((a, i) => (
              <li key={i} className="rounded-md border border-border p-2 text-sm">
                <p className="font-medium flex items-baseline gap-2 flex-wrap">
                  {a.when && <span className="text-[11px] rounded bg-muted px-1.5 py-0.5 font-normal">{a.when}</span>}
                  {a.title}
                </p>
                {a.detail && <p className="text-xs text-muted-foreground mt-0.5">{a.detail}</p>}
                {a.moves && <p className="text-xs text-primary mt-0.5">Moves: {a.moves}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {plan.assumptions.length > 0 && <p className="text-xs text-muted-foreground">Assumed: {plan.assumptions.join(" · ")}</p>}
      {plan.verifyWith && <p className="text-xs text-muted-foreground flex items-start gap-1.5"><ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Check with: {plan.verifyWith}</p>}
      <div className="flex gap-2 flex-wrap">
        {!done && (
          <Button size="sm" disabled={accepting} onClick={onAccept} data-testid="button-plan-accept">
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Plan on this — mark done
          </Button>
        )}
        {plan.actions.length > 0 && (
          <Button size="sm" variant="outline" disabled={addTasks.isPending} onClick={() => addTasks.mutate()} data-testid="button-plan-tasks">
            {addTasks.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5 mr-1.5" />}
            Add these to my tasks
          </Button>
        )}
      </div>
    </div>
  );
}
