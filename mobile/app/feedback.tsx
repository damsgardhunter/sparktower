import { Image, Pressable, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../src/theme";
import { Avatar, Btn, Empty, Icon, Loading, Screen, assetUri } from "../src/components/ui";
import { PageIntro, Pill, isSwitchedOff, weekLabel } from "../src/components/MoreKit";

/** Hours since posting, so the 24-hour promise is visible rather than implied. */
const hoursSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);

/**
 * Check-ins whose author asked for a read — the web's /feedback.
 *
 * Oldest first: the point is to clear the queue, and newest-first leaves the
 * people who've waited longest at the bottom.
 */
export default function FeedbackQueue() {
  const router = useRouter();
  const { data, isLoading, isRefetching, refetch, error } = useQuery({
    queryKey: ["needs-feedback"],
    queryFn: () => api<any[]>("/api/check-ins/queue/needs-feedback"),
  });

  const queue = [...(data ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const overdue = queue.filter((c) => hoursSince(c.createdAt) >= 24).length;

  return (
    <>
      <Stack.Screen options={{ title: "Needs feedback" }} />
      <Screen canvas onRefresh={refetch} refreshing={isRefetching}>
        <View style={{ paddingHorizontal: 2, gap: spacing.sm }}>
          <PageIntro icon="file-tray-full" title="Needs feedback"
            body="Builders who asked someone to read their week. One comment is enough — say what's working and what you'd push on." />
          {!isLoading && queue.length > 0 && (
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pill label={`${queue.length} waiting`} color={colors.textSecondary} />
              {overdue > 0 && <Pill label={`${overdue} over 24h`} icon="warning" color={colors.warning} solid />}
            </View>
          )}
        </View>

        {isLoading ? <View style={{ height: 200 }}><Loading /></View>
          : error ? (
            isSwitchedOff(error)
              ? <Empty icon="pause-circle-outline" title="Check-ins are paused" body="Weekly check-ins are switched off right now." />
              : <Empty icon="cloud-offline-outline" title="Couldn't load the queue" action="Try again" onAction={() => refetch()} />
          ) : queue.length === 0 ? (
            <View style={[card, { borderStyle: "dashed" }]}>
              <Empty icon="chatbubbles-outline" title="Queue is clear" body="Nobody is waiting on a read right now. Check back after the next round of check-ins." />
            </View>
          ) : queue.map((c) => {
            const hours = hoursSince(c.createdAt);
            const late = hours >= 24;
            const logo = assetUri(c.projectLogo);
            return (
              <Pressable key={c.id} onPress={() => router.push(`/check-in/${c.id}`)} style={({ pressed }) => [card, pressed && { opacity: 0.9 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  {logo
                    ? <Image source={{ uri: logo }} style={{ width: 36, height: 36, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border }} />
                    : <Avatar name={c.author?.name} uri={c.author?.avatarUrl} size={36} />}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }} numberOfLines={1}
                      onPress={() => router.push(`/project/${c.projectId}`)}>{c.projectTitle}</Text>
                    <Text style={small} numberOfLines={1}>{c.author?.name} · {weekLabel(c.weekStart)}</Text>
                  </View>
                  <Pill label={hours < 1 ? "just now" : hours < 24 ? `${hours}h waiting` : `${Math.floor(hours / 24)}d waiting`}
                    color={late ? colors.warning : colors.textSecondary} solid={late} />
                </View>

                <Text style={{ color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.semibold }}>{c.goal}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }} numberOfLines={3}>{c.proof}</Text>
                {c.blocker ? (
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Icon name="warning-outline" size={15} color={colors.warning} />
                    <Text style={{ flex: 1, color: colors.warning, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{c.blocker}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Icon name="arrow-forward" size={15} color={colors.primary} />
                  <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{c.nextStep}</Text>
                </View>
                <Btn label="Read and reply" icon="chatbubble-outline" small variant="outline" style={{ alignSelf: "flex-start" }} onPress={() => router.push(`/check-in/${c.id}`)} />
              </Pressable>
            );
          })}
      </Screen>
    </>
  );
}

const card = { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, ...shadow.card } as const;
const small = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular } as const;
