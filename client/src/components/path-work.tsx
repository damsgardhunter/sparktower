import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WORK_ACTION_LABEL, type Actor, type WorkPayload } from "@shared/phase-trees";
import { CheckCircle2, Copy, Loader2, Wrench } from "lucide-react";

export interface WorkRow { id: string; kind: WorkPayload["kind"]; payload: WorkPayload; chosenIndex: number | null; createdAt: string }

/** Every path query on the manage page, so a change anywhere shows everywhere. */
export function refreshPath(projectId: string) {
  for (const key of ["path", "kanban", "nova-briefing", "milestones", "roadmap"]) queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, key] });
  queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
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
export function WorkView({ projectId, taskId, actor, work, done, compact }: {
  projectId: string; taskId: string; actor: Actor; work: WorkRow | null; done: boolean; compact?: boolean;
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
      {run.isPending ? "Nova is on it…" : work ? "Have Nova redo it" : WORK_ACTION_LABEL[actor]}
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
          {p.runSteps.length > 0 && <ol className="list-decimal pl-5 text-sm space-y-0.5">{p.runSteps.map((r, i) => <li key={i}>{r}</li>)}</ol>}
          {p.verify && <p className="text-sm"><span className="font-medium">It works when:</span> {p.verify}</p>}
          {!done && (
            <Button size="sm" disabled={choose.isPending} onClick={() => choose.mutate({ workId: work.id })} data-testid="button-build-works">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />It runs — mark done
            </Button>
          )}
        </div>
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
