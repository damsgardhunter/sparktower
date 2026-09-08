import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import NotFound from "@/pages/not-found";
import { Loader2, Activity, CheckCircle2, AlertTriangle } from "lucide-react";
import { LOOP_TARGETS, formatDuration, formatPercent } from "@shared/loop-events";

interface Metrics {
  windowDays: number;
  funnel: {
    started: number; submitted: number; completionPercent: number | null;
    shares: number; comments: number; views: number;
  };
  timeToPost: { p50Ms: number | null; targetMs: number; atTarget: boolean; samples: number };
  feedbackSla: { hours: number; eligible: number; answered: number; percent: number | null };
  retention: {
    d7: { cohort: number; returned: number; percent: number | null };
    d30: { cohort: number; returned: number; percent: number | null };
  };
  activation: { windowHours: number; eligible: number; activated: number; percent: number | null };
  d7Signup: { cohort: number; retained: number; percent: number | null };
  wau: { windowDays: number; people: number; updaters: number };
  commentWithin24h: { hours: number; updates: number; answered: number; percent: number | null };
}

function Stat({
  label, value, sub, state,
}: {
  label: string; value: string; sub?: string;
  state?: "good" | "warn" | "none";
}) {
  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${
        state === "good" ? "text-emerald-600 dark:text-emerald-400"
        : state === "warn" ? "text-amber-600 dark:text-amber-400" : ""
      }`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * The six numbers Phase 4 is gated on.
 *
 * Every figure states the population it was computed from, because a
 * percentage over four samples and one over four hundred are different claims
 * and a dashboard that hides the denominator invites acting on noise.
 */
export default function LoopMetrics() {
  const { user, isLoading: authLoading } = useAuth();
  const [days, setDays] = useState(30);

  const isReviewer = user
    && ((user as any).platformRole === "reviewer" || (user as any).platformRole === "admin");

  const { data, isLoading } = useQuery<Metrics>({
    queryKey: ["/api/admin/loop-metrics", days],
    queryFn: async () => {
      const res = await fetch(`/api/admin/loop-metrics?days=${days}`, { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    enabled: !!isReviewer,
  });

  if (authLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!isReviewer) return <NotFound />;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6" data-testid="loop-metrics">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" /> Loop metrics
          </h1>
          <p className="text-sm text-muted-foreground">
            The weekly check-in loop, measured. These are the Phase 4 gate.
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <Button
              key={d} size="sm" variant={days === d ? "default" : "outline"}
              onClick={() => setDays(d)} data-testid={`window-${d}`}
            >
              {d}d
            </Button>
          ))}
        </div>
      </header>

      {isLoading || !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>
          {/*
            * The four headline numbers, first because they're the ones you'd
            * quote. Each carries its denominator: a percentage over four
            * samples and one over four hundred are different claims, and a
            * dashboard that hides that invites acting on noise.
            *
            * These four ignore the window buttons above. Activation and D7 are
            * anchored to when each person signed up, not to a calendar range,
            * and WAU means seven days by definition — narrowing them to "the
            * last 7 days" would produce a number that looks like a rate and
            * isn't one.
            */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Headline</CardTitle>
              <p className="text-xs text-muted-foreground">
                Anchored to each person's own signup date, so the window buttons don't apply.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <Stat
                label="Activation"
                value={formatPercent(data.activation.percent)}
                sub={`${data.activation.activated}/${data.activation.eligible} posted an update within ${data.activation.windowHours}h of signing up`}
                state={data.activation.percent == null ? "none"
                  : data.activation.percent >= 40 ? "good" : "warn"}
              />
              <Stat
                label="D7"
                value={formatPercent(data.d7Signup.percent)}
                sub={`${data.d7Signup.retained}/${data.d7Signup.cohort} still active a week after signing up`}
                state={data.d7Signup.percent == null ? "none"
                  : data.d7Signup.percent >= 25 ? "good" : "warn"}
              />
              <Stat
                label="WAU"
                value={String(data.wau.people)}
                sub={`${data.wau.updaters} of them posted an update`}
              />
              <Stat
                label={`Answered in ${data.commentWithin24h.hours}h`}
                value={formatPercent(data.commentWithin24h.percent)}
                sub={`${data.commentWithin24h.answered}/${data.commentWithin24h.updates} of all updates got a comment`}
                state={data.commentWithin24h.percent == null ? "none"
                  : data.commentWithin24h.percent >= 50 ? "good" : "warn"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">The loop</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Stat label="Composers opened" value={String(data.funnel.started)} />
              <Stat
                label="Check-ins posted" value={String(data.funnel.submitted)}
                sub={data.funnel.completionPercent != null
                  ? `${formatPercent(data.funnel.completionPercent)} of those opened`
                  : undefined}
              />
              <Stat label="Links copied" value={String(data.funnel.shares)} sub="share artifacts" />
              <Stat label="Pages viewed" value={String(data.funnel.views)} />
              <Stat label="Comments" value={String(data.funnel.comments)} />
              <Stat
                label="Time to post (P50)"
                value={formatDuration(data.timeToPost.p50Ms)}
                sub={`target ${formatDuration(LOOP_TARGETS.timeToPostP50Ms)} · ${data.timeToPost.samples} sampled`}
                state={data.timeToPost.samples === 0 ? "none" : data.timeToPost.atTarget ? "good" : "warn"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Feedback within {data.feedbackSla.hours}h
                {data.feedbackSla.eligible > 0 && (
                  <Badge
                    variant="outline"
                    className={(data.feedbackSla.percent ?? 0) >= 80 ? "text-emerald-600" : "text-amber-600"}
                  >
                    {(data.feedbackSla.percent ?? 0) >= 80
                      ? <CheckCircle2 className="h-3 w-3 mr-1" />
                      : <AlertTriangle className="h-3 w-3 mr-1" />}
                    {formatPercent(data.feedbackSla.percent)}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {data.feedbackSla.eligible === 0
                  ? "No check-in has asked for feedback and had a full 24 hours to receive it yet."
                  : `${data.feedbackSla.answered} of ${data.feedbackSla.eligible} check-ins that asked for
                     feedback got a comment inside ${data.feedbackSla.hours} hours.`}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Only check-ins older than {data.feedbackSla.hours}h count — anything posted this morning
                hasn't had its window yet and would drag the figure down for no reason.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Retention</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="D7" value={formatPercent(data.retention.d7.percent)}
                  sub={`${data.retention.d7.returned}/${data.retention.d7.cohort} builders`}
                />
                <Stat
                  label="D30" value={formatPercent(data.retention.d30.percent)}
                  sub={`${data.retention.d30.returned}/${data.retention.d30.cohort} builders`}
                />
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                For a weekly loop, "came back" means <strong>posted a second check-in</strong> — not
                opened the app. D7 asks whether week two happened at all; D30 whether the habit
                survived a month. Only builders whose first check-in is old enough to have had the
                full window are counted.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
