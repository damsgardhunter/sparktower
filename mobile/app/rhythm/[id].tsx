import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Field, Loading, Row, Screen, errText } from "../../src/components/ui";
import { Callout, MenuRow, PageIntro, TitledCard } from "../../src/components/MoreKit";
import { Pill } from "../../src/components/nova/Pill";
import { NoticeBanner, Sheet, useNotice, type Notice } from "../../src/components/Sheet";
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
 * ## What is here, and what is next door
 *
 * This screen is the week itself: the numbers, what happened, and marking a job
 * done — the acts. The quarter's goals, the monthly report and the check-in day
 * are each a screen of their own, linked from the bottom, because they are a
 * different frequency: goals are set once a quarter and read weekly, the report
 * is read once a month, and the check-in day is changed about never.
 *
 * Still not here: adding and editing the recurring jobs, and choosing which
 * numbers the project tracks. Both are the project's shape rather than this
 * week's or this quarter's intent, and both are long forms.
 */

interface Metric { id: string; label: string; unit: string; better: "up" | "down"; advice?: string }
interface RhythmMember { id: string; name: string; profileImageUrl: string | null }
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
  /**
   * What was made of the week: Nova's reading when it was asked for, and
   * otherwise the one worked out from the numbers alone. Stored on the check-in,
   * so it survives the page and is here on the next visit.
   */
  reply: string | null;
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
  members: RhythmMember[];
}

export default function ProjectRhythm() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  /** The job being edited, or "new" for one that does not exist yet. */
  const [editingJob, setEditingJob] = useState<Job | "new" | null>(null);

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

  /*
   * Nova's reading of the week. Only offered once the week is filed, because it
   * is a reply *to* the numbers — and it costs credits, so it is a tap somebody
   * makes rather than something that happens on open.
   *
   * The route answers 200 with `ai: false` and a sentence when the model is
   * unavailable or fails, having charged nothing, so a refusal is a message and
   * not an error.
   */
  const askNova = useMutation({
    mutationFn: () => api<{ checkin: Checkin; ai: boolean; message?: string }>(
      `/api/projects/${id}/rhythm/checkins/${q.data!.weekOf}/nova`,
      { method: "POST", body: {} },
    ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["rhythm", id] });
      show({ text: r.message ?? "Nova had a look at your week.", tone: r.ai ? "success" : "info" });
    },
    onError: (e) => show({ text: errText(e, "Couldn't ask Nova about this week."), tone: "error" }),
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

        {/*
          * What was made of the week.
          *
          * There is always a reply once a week is filed: the route recomputes one
          * from the numbers on every save. So this card never offers to produce a
          * reading — it shows the one there is, and offers to have Nova take a
          * closer look, which replaces it with a better-written one.
          *
          * It deliberately does not claim which of the two is on screen. Nothing
          * is stored saying where a reply came from, so after a reload the phone
          * cannot know, and a label that guessed would be wrong half the time.
          */}
        {filed && d.current?.reply ? (
          <TitledCard icon="sparkles" title="What to make of it">
            <Text style={[text.body, { lineHeight: 21 }]}>{d.current.reply}</Text>
            <Btn
              label="Ask Nova to look closer"
              variant="outline"
              style={{ marginTop: spacing.sm }}
              loading={askNova.isPending}
              onPress={() => askNova.mutate()}
              testID="ask-nova"
            />
            <Text style={text.small}>
              Nova compares this week with the weeks before it. It costs credits; the reading above is
              free and is worked out from the numbers.
            </Text>
          </TitledCard>
        ) : null}

        {/*
          * Always drawn, even with no jobs, because the card is now where a
          * first one gets added. It used to appear only once a job existed and
          * said "adding and editing them is configuration, and that is on the
          * web" — which left the phone able to tick a job off and not to create
          * the thing it was ticking.
          */}
        <TitledCard icon="repeat" title="Recurring jobs">
          {!d.jobs.filter((j) => j.active).length ? (
            <Text style={text.small}>Nothing recurring yet. A job is something that comes round — paying people, a backup, a report.</Text>
          ) : null}
          {d.jobs.filter((j) => j.active).map((j) => (
            <Pressable key={j.id} onPress={() => setEditingJob(j)} testID={`job-${j.id}`}>
              <CountRow
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
            </Pressable>
          ))}
          {/*
            * One tap, because marking a job done is the other recurring act.
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
          <Btn
            small
            variant="ghost"
            label="Add a recurring job"
            onPress={() => setEditingJob("new")}
            testID="add-job"
          />
        </TitledCard>

        {/*
          * The rest of the rhythm, each at its own frequency. Rows rather than a
          * sentence pointing at the web, which is what was here before: all three
          * of these are on the phone now.
          */}
        <TitledCard icon="compass" title="The rest of the rhythm">
          <MenuRow
            icon="flag"
            title="This quarter's goals"
            subtitle="What the weeks are adding up to, and how far along they are"
            onPress={() => router.push(`/rhythm/goals/${id}` as any)}
            testID="link-goals"
          />
          <MenuRow
            icon="calendar-outline"
            title="Last month"
            subtitle="How the numbers moved, what slipped, and what to fix next"
            tint={colors.info}
            onPress={() => router.push(`/rhythm/report/${id}` as any)}
            testID="link-report"
          />
          <MenuRow
            icon="alarm"
            title="Check-in day and reminders"
            subtitle="Which day the week is due, and who gets chased"
            tint={colors.textSecondary}
            onPress={() => router.push(`/rhythm/settings/${id}` as any)}
            testID="link-rhythm-settings"
          />
        </TitledCard>

        <Callout
          icon="desktop"
          tone="info"
          body="Editing the recurring jobs, and choosing which numbers this project tracks, are still on the web — both are the project's shape rather than this week's."
        />
        <View style={{ height: spacing.xl }} />
      </Screen>
      {editingJob ? (
        <JobSheet
          projectId={id!}
          job={editingJob === "new" ? null : editingJob}
          members={d.members}
          today={d.today}
          onClose={() => setEditingJob(null)}
          onSaved={() => { void qc.invalidateQueries({ queryKey: ["rhythm", id] }); setEditingJob(null); }}
          notify={show}
        />
      ) : null}
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

/** How often a job comes round — shared/company-rhythm.ts's JOB_INTERVALS. */
const JOB_INTERVALS = ["week", "fortnight", "month"] as const;

/**
 * Adding, changing and stopping a recurring job.
 *
 * Stopping is `active: false` rather than a delete, which is what the web does
 * and what the data wants: a job that ran for a year and then stopped is part
 * of the record of how the company was run, and deleting it takes that away.
 * The route for deleting exists and is offered separately, worded as what it
 * is — for a job added by mistake, which has no history to lose.
 */
function JobSheet({
  projectId, job, members, today, onClose, onSaved, notify,
}: {
  projectId: string;
  job: Job | null;
  members: RhythmMember[];
  today: string;
  onClose: () => void;
  onSaved: () => void;
  notify: (n: Notice) => void;
}) {
  const [title, setTitle] = useState(job?.title ?? "");
  const [notes, setNotes] = useState(job?.notes ?? "");
  const [every, setEvery] = useState<Job["every"]>(job?.every ?? "month");
  const [nextDue, setNextDue] = useState(job?.nextDue ?? today);
  const [ownerId, setOwnerId] = useState<string | null>(job?.ownerId ?? null);

  const save = useMutation({
    mutationFn: () => {
      const body = { title: title.trim(), notes: notes.trim() || null, every, nextDue, ownerId };
      return job
        ? api(`/api/projects/${projectId}/rhythm/jobs/${job.id}`, { method: "PATCH", body })
        : api(`/api/projects/${projectId}/rhythm/jobs`, { method: "POST", body });
    },
    onSuccess: () => { notify({ text: job ? "Saved" : "Added", tone: "success" }); onSaved(); },
    /*
     * The server's sentences, which name the field: "Say how often it comes
     * round: every week, fortnight or month", "The due date should be a date,
     * as YYYY-MM-DD", and the one about an owner who is not on the project.
     */
    onError: (e) => notify({ text: errText(e, "Couldn't save that job."), tone: "error" }),
  });

  const stop = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/rhythm/jobs/${job!.id}`, { method: "PATCH", body: { active: false } }),
    onSuccess: () => { notify({ text: "Stopped. It stays in the record.", tone: "success" }); onSaved(); },
    onError: (e) => notify({ text: errText(e, "Couldn't stop that job."), tone: "error" }),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/projects/${projectId}/rhythm/jobs/${job!.id}`, { method: "DELETE" }),
    onSuccess: () => { notify({ text: "Deleted", tone: "success" }); onSaved(); },
    onError: (e) => notify({ text: errText(e, "Couldn't delete that job."), tone: "error" }),
  });

  return (
    <Sheet visible onClose={onClose} title={job ? job.title : "A recurring job"} subtitle="Something that comes round">
      <View style={{ gap: spacing.sm }}>
        <Field label="What it is" value={title} onChangeText={setTitle} maxLength={140} placeholder="Run payroll" testID="job-title" />
        <Field label="Anything to remember (optional)" value={notes} onChangeText={setNotes} multiline maxLength={2000} testID="job-notes" />

        <Text style={text.small}>How often</Text>
        <Row gap={6}>
          {JOB_INTERVALS.map((i) => (
            <Pressable
              key={i}
              onPress={() => setEvery(i)}
              testID={`job-every-${i}`}
              style={{
                paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                borderColor: every === i ? colors.primary : colors.border,
                backgroundColor: every === i ? colors.primarySoft : "transparent",
              }}
            >
              <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: every === i ? colors.primary : colors.textSecondary }}>
                every {i}
              </Text>
            </Pressable>
          ))}
        </Row>

        <Field label="Next due (YYYY-MM-DD)" value={nextDue} onChangeText={setNextDue} autoCapitalize="none" placeholder={today} testID="job-next-due" />

        {/* Whose job it is. The server refuses anybody who is not on the project. */}
        {members.length ? (
          <>
            <Text style={text.small}>Whose job it is</Text>
            <Row wrap gap={6}>
              <Pressable
                onPress={() => setOwnerId(null)}
                testID="job-owner-none"
                style={{
                  paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                  borderColor: !ownerId ? colors.primary : colors.border,
                  backgroundColor: !ownerId ? colors.primarySoft : "transparent",
                }}
              >
                <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: !ownerId ? colors.primary : colors.textSecondary }}>nobody yet</Text>
              </Pressable>
              {members.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setOwnerId(m.id)}
                  testID={`job-owner-${m.id}`}
                  style={{
                    paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1,
                    borderColor: ownerId === m.id ? colors.primary : colors.border,
                    backgroundColor: ownerId === m.id ? colors.primarySoft : "transparent",
                  }}
                >
                  <Text style={{ fontSize: font.xs, fontFamily: fontFamily.semibold, color: ownerId === m.id ? colors.primary : colors.textSecondary }}>{m.name}</Text>
                </Pressable>
              ))}
            </Row>
          </>
        ) : null}

        <Btn
          label={job ? "Save" : "Add it"}
          loading={save.isPending}
          disabled={!title.trim() || !nextDue.trim()}
          onPress={() => save.mutate()}
          testID="save-job"
        />

        {job ? (
          <Row gap={spacing.sm} wrap>
            <Btn
              small
              variant="outline"
              label="Stop it coming round"
              loading={stop.isPending}
              onPress={() => stop.mutate()}
              testID="stop-job"
            />
            <Btn
              small
              variant="danger"
              label="Delete"
              loading={remove.isPending}
              testID="delete-job"
              onPress={() => Alert.alert(
                `Delete "${job.title}"?`,
                "For a job added by mistake. If it ran for a while, stop it instead — that keeps it in the record of how the company was run.",
                [{ text: "Keep it", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate() }],
              )}
            />
          </Row>
        ) : null}
      </View>
    </Sheet>
  );
}
