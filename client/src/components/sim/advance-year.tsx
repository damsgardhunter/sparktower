/**
 * "End the year now" — for developers, and for companies running their own
 * training seasons. See `server/season-control.ts` for who may, and why
 * nobody else can.
 *
 * Asks first, and says what it does to everybody else: ending a year ends it
 * for every team in the season, including any still deciding. For a developer
 * in a public market those are strangers, so the dialog says so plainly.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { FastForward, Loader2, Wrench, Building2 } from "lucide-react";

export function AdvanceYearCard({ seasonId, ventureId, year, totalYears, as }: {
  seasonId: string;
  ventureId: string;
  year: number;
  totalYears: number;
  as: "developer" | "company";
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const last = year >= totalYears;

  const advance = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/seasons/${seasonId}/advance`, {}).then((r) => r.json()),
    onSuccess: (body: { resolvedYear: number; status: string }) => {
      setOpen(false);
      toast({
        title: body.status === "finished" ? "Season over" : `Year ${body.resolvedYear} resolved`,
        description: body.status === "finished" ? "That was the last year." : `Year ${body.resolvedYear + 1} is open.`,
      });
      queryClient.invalidateQueries({ queryKey: [`/api/sim/ventures/${ventureId}/desk`] });
      queryClient.invalidateQueries({ queryKey: ["sim-projection", ventureId] });
    },
    onError: (err: any) => {
      setOpen(false);
      const raw = String(err?.message ?? "");
      const at = raw.indexOf("{");
      let message = "Couldn't resolve the year.";
      if (at >= 0) { try { message = JSON.parse(raw.slice(at)).message ?? message; } catch { /* keep */ } }
      toast({ title: "Not resolved", description: message, variant: "destructive" });
    },
  });

  return (
    <>
      <Card className="border-dashed" data-testid="card-advance-year">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-start gap-3">
            {as === "developer"
              ? <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              : <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {as === "developer" ? "Developer controls" : "Training season controls"}
              </p>
              <p className="text-xs text-muted-foreground">
                {as === "developer"
                  ? "You can end this year now rather than waiting for its clock."
                  : "Your company runs this season, so you can end the year whenever the room is ready."}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={advance.isPending} data-testid="button-advance-year">
            {advance.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FastForward className="mr-1.5 h-4 w-4" />}
            {last ? "End the season now" : `End year ${year} now`}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{last ? "End the season now?" : `End year ${year} now?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {as === "developer"
                ? "This resolves the year for every team in this market — including real players who may still be deciding. Whatever they have not filed runs on last year's plan. It is recorded in the moderation log."
                : "This resolves the year for every table in this training season, including anyone still deciding. Whatever they have not filed runs on last year's plan."}
              {last ? " It is the last year, so the season ends." : ` Year ${year + 1} opens straight away.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); advance.mutate(); }} data-testid="button-confirm-advance">
              {advance.isPending ? "Resolving…" : "Resolve it now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
