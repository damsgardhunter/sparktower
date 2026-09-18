import { useEffect, useRef } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/auth/AuthContext";
import { colors, font, fontFamily, spacing } from "../../src/theme";
import { Avatar, Btn, Card, Empty, Icon, Loading, Screen, timeAgo } from "../../src/components/ui";
import { Callout, Group, MenuRow, PageIntro, Pill, Stat, humanize, isSwitchedOff, tintSoft } from "../../src/components/MoreKit";
import { PHASE_COLORS, PHASE_LABELS, formatWait, styleLabel } from "../../src/components/SprintKit";
import { NoticeBanner, useNotice } from "../../src/components/Sheet";

/**
 * Co-founder sprints: the matchmaking waiting room, your active and finished
 * sprints, and the ways in — a real sprint or a practice run with Nova.
 */
export default function Sprints() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { notice, show, clear } = useNotice();

  const { data: sprints, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ["sprints"],
    queryFn: () => api<any[]>("/api/sprints"),
  });

  // Polling doubles as the heartbeat that keeps the queue row alive.
  const { data: queue } = useQuery({
    queryKey: ["sprint-queue"],
    queryFn: () => api<any>("/api/sprints/queue/status"),
    refetchInterval: 5_000,
  });

  const leave = useMutation({
    mutationFn: () => api("/api/sprints/queue", { method: "DELETE" }),
    onSuccess: () => {
      show({ tone: "info", text: "Left the queue. You've been removed from matchmaking." });
      qc.invalidateQueries({ queryKey: ["sprint-queue"] });
    },
    onError: (e: any) => show({ tone: "error", text: e?.message || "Couldn't leave the queue." }),
  });

  // A match made by the other side arrives on our next poll — follow it once.
  const handled = useRef(false);
  useEffect(() => {
    if (queue?.matched && queue.sprint && !handled.current) {
      handled.current = true;
      qc.invalidateQueries({ queryKey: ["sprints"] });
      router.push(`/sprint/${queue.sprint.id}`);
    }
  }, [queue?.matched, queue?.sprint?.id]);

  if (isLoading) return <Loading />;
  if (error && isSwitchedOff(error)) {
    return <Screen canvas><Empty icon="pause-circle-outline" title="Sprints are paused" body="Sprints are switched off right now. Check back soon." /></Screen>;
  }

  const active = (sprints ?? []).filter((s) => s.status !== "completed");
  const done = (sprints ?? []).filter((s) => s.status === "completed");
  const waiting = queue?.inQueue && queue.entry;

  return (
    <View style={{ flex: 1 }}>
      <Screen canvas onRefresh={refetch} refreshing={isRefetching}>
        <Card>
          <PageIntro icon="people" title="Co-Founder Sprints" body="Trial collaborations to find your co-founder — 24 or 72 hours, with a stranger or with Nova." />
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs }}>
            <Btn label="New sprint" icon="add" style={{ flex: 1 }} onPress={() => router.push("/sprint/new")} />
            <Btn label="Practice" icon="school-outline" variant="outline" style={{ flex: 1 }} onPress={() => router.push("/sprint/practice")} />
          </View>
        </Card>

        {/* The market simulation. Its own thing rather than a sprint — five
            strangers and a fortnight, not two people and a weekend — but this
            is the tab people come to when they want to build with strangers,
            so it is the honest place to reach it from. */}
        <Group>
          <MenuRow
            icon="trending-up"
            title="Market simulation"
            subtitle="Five strangers, one company, fourteen years"
            tint={colors.novaEmerald}
            onPress={() => router.push("/sim")}
            testID="sprints-market-simulation"
          />
        </Group>

        {waiting && (
          <Card style={{ borderColor: tintSoft(colors.primary, 0.4), backgroundColor: "#FCF8FE" }}>
            <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator color={colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.bold }}>Looking for a partner…</Text>
                <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, fontFamily: fontFamily.regular }}>
                  You'll be paired with the next builder who picks a {queue.entry.duration} sprint. Keep the app open — we check every few seconds.
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" }}>
              <Pill label={queue.entry.duration} icon="time-outline" />
              {queue.entry.productStyle ? <Pill label={styleLabel(queue.entry.productStyle)} color={colors.info} /> : null}
            </View>
            <View style={{ flexDirection: "row", borderTopWidth: 1, borderColor: tintSoft(colors.primary, 0.25), marginTop: spacing.xs }}>
              <Stat value={queue.position ? `#${queue.position}` : "—"} label="Your place" />
              <Stat value={queue.waiting ?? 0} label="Builders waiting" />
              <Stat value={formatWait(queue.waitingSeconds ?? 0)} label="Waiting for" />
            </View>
            {(queue.waiting ?? 0) <= 1 && (queue.waitingSeconds ?? 0) > 30 && (
              <Callout icon="chatbubble-ellipses-outline" body="Quiet in here right now. Practise with Nova instead — your place in line is kept.">
                <Btn label="Practice with Nova" icon="sparkles" small variant="outline" style={{ alignSelf: "flex-start", marginTop: 6 }} onPress={() => router.push("/sprint/practice")} />
              </Callout>
            )}
            <Btn label="Leave queue" icon="close-circle-outline" variant="ghost" small loading={leave.isPending} onPress={() => leave.mutate()} />
          </Card>
        )}

        {active.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <SectionTitle icon="time" title={`Active sprints (${active.length})`} />
            {active.map((s) => <SprintCard key={s.id} sprint={s} userId={user?.id} onPress={() => router.push(`/sprint/${s.id}`)} />)}
          </View>
        )}

        {done.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <SectionTitle icon="checkmark-circle" title={`Completed (${done.length})`} color={colors.textTertiary} />
            {done.map((s) => <SprintCard key={s.id} sprint={s} userId={user?.id} onPress={() => router.push(`/sprint/${s.id}`)} />)}
          </View>
        )}

        {!active.length && !done.length && !waiting && (
          <Card style={{ borderStyle: "dashed" }}>
            <Empty icon="people-outline" title="No sprints yet"
              body="Start a trial collaboration with a potential co-founder. Get randomly paired, or practise the whole thing with Nova first."
              action="Start your first sprint" onAction={() => router.push("/sprint/new")} />
          </Card>
        )}
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </View>
  );
}

function SectionTitle({ icon, title, color = colors.primary }: { icon: "time" | "checkmark-circle"; title: string; color?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
      <Icon name={icon} size={16} color={color} />
      <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{title}</Text>
    </View>
  );
}

function SprintCard({ sprint: s, userId, onPress }: { sprint: any; userId?: string; onPress: () => void }) {
  const partner = s.user1Id === userId ? s.user2 : s.user1;
  const completed = s.status === "completed";
  return (
    <Card onPress={onPress} style={completed ? { opacity: 0.85 } : undefined}>
      <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }} numberOfLines={1}>{s.productName || "Untitled sprint"}</Text>
          {s.productDescription ? <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 18, fontFamily: fontFamily.regular }} numberOfLines={2}>{s.productDescription}</Text> : null}
        </View>
        <Pill label={PHASE_LABELS[s.status] ?? humanize(s.status)} color={PHASE_COLORS[s.status] ?? colors.primary} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" }}>
        {s.isPractice ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="hardware-chip-outline" size={13} color={colors.primary} />
            </View>
            <Text style={meta}>Nova (AI)</Text>
          </View>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Avatar name={partner?.firstName || "Partner"} uri={partner?.profileImageUrl} size={22} />
            <Text style={meta}>{partner?.firstName || "Partner"}</Text>
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="timer-outline" size={14} color={colors.textTertiary} />
          <Text style={meta}>{s.duration}</Text>
        </View>
        {s.isPractice && <Pill label="Practice" color={colors.novaEmerald} />}
        {s.productStyle ? <Text style={meta}>{styleLabel(s.productStyle)}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={[meta, { fontSize: font.xs }]}>{completed ? `Finished ${timeAgo(s.completedAt || s.updatedAt || s.createdAt)}` : `Started ${timeAgo(s.createdAt)}`}</Text>
        {!completed && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Continue</Text>
            <Icon name="arrow-forward" size={14} color={colors.primary} />
          </View>
        )}
      </View>
    </Card>
  );
}

const meta = { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular } as const;
