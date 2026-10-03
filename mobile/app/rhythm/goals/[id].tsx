import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../../src/theme";
import { Btn, Loading, Screen, errText } from "../../../src/components/ui";
import { Callout, PageIntro, TitledCard } from "../../../src/components/MoreKit";
import { Pill } from "../../../src/components/nova/Pill";
import { NoticeBanner, Sheet, useNotice } from "../../../src/components/Sheet";
import { ChoiceList, ConfirmSheet, NotFoundScreen, isNotFound, text } from "../../../src/components/more/AdminKit";

/**
 * The quarter's goals, on a Run project — the half of the rhythm the phone had
 * no way to see.
 *
 * The weekly check-in was already here and it is the act; this is what the act
 * is *for*. A goal is three or four a quarter, each measured by one of the
 * numbers the check-ins already collect, so progress is not something anybody
 * types — the server works it out from the weeks that have been filed.
 *
 * ## Why progress is read and never written
 *
 * `goalProgress` in shared/company-rhythm.ts measures from the quarter's *first
 * recorded value* to the target, so a café aiming for 600 covers from 500 is
 * halfway at 550 rather than 92% of the way there. It also allows about two
 * weeks of slack in thirteen before calling a goal behind, because weekly
 * numbers are noisy and a badge that says "behind" in week two teaches people to
 * ignore the badge. None of that is re-derived here: this screen renders the
 * state it is given, for the same reason the check-in screen renders the metrics
 * it is given.
 *
 * ## What is here and what is not
 *
 * Adding a goal, renaming it, pointing it at a number and a target, marking it
 * done or dropped, deleting it. All of it is a sentence and a number, which is
 * phone-sized. What is not here is choosing *which numbers the project tracks* —
 * that is the project's shape rather than this quarter's intent, and it stays
 * where it was.
 */

interface Metric { id: string; label: string; unit: string; better: "up" | "down" }

interface Progress {
  first: number | null; firstWeek: string | null;
  latest: number | null; latestWeek: string | null;
  fraction: number | null;
  elapsed: number;
  reached: boolean;
  state: "reached" | "on track" | "behind" | "no numbers yet" | "not measured";
}

interface Goal {
  id: string;
  quarter: string;
  title: string;
  metricId: string | null;
  target: number | null;
  direction: "up" | "down" | null;
  ownerId: string | null;
  status: "active" | "done" | "dropped";
  progress: Progress;
}

interface Quarter {
  quarter: string;
  start: string;
  end: string;
  today: string;
  previousQuarter: string;
  nextQuarter: string;
  metrics: Metric[];
  goals: Goal[];
}

/** The server's five states, as a colour. "No numbers yet" is dashed and never red. */
const TONE: Record<Progress["state"], "good" | "warn" | "bad" | "info" | "neutral" | "unknown"> = {
  reached: "good",
  "on track": "good",
  behind: "warn",
  "no numbers yet": "unknown",
  "not measured": "neutral",
};

export default function QuarterGoals() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const [quarter, setQuarter] = useState<string | null>(null);

  const key = ["rhythm", id, "goals", quarter ?? "now"];
  const q = useQuery<Quarter>({
    queryKey: key,
    queryFn: () => api<Quarter>(`/api/projects/${id}/rhythm/goals${quarter ? `?quarter=${quarter}` : ""}`),
    enabled: !!id,
    retry: false,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["rhythm", id] });

  /* The add/edit sheet. One sheet for both, because the fields are the same. */
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [metricId, setMetricId] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [deleting, setDeleting] = useState<Goal | null>(null);

  const open = (goal: Goal | "new") => {
    setTitle(goal === "new" ? "" : goal.title);
    setMetricId(goal === "new" ? null : goal.metricId);
    setTarget(goal === "new" || goal.target == null ? "" : String(goal.target));
    setEditing(goal);
  };

  const save = useMutation({
    mutationFn: () => {
      /*
       * A target means nothing without a number to measure it by, and the server
       * refuses that pair — so an empty metric sends an explicit null for both
       * rather than leaving a stale target behind on an edit.
       */
      const body: Record<string, unknown> = {
        title: title.trim(),
        metricId: metricId ?? null,
        target: metricId && target.trim() !== "" ? Number(target) : null,
      };
      if (editing === "new") {
        return api(`/api/projects/${id}/rhythm/goals`, { method: "POST", body: { ...body, quarter: q.data!.quarter } });
      }
      return api(`/api/projects/${id}/rhythm/goals/${(editing as Goal).id}`, { method: "PATCH", body });
    },
    onSuccess: () => { setEditing(null); refresh(); show({ text: "Saved.", tone: "success" }); },
    onError: (e) => show({ text: errText(e, "Couldn't save that goal."), tone: "error" }),
  });

  const setStatus = useMutation({
    mutationFn: ({ goal, status }: { goal: Goal; status: Goal["status"] }) =>
      api(`/api/projects/${id}/rhythm/goals/${goal.id}`, { method: "PATCH", body: { status } }),
    onSuccess: (_r, v) => { refresh(); show({ text: v.status === "done" ? "Marked done." : v.status === "dropped" ? "Dropped." : "Back to active.", tone: "success" }); },
    onError: (e) => show({ text: errText(e, "Couldn't change that."), tone: "error" }),
  });

  const remove = useMutation({
    mutationFn: (goal: Goal) => api(`/api/projects/${id}/rhythm/goals/${goal.id}`, { method: "DELETE" }),
    onSuccess: () => { setDeleting(null); refresh(); show({ text: "Goal deleted.", tone: "info" }); },
    onError: (e) => show({ text: errText(e, "Couldn't delete that goal."), tone: "error" }),
  });

  if (isNotFound(q.error)) return <NotFoundScreen title="Goals" />;
  if (q.isLoading || !q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Stack.Screen options={{ title: "Goals" }} />
        <Loading />
      </View>
    );
  }

  const d = q.data;
  const active = d.goals.filter((g) => g.status === "active");
  const settled = d.goals.filter((g) => g.status !== "active");
  const metric = (id: string | null) => d.metrics.find((m) => m.id === id) ?? null;
  const invalid = !!metricId && target.trim() !== "" && !Number.isFinite(Number(target));

  return (
    <>
      <Screen>
        <Stack.Screen options={{ title: "Goals" }} />
        <PageIntro
          icon="flag"
          title={d.quarter}
          body={`${d.start} to ${d.end}. What this quarter is for, measured by the numbers your check-ins already collect.`}
          right={<Pill label={`${active.length} active`} tone={active.length ? "info" : "neutral"} />}
        />

        {/* The quarter being read. Last quarter is the one people actually look back at. */}
        <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md }}>
          <Btn label={`← ${d.previousQuarter}`} small variant="outline" onPress={() => setQuarter(d.previousQuarter)} testID="goals-previous-quarter" />
          <View style={{ flex: 1 }} />
          <Btn label={`${d.nextQuarter} →`} small variant="outline" onPress={() => setQuarter(d.nextQuarter)} testID="goals-next-quarter" />
        </View>

        <TitledCard
          icon="flag"
          title="This quarter"
          action={<Btn label="Add" small icon="add" onPress={() => open("new")} testID="add-goal" />}
        >
          {active.length === 0 ? (
            <Text style={text.meta}>
              No goals set for {d.quarter}. Three or four is plenty — each one a sentence, measured by
              one of your numbers.
            </Text>
          ) : active.map((g) => {
            const m = metric(g.metricId);
            return (
              <View key={g.id} style={{ paddingVertical: spacing.sm, borderTopWidth: 1, borderColor: colors.border, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[text.body, { flex: 1 }]}>{g.title}</Text>
                  <Pill label={g.progress.state} tone={TONE[g.progress.state]} />
                </View>

                {m ? (
                  <Text style={text.small}>
                    {m.label}
                    {g.target != null ? ` → ${g.target}` : ""}
                    {g.progress.latest != null ? ` · now ${g.progress.latest}${g.progress.latestWeek ? ` (week of ${g.progress.latestWeek})` : ""}` : ""}
                  </Text>
                ) : (
                  <Text style={text.small}>Ticked by hand — not measured by a number.</Text>
                )}

                {/*
                  * The bar compares how far the goal has come with how far the
                  * quarter has gone. Both, because one without the other says
                  * nothing: 40% in week two is ahead, and in week twelve it is not.
                  */}
                {g.progress.fraction != null ? (
                  <View style={{ gap: 3 }}>
                    <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
                      <View style={{
                        width: `${Math.max(0, Math.min(1, g.progress.fraction)) * 100}%`,
                        height: "100%",
                        backgroundColor: g.progress.reached ? colors.success : g.progress.state === "behind" ? colors.warning : colors.primary,
                      }} />
                    </View>
                    <Text style={text.small}>
                      {Math.round(g.progress.fraction * 100)}% of the way, {Math.round(g.progress.elapsed * 100)}% of the quarter gone
                    </Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 2 }}>
                  <Btn label="Edit" small variant="ghost" onPress={() => open(g)} testID={`edit-goal-${g.id}`} />
                  <Btn label="Done" small variant="outline" onPress={() => setStatus.mutate({ goal: g, status: "done" })} testID={`goal-done-${g.id}`} />
                  <Btn label="Drop" small variant="ghost" onPress={() => setStatus.mutate({ goal: g, status: "dropped" })} testID={`goal-drop-${g.id}`} />
                </View>
              </View>
            );
          })}
        </TitledCard>

        {settled.length ? (
          <TitledCard icon="checkmark-done" title="Settled">
            {settled.map((g) => (
              <View key={g.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 }}>
                <Text style={[text.body, { flex: 1, color: colors.textSecondary }]}>{g.title}</Text>
                <Pill label={g.status} tone={g.status === "done" ? "good" : "neutral"} />
                <Btn label="Reopen" small variant="ghost" onPress={() => setStatus.mutate({ goal: g, status: "active" })} testID={`goal-reopen-${g.id}`} />
                <Btn label="Delete" small variant="ghost" onPress={() => setDeleting(g)} testID={`goal-delete-${g.id}`} />
              </View>
            ))}
          </TitledCard>
        ) : null}

        <Callout
          icon="information-circle"
          tone="info"
          body="Progress is worked out from the weeks you've filed, measured from where the quarter started rather than from zero. Which numbers the project tracks is part of its setup, and that is still on the web."
        />
        <View style={{ height: spacing.xl }} />
      </Screen>

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add a goal" : "Edit this goal"}
        subtitle={d.quarter}
      >
        <Text style={text.small}>What the quarter is for</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          maxLength={140}
          placeholder="Six hundred covers a week"
          placeholderTextColor={colors.textTertiary}
          style={{
            backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
            paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
            fontSize: font.sm, fontFamily: fontFamily.regular,
          }}
          testID="input-goal-title"
        />

        <Text style={[text.small, { marginTop: spacing.md }]}>Measured by</Text>
        {/*
          * One of the project's own numbers, or none. "None" is a real choice —
          * a goal that is ticked by hand is still a goal, and pretending
          * everything is measurable is how a quarter gets goals nobody means.
          */}
        <ChoiceList
          options={[
            { id: "", label: "Ticked by hand" },
            ...d.metrics.map((m) => ({ id: m.id, label: m.label, detail: m.better === "up" ? "higher is better" : "lower is better" })),
          ]}
          value={metricId ?? ""}
          onChange={(v) => setMetricId(v || null)}
          disabled={save.isPending}
        />

        {metricId ? (
          <>
            <Text style={[text.small, { marginTop: spacing.md }]}>
              The value that means done ({metric(metricId)?.unit}, {metric(metricId)?.better === "up" ? "higher is better" : "lower is better"})
            </Text>
            <TextInput
              value={target}
              onChangeText={setTarget}
              keyboardType="numeric"
              placeholder="Leave empty for no target"
              placeholderTextColor={colors.textTertiary}
              style={{
                backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
                paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text,
                fontSize: font.sm, fontFamily: fontFamily.regular,
              }}
              testID="input-goal-target"
            />
          </>
        ) : null}

        {invalid ? <Text style={[text.small, { color: colors.danger }]}>That target isn't a number.</Text> : null}
        <Btn
          label={editing === "new" ? "Add it" : "Save"}
          style={{ marginTop: spacing.lg }}
          loading={save.isPending}
          disabled={!title.trim() || invalid || save.isPending}
          onPress={() => save.mutate()}
          testID="save-goal"
        />
      </Sheet>

      <ConfirmSheet
        visible={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this goal?"
        body={`"${deleting?.title ?? ""}" goes, along with what it recorded about the quarter. Dropping it instead keeps the record.`}
        confirmLabel="Delete it"
        danger
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />

      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
