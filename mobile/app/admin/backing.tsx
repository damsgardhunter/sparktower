import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Empty, Icon, Loading, Screen, errText } from "../../src/components/ui";
import { Callout, PageIntro, Pill, TitledCard } from "../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";
import {
  ConfirmSheet, NotFoundScreen, StatBox, StatGrid, gateView, blockedView, isNotFound, money, text, useReviewer,
} from "../../src/components/more/AdminKit";

/** shared/backing.ts, restated. */
const PLATFORM_FEE_PERCENT = 10;
const creatorPayoutCents = (cents: number) => cents - Math.round(cents * (PLATFORM_FEE_PERCENT / 100));

interface QueueRow {
  projectId: string;
  projectTitle: string;
  ownerId: string;
  reviewStatus: "pending" | "approved" | "rejected" | "not_submitted";
  submittedForReviewAt: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  heldCents: number;
  heldBackers: number;
}

interface Signals {
  project: { id: string; title: string; createdAt: string };
  owner: { id: string; email: string | null; createdAt: string } | null;
  codeAudit: { completionPercent: number | null; stage: string | null; source: string; createdAt: string } | null;
  completedTasks: number;
  profileCompleteness: number;
  hasRepoUrl: boolean;
  hasLiveUrl: boolean;
  memberCount: number;
  stripeAccount: { detailsSubmitted: boolean; chargesEnabled: boolean; payoutsEnabled: boolean } | null;
  backers: number;
  heldCents: number;
  releasedCents: number;
}

const STATUS_COLOR: Record<string, string> = {
  pending: colors.warning, approved: colors.success, rejected: colors.danger,
};

/**
 * The payout console — the web's /admin/backing. The queue first; tapping a
 * project shows its evidence and the decision. Approving and releasing stay
 * two separate actions, and releasing asks once more.
 */
export default function BackingReview() {
  const qc = useQueryClient();
  const router = useRouter();
  const { notice, show, clear } = useNotice();
  const { loading, isReviewer } = useReviewer();
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [confirmRelease, setConfirmRelease] = useState(false);

  const { data: queue, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["admin-backing-queue"],
    queryFn: () => api<QueueRow[]>("/api/admin/backing/queue"),
    enabled: isReviewer,
    retry: false,
  });

  const { data: signals, isLoading: signalsLoading, error: signalsError } = useQuery({
    queryKey: ["admin-backing-signals", selected],
    queryFn: () => api<Signals>(`/api/admin/backing/${selected}/signals`),
    enabled: !!selected && isReviewer,
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-backing-queue"] });
    qc.invalidateQueries({ queryKey: ["admin-backing-signals", selected] });
  };

  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      api<{ merchWaiting?: number }>(`/api/admin/backing/${selected}/decision`, { method: "POST", body: { decision, notes } }),
    onSuccess: (result) => {
      show({ tone: "success", text: result?.merchWaiting ? `Decision recorded. ${result.merchWaiting} merch order(s) now clear to ship.` : "Decision recorded" });
      setNotes("");
      refresh();
    },
    onError: (e) => show({ tone: "error", text: `Couldn't record that. ${errText(e, "Try again.")}` }),
  });

  const release = useMutation({
    mutationFn: () => api<{ released: number; totalCents: number; failed?: { id: string }[] }>(`/api/admin/backing/${selected}/release`, { method: "POST" }),
    onSuccess: (result) => {
      setConfirmRelease(false);
      const failed = result.failed?.length ?? 0;
      show({
        tone: failed ? "error" : "success",
        text: `Released ${result.released} pledge(s). ${money(result.totalCents)} sent.${failed ? ` ${failed} failed — check the logs.` : ""}`,
      });
      refresh();
    },
    onError: (e) => { setConfirmRelease(false); show({ tone: "error", text: `Couldn't release funds. ${errText(e, "Try again.")}` }); },
  });

  const gate = gateView("Payout review", loading, isReviewer);
  if (gate) return gate;
  // Same answer the API gives a non-reviewer: this page does not exist.
  // Locked behind a second factor, or simply not this account's page (src/components/more/AdminKit.tsx).
  const blocked = blockedView("Payout review", error);
  if (blocked) return blocked;

  const current = queue?.find((q) => q.projectId === selected);

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Stack.Screen options={{ title: "Payout review" }} />
      <Screen canvas onRefresh={() => refetch()} refreshing={isRefetching}>
        <PageIntro
          icon="shield-checkmark"
          title="Payout review"
          body={`Backer money sits with SparkTower until you approve the project behind it. SparkTower keeps ${PLATFORM_FEE_PERCENT}% of every released pledge.`}
        />

        {!selected ? (
          <TitledCard title="Queue">
            {isLoading ? <View style={{ height: 120 }}><Loading /></View>
              : error ? <Empty icon="cloud-offline-outline" title="Couldn't load the queue" body={errText(error)} action="Try again" onAction={() => refetch()} />
              : !queue?.length ? <Text style={[text.meta, { textAlign: "center", paddingVertical: spacing.lg }]}>Nothing submitted yet.</Text>
              : (
                <>
                  <Text style={text.small}>Pick a project to review.</Text>
                  {queue.map((row) => (
                    <Pressable
                      key={row.projectId}
                      onPress={() => { setSelected(row.projectId); setNotes(""); }}
                      style={({ pressed }) => [{ borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, gap: 2 }, pressed && { opacity: 0.7 }]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                        <Text style={[text.strong, { flex: 1 }]}>{row.projectTitle}</Text>
                        <Pill label={row.reviewStatus} color={STATUS_COLOR[row.reviewStatus] ?? colors.textSecondary} />
                        <Icon name="chevron-forward" size={16} color={colors.textTertiary} />
                      </View>
                      {row.heldCents > 0 ? <Text style={text.small}>{money(row.heldCents)} held · {row.heldBackers} backer(s)</Text> : null}
                    </Pressable>
                  ))}
                </>
              )}
          </TitledCard>
        ) : (
          <>
            <Btn label="Back to the queue" icon="chevron-back" small variant="ghost" onPress={() => setSelected(null)} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
            {signalsError ? (
              <Empty icon="cloud-offline-outline" title="Couldn't load this project" body={errText(signalsError)} />
            ) : signalsLoading || !signals ? (
              <View style={{ height: 200 }}><Loading /></View>
            ) : (
              <>
                <TitledCard
                  title={signals.project.title}
                  action={<Btn label="Open project" icon="open-outline" small variant="outline" onPress={() => router.push(`/project/${signals.project.id}` as any)} />}
                >
                  {current ? <Pill label={current.reviewStatus} color={STATUS_COLOR[current.reviewStatus] ?? colors.textSecondary} /> : null}
                  <StatGrid>
                    <StatBox label="Backers" value={String(signals.backers)} />
                    <StatBox label="Held" value={money(signals.heldCents)} />
                    <StatBox label="Released" value={money(signals.releasedCents)} />
                    <StatBox label="Team" value={String(signals.memberCount)} />
                  </StatGrid>

                  <Text style={[text.over, { marginTop: spacing.sm }]}>Evidence</Text>
                  {evidence(signals).map((s) => (
                    <View key={s.label} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
                      <Icon name={s.ok ? "checkmark-circle" : "warning"} size={17} color={s.ok ? colors.success : colors.warning} />
                      <Text style={[text.body, { flex: 1 }]}>
                        <Text style={{ fontFamily: fontFamily.semibold }}>{s.label}</Text>
                        <Text style={{ color: colors.textTertiary, fontSize: font.xs }}> · {s.detail}</Text>
                      </Text>
                    </View>
                  ))}
                  <Text style={text.small}>
                    Signals only. A three-week-old project failing four of these can be completely legitimate — read the project, not the checkmarks.
                  </Text>
                </TitledCard>

                <TitledCard title="Decision">
                  {current?.reviewNotes ? <Text style={text.small}>Last note: {current.reviewNotes}</Text> : null}
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    maxLength={2000}
                    placeholder="What you want the creator to read. If you're rejecting, say what would change your mind."
                    placeholderTextColor={colors.textTertiary}
                    style={{
                      minHeight: 80, textAlignVertical: "top", backgroundColor: colors.surfaceRaised, borderRadius: radius.sm,
                      borderWidth: 1, borderColor: colors.border, padding: spacing.sm, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
                    }}
                  />
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                    <Btn
                      label="Approve for payouts"
                      icon="checkmark-circle"
                      small
                      loading={decide.isPending && decide.variables === "approved"}
                      disabled={decide.isPending || current?.reviewStatus === "approved"}
                      onPress={() => decide.mutate("approved")}
                    />
                    <Btn
                      label="Reject"
                      icon="close-circle-outline"
                      small
                      variant="outline"
                      loading={decide.isPending && decide.variables === "rejected"}
                      disabled={decide.isPending}
                      onPress={() => decide.mutate("rejected")}
                    />
                  </View>

                  {current?.reviewStatus === "approved" ? (
                    <Callout icon="cash-outline" body={`Releases ${money(signals.heldCents)} held across ${signals.backers} pledge(s). The creator receives ${money(creatorPayoutCents(signals.heldCents))} after the ${PLATFORM_FEE_PERCENT}% fee. Each pledge transfers separately, so one failure doesn't take the batch with it.`}>
                      <Btn
                        label={`Release ${money(signals.heldCents)}`}
                        icon="cash"
                        small
                        disabled={release.isPending || signals.heldCents === 0}
                        onPress={() => setConfirmRelease(true)}
                        style={{ alignSelf: "flex-start", marginTop: spacing.sm }}
                      />
                    </Callout>
                  ) : null}

                  {current?.submittedForReviewAt ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Icon name="time-outline" size={12} color={colors.textTertiary} />
                      <Text style={text.small}>Submitted {new Date(current.submittedForReviewAt).toLocaleString()}</Text>
                    </View>
                  ) : null}
                </TitledCard>
              </>
            )}
          </>
        )}
      </Screen>

      <ConfirmSheet
        visible={confirmRelease && !!signals}
        onClose={() => setConfirmRelease(false)}
        title={`Release ${signals ? money(signals.heldCents) : ""}?`}
        body={signals ? `Sends ${money(creatorPayoutCents(signals.heldCents))} to ${signals.project.title}'s creator across ${signals.backers} pledge(s). This can't be undone from here.` : undefined}
        confirmLabel="Release funds"
        loading={release.isPending}
        onConfirm={() => release.mutate()}
      />
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

function evidence(s: Signals) {
  return [
    {
      label: "Codebase audit",
      ok: (s.codeAudit?.completionPercent ?? 0) > 0,
      detail: s.codeAudit ? `${s.codeAudit.completionPercent ?? "?"}% · ${s.codeAudit.stage || "no stage"} · ${s.codeAudit.source}` : "Never run",
    },
    { label: "Tasks finished", ok: s.completedTasks > 0, detail: `${s.completedTasks} completed` },
    { label: "Owner profile", ok: s.profileCompleteness >= 80, detail: `${s.profileCompleteness}% filled in` },
    {
      label: "Something to show",
      ok: s.hasRepoUrl || s.hasLiveUrl,
      detail: [s.hasRepoUrl && "repo", s.hasLiveUrl && "live URL"].filter(Boolean).join(" + ") || "neither",
    },
    {
      label: "Stripe identity",
      ok: Boolean(s.stripeAccount?.payoutsEnabled),
      detail: s.stripeAccount
        ? [s.stripeAccount.detailsSubmitted && "details submitted", s.stripeAccount.chargesEnabled && "charges on", s.stripeAccount.payoutsEnabled && "payouts on"]
          .filter(Boolean).join(", ") || "onboarding incomplete"
        : "no connected account",
    },
    {
      label: "Account age",
      ok: true,
      detail: s.owner?.createdAt ? `owner joined ${new Date(s.owner.createdAt).toLocaleDateString()}` : "unknown",
    },
  ];
}
