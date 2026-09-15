import { useState } from "react";
import { Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_URL, api, fetchMe } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Empty, Icon, Loading, errText, type IconName } from "../../src/components/ui";
import { Callout, Pill, TitledCard, humanize } from "../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";

/** shared/safety.ts SAFETY_CHECKLIST — restated; the server rejects a review missing any id. */
const CHECKLIST = [
  { id: "reports", label: "Open reports triaged", detail: "Nothing left open longer than 24 hours." },
  { id: "limits", label: "Rate-limit spikes looked at", detail: "A spike is a script, a raid, or a limit set too tight — decide which." },
  { id: "impact", label: "Impact of recent actions checked", detail: "Each action did what it was for, and nothing it wasn't." },
  { id: "loops", label: "Loop metrics checked for a drop", detail: "A takedown or switch shouldn't have cost the loop its people." },
  { id: "surfaces", label: "Switched-off surfaces reconsidered", detail: "Anything off still needs to be off." },
];
const IMPACT_WINDOW_HOURS = 24;

const ACTION_WORDS: Record<string, string> = {
  comment_remove: "Removed a comment", comment_shadow_hide: "Shadow-hid a comment", comment_ban: "Banned an author",
  comment_dismiss: "Dismissed a report", content_hidden: "Took content down", content_restored: "Restored content",
  suspend: "Suspended an account", reinstate: "Reinstated an account", surface_toggled: "Switched a surface",
};

const ALERT: Record<string, { icon: IconName; tone: "danger" | "warn" | "info" }> = {
  urgent: { icon: "alert-circle", tone: "danger" },
  warn: { icon: "warning", tone: "warn" },
  info: { icon: "information-circle", tone: "info" },
};

const hoursLabel = (h: number | null | undefined) => (h == null ? "—" : h < 1 ? "<1h" : h < 48 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`);

/**
 * The daily safety review, for reviewers and admins — the web's /admin/safety.
 * Every signal on one screen, what recent actions did, and the checklist that
 * records the pass. The deeper admin tools stay on the web and are linked.
 */
export default function AdminSafety() {
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  const { data: me, isLoading: meLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const isReviewer = ["reviewer", "admin"].includes(me?.user?.platformRole);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["safety-review"],
    queryFn: () => api<any>("/api/admin/safety/review"),
    enabled: isReviewer,
    refetchOnMount: "always",
  });

  const complete = useMutation({
    mutationFn: () => api("/api/admin/safety/review", { method: "POST", body: { checked: Array.from(checked), note: note.trim() || undefined } }),
    onSuccess: () => {
      setChecked(new Set()); setNote("");
      qc.invalidateQueries({ queryKey: ["safety-review"] });
      qc.invalidateQueries({ queryKey: ["safety-status"] });
      show({ tone: "success", text: "Review recorded. The next one picks up from here." });
    },
    onError: (e) => show({ tone: "error", text: errText(e, "Couldn't record the review.") }),
  });

  if (meLoading) return <Loading />;
  if (!isReviewer) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Safety review" }} />
        <Empty icon="lock-closed-outline" title="Reviewers only" body="This page is for SparkTower's reviewers and admins." />
      </View>
    );
  }

  const web = (path: string) => Linking.openURL(`${API_URL}${path}`);

  return (
    <>
      <Stack.Screen options={{ title: "Safety review" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 }}>
        <View style={{ gap: 4, paddingHorizontal: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="shield-checkmark" size={22} color={colors.primary} />
            <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>Daily safety review</Text>
          </View>
          <Text style={meta}>
            Reports, rate limits and loop health together, what recent actions did, and a checklist that records the pass.
            {data ? (data.lastReview
              ? ` Covering the last ${hoursLabel(data.windowHours)} — since ${data.lastReview.by ?? "someone"}'s review ${hoursLabel(data.lastReview.hoursAgo)} ago.`
              : ` Covering the last ${hoursLabel(data.windowHours)}. No review has been recorded yet.`) : ""}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {[["Reports queue", "/admin/reports"], ["Surfaces", "/admin/surfaces"], ["Loop metrics", "/admin/loop-metrics"], ["Analytics", "/admin/analytics"]].map(([l, p]) => (
              <Pressable key={p} onPress={() => web(p)} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>{l}</Text>
                <Icon name="open-outline" size={11} color={colors.primary} />
              </Pressable>
            ))}
          </View>
        </View>

        {isLoading ? <View style={{ height: 200 }}><Loading /></View>
          : isError || !data ? <Empty icon="cloud-offline-outline" title="Couldn't load the review" action="Try again" onAction={() => refetch()} />
          : (
            <>
              {data.alerts.length === 0
                ? <Callout tone="success" title="Nothing needs attention." />
                : data.alerts.map((a: any) => <Callout key={a.id} icon={ALERT[a.level]?.icon} tone={ALERT[a.level]?.tone ?? "info"} title={a.title} body={a.detail} />)}

              <TitledCard icon="flag" title="Reports" action={<Btn label="Open queue" small variant="ghost" onPress={() => web("/admin/reports")} />}>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <StatBox label="Open" value={data.reports.open} />
                  <StatBox label="Oldest open" value={hoursLabel(data.reports.oldestOpenHours)} />
                  <StatBox label="New" value={data.reports.newInWindow} delta={<Delta now={data.reports.newInWindow} before={data.reports.newBefore} />} />
                </View>
                {data.reports.byReason.length > 0 && (
                  <Text style={small}>Open by reason: {data.reports.byReason.map((r: any) => `${humanize(r.reason)} ${r.count}`).join(" · ")}</Text>
                )}
              </TitledCard>

              <TitledCard icon="pulse" title="Loop health (7 days)">
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <StatBox label="Posts, comments, messages" value={data.content.inWindow} delta={<Delta now={data.content.inWindow} before={data.content.before} goodWhen="up" />} />
                  <StatBox label="Check-ins posted" value={data.loops?.submitted ?? "—"} />
                </View>
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <StatBox label="Feedback within SLA" value={data.loops?.feedbackSlaPercent != null ? `${data.loops.feedbackSlaPercent}%` : "—"} />
                  <StatBox label="D7 retention" value={data.loops?.d7Percent != null ? `${data.loops.d7Percent}%` : "—"} />
                </View>
              </TitledCard>

              <TitledCard icon="speedometer" title="Rate limits">
                {data.limits.length === 0 ? <Text style={meta}>No one has been refused in this window or the one before.</Text>
                  : data.limits.map((l: any) => (
                    <View key={l.action} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
                      <View style={{ flex: 1 }}>
                        <Text style={[body, { fontFamily: fontFamily.semibold }]}>{l.action}</Text>
                        {l.rule ? <Text style={small}>{l.rule}</Text> : null}
                        <Text style={small}>Before: {l.refusedBefore} · Allowed (24h): {l.allowedLast24h ?? "—"}</Text>
                      </View>
                      <Text style={[body, { fontFamily: fontFamily.bold }]}>{l.refused}</Text>
                      {l.spike && <Pill label="Spike" color={colors.danger} solid />}
                    </View>
                  ))}
              </TitledCard>

              <TitledCard icon="analytics" title="What recent actions did">
                {data.actions.length === 0 ? <Text style={meta}>No moderation actions in the last 7 days.</Text>
                  : data.actions.map((a: any) => (
                    <View key={a.logId} style={{ borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 6 }}>
                      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
                        <View style={{ flex: 1 }}>
                          <Text style={[body, { fontFamily: fontFamily.semibold }]}>{ACTION_WORDS[a.action] ?? humanize(a.action)}{a.targetType === "surface" && a.targetId ? ` · ${a.targetId}` : ""}</Text>
                          <Text style={small}>{a.actorName ?? "Someone"} · {hoursLabel(a.hoursSince)} ago{a.reasonCode ? ` · ${humanize(a.reasonCode)}` : ""}</Text>
                        </View>
                        <Pill label={a.status === "early" ? "Too early" : a.status === "watching" ? `Watching · ${hoursLabel(a.hoursSince)} in` : "Settled"} color={a.status === "settled" ? colors.textSecondary : colors.info} />
                      </View>
                      {a.headline ? <Text style={body}>{a.headline}</Text> : null}
                      {a.status !== "early" && a.metrics.map((m: any) => (
                        <View key={m.key} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[small, { flex: 1, color: colors.textSecondary }]}>{m.label}</Text>
                          <Text style={small}>{m.before} → {m.afterPace}{m.afterHours < IMPACT_WINDOW_HOURS ? ` (${m.after} so far)` : ""}</Text>
                          <Delta now={m.afterPace} before={m.before} goodWhen={m.goodWhen} />
                        </View>
                      ))}
                    </View>
                  ))}
              </TitledCard>

              {data.surfacesOff.length > 0 && (
                <TitledCard icon="toggle" title="Switched off" action={<Btn label="Surfaces" small variant="ghost" onPress={() => web("/admin/surfaces")} />}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {data.surfacesOff.map((s: any) => <Pill key={s.id} label={s.label} color={colors.textSecondary} />)}
                  </View>
                </TitledCard>
              )}

              <TitledCard icon="checkmark-done" title="Complete today's review" style={{ borderColor: colors.primary }}>
                {data.lastReview && (
                  <Text style={small}>Last: {data.lastReview.by ?? "Someone"}, {hoursLabel(data.lastReview.hoursAgo)} ago{data.lastReview.note ? ` — "${data.lastReview.note}"` : ""}</Text>
                )}
                {CHECKLIST.map((item) => {
                  const on = checked.has(item.id);
                  return (
                    <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                      onPress={() => setChecked((prev) => { const next = new Set(prev); if (on) next.delete(item.id); else next.add(item.id); return next; })}
                      style={{ flexDirection: "row", gap: spacing.sm, paddingVertical: 4 }}>
                      <Icon name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.primary : colors.textTertiary} />
                      <View style={{ flex: 1 }}>
                        <Text style={[body, { fontFamily: fontFamily.semibold }]}>{item.label}</Text>
                        <Text style={small}>{item.detail}</Text>
                      </View>
                    </Pressable>
                  );
                })}
                <TextInput value={note} onChangeText={setNote} multiline placeholder="Anything the next reviewer should know (optional)" placeholderTextColor={colors.textTertiary}
                  style={{ minHeight: 60, textAlignVertical: "top", backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular }} />
                <Btn label="Complete review" icon="checkmark" disabled={checked.size < CHECKLIST.length} loading={complete.isPending} onPress={() => complete.mutate()} />
              </TitledCard>
            </>
          )}
      </ScrollView>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}

function StatBox({ label, value, delta }: { label: string; value: React.ReactNode; delta?: React.ReactNode }) {
  return (
    <View style={{ flex: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 2 }}>
      <Text style={small} numberOfLines={2}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>{value}</Text>
        {delta}
      </View>
    </View>
  );
}

function Delta({ now, before, goodWhen = "down" }: { now: number; before: number; goodWhen?: "down" | "up" | "either" }) {
  const diff = now - before;
  if (Math.abs(diff) < 0.5) return <Text style={small}>flat</Text>;
  const up = diff > 0;
  const good = goodWhen === "either" ? null : (goodWhen === "down") !== up;
  const color = good == null ? colors.textTertiary : good ? colors.success : colors.danger;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Icon name={up ? "arrow-up" : "arrow-down"} size={11} color={color} />
      <Text style={{ color, fontSize: font.xs, fontFamily: fontFamily.semibold }}>{up ? "+" : ""}{Math.round(diff * 10) / 10}</Text>
    </View>
  );
}

const body = { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular } as const;
const meta = { color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular } as const;
const small = { color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular } as const;
