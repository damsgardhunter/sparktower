/**
 * "Continue your path" at the top of the feed — continue-path-card.tsx on the
 * web: each of your paths, the one step waiting on it, and the prompt to share
 * what you finished for feedback (one step, or the week's update). A project
 * working more than one section has one item per started section, each with
 * the section's short name and a link straight into it.
 */
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "../../api/client";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, errText } from "../ui";
import { Sheet, type Notice } from "../Sheet";
import { MAX_ASKS } from "../feedModel";
import { Box, ProjectTile, primaryTint } from "./Box";

/*
 * Restated from @shared/next-step, because Metro can't resolve that alias.
 * test/unit/next-step-mirror.test.ts reads both and fails when they drift —
 * which they already had: this copy had lost `projectedAt`, and the sentence
 * below for a finished path was a different sentence from the web's.
 */
export interface NextStepItem {
  project: { id: string; title: string; logoUrl: string | null };
  /** The manager section this item is on (Ship / Systemize / Raise). */
  track?: { goal: string; label: string; short: string; primary: boolean };
  phase: string;
  progress: { done: number; total: number };
  next: { id: string; title: string; actor: string; estimateMinutes: number | null; step: string | null } | null;
  daysSinceActivity: number;
  projectedAt: string | null;
  lastDone: { taskId: string; title: string; completedAt: string; sharedPostId: string | null } | null;
  weekly?: { due: boolean; steps: { taskId: string; title: string; completedAt: string }[] };
  /** Set instead of `next` when the project has no path to take a step on. */
  needsPath?: { kind: "start" | "adopt"; existingTasks: number; existingDone: number };
}

const ACTOR_SHORT: Record<string, string> = {
  "nova-builds": "Nova builds it",
  "nova-drafts": "Nova drafts it",
  "user-decides": "You choose",
  "user-does": "Only you",
};

const NEXT_STEP_COPY = {
  mainLineDone: "Main line done — pick what's next.",
  startTitle: "This project isn't on a path yet",
  startBody: "A path is the sequence Nova works out with you — one step at a time, each with something to show at the end.",
  startAction: "Choose a path",
  adoptTitle: "Put this project on its path",
  adoptAction: "Start the path",
  failed: "Couldn't set the path up. Try again in a moment.",
};

const adoptBody = (done: number, total: number) =>
  total > 0
    ? `${done}/${total} tasks already done — Nova reads them and marks what's finished.`
    : "Nova sets up the steps and marks anything already finished.";
const estimate = (m: number | null) => (m == null ? null : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`);

export const NEXT_STEPS_KEY = ["next-steps"];

/**
 * A project with no path, and the way to give it one — the state the list used
 * to drop in silence, leaving the newest project off the screen that answers
 * "what now". Mirrors StartPath in client/src/components/continue-path-card.tsx.
 */
function StartPath({ item, idSuffix, onNotice }: {
  item: NextStepItem; idSuffix: string; onNotice?: (n: Notice) => void;
}) {
  const qc = useQueryClient();
  const needs = item.needsPath!;
  const goal = item.track?.goal ?? "";
  const start = useMutation({
    mutationFn: async () => {
      if (needs.kind === "start") await api(`/api/projects/${item.project.id}/tracks`, { method: "POST", body: { goal } });
      await api(`/api/projects/${item.project.id}/path/adopt?goal=${goal}`, { method: "POST", body: {} });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: NEXT_STEPS_KEY });
      qc.invalidateQueries({ queryKey: ["manage", item.project.id] });
    },
    onError: (e) => onNotice?.({ text: errText(e, NEXT_STEP_COPY.failed), tone: "error" }),
  });

  return (
    <View style={{ gap: 6 }} testID={`continue-path-needs-${idSuffix}`}>
      <Text style={[s.next, { fontFamily: fontFamily.medium }]}>
        {needs.kind === "adopt" ? NEXT_STEP_COPY.adoptTitle : NEXT_STEP_COPY.startTitle}
      </Text>
      <Text style={s.nextMeta}>
        {needs.kind === "adopt" ? adoptBody(needs.existingDone, needs.existingTasks) : NEXT_STEP_COPY.startBody}
      </Text>
      <Btn
        small
        label={needs.kind === "adopt" ? NEXT_STEP_COPY.adoptAction : NEXT_STEP_COPY.startAction}
        onPress={() => start.mutate()}
        loading={start.isPending}
        testID={`button-start-path-${idSuffix}`}
      />
    </View>
  );
}

export function ContinuePathCard({ onNotice }: { onNotice?: (n: Notice) => void }) {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: NEXT_STEPS_KEY,
    queryFn: () => api<{ items: NextStepItem[] }>("/api/me/next-steps"),
  });
  const [sharing, setSharing] = useState<NextStepItem | null>(null);
  const [weekly, setWeekly] = useState<NextStepItem | null>(null);
  const items = data?.items ?? [];
  if (!items.length) return null;

  return (
    <Box padded={false} style={{ borderColor: primaryTint(0.3) }} testID="continue-path-card">
      <View style={s.head}>
        <Ionicons name="compass-outline" size={14} color={colors.primary} />
        <Text style={s.headText}>CONTINUE YOUR PATH</Text>
      </View>
      {items.map((item, idx) => {
        const pct = item.progress.total ? Math.round((item.progress.done / item.progress.total) * 100) : 0;
        const novaActs = item.next?.actor.startsWith("nova");
        const weeklyDue = !!item.weekly?.due && item.weekly.steps.length > 1;
        const est = item.next ? estimate(item.next.estimateMinutes) : null;
        const idSuffix = item.track && !item.track.primary ? `${item.project.id}-${item.track.goal}` : item.project.id;
        const href = item.track ? `/manage/${item.project.id}?section=${item.track.goal}` : `/manage/${item.project.id}`;
        return (
          <View key={`${item.project.id}:${item.track?.goal ?? ""}`} style={[s.item, idx > 0 && s.itemRule]} testID={`continue-path-${idSuffix}`}>
            <View style={s.itemTop}>
              <ProjectTile title={item.project.title} uri={item.project.logoUrl} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={s.titleRow}>
                  <Text style={[s.title, { flexShrink: 1 }]} numberOfLines={1}>{item.project.title}</Text>
                  {item.track && (
                    <View style={s.badge} accessibilityLabel={item.track.label} testID={`continue-path-section-${idSuffix}`}>
                      <Text style={s.badgeText}>{item.track.short}</Text>
                    </View>
                  )}
                </View>
                <Text style={s.sub} numberOfLines={1}>
                  {item.phase} · {item.progress.done}/{item.progress.total} steps{item.daysSinceActivity >= 2 ? ` · away ${item.daysSinceActivity} days` : ""}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push(href as any)}
                style={({ pressed }) => [s.continue, pressed && { opacity: 0.85 }]}
                testID={`button-continue-path-${idSuffix}`}
              >
                <Text style={s.continueText}>Continue</Text>
                <Ionicons name="arrow-forward" size={13} color={colors.primaryText} />
              </Pressable>
            </View>
            <View style={s.track}><View style={[s.fill, { width: `${pct}%` }]} /></View>
            {item.next ? (
              <Text style={s.next} testID={`continue-path-next-${idSuffix}`}>
                <Ionicons name={novaActs ? "sparkles" : "person-outline"} size={12} color={novaActs ? colors.primary : colors.text} />
                <Text style={{ color: colors.textTertiary }}>  Next: </Text>
                <Text style={{ fontFamily: fontFamily.medium }}>{item.next.step ?? item.next.title}</Text>
                <Text style={s.nextMeta}>  · {ACTOR_SHORT[item.next.actor] ?? item.next.actor}{est ? ` · ${est}` : ""}</Text>
              </Text>
            ) : item.needsPath ? (
              <StartPath item={item} idSuffix={idSuffix} onNotice={onNotice} />
            ) : (
              <Text style={[s.next, { color: colors.textTertiary }]}>{NEXT_STEP_COPY.mainLineDone}</Text>
            )}
            {weeklyDue && (
              <Pressable onPress={() => setWeekly(item)} style={s.share} testID={`button-weekly-update-${idSuffix}`}>
                <Ionicons name="share-social-outline" size={12} color={colors.primary} />
                <Text style={s.shareText}>{item.weekly!.steps.length} steps finished this week — post your weekly update</Text>
              </Pressable>
            )}
            {item.lastDone && !item.lastDone.sharedPostId && !weeklyDue && (
              <Pressable onPress={() => setSharing(item)} style={s.share} testID={`button-share-last-step-${idSuffix}`}>
                <Ionicons name="share-social-outline" size={12} color={colors.primary} />
                <Text style={s.shareText}>You finished "{item.lastDone.title}" — share it for feedback</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {sharing?.lastDone && (
        <ShareStepSheet
          projectId={sharing.project.id}
          projectTitle={sharing.project.title}
          step={sharing.lastDone}
          onClose={() => setSharing(null)}
          onNotice={onNotice}
        />
      )}
      {weekly?.weekly && (
        <WeeklyUpdateSheet
          projectId={weekly.project.id}
          projectTitle={weekly.project.title}
          steps={weekly.weekly.steps}
          onClose={() => setWeekly(null)}
          onNotice={onNotice}
        />
      )}
    </Box>
  );
}

function useRefreshAfterShare() {
  const qc = useQueryClient();
  return (projectId: string) => {
    qc.invalidateQueries({ queryKey: NEXT_STEPS_KEY });
    qc.invalidateQueries({ queryKey: ["feed"] });
    qc.invalidateQueries({ queryKey: ["project", projectId] });
  };
}

/** Sharing one finished step as a progress post tied to it. */
function ShareStepSheet({ projectId, projectTitle, step, onClose, onNotice }: {
  projectId: string; projectTitle: string; step: { taskId: string; title: string }; onClose: () => void; onNotice?: (n: Notice) => void;
}) {
  const refresh = useRefreshAfterShare();
  const [content, setContent] = useState(`Just finished "${step.title}" on ${projectTitle}. `);
  const [asks, setAsks] = useState<string[]>([""]);
  const [error, setError] = useState<string | null>(null);
  const share = useMutation({
    mutationFn: () => api("/api/feed", {
      method: "POST",
      body: { postType: "project_update", projectId, content: content.trim(), asks: asks.filter((a) => a.trim()), pathTaskId: step.taskId },
    }),
    onSuccess: () => {
      onNotice?.({ text: "Shared — replies land in your notifications and your project's feedback inbox.", tone: "success" });
      refresh(projectId);
      onClose();
    },
    onError: (e) => setError(errText(e, "Couldn't share that.")),
  });
  return (
    <Sheet visible onClose={onClose} title="Share this step for feedback" subtitle="Post what you finished, with a question or two. Feedback on it comes back to you.">
      <TextInput value={content} onChangeText={setContent} multiline style={[s.input, { minHeight: 96 }]} textAlignVertical="top" testID="input-share-step-content" />
      {asks.map((a, i) => (
        <TextInput
          key={i}
          value={a}
          onChangeText={(v) => setAsks((prev) => prev.map((x, j) => (j === i ? v : x)))}
          placeholder={i === 0 ? "What do you want feedback on? e.g. Is this pricing clear?" : "Another question"}
          placeholderTextColor={colors.textTertiary}
          style={s.input}
        />
      ))}
      {asks.length < MAX_ASKS && <Text style={s.addAsk} onPress={() => setAsks((p) => [...p, ""])}>+ Another question</Text>}
      {error && <Text style={s.error}>{error}</Text>}
      <View style={s.footer}>
        <Btn label="Not now" variant="ghost" small onPress={onClose} />
        <Btn label="Share" icon="share-social-outline" small disabled={!content.trim()} loading={share.isPending} onPress={() => share.mutate()} />
      </View>
    </Sheet>
  );
}

/** The weekly progress update: everything finished on the path this week, ticked, with a question. */
function WeeklyUpdateSheet({ projectId, projectTitle, steps, onClose, onNotice }: {
  projectId: string; projectTitle: string; steps: { taskId: string; title: string }[]; onClose: () => void; onNotice?: (n: Notice) => void;
}) {
  const refresh = useRefreshAfterShare();
  const [picked, setPicked] = useState<string[]>(steps.map((st) => st.taskId));
  const [content, setContent] = useState(`This week on ${projectTitle}:\n${steps.map((st) => `- ${st.title}`).join("\n")}\n\n`);
  const [ask, setAsk] = useState("");
  const [error, setError] = useState<string | null>(null);
  const post = useMutation({
    mutationFn: () => api("/api/feed", {
      method: "POST",
      body: { postType: "project_update", projectId, content: content.trim(), asks: ask.trim() ? [ask.trim()] : [], pathStepIds: picked },
    }),
    onSuccess: () => {
      onNotice?.({ text: "Weekly update posted — replies land in your notifications.", tone: "success" });
      refresh(projectId);
      onClose();
    },
    onError: (e) => setError(errText(e, "Couldn't post that.")),
  });
  return (
    <Sheet visible onClose={onClose} title="This week's progress" subtitle="What you finished on the path, ready to post. Ask something specific and the feedback comes back to you.">
      <View style={{ gap: 6 }}>
        {steps.map((st) => {
          const on = picked.includes(st.taskId);
          return (
            <Pressable
              key={st.taskId}
              onPress={() => setPicked((p) => (on ? p.filter((x) => x !== st.taskId) : [...p, st.taskId]))}
              style={s.check}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <Ionicons name={on ? "checkbox" : "square-outline"} size={18} color={on ? colors.primary : colors.textTertiary} />
              <Text style={s.checkText}>{st.title}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput value={content} onChangeText={setContent} multiline style={[s.input, { minHeight: 110 }]} textAlignVertical="top" />
      <TextInput value={ask} onChangeText={setAsk} placeholder="What do you want feedback on this week?" placeholderTextColor={colors.textTertiary} style={s.input} />
      {error && <Text style={s.error}>{error}</Text>}
      <View style={s.footer}>
        <Btn label="Not now" variant="ghost" small onPress={onClose} />
        <Btn label="Post update" icon="share-social-outline" small disabled={!content.trim() || !picked.length} loading={post.isPending} onPress={() => post.mutate()} />
      </View>
    </Sheet>
  );
}

const s = StyleSheet.create({
  head: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderColor: colors.borderSubtle,
  },
  headText: { color: colors.primary, fontSize: 11, fontFamily: fontFamily.semibold, letterSpacing: 0.5 },
  item: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  itemRule: { borderTopWidth: 1, borderColor: colors.borderSubtle },
  itemTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.semibold },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  badge: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { color: colors.primary, fontSize: 10, fontFamily: fontFamily.semibold },
  sub: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular },
  continue: {
    flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 6, backgroundColor: colors.primary,
  },
  continueText: { color: colors.primaryText, fontSize: font.sm, fontFamily: fontFamily.medium },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.primary },
  next: { color: colors.text, fontSize: font.sm + 1, lineHeight: 19, fontFamily: fontFamily.regular },
  nextMeta: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular },
  share: { flexDirection: "row", alignItems: "center", gap: 5 },
  shareText: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.regular, flexShrink: 1 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 9,
    color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.regular, backgroundColor: colors.surface,
  },
  addAsk: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.medium },
  error: { color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.regular },
  footer: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  check: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkText: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.regular, flexShrink: 1 },
});
