import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../src/theme";
import { Avatar, Chip, Empty, Icon, Loading, NovaGradient, Row, Screen, timeAgo } from "../src/components/ui";
import { ConnectActions, useConnectionStates } from "../src/components/ConnectActions";
import { NoticeBanner, useNotice } from "../src/components/Sheet";
import { UpdateBadge, networkStyles } from "../src/components/NetworkCards";
import { EXPLORE, markSeen, openDiscover, trackExplore } from "../src/explore";
import { personAvatar, personName, useExploreUpdates } from "../src/networkData";

/**
 * All of Nova's matches, the counterpart of the web's Matches page: score,
 * why you matched, skills, and Connect or Message in place. "Find new matches"
 * runs the matcher — which is why it's a button and not a pull-to-refresh.
 */
export default function Matches() {
  const router = useRouter();
  const qc = useQueryClient();
  const { notice, show, clear } = useNotice();
  const matches = useQuery({ queryKey: ["matches"], queryFn: () => api<any[]>("/api/matches") });
  const rows = matches.data ?? [];
  const { data: connections } = useConnectionStates(rows.map((m) => m.matchedUserId));
  const { byKey } = useExploreUpdates();

  // Matches is an Explore surface too, as on the web.
  useFocusEffect(useCallback(() => { openDiscover(); }, []));

  const generate = useMutation({
    mutationFn: () => api<any[]>("/api/matches/generate", { method: "POST" }),
    onSuccess: (found) => {
      void qc.invalidateQueries({ queryKey: ["matches"] });
      show({ text: found?.length ? "Matches generated — here are builders who fit." : "No new matches right now.", tone: found?.length ? "success" : "info" });
    },
    onError: (error: any) => show({ text: error?.message || "Failed to generate matches.", tone: "error" }),
  });

  const open = (userId: string, rank: number) => {
    trackExplore(EXPLORE.openProfile, { matchType: "builder", targetId: userId, rankPosition: rank, source: "discover" });
    markSeen("builder", userId);
    router.push(`/user/${userId}`);
  };

  return (
    <>
      <Stack.Screen options={{ title: "Your matches" }} />
      <Screen canvas onRefresh={matches.refetch} refreshing={matches.isRefetching} contentStyle={{ padding: 0, gap: spacing.sm }}>
        <NovaGradient style={{ padding: spacing.lg, gap: spacing.sm }}>
          <Row center gap={spacing.sm}>
            <Icon name="sparkles" size={20} color="#FFFFFF" />
            <Text style={{ color: "#FFFFFF", fontSize: font.lg, fontFamily: fontFamily.bold }}>Collaborators picked by Nova</Text>
          </Row>
          <Text style={{ color: "#FFFFFFE6", fontSize: font.sm, fontFamily: fontFamily.regular, lineHeight: 19 }}>
            Based on your skills, interests and projects. Finding new matches can use 1 credit on paid plans.
          </Text>
          <Pressable
            onPress={() => generate.mutate()}
            disabled={generate.isPending}
            style={({ pressed }) => [{ alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 8, flexDirection: "row", gap: 6, alignItems: "center", marginTop: 4 }, (pressed || generate.isPending) && { opacity: 0.7 }]}
          >
            <Icon name="sparkles-outline" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: fontFamily.semibold, fontSize: font.sm }}>{generate.isPending ? "Finding…" : "Find new matches"}</Text>
          </Pressable>
        </NovaGradient>

        {matches.isLoading ? <Loading /> : !rows.length ? (
          <View style={{ backgroundColor: colors.surface }}>
            <Empty icon="person-add-outline" title="No matches yet" body="Let Nova find the best collaborators for your next project." action="Find my first match" onAction={() => generate.mutate()} />
          </View>
        ) : rows.map((m, i) => {
          const name = personName(m.matchedUser, m.matchedProfile);
          const p = m.matchedProfile ?? {};
          const reasons: string[] = (m.reasons ?? []).filter((r: string) => r && r.trim()).slice(0, 2);
          return (
            <View key={m.id} style={{ backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm }}>
              <Pressable onPress={() => open(m.matchedUserId, i + 1)} style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                <Avatar name={name} uri={personAvatar(m.matchedUser, p)} size={56} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Row between center>
                    <Text style={[networkStyles.rowTitle, { flex: 1 }]} numberOfLines={1}>{name}</Text>
                    <View style={{ backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.bold }}>{m.score}% match</Text>
                    </View>
                  </Row>
                  {p.username ? <Text style={networkStyles.meta}>@{p.username}</Text> : null}
                  {p.headline ? <Text style={networkStyles.rowSub} numberOfLines={2}>{p.headline}</Text> : null}
                  <Row center gap={spacing.sm}>
                    <Text style={networkStyles.meta}>Matched {timeAgo(m.createdAt)}</Text>
                    <UpdateBadge update={byKey.get(`builder:${m.matchedUserId}`)} />
                  </Row>
                </View>
              </Pressable>
              {p.bio ? <Text style={networkStyles.rowBody} numberOfLines={2}>{p.bio}</Text> : null}
              {reasons.length > 0 && (
                <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md, gap: 6 }}>
                  <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold }}>Why you matched</Text>
                  {reasons.map((r) => (
                    <Row key={r} gap={6}>
                      <Icon name="sparkles" size={12} color={colors.primary} />
                      <Text style={[networkStyles.rowSub, { flex: 1 }]}>{r}</Text>
                    </Row>
                  ))}
                </View>
              )}
              {(p.skills ?? []).length > 0 && (
                <Row wrap gap={spacing.xs}>
                  {(p.skills as string[]).slice(0, 5).map((s) => <Chip key={s} label={s} small />)}
                </Row>
              )}
              <Row center gap={spacing.sm} wrap>
                <ConnectActions userId={m.matchedUserId} name={name} reason={reasons[0]} headline={p.headline} connection={connections?.[m.matchedUserId]} notify={show} explore={{ source: "discover", rankPosition: i + 1 }} />
              </Row>
            </View>
          );
        })}
      </Screen>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
