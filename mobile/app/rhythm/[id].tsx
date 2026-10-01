import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Loading, Screen, errText } from "../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import { CountRow, NotFoundScreen, isNotFound, text } from "../../src/components/more/AdminKit";

/**
 * The week, on a Run project — the phone's half of the web's rhythm tab.
 *
 * This is the piece of the Companies surface that most wanted to be on a phone
 * and was not. A weekly check-in is a recurring task somebody does on a Sunday
 * evening or between two other things; the numbers are small, there are three
 * of them, and the whole job is two minutes. It was only possible at a desk.
 *
 * It also needs no company page to reach, which is why it is here rather than
 * waiting behind the rest of the surface: the rhythm belongs to a *project* on
 * the Run path, so it hangs off a screen the phone already had.
 *
 * ## The metrics are the project's, not this screen's
 *
 * `metricsForProject` decides which numbers a project tracks, from its
 * subcategory and from what it has filed before, and Postgres jsonb does not
 * keep key order so the server sorts them deliberately. The phone renders what
 * it is given in the order it is given, and adds nothing: a restaurant tracks
 * covers and food cost, an agency tracks something else, and this screen should
 * never be the place that decides which.
 *
 * `better` says which way is good — "food cost going up is a worse week, covers
 * going up a better one" — so it is shown, because a number without a direction
 * is a number somebody has to remember the meaning of.
 *
 * ## What is not here
 *
 * Adding and editing the recurring jobs, the metric settings, the quarter goals
 * and the monthly report. Those are configuration and reading, and they are the
 * parts that benefit from a desk. Marking a job done is here, because that is
 * the other recurring act and it is one tap.
 */

interface Metric { id: string; label: string; unit: string; better: "up" | "down"; advice?: string }
interface Job {
  id: string; title: string; notes: string | null;
  every: "week" | "fortnight" | "month";
  ownerId: string | null; nextDue: string; active: boolean;
}
interface Checkin {
  weekOf: string;
  numbers: Record<string, number | null> | null;
  wentRight: string | null;
  wentWrong: string | null;
}
interface Rhythm {
  today: string;
  weekOf: string;
  subcategory: string | null;
  metrics: Metric[];
  current: Checkin | null;
  checkins: Checkin[];
  jobs: Job[];
  overdue: Job[];
  members: unknown[];
}

export default function ProjectRhythm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();

  const q = useQuery<Rhythm>({
    queryKey: ["rhythm", id],
    queryFn: () => api<Rhythm>(`/api/projects/${id}/rhythm`),
    enabled: !!id,
    retry: false,
  });

  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [wentRight, setWentRight] = useState("");
  const [wentWrong, setWentWrong] = useState("");

  /* Seed the form from this week's filing, so an edit starts from what is there. */
  useEffect(() => {
    const c = q.data?.current;
    if (!c) return;
    setNumbers(Object.fromEntries(Object.entries(c.numbers ?? {}).map(([k, v]) => [k, v == null ? "" : String(v)])));
    setWentRight(c.wentRight ?? "");
    setWentWrong(c.wentWrong ?? "");
  }, [q.data?.current]);

  const file = useMutation({
    mutationFn: () => {
      /*
       * Empty means "not tracked this week", which the server accepts as null —
       * different from zero, and the difference matters: zero covers is a bad
       * week, no answer is a week nobody counted.
       */
      const cleaned = Object.fromEntries(
        Object.entries(numbers).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)]),
      );
      return api(`/api/projects/${id}/rhythm/checkins/${q.data!.weekOf}`, {
        method: "PUT",
        body: { numbers: cleaned, wentRight, wentWrong },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rhythm", id] });
      show({ text: "Week filed.", tone: "success" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't file that week."), tone: "error" }),
  });

  const done = useMutation({
    mutationFn: (jobId: string) => api(`/api/projects/${id}/rhythm/jobs/${jobId}/done`, { method: "POST", body: {} }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rhythm", id] });
      show({ text: "Marked done.", tone: "success" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't mark that done."), tone: "error" }),
  });

  if (isNotFound(q.error)) return <NotFoundScreen title="This week" />;
  if (q.isLoading || !q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: "This week" }} />
        <Loading />
      </View>
    );
  }

  const d = q.data;
  const filed = !!d.current;
  const invalid = Object.values(numbers).some((v) => v.trim() !== "" && !Number.isFinite(Number(v)));

  return (
    <>
      <Screen>
        <Stack.Screen options={{ title: "This week" }} />
        <PageIntro
          icon="calendar"
          title={`Week of ${d.weekOf}`}
          body={d.subcategory ? `The numbers a ${d.subcategory} tracks, and what happened.` : "The week's numbers, and what happened."}
          right={<Pill label={filed ? "filed" : "not filed"} tone={filed ? "good" : "warn"} />}
        />

        {/* Overdue first: it is the thing that is wrong right now. */}
        {d.overdue.length > 0 ? (
          <Callout
            icon="alert-circle"
            tone="warn"
            title={`${d.overdue.length} ${d.overdue.length === 1 ? "job is" : "jobs are"} overdue`}
            body={d.overdue.map((j) => j.title).join(", ")}
          />
        ) : null}

        <TitledCard icon="stats-chart" title="The numbers">
          {d.metrics.length === 0 ? (
            <Text style={text.meta}>No numbers are being tracked yet. Choosing them is on the web.</Text>
          ) : d.metrics.map((m) => (
            <View key={m.id} style={{ gap: 4, paddingVertical: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[text.body, { flex: 1 }]}>{m.label}</Text>
                {/* Which way is good, because a number without a direction has to be remembered. */}
                <Pill label={m.better === "up" ? "higher is better" : "lower is better"} tone="neutral" />
              </View>
              <TextInput
                value={numbers[m.id] ?? ""}
                onChangeText={(v) => setNumbers((n) => ({ ...n, [m.id]: v }))}
                keyboardType="numeric"
                placeholder={m.unit}
                placeholderTextColor={colors.textTertiary}
                style={{
                  backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
                  paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
                  fontSize: font.sm, fontFamily: fontFamily.regular,
                }}
                testID={`metric-${m.id}`}
              />
              {m.advice ? <Text style={text.small}>{m.advice}</Text> : null}
            </View>
          ))}
        </TitledCard>

        <TitledCard icon="create" title="What happened">
          <Text style={text.small}>What went right</Text>
          <TextInput
            value={wentRight}
            onChangeText={setWentRight}
            multiline
            maxLength={2000}
            placeholder="A sentence is enough."
            placeholderTextColor={colors.textTertiary}
            style={{
              backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
              padding: spacing.md, minHeight: 64, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
            }}
            testID="input-went-right"
          />
          <Text style={[text.small, { marginTop: spacing.sm }]}>What went wrong</Text>
          <TextInput
            value={wentWrong}
            onChangeText={setWentWrong}
            multiline
            maxLength={2000}
            placeholder="And what you'll do about it."
            placeholderTextColor={colors.textTertiary}
            style={{
              backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
              padding: spacing.md, minHeight: 64, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
            }}
            testID="input-went-wrong"
          />
          <Btn
            label={filed ? "Update this week" : "File this week"}
            style={{ marginTop: spacing.md }}
            loading={file.isPending}
            disabled={invalid || d.metrics.length === 0}
            onPress={() => file.mutate()}
            testID="file-week"
          />
          {invalid ? <Text style={[text.small, { color: colors.danger }]}>One of those isn't a number.</Text> : null}
          <Text style={text.small}>
            An empty box is "nobody counted", which is not the same as zero — the server keeps the
            difference.
          </Text>
        </TitledCard>

        {d.jobs.length ? (
          <TitledCard icon="repeat" title="Recurring jobs">
            {d.jobs.filter((j) => j.active).map((j) => (
              <CountRow
                key={j.id}
                label={j.title}
                value={j.nextDue}
                note={j.every}
                leading={
                  <Pill
                    label={j.nextDue < d.today ? "overdue" : "due"}
                    tone={j.nextDue < d.today ? "warn" : "neutral"}
                  />
                }
              />
            ))}
            {/*
              * One tap, because marking a job done is the other recurring act.
              * Adding and editing them is configuration, and that is on the web.
              */}
            {d.overdue.length ? (
              <Btn
                label={`Mark "${d.overdue[0].title}" done`}
                variant="outline"
                style={{ marginTop: spacing.sm }}
                loading={done.isPending}
                onPress={() => done.mutate(d.overdue[0].id)}
                testID="mark-job-done"
              />
            ) : null}
          </TitledCard>
        ) : null}

        <Callout
          icon="desktop"
          tone="info"
          body="Choosing which numbers to track, editing the recurring jobs, the quarter goals and the monthly report are on the web. This screen is the week itself."
        />
        <View style={{ height: spacing.xl }} />
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
