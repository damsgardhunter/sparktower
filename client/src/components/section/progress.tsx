/** Progress & pace: four numbers, Nova's one-line read, and the two controls that steer Nova. */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { refreshPath, useFail } from "@/components/path-work";
import { Clamp } from "./block";
import { projection, type PathStatus } from "./path-types";
import { Loader2, Sparkles, MessageSquare } from "lucide-react";

const PACE_LABEL: Record<string, string> = { active: "On pace", nudge: "Quiet week", decaying: "Slipping", dormant: "Paused" };
const PACE_TONE: Record<string, string> = { active: "text-emerald-600", nudge: "text-amber-600", decaying: "text-amber-700", dormant: "text-muted-foreground" };

export function ProgressStats({ data }: { data: PathStatus }) {
  const { mainLine, current, pace, plan } = data;
  const pct = mainLine.total ? Math.round((mainLine.done / mainLine.total) * 100) : 0;
  const tiles = [
    { label: "Complete", value: `${pct}%`, sub: `${mainLine.done}/${mainLine.total} milestones`, bar: pct },
    { label: "Phase", value: current.title.split(" — ")[0], sub: `Step ${current.step} of ${current.of}` },
    { label: "Finish", value: pace ? projection(pace) : "—", sub: plan && plan.loops > 1 ? `${plan.loops} loops · ${Math.round(plan.authoredDays / 7)} wk plan` : "Projected", testid: "pace-projection" },
    { label: "Pace", value: pace?.multiplier != null ? `${pace.multiplier}×` : pace ? PACE_LABEL[pace.state] ?? "—" : "—", sub: pace ? (Math.floor(pace.daysSinceActivity) === 0 ? "Active today" : `Last active ${Math.floor(pace.daysSinceActivity)}d ago`) : "No activity yet", tone: pace ? PACE_TONE[pace.state] : "", testid: "pace-multiplier" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-lg border border-border bg-border overflow-hidden" data-testid="path-progress">
      {tiles.map((t) => (
        <div key={t.label} className="bg-background p-3 min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.label}</p>
          <p className={`text-lg font-semibold tabular-nums truncate ${t.tone ?? ""}`} data-testid={t.testid} title={t.value}>{t.value}</p>
          <p className="text-[11px] text-muted-foreground truncate" data-testid={t.label === "Finish" && plan && plan.loops > 1 ? "plan-loops" : undefined}>{t.sub}</p>
          {t.bar != null && <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all duration-700" style={{ width: `${t.bar}%` }} /></div>}
        </div>
      ))}
    </div>
  );
}

/** Nova's read of the pace, and the note/re-read controls. */
export function NovaRead({ projectId, data, adopting, onReevaluate }: { projectId: string; data: PathStatus; adopting: boolean; onReevaluate: () => void }) {
  const { toast } = useToast();
  const fail = useFail();
  const [notes, setNotes] = useState<string | null>(null);
  const saveNotes = useMutation({
    mutationFn: (n: string) => apiRequest("PUT", `/api/projects/${projectId}/nova-notes`, { notes: n }).then((r) => r.json()),
    onSuccess: () => { setNotes(null); refreshPath(projectId); toast({ title: "Nova will keep that in mind" }); },
    onError: fail,
  });
  const { pace } = data;
  return (
    <div className="space-y-2" data-testid="nova-panel">
      <div className="flex items-start gap-3 flex-wrap">
        {pace && (
          <div className="flex items-start gap-2 flex-1 min-w-[14rem]">
            <Sparkles className="h-3.5 w-3.5 text-primary mt-1 shrink-0" />
            <div data-testid="pace-note" className="min-w-0">
              <Clamp text={`${pace.state === "nudge" ? "A week without activity — one small step keeps the date. " : ""}${pace.note}`} lines={1} />
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setNotes(notes == null ? data.novaNotes : null)} data-testid="button-nova-notes" title="Something Nova keeps getting wrong? Tell it once; every read obeys it.">
            <MessageSquare className="h-3.5 w-3.5 mr-1" />{data.novaNotes ? "Your note" : "Tell Nova"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={adopting} onClick={onReevaluate} data-testid="button-reevaluate" title="Nova re-reads your brief, setup, audits and tasks, and marks what's done.">
            {adopting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            {adopting ? "Re-reading…" : "Re-evaluate"}
          </Button>
        </div>
      </div>
      {notes != null && (
        <div className="space-y-2 rounded-lg border border-border p-3" data-testid="nova-notes-form">
          <p className="text-xs text-muted-foreground">Outranks the brief and the board on every read.</p>
          <Textarea rows={3} className="text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Check-ins are being removed — they are not a loop." data-testid="input-nova-notes" />
          <div className="flex gap-2">
            <Button size="sm" disabled={saveNotes.isPending} onClick={() => saveNotes.mutate(notes)} data-testid="button-save-nova-notes">Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setNotes(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {data.rejectedLoops.length > 0 && (
        <p className="text-[11px] text-muted-foreground truncate" title={data.rejectedLoops.join(" · ")} data-testid="rejected-loops">Not loops: {data.rejectedLoops.join(" · ")}</p>
      )}
    </div>
  );
}
