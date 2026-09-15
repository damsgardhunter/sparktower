import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Flag, ChevronRight, ArrowLeft } from "lucide-react";
import {
  REPORT_REASONS, REPORT_REASON_DETAILS, REPORT_NOTE_MAX, REPORT_TARGET_LABEL,
  type ReportTarget, type ReportReason,
} from "@shared/moderation";

type Step = "reason" | "detail" | "confirm";

/**
 * Reporting something to a human, in a few clicks.
 *
 * Why → a little more precisely → an optional note, then send. Each choice is a
 * click rather than a form to fill in, because a report nobody finishes helps
 * nobody.
 *
 * Hidden from signed-out visitors — an anonymous report button on a public
 * page is a button for scripts. The server limits how many reports one person
 * can send an hour and a day, and one report per person per thing.
 *
 * The response is the same whether the report is new or a duplicate, so
 * nobody can use it to find out what's already been flagged.
 *
 * `variant="action"` is the labelled button in a post's action row; the
 * default is the quiet flag icon.
 */
export function ReportButton({
  targetType, targetId, className, variant = "icon",
}: {
  targetType: ReportTarget;
  targetId: string;
  className?: string;
  variant?: "icon" | "action";
}) {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const what = REPORT_TARGET_LABEL[targetType].toLowerCase();

  const close = () => { setOpen(false); setStep("reason"); setReason(null); setDetail(null); setNote(""); };

  const send = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reports", { targetType, targetId, reason, detail, note });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Thanks — we'll take a look",
        description: "Someone will review this. You won't hear back unless we need to ask you something.",
      });
      close();
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const start = raw.indexOf("{");
      let description = "Try again.";
      if (start >= 0) {
        try { description = JSON.parse(raw.slice(start)).message || description; } catch { /* keep */ }
      }
      toast({ title: "Couldn't send that", description, variant: "destructive" });
    },
  });

  if (!isAuthenticated) return null;

  const option = (label: string, onClick: () => void, testId: string, selected = false) => (
    <button
      key={testId}
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-sm text-left transition-colors ${selected ? "border-primary bg-primary/5" : "border-border hover:bg-accent"}`}
      data-testid={testId}
    >
      {label}
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );

  const reasonLabel = REPORT_REASONS.find((r) => r.id === reason)?.label;
  const detailLabel = reason ? REPORT_REASON_DETAILS[reason].find((d) => d.id === detail)?.label : null;

  return (
    <>
      {variant === "action" ? (
        <Button
          variant="ghost"
          size="sm"
          className={`gap-1.5 h-8 text-xs text-muted-foreground ${className || ""}`}
          onClick={() => setOpen(true)}
          title={`Report this ${what}`}
          data-testid={`button-report-${targetType}-${targetId}`}
        >
          <Flag className="h-4 w-4" />
          Report
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className={`h-6 px-1.5 text-muted-foreground/60 hover:text-foreground ${className || ""}`}
          onClick={() => setOpen(true)}
          title={`Report this ${what}`}
          data-testid={`button-report-${targetType}-${targetId}`}
        >
          <Flag className="h-3 w-3" />
        </Button>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-md" data-testid="report-dialog">
          <DialogHeader>
            <DialogTitle>
              {step === "reason" ? `Why are you reporting this ${what}?` : step === "detail" ? reasonLabel : "Send this report?"}
            </DialogTitle>
            <DialogDescription>
              {step === "reason"
                ? "A person reads every report. Nothing happens to the author automatically."
                : step === "detail"
                  ? "Which is closest?"
                  : "Add anything that would help us judge it — or just send it."}
            </DialogDescription>
          </DialogHeader>

          {step === "reason" && (
            <div className="space-y-1.5">
              {REPORT_REASONS.map((r) => option(r.label, () => { setReason(r.id); setDetail(null); setStep("detail"); }, `report-reason-${r.id}`, reason === r.id))}
            </div>
          )}

          {step === "detail" && reason && (
            <div className="space-y-1.5">
              {REPORT_REASON_DETAILS[reason].map((d) => option(d.label, () => { setDetail(d.id); setStep("confirm"); }, `report-detail-${d.id}`, detail === d.id))}
            </div>
          )}

          {step === "confirm" && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/60 px-3 py-2 text-sm" data-testid="report-summary">
                <p className="font-medium">{reasonLabel}</p>
                {detailLabel && <p className="text-muted-foreground text-xs">{detailLabel}</p>}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Label className="text-xs">Anything else ({detail === "something_else" ? "tell us what" : "optional"})</Label>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{note.length}/{REPORT_NOTE_MAX}</span>
                </div>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, REPORT_NOTE_MAX))}
                  placeholder="Context helps us judge it faster."
                  className="min-h-[70px]"
                  data-testid="input-report-note"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {step === "reason" ? (
              <Button variant="outline" onClick={close}>Cancel</Button>
            ) : (
              <Button variant="ghost" className="gap-1" onClick={() => setStep(step === "confirm" ? "detail" : "reason")} data-testid="button-report-back">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            )}
            {step === "confirm" && (
              <Button
                disabled={!reason || send.isPending || (detail === "something_else" && !note.trim())}
                onClick={() => send.mutate()}
                data-testid="button-submit-report"
              >
                {send.isPending ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Sending…</> : "Send report"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
