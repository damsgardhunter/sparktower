import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Flag } from "lucide-react";
import {
  REPORT_REASONS, REPORT_NOTE_MAX, REPORT_TARGET_LABEL, type ReportTarget,
} from "@shared/moderation";

/**
 * Reporting something to a human.
 *
 * Hidden from signed-out visitors — an anonymous report button on a public
 * page is a button for scripts. Deliberately quiet: a flag icon that only
 * darkens on hover, because a prominent report control on every card makes a
 * product feel hostile before anything has gone wrong.
 *
 * The response is the same whether the report is new or a duplicate, so
 * nobody can use it to find out what's already been flagged.
 */
export function ReportButton({
  targetType, targetId, className,
}: {
  targetType: ReportTarget;
  targetId: string;
  className?: string;
}) {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reports", {
        targetType, targetId, reason, note,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Thanks — we'll take a look",
        description: "Someone will review this. You won't hear back unless we need to ask you something.",
      });
      setOpen(false);
      setReason("");
      setNote("");
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

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={`h-6 px-1.5 text-muted-foreground/60 hover:text-foreground ${className || ""}`}
        onClick={() => setOpen(true)}
        title={`Report this ${REPORT_TARGET_LABEL[targetType].toLowerCase()}`}
        data-testid={`button-report-${targetType}-${targetId}`}
      >
        <Flag className="h-3 w-3" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Report this {REPORT_TARGET_LABEL[targetType].toLowerCase()}</DialogTitle>
            <DialogDescription>
              A person reads every report. Nothing happens to the author automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">What's wrong with it</Label>
              <RadioGroup value={reason} onValueChange={setReason} className="gap-1.5">
                {REPORT_REASONS.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <RadioGroupItem value={r.id} data-testid={`report-reason-${r.id}`} />
                    {r.label}
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label className="text-xs">Anything else (optional)</Label>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {note.length}/{REPORT_NOTE_MAX}
                </span>
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!reason || send.isPending}
              onClick={() => send.mutate()}
              data-testid="button-submit-report"
            >
              {send.isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Sending…</>
                : "Send report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
