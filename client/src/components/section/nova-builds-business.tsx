import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/api-error";
import { useConfirmPurchase } from "@/components/payment-dialog";
import { buildSummary, type BuildRunStatus } from "@shared/nova-build";
import { OUTCOME_COPY, OUTCOME_PRICE_CENTS, formatMoney } from "@shared/plans";
import { AlertTriangle, Check, Loader2, Sparkles, UserRound } from "lucide-react";

/**
 * "Nova builds your business" on the section it will build.
 *
 * Three states, because there are three things a person can be doing here:
 * deciding whether to buy it, watching it happen, and reading what it did.
 *
 * The middle one is why this polls a server-side run rather than holding a
 * spinner: the build takes minutes and outlives the tab that started it, and
 * somebody who has just spent $30 will absolutely refresh the page.
 */
export function NovaBuildsBusiness({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const confirmPurchase = useConfirmPurchase();

  const { data } = useQuery<BuildRunStatus>({
    queryKey: [`/api/projects/${projectId}/nova-build`],
    // While it runs, often enough to feel live; when it isn't, not at all.
    refetchInterval: (q) => (q.state.data?.running ? 3_000 : false),
    refetchOnWindowFocus: true,
  });

  const start = useMutation({
    mutationFn: async () => {
      // Free on a project already paid for, so the confirm is only for a first buy.
      if (!data?.paid && !(await confirmPurchase("buildMyBusiness", {
        title: OUTCOME_COPY.business.name,
        detail: `${OUTCOME_COPY.business.blurb} Nova writes every step that is its to write, and leaves the decisions that are yours with the options already researched.`,
      }))) return null;
      return (await apiRequest("POST", "/api/nova/build-my-business", { projectId })).json();
    },
    onSuccess: (result) => {
      if (!result) return;  // They cancelled at the price.
      void queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/nova-build`] });
      toast({ title: "Nova is building", description: "It works through your path step by step. You can leave this page." });
    },
    onError: (e) => toast({ title: "Couldn't start the build", description: errorText(e), variant: "destructive" }),
  });

  const running = data?.running;
  const last = data?.last;

  if (running) {
    const total = Math.max(running.stepsTotal, 1);
    const through = running.stepsDone + running.stepsForYou;
    return (
      <div className="rounded-lg border border-primary/30 p-4 space-y-3" data-testid="nova-build-running">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <p className="text-sm font-medium">{running.stageLabel}</p>
          <span className="ml-auto text-xs text-muted-foreground" data-testid="text-build-count">
            {through} of {running.stepsTotal || "—"}
          </span>
        </div>
        <Progress value={running.stepsTotal ? (through / total) * 100 : undefined} className="h-1.5" />
        {running.currentTitle && (
          <p className="text-xs text-muted-foreground truncate" data-testid="text-build-current">{running.currentTitle}</p>
        )}
        <p className="text-xs text-muted-foreground">
          This takes a few minutes. You can close the page — it keeps going, and what it writes lands on your path.
        </p>
      </div>
    );
  }

  if (last && data?.paid) {
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
