import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { spacing } from "../../src/theme";
import { Body, Card, H2, Meta, Row, Screen } from "../../src/components/ui";

/**
 * Games hub.
 *
 * Its own entry point rather than a tab of Contests — the contests page is
 * hidden for now, and these two stand on their own.
 */
const GAMES = [
  {
    route: "/games/typing" as const,
    glyph: "⌨️",
    name: "Typing Arena",
    blurb: "Race the same prompt against other builders. Speed and accuracy both count.",
    leaderboard: "typing",
  },
  {
    route: "/games/signal-noise" as const,
    glyph: "📡",
    name: "Signal vs. Noise",
    blurb: "Sort what matters from what doesn't, under time pressure.",
    leaderboard: "signal",
  },
];

function TopScore({ gameType }: { gameType: string }) {
  const { data } = useQuery({
    queryKey: ["game-leaderboard", gameType],
    queryFn: () => api<any[]>(`/api/games/leaderboard/${gameType}`),
  });
  const top = data?.[0];
  if (!top) return <Meta>No scores yet — the record is yours to take.</Meta>;
  const who = [top.user?.firstName, top.user?.lastName].filter(Boolean).join(" ") || "a builder";
  return <Meta>Best so far: {top.score} by {who}</Meta>;
}

export default function GamesHub() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ title: "Games" }} />
      <Screen>
        <Card>
          <H2>Games</H2>
          <Meta>
            Short, competitive, and free — no credits. Scores land on the game
            leaderboards and earn badges on your profile.
          </Meta>
        </Card>

        {GAMES.map((g) => (
          <Card key={g.route} onPress={() => router.push(g.route)}>
            <Row center gap={spacing.md}>
              <Text style={{ fontSize: 34 }}>{g.glyph}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Body style={{ fontWeight: "700" }}>{g.name}</Body>
                <Meta>{g.blurb}</Meta>
                <TopScore gameType={g.leaderboard} />
              </View>
            </Row>
          </Card>
        ))}
      </Screen>
    </>
  );
}
