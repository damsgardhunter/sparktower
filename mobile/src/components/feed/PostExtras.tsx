/**
 * What the website's post page (client/src/pages/post-detail.tsx) shows around
 * the post: the team's next step on a post shared from the path, and everyone
 * who reacted, by reaction.
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Avatar } from "../ui";
import { ReactionBadge } from "../FeedParts";
import { REACTIONS, type Reaction } from "../feedModel";
import { Box, primaryTint } from "./Box";

/** The project's next step, for someone on its team reading feedback on a shared step. */
export function NextStepLink({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["project", projectId, "path"],
    queryFn: () => api<{ adopted?: boolean; next?: { title: string; step?: { title: string } | null } | null }>(`/api/projects/${projectId}/path`),
  });
  if (!data?.adopted) return null;
  return (
    <Pressable
      onPress={() => router.push(`/manage/${projectId}` as any)}
      style={({ pressed }) => [s.next, pressed && { backgroundColor: primaryTint(0.1) }]}
      testID="post-next-step"
    >
      <Ionicons name="compass-outline" size={16} color={colors.primary} />
      <Text style={s.nextText} numberOfLines={1}>
        {data.next
          ? <>Your next step: <Text style={{ fontFamily: fontFamily.medium }}>{data.next.step?.title ?? data.next.title}</Text></>
          : "Back to your path"}
      </Text>
      <Text style={s.nextLink}>Continue</Text>
      <Ionicons name="arrow-forward" size={12} color={colors.primary} />
    </Pressable>
  );
}

interface Reactor { userId: string; reaction: Reaction; name: string; headline: string | null; avatarUrl: string | null }

/** The interactions: everyone who reacted, with a tab per reaction. */
export function ReactionsBox({ postId }: { postId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Reaction | "all">("all");
  const { data: reactors } = useQuery({
    queryKey: ["post", postId, "reactions"],
    queryFn: () => api<Reactor[]>(`/api/feed/${postId}/reactions`),
  });
  const shown = (reactors ?? []).filter((r) => tab === "all" || r.reaction === tab);
  const counts = REACTIONS.map((r) => ({ ...r, count: (reactors ?? []).filter((x) => x.reaction === r.reaction).length })).filter((r) => r.count > 0);

  return (
    <Box padded={false} testID="post-reactions">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabs} contentContainerStyle={s.tabsInner}>
        <Pressable onPress={() => setTab("all")} style={[s.tab, tab === "all" && s.tabOn]} testID="reactions-tab-all">
          <Text style={[s.tabText, tab === "all" && s.tabTextOn]}>All {reactors?.length ?? 0}</Text>
        </Pressable>
        {counts.map((r) => (
          <Pressable key={r.reaction} onPress={() => setTab(r.reaction)} style={[s.tab, tab === r.reaction && s.tabOn]} testID={`reactions-tab-${r.reaction}`}>
            <Text style={[s.tabText, tab === r.reaction && s.tabTextOn]}>{r.emoji} {r.count}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {!reactors?.length ? (
        <Text style={s.none}>No reactions yet.</Text>
      ) : (
        shown.map((r, i) => (
          <Pressable
            key={r.userId}
            onPress={() => router.push(`/user/${r.userId}` as any)}
            style={({ pressed }) => [s.row, i > 0 && s.rowRule, pressed && { backgroundColor: colors.surfaceRaised }]}
            testID={`reactor-${r.userId}`}
          >
            <View>
              <Avatar name={r.name} uri={r.avatarUrl} size={36} />
              <View style={s.badge}><ReactionBadge reaction={r.reaction} size={16} /></View>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.name} numberOfLines={1}>{r.name}</Text>
              {r.headline ? <Text style={s.headline} numberOfLines={1}>{r.headline}</Text> : null}
            </View>
          </Pressable>
        ))
      )}
    </Box>
  );
}

const s = StyleSheet.create({
  next: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.sm,
    borderRadius: 8, borderWidth: 1, borderColor: primaryTint(0.3), backgroundColor: primaryTint(0.05),
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  nextText: { flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular },
  nextLink: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.regular },
  tabs: { flexGrow: 0, borderBottomWidth: 1, borderColor: colors.borderSubtle },
  tabsInner: { gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  tab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  tabOn: { backgroundColor: primaryTint(0.1) },
  tabText: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular },
  tabTextOn: { color: colors.primary, fontFamily: fontFamily.medium },
  none: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  rowRule: { borderTopWidth: 1, borderColor: colors.borderSubtle },
  badge: { position: "absolute", right: -4, bottom: -4 },
  name: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.medium },
  headline: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular },
});
