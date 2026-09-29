/**
 * "Is there a problem? Report it" — on the bottom of every screen.
 *
 * The whole design is that it asks for nothing. One box, one button, no
 * category and no account: every field somebody has to fill in before they can
 * say a screen is broken is a field that loses you the report, and the ones
 * you lose come from the people least willing to put up with a form — which is
 * most people.
 *
 * It sits in a footer rather than floating, because the floating corner is
 * already Nova's (components/nova-guide.tsx) and two round buttons stacked on
 * each other is how neither gets pressed.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { errorText } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PROBLEM_MESSAGE_MAX, readProblemMessage } from "@shared/problem-reports";
import { CheckCircle2, Loader2, MessageSquareWarning } from "lucide-react";

export function ReportProblemDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [location] = useLocation();
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      const read = readProblemMessage(message);
      if (!read.ok) throw new Error(read.reason);
      /*
       * The path is sent from here rather than read from the referer, which
       * a report from a single-page app would get wrong anyway.
       */
      await apiRequest("POST", "/api/problem-reports", { message: read.message, path: location });
    },
    onMutate: () => setError(null),
    onSuccess: () => { setSent(true); setMessage(""); },
    onError: (e) => setError(errorText(e)),
  });

  const close = (v: boolean) => {
    onOpenChange(v);
    // Reset only once it is shut, so the thank-you doesn't vanish as it closes.
    if (!v) setTimeout(() => { setSent(false); setError(null); }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md" data-testid="dialog-report-problem">
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Got it, thank you
              </DialogTitle>
              <DialogDescription>
                It's in the queue with the page you were on. If it's something we can fix, it gets fixed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => close(false)} data-testid="button-report-done">Close</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Is there a problem?</DialogTitle>
              <DialogDescription>
                Tell us what went wrong, in as few words as you like. We'll see the page you were on.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Textarea
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, PROBLEM_MESSAGE_MAX))}
                placeholder="The button doesn't do anything when I press it…"
                className="min-h-[120px]"
                data-testid="input-report-problem"
              />
              {error && <p className="text-sm text-destructive" data-testid="text-report-error">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
              <Button onClick={() => send.mutate()} disabled={send.isPending} data-testid="button-report-send">
                {send.isPending && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
                Send it
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The footer itself. One line, quiet, and on every screen — including the ones
 * you reach signed out, because "I can't sign in" is a report worth having and
 * the person with that problem is by definition not signed in.
 */
export function ReportProblemFooter({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <footer
      className={`shrink-0 border-t border-border/60 px-4 py-1.5 flex items-center justify-center ${className}`}
      data-testid="footer-report-problem"
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1.5"
        onClick={() => setOpen(true)}
        data-testid="button-report-problem"
      >
        <MessageSquareWarning className="h-3.5 w-3.5" />
        Is there a problem? Report it
      </Button>
      <ReportProblemDialog open={open} onOpenChange={setOpen} />
    </footer>
  );
}
