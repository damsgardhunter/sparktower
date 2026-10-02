import { useState } from "react";
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../src/api/client";
import { colors, spacing } from "../../../src/theme";
import { Btn, Loading, Screen } from "../../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../../src/components/MoreKit";
import { Pill } from "../../../src/components/nova/Pill";
import { CountRow, NotFoundScreen, StatBox, StatGrid, isNotFound, text } from "../../../src/components/more/AdminKit";

/**
 * The month, looked back on — the other half of the rhythm the phone could not see.
 *
 * A check-in is a Sunday-evening act and the phone had it. This is the once-a-
 * month read that tells somebody whether the weeks added up to anything, and it
 * is at least as phone-shaped: it is all reading, it is short, and the month a
 * person wants is usually the one that just ended rather than the one they are
 * in.
 *
 * ## Everything here is the server's arithmetic
 *
 * `buildMonthlyReport` in shared/company-rhythm.ts decides which number got
 * worse, which recurring job slipped, what kept going wrong, and — the one line
 * that matters — what to fix next. None of it is recomputed here. That is not
 * laziness: the web reads the same function, and a phone that worked out its own
 * "what to fix next" would be a second opinion on the same month.
 *
 * ## `glance=1`
 *
 * Reading the report is itself a Run milestone (RUN.S3.4), which the route closes
 * when a month with filings is opened. That is right for somebody who came to
 * read it and wrong for a card that happens to fetch one, so the route takes
 * `glance=1` to read without claiming the milestone. This screen does *not* pass
 * it: opening this screen is the act the milestone is about.
 */

interface MetricMonth {
  id: string; label: string; unit: string; better: "up" | "down";
  first: number | null; firstWeek: string | null;
  last: number | null; lastWeek: string | null;
  change: number | null; pct: number | null;
  verdict: "better" | "worse" | "flat" | "no numbers";
}

interface JobMonth { jobId: string; title: string; onTime: number; late: number; missed: number }

interface Report {
  month: string;
  weeks: string[];
  filed: number;
  weeksSoFar: number;
  missingWeeks: string[];
  metrics: MetricMonth[];
  bestWeek: { weekOf: string; improved: number; worsened: number } | null;
  worstWeek: { weekOf: string; improved: number; worsened: number } | null;
  jobs: { onTime: number; late: number; missed: number; byJob: JobMonth[] };
  themes: { id: string; label: string; weeks: string[] }[];
  fixNext: { kind: "metric" | "job" | "theme"; id: string; text: string } | null;
  previousMonth: string;
  nextMonth: string;
}

/** The month before this one, as YYYY-MM, computed locally only to open on it. */
function lastMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const VERDICT: Record<MetricMonth["verdict"], "good" | "bad" | "neutral" | "unknown"> = {
  better: "good",
  worse: "bad",
  flat: "neutral",
  "no numbers": "unknown",
};

export default function MonthlyReport() {
  const { id } = useLocalSearchParams<{ id: string }>();
  /*
   * Opens on the month that just ended, not the one in progress. A report on a
   * month three days old is a report on three days.
   */
  const [month, setMonth] = useState(lastMonth);

  const q = useQuery<Report>({
    queryKey: ["rhythm", id, "report", month],
    queryFn: () => api<Report>(`/api/projects/${id}/rhythm/report/${month}`),
    enabled: !!id,
    retry: false,
  });

  if (isNotFound(q.error)) return <NotFoundScreen title="The month" />;
  if (q.isLoading || !q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: "The month" }} />
        <Loading />
      </View>
    );
  }

  const d = q.data;
  const shown = d.metrics.filter((m) => m.verdict !== "no numbers");

  return (
    <Screen>
      <Stack.Screen options={{ title: "The month" }} />
      <PageIntro
        icon="calendar-outline"
        title={d.month}
        body={`${d.filed} of ${d.weeksSoFar} weeks filed.`}
        right={<Pill label={d.filed === d.weeksSoFar ? "complete" : `${d.missingWeeks.length} missing`} tone={d.filed === d.weeksSoFar ? "good" : "warn"} />}
      />

      <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}>
        <Btn label={`← ${d.previousMonth}`} small variant="outline" onPress={() => setMonth(d.previousMonth)} testID="report-previous-month" />
        <View style={{ flex: 1 }} />
        <Btn label={`${d.nextMonth} →`} small variant="outline" onPress={() => setMonth(d.nextMonth)} testID="report-next-month" />
      </View>

      {/*
        * The one line worth reading first. The server picked it: the number that
        * got worst, else the job that slipped most, else the thing that kept
        * going wrong — in that order, because a slipping number outranks a
        * slipping habit.
        */}
      {d.fixNext ? (
        <Callout icon="construct" tone="warn" title="What to fix next" body={d.fixNext.text} />
      ) : d.filed === 0 ? (
        <Callout
          icon="information-circle"
          tone="info"
          title="Nothing filed for this month"
          body="A report is built from the weeks that were filed. File a week and it will have something to say."
        />
      ) : (
        <Callout icon="checkmark-circle" tone="success" title="Nothing obviously slipping" body="No number got worse, no job was late, and nothing came up twice." />
      )}

      {shown.length ? (
        <TitledCard icon="stats-chart" title="The numbers, start to end">
          {shown.map((m) => (
            <View key={m.id} style={{ paddingVertical: 6, gap: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[text.body, { flex: 1 }]}>{m.label}</Text>
                <Pill label={m.verdict} tone={VERDICT[m.verdict]} />
              </View>
              <Text style={text.small}>
                {m.first ?? "—"} → {m.last ?? "—"}
                {m.pct != null ? ` (${m.pct > 0 ? "+" : ""}${Math.round(m.pct * 100)}%)` : m.change != null ? ` (${m.change > 0 ? "+" : ""}${m.change})` : ""}
                {m.better === "up" ? " · higher is better" : " · lower is better"}
              </Text>
            </View>
          ))}
        </TitledCard>
      ) : null}

      {d.bestWeek || d.worstWeek ? (
        <TitledCard icon="podium" title="Best and worst week">
          <StatGrid>
            {d.bestWeek ? <StatBox label="Best" value={d.bestWeek.weekOf} sub={`${d.bestWeek.improved} up, ${d.bestWeek.worsened} down`} state="good" /> : null}
            {d.worstWeek ? <StatBox label="Worst" value={d.worstWeek.weekOf} sub={`${d.worstWeek.improved} up, ${d.worstWeek.worsened} down`} state="warn" /> : null}
          </StatGrid>
        </TitledCard>
      ) : null}

      <TitledCard icon="repeat" title="The jobs that come round">
        <StatGrid>
          <StatBox label="On time" value={d.jobs.onTime} state={d.jobs.onTime ? "good" : undefined} />
          <StatBox label="Late" value={d.jobs.late} state={d.jobs.late ? "warn" : undefined} />
          <StatBox label="Missed" value={d.jobs.missed} state={d.jobs.missed ? "warn" : undefined} />
        </StatGrid>
        {d.jobs.byJob.map((j) => (
          <CountRow
            key={j.jobId}
            label={j.title}
            value={`${j.onTime} on time`}
            note={j.late || j.missed ? `${j.late} late, ${j.missed} missed` : undefined}
          />
        ))}
      </TitledCard>

      {d.themes.length ? (
        <TitledCard icon="repeat-outline" title="What kept going wrong">
          {/*
            * Only themes that came up at least twice reach here — the server's
            * rule, and the right one: a single bad week is a bad week, not a
            * pattern worth naming.
            */}
          {d.themes.map((t) => (
            <CountRow key={t.id} label={t.label} value={`${t.weeks.length} weeks`} note={t.weeks.join(", ")} />
          ))}
        </TitledCard>
      ) : null}

      {d.missingWeeks.length ? (
        <Callout
          icon="alert-circle"
          tone="warn"
          title={`${d.missingWeeks.length} ${d.missingWeeks.length === 1 ? "week" : "weeks"} never filed`}
          body={d.missingWeeks.join(", ")}
        />
      ) : null}

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}
