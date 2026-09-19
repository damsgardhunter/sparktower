/**
 * The leaderboards, on a phone.
 *
 * Six of them — an overall, plus one per dimension — and the reason there are
 * six rather than one is the whole point: a pair who built something reckless
 * and enormous and a pair who built something small and certain should each
 * find a board they are near the top of. One ranking tells most people they
 * came 40th and gives them nothing to come back for.
 */
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Chip, Empty, Loading, Screen, TAB_BAR_SPACE } from "../../src/components/ui";
import { money, ordinal } from "../../src/components/game/model";

export default function GameBoards() {
  const router = useRouter();
  const [board, setBoard] = useState("overall");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["game-boards", board],
    queryFn: () => api<any>(`/api/games/leaderboard?board=${board}`),
  });

  if (isLoading) return <Loading />;

  const boards = data?.boards ?? [];
  const standings = data?.standings ?? [];
  const current = boards.find((b: any) => b.id === board);

  return (
    <Screen canvas>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: TAB_BAR_SPACE, gap: spacing.lg }}>
        <View>
          <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>Leaderboards</Text>
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, marginTop: 2 }}>
            Every company anyone has built, scored out of a thousand.
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {boards.map((b: any) => (
            <Chip
              key={b.id}
              label={b.title}
              active={b.id === board}
              onPress={() => setBoard(b.id)}
            />
          ))}
        </ScrollView>

        {current?.blurb ? (
          <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>{current.blurb}</Text>
        ) : null}

        {standings.length === 0 ? (
          <Empty
            icon="trophy-outline"
            title="Nobody has finished a game yet"
            body="Be the first."
            action="Play now"
            onAction={() => router.replace("/(tabs)/sprints")}
          />
        ) : (
          <View style={{ gap: spacing.sm }} testID="standings">
            {standings.map((s: any) => (
              <View
                key={`${s.rank}-${s.name}`}
                style={{
                  flexDirection: "row", alignItems: "center", gap: spacing.md,
                  borderWidth: 1,
                  // Your own game, found without scrolling for it.
                  borderColor: s.isYours ? colors.primary : colors.border,
                  backgroundColor: s.isYours ? colors.primarySoft : colors.surface,
                  borderRadius: radius.lg, padding: spacing.lg,
                }}
              >
                <Text style={{
                  width: 42, textAlign: "center",
                  color: s.rank <= 3 ? colors.primary : colors.textTertiary,
                  fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"],
                }}>
                  {ordinal(s.rank)}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.medium }}>
                    {s.name}
                  </Text>
                  {/* A bot says so here too, as it does everywhere else. */}
                  <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: font.xs }}>
                    {s.players.map((p: any) => `${p.name}${p.isBot ? " (Bot)" : ""}`).join(" & ")}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
                    {s.score}
                  </Text>
                  <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontVariant: ["tabular-nums"] }}>
                    {money(s.tenYear)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
