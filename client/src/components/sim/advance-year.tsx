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
import { usePeriod } from "./desk-currency";
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
  /** "dev_flag": a local development server letting anyone seated end the year (SIM_DEV_ADVANCE). */
  as: "developer" | "dev_flag" | "company";
}) {
  const { toast } = useToast();
  const period = usePeriod();
  const Period = period.one.charAt(0).toUpperCase() + period.one.slice(1);
  const [open, setOpen] = useState(false);
  const last = year >= totalYears;

  const advance = useMutation({
    mutationFn: () => apiRequest("POST", `/api/sim/seasons/${seasonId}/advance`, {}).then((r) => r.json()),
    onSuccess: (body: { resolvedYear: number; status: string }) => {
      setOpen(false);
      toast({
        title: body.status === "finished" ? "Season over" : `${Period} ${body.resolvedYear} resolved`,
        description: body.status === "finished" ? `That was the last ${period.one}.` : `${Period} ${body.resolvedYear + 1} is open.`,
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
            {as !== "company"
              ? <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              : <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {as !== "company" ? "Developer controls" : "Training season controls"}
              </p>
              <p className="text-xs text-muted-foreground">
                {as !== "company"
                  ? `You can end ${period.of} now rather than waiting for its clock.`
                  : `Your company runs this season, so you can end the ${period.one} whenever the room is ready.`}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={advance.isPending} data-testid="button-advance-year">
            {advance.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FastForward className="mr-1.5 h-4 w-4" />}
            {last ? "End the season now" : `End ${period.one} ${year} now`}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{last ? "End the season now?" : `End ${period.one} ${year} now?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {as !== "company"
                ? `This resolves the ${period.one} for every team in this market — including real players who may still be deciding. Whatever they have not filed runs on last ${period.one}'s plan. It is recorded in the moderation log.`
                : `This resolves the ${period.one} for every table in this training season, including anyone still deciding. Whatever they have not filed runs on last ${period.one}'s plan.`}
              {last ? ` It is the last ${period.one}, so the season ends.` : ` ${period.one.charAt(0).toUpperCase() + period.one.slice(1)} ${year + 1} opens straight away.`}
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
