import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { useConfirmPurchase } from "@/components/payment-dialog";
import { useNow } from "@/components/section/live";
import { plural } from "@/components/section/path-types";
import { LiveDot, Working } from "@/components/nova";
import { formatElapsed } from "@/lib/audit-status";
import {
  useBuildStatus, quietBuildErrors, buildStageLabel, buildStatusKey, STAGE_ORDER,
} from "@/lib/build-status";

/** The build's stages with the words shown for each, from the same list the status hook reads. */
const BUILD_STAGES = STAGE_ORDER.map((id) => ({ id, label: buildStageLabel(id) }));
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
 * because somebody who has just bought the build will absolutely reload the page.
 */
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
  const { running, last, paid, waiting } = useBuildStatus(projectId, { expectRunning: starting });
  // Ticks the elapsed time every second while it runs, and hardly ever otherwise.
  const now = useNow(running ? 1_000 : 30_000);

  useEffect(() => { if (running) setStarting(false); }, [running]);
  const start = useMutation({
    mutationFn: async () => {
      // Free on a project already paid for, so the price is only asked the first time.
      if (!paid && !(await confirmPurchase("buildMyBusiness", {
        title: OUTCOME_COPY.business.name,
        detail: `${OUTCOME_COPY.business.blurb} Nova writes every step that is its to write, and leaves the decisions that are yours with the options already researched.`,
        projectId,
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
    // Failures count as steps gone through too, or the bar stops moving on a run that is still working.
    const through = running.stepsDone + running.stepsForYou + running.stepsFailed;
    return (
      <div className="rounded-lg border border-primary/30 p-4 space-y-2" data-testid="nova-build-running">
        <Working
          testId="nova-build-progress"
          stages={BUILD_STAGES}
          current={running.stage}
          /*
           * Only the building stage counts anything, so only it passes a real
           * figure; the others breathe at the shared default rather than
           * inventing one. See `progress` in the component.
           */
          progress={running.stage === "building" && running.stepsTotal ? through / running.stepsTotal : null}
          meta={
            <>
              {running.stepsTotal > 0 && (
                <span className="tabular-nums" data-testid="text-build-count">step {Math.min(through + 1, running.stepsTotal)} of {running.stepsTotal}</span>
              )}
              <span className="tabular-nums" data-testid="text-build-elapsed">· {formatElapsed(elapsed)}</span>
            </>
          }
          detail={running.currentTitle}
        />
        {/* "A few minutes" was measured at fourteen on a twenty-seven step path:
            about forty-five seconds a step, since the steps run one after
            another and each is a model call. Better to say the number the
            progress line already implies than to be optimistic at someone who
            has just paid. */}
        <p className="text-xs text-muted-foreground">
          {running.stepsTotal > 0
            ? `Around ${Math.max(1, Math.round((running.stepsTotal * 45) / 60))} minutes for ${running.stepsTotal} steps. `
            : "This takes a while. "}
          You can close the page — it keeps going, and the bell will tell you when it's done.
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
                {buildSummary(last.stepsDone, last.stepsForYou, last.stepsFailed)}
              </p>
            </div>
          </div>
        )}
        {/*
          * What is open now, not what the run happened to count.
          *
          * This line used to read "The steps left open are the ones only you
          * can answer — each has Nova's options on it already" whenever
          * `stepsForYou` was above zero. On a path whose open steps are mostly
          * questions about the builder's own business, that was wrong about
          * most of them: eight of fifteen had nothing on them, because a
          * question only they can answer is one Nova is *supposed* to leave
          * blank. The two are now counted and named apart, from a live read.
          */}
        {!last.error && waiting && (waiting.optionsReady > 0 || waiting.yoursAlone > 0) && (
          <div className="space-y-1 text-xs text-muted-foreground">
            {waiting.optionsReady > 0 && (
              <p className="flex items-start gap-1.5" data-testid="text-build-options-ready">
                <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {plural(waiting.optionsReady, "decision")} waiting with Nova's options on {waiting.optionsReady === 1 ? "it" : "them"} — open one and pick.
              </p>
            )}
            {waiting.yoursAlone > 0 && (
              <p className="flex items-start gap-1.5" data-testid="text-build-yours-alone">
                <UserRound className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {plural(waiting.yoursAlone, "step")} only you can do — your numbers, your calls, and the ones another screen finishes. Nova leaves these alone on purpose.
              </p>
            )}
          </div>
        )}

        {/*
          * Steps Nova could still write, counted now.
          *
          * A build covers at most BUILD_STEP_CAP steps, and a path can grow
          * after it finishes — choosing a funding route added seventeen
          * milestones to one project the moment it was picked. Both left work
          * Nova would do for free sitting behind a card that said "Nova built
          * out your path" and a button whose label gave no reason to press it.
          */}
        {waiting && waiting.novaCanWrite > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-build-can-write">
            {plural(waiting.novaCanWrite, "step")} on your path {waiting.novaCanWrite === 1 ? "is" : "are"} still Nova's to write.
          </p>
        )}

        {/* Paid once, so running it again is free: a path that grew, or a build that stopped. */}
        <Button size="sm" variant="outline" onClick={() => start.mutate()} disabled={start.isPending} data-testid="button-build-again">
          {start.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
          {waiting && waiting.novaCanWrite > 0
            ? `Write ${waiting.novaCanWrite === 1 ? "it" : "them"} — free, you've paid for this one`
            : "Build what's left — free, you've paid for this one"}
        </Button>
      </div>
    );
  }

  /*
   * Nothing left for Nova to write, so nothing to sell.
   *
   * The paid card has always counted `novaCanWrite` and said "three steps on
   * your path are still Nova's to write". The offer never looked at it, so a
   * builder who had worked through all twenty-four of their own milestones was
   * still shown "Have Nova build it" at full price, for a path with nothing on
   * it left to build — the one person on the product who should not be offered
   * this, offered it every time they opened the dashboard.
   *
   * `undefined` is "not read yet" and must not hide the offer, or the card
   * would blink out on every load before the first poll comes back. Only a
   * real zero stands it down.
   */
  if (waiting && waiting.novaCanWrite === 0) return null;

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
        {/*
          * What it would actually write, on this path, today.
          *
          * It falls as the builder gets on with it, and that is the point: at
          * four steps left this is a bad buy and the number says so before the
          * price does. A figure that shrinks is worth more than a promise that
          * doesn't, and somebody who reads it and decides against is somebody
          * who was never going to be happy having paid.
          */}
        {waiting && waiting.novaCanWrite > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="text-build-offer-scope">
            {plural(waiting.novaCanWrite, "step")} on your path {waiting.novaCanWrite === 1 ? "is" : "are"} Nova's to write right now.
            {waiting.yoursAlone > 0 && ` ${plural(waiting.yoursAlone, "step")} would stay yours.`}
          </p>
        )}
      </div>
      <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending} data-testid="button-build-my-business">
        {start.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
        {`Have Nova build it — ${formatMoney(OUTCOME_PRICE_CENTS.business)} once`}
      </Button>
      <p className="text-xs text-muted-foreground">One payment for this project. No subscription, and nothing expires.</p>
    </div>
  );
}
