import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { trackLoopEvent, newComposeSession, LOOP_EVENTS } from "@/lib/loop-events";
import { Loader2, Target, CheckCircle2, AlertTriangle, ArrowRight, Globe, Link2, Sparkles } from "lucide-react";
import {
  CHECK_IN_LIMITS, validateCheckIn, weekLabel, weekKey, type CheckInVisibility,
} from "@shared/check-in";
import { CREDIT_COSTS } from "@shared/plans";

interface Context {
  weekStart: string;
  current: {
    id: string; goal: string; proof: string; blocker: string | null;
    nextStep: string; visibility: CheckInVisibility; needsFeedback: boolean;
  } | null;
  previous: { goal: string; nextStep: string; weekStart: string } | null;
}

const EMPTY = { goal: "", proof: "", blocker: "", nextStep: "" };

/** Counter that only turns red once you're actually over. */
function Count({ value, max }: { value: string; max: number }) {
  const n = value.trim().length;
  return (
    <span
      className={`text-[11px] tabular-nums ${n > max ? "text-destructive" : "text-muted-foreground"}`}
    >
      {n}/{max}
    </span>
  );
}

function Field({
  label, hint, error, children, value, max,
}: {
  label: string; hint?: string; error?: string;
  children: React.ReactNode; value: string; max: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <Count value={value} max={max} />
      </div>
      {children}
      {/* The rule shows before you've broken it; the error replaces it after. */}
      {error
        ? <p className="text-xs text-destructive leading-relaxed">{error}</p>
        : hint && <p className="text-[11px] text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  );
}

/**
 * The weekly check-in composer — step 2 of the loop.
 *
 * Four fields, tight limits, and a two-minute target. Three things exist here
 * purely to protect that target: last week's goal and next step are shown so
 * the builder starts from what they already said, the draft is kept in local
 * storage so a mis-click doesn't cost the whole thing, and validation runs as
 * you type rather than rejecting you at the end.
 */
export function CheckInComposer({
  projectId, open, onClose, editing,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /**
   * A past check-in to edit. Omitted for the normal case — this week, which
   * the server upserts so re-opening the composer edits rather than duplicates.
   */
  editing?: {
    id: string; weekStart: string; goal: string; proof: string;
    blocker: string | null; nextStep: string;
    visibility: CheckInVisibility; needsFeedback: boolean;
  } | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState(EMPTY);
  const [visibility, setVisibility] = useState<CheckInVisibility>("unlisted");
  const [needsFeedback, setNeedsFeedback] = useState(false);
  const [touched, setTouched] = useState(false);
  const [restored, setRestored] = useState(false);
  /*
   * One id per composing session, sent with both "started" and "submitted" so
   * the pair can be matched. Without it, time-to-post is unknowable — there's
   * nothing tying an opened composer to the check-in it produced.
   */
  const [sessionId, setSessionId] = useState<string | null>(null);

  const { data: context, isLoading } = useQuery<Context>({
    queryKey: ["/api/projects", projectId, "check-ins", "context"],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/check-ins/context`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: open && !!projectId,
  });

  /*
   * Drafts are scoped to the week they were written for.
   *
   * A single per-project key meant a draft abandoned three weeks ago loaded
   * into today's composer, silently presenting stale text as this week's work
   * — the exact failure the autosave was meant to prevent.
   */
  const targetWeek = editing?.weekStart ?? context?.weekStart;
  const draftKey = targetWeek
    ? `checkin-draft:${projectId}:${weekKey(targetWeek)}`
    : null;

  /*
   * Seed order matters: this week's existing check-in wins (you're editing it),
   * then a saved draft, then empty. Last week's values are shown for reference
   * but never copied in — carrying the text forward would let someone file the
   * same week twice without noticing.
   */
  useEffect(() => {
    if (!open || touched) return;
    const existing = editing ?? context?.current;
    if (existing) {
      setForm({
        goal: existing.goal,
        proof: existing.proof,
        blocker: existing.blocker || "",
        nextStep: existing.nextStep,
      });
      setVisibility(existing.visibility);
      setNeedsFeedback(existing.needsFeedback);
      return;
    }
    if (!draftKey) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      // Belt and braces alongside the week-scoped key: a draft left in storage
      // by an old build shouldn't resurface months later.
      if (parsed.savedAt && Date.now() - parsed.savedAt > 21 * 86_400_000) {
        localStorage.removeItem(draftKey);
        return;
      }
      setForm({ ...EMPTY, ...(parsed.form ?? parsed) });
      if (parsed.visibility) setVisibility(parsed.visibility);
      if (typeof parsed.needsFeedback === "boolean") setNeedsFeedback(parsed.needsFeedback);
      setRestored(true);
    } catch { /* a corrupt draft is not worth a crash */ }
  }, [open, context, editing, touched, draftKey]);

  /*
   * Autosave. Saves the settings too — an earlier version stored only the four
   * text fields, so someone who chose "public, wants feedback" and came back
   * found themselves quietly switched to unlisted.
   */
  useEffect(() => {
    if (!open || !touched || !draftKey) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({
        form, visibility, needsFeedback, savedAt: Date.now(),
      }));
    } catch { /* quota */ }
  }, [form, visibility, needsFeedback, open, touched, draftKey]);

  useEffect(() => {
    if (!open) { setSessionId(null); return; }
    if (sessionId) return;
    const id = newComposeSession();
    setSessionId(id);
    trackLoopEvent(LOOP_EVENTS.checkInStarted, { projectId, sessionId: id });
  }, [open, sessionId, projectId]);

  const errors = useMemo(() => validateCheckIn(form), [form]);
  const publish = useMutation({
    mutationFn: async () => {
      const body = { ...form, blocker: form.blocker || null, visibility, needsFeedback, sessionId };
      // Editing a past week patches that check-in; this week goes through the
      // upserting POST, so the permalink survives a correction either way.
      const res = editing
        ? await apiRequest("PATCH", `/api/check-ins/${editing.id}`, body)
        : await apiRequest("POST", `/api/projects/${projectId}/check-ins`, body);
      return res.json();
    },
    onSuccess: (checkIn: any) => {
      if (draftKey) { try { localStorage.removeItem(draftKey); } catch { /* fine */ } }
      toast({
        title: editing ? "Check-in updated" : "Check-in published",
        description: editing ? undefined : "Copy the link from the card to share it.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "check-ins"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "check-ins", "context"] });
      if (checkIn?.id) queryClient.invalidateQueries({ queryKey: ["/api/check-ins", checkIn.id] });
      setForm(EMPTY);
      setTouched(false);
      setRestored(false);
      onClose();
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Try again.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Couldn't publish", description, variant: "destructive" });
    },
  });

  /**
   * Nova drafts, you publish.
   *
   * The result lands in the fields for editing rather than going straight out
   * — a check-in is a public statement in the builder's own voice, and the
   * whole artifact loses its worth if it's visibly machine-written.
   */
  const draft = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/check-ins/draft`);
      return res.json();
    },
    onSuccess: (r: any) => {
      setTouched(true);
      setForm({
        goal: r.draft.goal || "",
        proof: r.draft.proof || "",
        blocker: r.draft.blocker || "",
        nextStep: r.draft.nextStep || "",
      });
      toast({
        title: "Nova wrote a draft",
        description: r.basedOn?.finishedThisWeek
          ? `Based on ${r.basedOn.finishedThisWeek} task${r.basedOn.finishedThisWeek === 1 ? "" : "s"} you finished. Read it before you publish.`
          : "Nothing was marked done this week, so read this closely before you publish.",
      });
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Try again.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Nova couldn't draft that", description, variant: "destructive" });
    },
  });

  const set = (patch: Partial<typeof EMPTY>) => {
    setTouched(true);
    setForm((f) => ({ ...f, ...patch }));
  };

  const ready = Object.keys(errors).length === 0;
  const show = (k: keyof typeof EMPTY) => (touched ? errors[k] : undefined);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            {editing ? "Edit check-in" : context?.current ? "Edit this week's check-in" : "New check-in"}
          </DialogTitle>
          <DialogDescription>
            {weekLabel(editing?.weekStart ?? context?.weekStart ?? "") || "This week"} · aim for under two minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 -mx-1 px-1">
          {isLoading ? (
            <div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : (
            <>
              {/* Step 6 of the loop: last week, in front of you, while you write. */}
              {context?.previous && (
                <div className="rounded-md border border-border/60 bg-muted/40 p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Last week you said
                  </p>
                  <p className="text-xs"><span className="text-muted-foreground">Goal:</span> {context.previous.goal}</p>
                  <p className="text-xs flex items-start gap-1">
                    <ArrowRight className="h-3 w-3 mt-0.5 shrink-0 text-primary" />
                    <span><span className="text-muted-foreground">Next:</span> {context.previous.nextStep}</span>
                  </p>
                  {/*
                    * The loop's actual mechanic: what you said you'd do next is
                    * what this week is measured against. One click rather than
                    * retyping it, but still a choice — plans change.
                    */}
                  <Button
                    type="button" variant="outline" size="sm"
                    className="h-6 text-[11px] px-2 mt-0.5"
                    onClick={() => set({ goal: context.previous!.nextStep })}
                    data-testid="button-carry-forward"
                  >
                    Use as this week's goal
                  </Button>
                </div>
              )}

              {restored && (
                <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  Picked up where you left off.
                </p>
              )}

              {/* Offered before the fields, since its whole value is not
                  starting from a blank box. */}
              <Button
                type="button" variant="outline" size="sm"
                className="w-full gap-1.5"
                disabled={draft.isPending}
                onClick={() => draft.mutate()}
                data-testid="button-nova-draft"
              >
                {draft.isPending
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Nova is reading your week…</>
                  : <><Sparkles className="h-3.5 w-3.5 text-primary" /> Draft this with Nova ({CREDIT_COSTS.checkInDraft})</>}
              </Button>

              <Field label="Weekly goal" value={form.goal} max={CHECK_IN_LIMITS.goal.max}
                hint="One sentence. What were you aiming for?" error={show("goal")}>
                <Input
                  value={form.goal}
                  onChange={(e) => set({ goal: e.target.value })}
                  placeholder="Get the check-in loop working end to end"
                  data-testid="input-checkin-goal"
                />
              </Field>

              <Field label="Proof — what shipped" value={form.proof} max={CHECK_IN_LIMITS.proof.max}
                hint="Link it, or name the thing that exists now." error={show("proof")}>
                <Textarea
                  value={form.proof}
                  onChange={(e) => set({ proof: e.target.value })}
                  placeholder="Shipped the public check-in page — sparktower.app/c/…"
                  className="min-h-[70px]"
                  data-testid="input-checkin-proof"
                />
              </Field>

              <Field label="Blocker (optional)" value={form.blocker} max={CHECK_IN_LIMITS.blocker.max}
                hint="What's in the way, if anything." error={show("blocker")}>
                <Textarea
                  value={form.blocker}
                  onChange={(e) => set({ blocker: e.target.value })}
                  placeholder="Stripe review is taking longer than expected"
                  className="min-h-[50px]"
                  data-testid="input-checkin-blocker"
                />
              </Field>

              <Field label="Next step" value={form.nextStep} max={CHECK_IN_LIMITS.nextStep.max}
                hint="One thing, starting with a verb." error={show("nextStep")}>
                <Input
                  value={form.nextStep}
                  onChange={(e) => set({ nextStep: e.target.value })}
                  placeholder="Ship the comment box on check-in pages"
                  data-testid="input-checkin-next"
                />
              </Field>

              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <Label className="text-xs">Who can see it</Label>
                <div className="grid gap-1.5">
                  {([
                    { key: "unlisted", icon: Link2, title: "Unlisted", blurb: "Anyone with the link. Listed nowhere." },
                    { key: "public", icon: Globe, title: "Public", blurb: "Can appear in the feedback queue and on your project." },
                  ] as const).map(({ key, icon: Icon, title, blurb }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setVisibility(key)}
                      className={`text-left rounded-md border p-2.5 transition-colors ${
                        visibility === key ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50"
                      }`}
                      data-testid={`visibility-${key}`}
                    >
                      <span className="text-sm font-medium flex items-center gap-1.5">
                        <Icon className="h-3.5 w-3.5" /> {title}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">{blurb}</span>
                    </button>
                  ))}
                </div>

                <label className="flex items-start gap-2 text-sm pt-1">
                  <Checkbox
                    className="mt-0.5"
                    checked={needsFeedback}
                    onCheckedChange={(v) => {
                      const on = Boolean(v);
                      setNeedsFeedback(on);
                      // The queue only carries public check-ins, so asking for
                      // feedback implies making it readable.
                      if (on) setVisibility("public");
                    }}
                    data-testid="checkbox-needs-feedback"
                  />
                  <span>
                    Ask for feedback
                    <span className="block text-[11px] text-muted-foreground">
                      Puts this in the feedback queue. Makes it public.
                    </span>
                  </span>
                </label>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <div className="mr-auto flex items-center gap-1.5 text-xs">
            {ready
              ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="text-muted-foreground">Ready</span></>
              : touched
                ? <><AlertTriangle className="h-3.5 w-3.5 text-amber-500" /><span className="text-muted-foreground">{Object.keys(errors).length} to fix</span></>
                : <span className="text-muted-foreground">Four fields</span>}
          </div>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!ready || publish.isPending}
            onClick={() => { setTouched(true); publish.mutate(); }}
            data-testid="button-publish-checkin"
          >
            {publish.isPending
              ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Publishing…</>
              : context?.current ? "Save changes" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
