import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { useConfirmPurchase } from "@/components/payment-dialog";
import { useNow } from "@/components/section/live";
import { NOVA_GRADIENT } from "@/components/section/path-types";
import { formatElapsed } from "@/lib/audit-status";
import {
  useBuildStatus, quietBuildErrors, buildStageLabel, buildStatusKey, STAGE_ORDER,
} from "@/lib/build-status";
import { buildSummary } from "@shared/nova-build";
import { OUTCOME_COPY, OUTCOME_PRICE_CENTS, formatMoney } from "@shared/plans";
import { AlertTriangle, Check, Loader2, Sparkles, UserRound } from "lucide-react";

/**
 * "Nova builds your business", and what it is doing while it does it.
 *
 * The running state is deliberately the same thing the Codebase tab shows for
 * a code read — a segment per stage, a live dot, the stage in words and the
 * time so far — because they are the same kind of wait and a builder should
 * not have to learn two of them. What is added is the step: "19 of 28" and the
 * name of the one it is on, since a build has somewhere to be and "which step"
 * is the question people actually have while they watch.
 *
 * It reads a server-side run rather than holding a spinner, so the wait
 * survives a refresh, a second tab and the phone — which matters most here,
 * because somebody who has just spent $30 will absolutely reload the page.
 */
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${NOVA_GRADIENT}`} />
    </span>
  );
}

export function NovaBuildsBusiness({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const confirmPurchase = useConfirmPurchase();
  /*
   * Set the moment the button is pressed and cleared when the run row appears.
   * The row does not exist until the server has written it, and without this
   * the offer card sits there unchanged after the press — the one moment
   * somebody is most likely to press it again.
   */
  const [starting, setStarting] = useState(false);
  const { running, last, paid } = useBuildStatus(projectId, { expectRunning: starting });
  // Ticks the elapsed time every second while it runs, and hardly ever otherwise.
  const now = useNow(running ? 1_000 : 30_000);

  useEffect(() => { if (running) setStarting(false); }, [running]);
  const start = useMutation({
    mutationFn: async () => {
      // Free on a project already paid for, so the price is only asked the first time.
      if (!paid && !(await confirmPurchase("buildMyBusiness", {
        title: OUTCOME_COPY.business.name,
        detail: `${OUTCOME_COPY.business.blurb} Nova writes every step that is its to write, and leaves the decisions that are yours with the options already researched.`,
      }))) return null;
      // This screen reports its own failure, so the shared watcher doesn't toast it too.
      quietBuildErrors(projectId, 60_000);
      setStarting(true);
      return (await apiRequest("POST", "/api/nova/build-my-business", { projectId })).json();
    },
    onSuccess: (result) => {
      if (!result) { setStarting(false); return; }  // They cancelled at the price.
      void queryClient.invalidateQueries({ queryKey: buildStatusKey(projectId) });
      toast({ title: "Nova is building", description: "It works down your path step by step. You can close this page — it keeps going, and we'll tell you when it's done." });
    },
    onError: (e) => {
      setStarting(false);
      toast({ title: "Couldn't start the build", description: errorText(e), variant: "destructive" });
    },
  });


  /*
   * Pressed, and the run row not written yet. Shown as its own line rather
   * than by faking a stage, because inventing progress for work that has not
   * started is how a progress bar stops meaning anything.
   */
  if (starting && !running) {
    return (
      <div className="rounded-lg border border-primary/30 p-4 space-y-2" data-testid="nova-build-starting">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <LiveDot />
          Starting the build…
        </p>
        <p className="text-xs text-muted-foreground">Nova is getting your path ready.</p>
      </div>
    );
  }

  if (running) {
    /*
     * Elapsed is counted from the run's own start rather than from the number
     * the server sent, so the seconds move between polls instead of jumping
     * three at a time.
     */
    const elapsed = Math.max(running.elapsedSeconds, Math.round((now - Date.parse(running.startedAt)) / 1000));
    const stageIndex = Math.max(0, STAGE_ORDER.indexOf(running.stage));
    const through = running.stepsDone + running.stepsForYou;
    return (
      <div className="rounded-lg border border-primary/30 p-4 space-y-2" data-testid="nova-build-running">
        {/* One segment per stage, as the code read does it. */}
        {/* Columns inline rather than as a Tailwind class: the count comes from
            the stage list, and Tailwind can't generate a class from a variable. */}
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${STAGE_ORDER.length}, minmax(0, 1fr))` }} aria-hidden>
          {STAGE_ORDER.map((st, i) => (
            <div key={st} className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${NOVA_GRADIENT} transition-all duration-700 ${i === stageIndex ? "animate-pulse" : ""}`}
                style={{
                  width: i < stageIndex ? "100%"
                    // The building stage knows how far along it really is; the others don't, so they breathe.
                    : i === stageIndex
                      ? (st === "building" && running.stepsTotal ? `${Math.max(8, Math.round((through / running.stepsTotal) * 100))}%` : "60%")
                      : "0%",
                }}
              />
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground flex items-center justify-between gap-x-3 gap-y-0.5 flex-wrap">
          <span className="flex items-center gap-1.5 font-medium text-foreground" data-testid="text-build-stage">
            <LiveDot />
            {buildStageLabel(running.stage)}…
          </span>
          <span className="flex items-center gap-1.5 min-w-0">
            {running.stepsTotal > 0 && (
              <span className="tabular-nums" data-testid="text-build-count">step {Math.min(through + 1, running.stepsTotal)} of {running.stepsTotal}</span>
            )}
            <span className="tabular-nums" data-testid="text-build-elapsed">· {formatElapsed(elapsed)}</span>
          </span>
        </div>

        {running.currentTitle && (
          <p className="text-xs text-muted-foreground truncate" title={running.currentTitle} data-testid="text-build-current">
            {running.currentTitle}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          A few minutes. You can close the page — it keeps going, and the bell will tell you when it's done.
        </p>
      </div>
    );
  }

  if (last && paid) {
    return (
      <div className="rounded-lg border p-4 space-y-3" data-testid="nova-build-done">
        {last.error ? (
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm" data-testid="text-build-error">{last.error}</p>
          </div>
        ) : (
          <div className="flex items-start gap-2">
            <Check className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Nova built out your path</p>
              <p className="text-sm text-muted-foreground" data-testid="text-build-summary">
                {buildSummary(last.stepsDone, last.stepsForYou)}
              </p>
            </div>
          </div>
        )}
        {last.stepsForYou > 0 && !last.error && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <UserRound className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            The steps left open are the ones only you can answer. Each has Nova's options on it already — open one and pick.
          </p>
        )}
        {/* Paid once, so running it again is free: a path that grew, or a build that stopped. */}
        <Button size="sm" variant="outline" onClick={() => start.mutate()} disabled={start.isPending} data-testid="button-build-again">
          {start.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
          Build what's left — free, you've paid for this one
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/30 p-4 space-y-3" data-testid="nova-build-offer">
      <div className="space-y-1">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" /> {OUTCOME_COPY.business.name}
        </p>
        <p className="text-sm text-muted-foreground">
          Nova works down your whole path and writes every step that's its to write — the research, the drafts, the documents.
          The decisions that are yours stay yours, with three real options waiting on each.
        </p>
      </div>
      <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending} data-testid="button-build-my-business">
        {start.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
        {`Have Nova build it — ${formatMoney(OUTCOME_PRICE_CENTS.business)} once`}
      </Button>
      <p className="text-xs text-muted-foreground">One payment for this project. No subscription, and nothing expires.</p>
    </div>
  );
}
