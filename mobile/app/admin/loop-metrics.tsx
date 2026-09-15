import { useState } from "react";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, fontFamily } from "../../src/theme";
import { Empty, Loading, Screen, Segments, errText } from "../../src/components/ui";
import { PageIntro, Pill, TitledCard } from "../../src/components/MoreKit";
import {
  NotFoundScreen, StatBox, StatGrid, formatDuration, formatPercent, gateView, isNotFound, text, useReviewer,
} from "../../src/components/more/AdminKit";

/** shared/loop-events.ts LOOP_TARGETS.timeToPostP50Ms. */
const TIME_TO_POST_TARGET_MS = 2 * 60 * 1000;

interface Metrics {
  windowDays: number;
  funnel: { started: number; submitted: number; completionPercent: number | null; shares: number; comments: number; views: number };
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

const WINDOWS = [{ value: "7", label: "7d" }, { value: "30", label: "30d" }, { value: "90", label: "90d" }];

const stateOf = (percent: number | null, good: number) => (percent == null ? "none" : percent >= good ? "good" : "warn") as "none" | "good" | "warn";

/**
 * The weekly check-in loop, measured — the web's /admin/loop-metrics. Every
 * figure keeps its denominator, because a percentage over four samples and
 * one over four hundred are different claims.
 */
export default function LoopMetrics() {
  const { loading, isReviewer } = useReviewer();
  const [days, setDays] = useState("30");

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin-loop-metrics", days],
    queryFn: () => api<Metrics>(`/api/admin/loop-metrics?days=${days}`),
    enabled: isReviewer,
    retry: false,
  });

  const gate = gateView("Loop metrics", loading, isReviewer);
  if (gate) return gate;
  if (isNotFound(error)) return <NotFoundScreen title="Loop metrics" />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Stack.Screen options={{ title: "Loop metrics" }} />
      <Screen canvas onRefresh={() => refetch()} refreshing={isRefetching}>
        <PageIntro icon="pulse" title="Loop metrics" body="The weekly check-in loop, measured. These are the Phase 4 gate." />
        <Segments options={WINDOWS} value={days} onChange={setDays} />

        {isLoading ? <View style={{ height: 200 }}><Loading /></View>
          : error || !data ? <Empty icon="cloud-offline-outline" title="Couldn't compute the metrics" body={errText(error)} action="Try again" onAction={() => refetch()} />
          : (
            <>
              {/* Anchored to signup, or seven days by definition — the window buttons don't move these. */}
              <TitledCard title="Headline">
                <Text style={text.small}>Anchored to each person's own signup date, so the window buttons don't apply.</Text>
                <StatGrid>
                  <StatBox
                    label="Activation"
                    value={formatPercent(data.activation.percent)}
                    sub={`${data.activation.activated}/${data.activation.eligible} posted an update within ${data.activation.windowHours}h of signing up`}
                    state={stateOf(data.activation.percent, 40)}
                  />
                  <StatBox
                    label="D7"
                    value={formatPercent(data.d7Signup.percent)}
                    sub={`${data.d7Signup.retained}/${data.d7Signup.cohort} still active a week after signing up`}
                    state={stateOf(data.d7Signup.percent, 25)}
                  />
                  <StatBox label="WAU" value={String(data.wau.people)} sub={`${data.wau.updaters} of them posted an update`} />
                  <StatBox
                    label={`Answered in ${data.commentWithin24h.hours}h`}
                    value={formatPercent(data.commentWithin24h.percent)}
                    sub={`${data.commentWithin24h.answered}/${data.commentWithin24h.updates} of all updates got a comment`}
                    state={stateOf(data.commentWithin24h.percent, 50)}
                  />
                </StatGrid>
              </TitledCard>

              <TitledCard title="The loop">
                <StatGrid>
                  <StatBox label="Composers opened" value={String(data.funnel.started)} />
                  <StatBox
                    label="Check-ins posted"
                    value={String(data.funnel.submitted)}
                    sub={data.funnel.completionPercent != null ? `${formatPercent(data.funnel.completionPercent)} of those opened` : undefined}
                  />
                  <StatBox label="Links copied" value={String(data.funnel.shares)} sub="share artifacts" />
                  <StatBox label="Pages viewed" value={String(data.funnel.views)} />
                  <StatBox label="Comments" value={String(data.funnel.comments)} />
                  <StatBox
                    label="Time to post (P50)"
                    value={formatDuration(data.timeToPost.p50Ms)}
                    sub={`target ${formatDuration(TIME_TO_POST_TARGET_MS)} · ${data.timeToPost.samples} sampled`}
                    state={data.timeToPost.samples === 0 ? "none" : data.timeToPost.atTarget ? "good" : "warn"}
                  />
                </StatGrid>
              </TitledCard>

              <TitledCard
                title={`Feedback within ${data.feedbackSla.hours}h`}
                action={data.feedbackSla.eligible > 0 ? (
                  <Pill
                    label={formatPercent(data.feedbackSla.percent)}
                    icon={(data.feedbackSla.percent ?? 0) >= 80 ? "checkmark-circle" : "warning"}
                    color={(data.feedbackSla.percent ?? 0) >= 80 ? colors.success : colors.warning}
                  />
                ) : undefined}
              >
                <Text style={text.meta}>
                  {data.feedbackSla.eligible === 0
                    ? "No check-in has asked for feedback and had a full 24 hours to receive it yet."
                    : `${data.feedbackSla.answered} of ${data.feedbackSla.eligible} check-ins that asked for feedback got a comment inside ${data.feedbackSla.hours} hours.`}
                </Text>
                <Text style={text.small}>
                  Only check-ins older than {data.feedbackSla.hours}h count — anything posted this morning hasn't had its window yet and would drag the figure down for no reason.
                </Text>
              </TitledCard>

              <TitledCard title="Retention">
                <StatGrid>
                  <StatBox label="D7" value={formatPercent(data.retention.d7.percent)} sub={`${data.retention.d7.returned}/${data.retention.d7.cohort} builders`} />
                  <StatBox label="D30" value={formatPercent(data.retention.d30.percent)} sub={`${data.retention.d30.returned}/${data.retention.d30.cohort} builders`} />
                </StatGrid>
                <Text style={text.small}>
                  For a weekly loop, "came back" means <Text style={{ fontFamily: fontFamily.bold }}>posted a second check-in</Text> — not opened the app. D7 asks whether week two happened at all; D30 whether the habit survived a month. Only builders whose first check-in is old enough to have had the full window are counted.
                </Text>
              </TitledCard>
            </>
          )}
      </Screen>
    </View>
  );
}
