import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../src/theme";
import { Avatar, Empty, Icon, NovaGradient, type IconName } from "../../src/components/ui";
import { Pill, tintSoft, useSurfaces } from "../../src/components/MoreKit";

/**
 * Games hub: the two games from the web's Games arena, each with its current
 * record. Free — no credits — and scores earn badges on your profile.
 */
const GAMES: { route: "/games/typing" | "/games/signal-noise"; icon: IconName; tint: string; name: string; blurb: string; tags: string[]; board: string }[] = [
  { route: "/games/typing", icon: "speedometer", tint: colors.success, name: "Velocity Type Arena", blurb: "Race others typing builder-focused prompts. Speed, accuracy, and execution under pressure.", tags: ["Multiplayer", "Speed"], board: "typing" },
  { route: "/games/signal-noise", icon: "radio", tint: colors.novaPurple, name: "Signal vs. Noise", blurb: "Sort cards into signal or noise under time pressure. Train prioritization and product thinking.", tags: ["Solo", "Decision-making"], board: "signal" },
];

function TopScore({ gameType }: { gameType: string }) {
  const { data } = useQuery({
    queryKey: ["game-leaderboard", gameType],
    queryFn: () => api<any[]>(`/api/games/leaderboard/${gameType}`),
  });
  const top = data?.[0];
  if (!top) return <Text style={small}>No scores yet — the record is yours to take.</Text>;
  const who = [top.user?.firstName, top.user?.lastName].filter(Boolean).join(" ") || "a builder";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name="trophy" size={13} color="#CA8A04" />
      <Avatar name={who} uri={top.user?.profileImageUrl} size={18} />
      <Text style={small} numberOfLines={1}>Best: {gameType === "typing" && top.metadata?.wpm ? `${top.metadata.wpm} wpm` : top.score} by {who}</Text>
    </View>
  );
}

export default function GamesHub() {
  const router = useRouter();
  const { on, loaded } = useSurfaces();
  const off = loaded && !on("games");

  return (
    <>
      <Stack.Screen options={{ title: "Games" }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 }}>
        <NovaGradient style={{ borderRadius: radius.lg, padding: spacing.lg, gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Icon name="game-controller" size={24} color="#FFFFFF" />
            <Text style={{ color: "#FFFFFF", fontSize: font.xl, fontFamily: fontFamily.bold }}>Games arena</Text>
          </View>
          <Text style={{ color: "rgba(255,255,255,0.95)", fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            Short, competitive, and free — no credits. Scores land on the game leaderboards and earn badges on your profile.
          </Text>
        </NovaGradient>

        {off ? (
          <Empty icon="pause-circle-outline" title="Games are switched off" body="They're paused on SparkTower right now. Check back soon." />
        ) : GAMES.map((g) => (
          <Pressable key={g.route} onPress={() => router.push(g.route)}
            style={({ pressed }) => [{ backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, ...shadow.card }, pressed && { opacity: 0.85 }]}>
            <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
              <View style={{ width: 48, height: 48, borderRadius: 12, backgroundColor: tintSoft(g.tint), alignItems: "center", justifyContent: "center" }}>
                <Icon name={g.icon} size={24} color={g.tint} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{g.name}</Text>
                <View style={{ flexDirection: "row", gap: 4 }}>{g.tags.map((t) => <Pill key={t} label={t} color={colors.textSecondary} />)}</View>
              </View>
              <Icon name="chevron-forward" size={18} color={colors.textTertiary} />
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{g.blurb}</Text>
            <TopScore gameType={g.board} />
          </Pressable>
        ))}
      </ScrollView>
    </>
  );
}

const small = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, flexShrink: 1 } as const;
