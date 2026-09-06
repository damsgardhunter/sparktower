import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, Empty, ErrorNote, H2, Label, Loading, Meta, Progress,
  Row, Screen, errText,
} from "../../src/components/ui";

/**
 * Signal vs. Noise — one card at a time, keep or discard.
 *
 * The whole deck arrives when the round starts, so the reaction clock is
 * per-card and client-side; the server scores from the times it's sent. That
 * matches the web version and keeps each swipe instant with no round trip.
 */

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: colors.success,
  intermediate: colors.warning,
  advanced: colors.danger,
};

interface SNCard { id: string; text: string; isSignal: boolean }

export default function SignalNoise() {
  const qc = useQueryClient();
  const [game, setGame] = useState<any>(null);
  const [index, setIndex] = useState(0);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef<number>(Date.now());

  const { data: scenarios, isLoading } = useQuery({
    queryKey: ["sn-scenarios"],
    queryFn: () => api<any[]>("/api/games/signal-noise/scenarios"),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ["game-leaderboard", "signal"],
    queryFn: () => api<any[]>("/api/games/leaderboard/signal"),
  });

  const cards: SNCard[] = useMemo(() => (game?.cards as SNCard[]) || [], [game]);
  const card = cards[index];

  const start = useMutation({
    mutationFn: (scenario?: string) =>
      api<any>("/api/games/signal-noise/start", { method: "POST", body: { scenario } }),
    onSuccess: (g) => {
      setGame(g);
      setIndex(0);
      setLastCorrect(null);
      setCorrectCount(0);
      setStreak(0);
      setResult(null);
      setError(null);
      shownAt.current = Date.now();
    },
    onError: (e) => setError(errText(e, "Couldn't deal a round.")),
  });

  const complete = useMutation({
    mutationFn: () => api<any>(`/api/games/signal-noise/${game.id}/complete`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["game-leaderboard", "signal"] });
    },
    onError: (e) => setError(errText(e, "Couldn't score that round.")),
  });

  const decide = async (choice: "keep" | "discard") => {
    if (!card) return;
    const timeMs = Date.now() - shownAt.current;
    const right = (choice === "keep") === card.isSignal;

    // Score locally for instant feedback; the server is still the authority.
    setLastCorrect(right);
    setCorrectCount((c) => c + (right ? 1 : 0));
    setStreak((s) => (right ? s + 1 : 0));

    try {
      await api(`/api/games/signal-noise/${game.id}/decide`, {
        method: "POST",
        body: { cardId: card.id, choice, timeMs },
      });
    } catch (e) {
      setError(errText(e, "That call didn't save."));
      return;
    }

    if (index + 1 >= cards.length) complete.mutate();
    else {
      setIndex(index + 1);
      shownAt.current = Date.now();
    }
  };

  // --- Result ---
  if (result) {
    return (
      <>
        <Stack.Screen options={{ title: "Signal vs. Noise" }} />
        <Screen>
          <Card accent={colors.primary}>
            <Label>{game.scenario}</Label>
            <Text style={{ color: colors.primary, fontSize: 44, fontWeight: "800" }}>{result.score}</Text>
            <Meta>points</Meta>
          </Card>

          <Card>
            <Row between>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>{result.accuracy}%</Body>
                <Meta>accuracy</Meta>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>{result.streak}</Body>
                <Meta>best streak</Meta>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>
                  {((result.avgReactionMs || 0) / 1000).toFixed(1)}s
                </Body>
                <Meta>avg call</Meta>
              </View>
            </Row>
          </Card>

          <Card>
            <Label>What you missed</Label>
            {cards.filter((c, i) => {
              const d = (result.decisions || [])[i];
              return d && !d.correct;
            }).length === 0 ? (
              <Meta>Nothing — you called every card correctly.</Meta>
            ) : (
              (result.decisions || []).map((d: any, i: number) => {
                if (d.correct) return null;
                const c = cards.find((x) => x.id === d.cardId);
                if (!c) return null;
                return (
                  <View key={d.cardId} style={{ gap: 2, marginTop: spacing.sm }}>
                    <Body>{c.text}</Body>
                    <Meta style={{ color: colors.warning }}>
                      {c.isSignal ? "That was signal — worth keeping." : "That was noise — safe to drop."}
                    </Meta>
                  </View>
                );
              })
            )}
          </Card>

          <Btn label="Play again" onPress={() => start.mutate(game.scenario)} loading={start.isPending} />
          <Btn label="Pick a different scenario" variant="outline" onPress={() => { setGame(null); setResult(null); }} />
        </Screen>
      </>
    );
  }

  // --- Playing ---
  if (game && card) {
    const pct = Math.round((index / cards.length) * 100);
    return (
      <>
        <Stack.Screen options={{ title: game.scenario }} />
        <Screen>
          <Card>
            <Row between center>
              <Meta>Card {index + 1} of {cards.length}</Meta>
              <Row center gap={spacing.sm}>
                <Meta>{correctCount} right</Meta>
                {streak >= 3 && <Chip label={`🔥 ${streak}`} color={colors.warning} small active />}
              </Row>
            </Row>
            <Progress value={pct} />
          </Card>

          {lastCorrect !== null && (
            <Card accent={lastCorrect ? colors.success : colors.danger}>
              <Body style={{ color: lastCorrect ? colors.success : colors.danger, fontWeight: "700" }}>
                {lastCorrect ? "Good call." : "Not that one."}
              </Body>
            </Card>
          )}

          <Card style={{ minHeight: 180, justifyContent: "center" }}>
            {/* The started game doesn't carry the prompt text, so it comes from
                the scenario list the picker already loaded. */}
            <Meta>
              {scenarios?.find((s) => s.scenario === game.scenario)?.description
                || "Keep what matters. Drop the rest."}
            </Meta>
            <Body style={{ fontSize: 20, fontWeight: "700", lineHeight: 28, marginTop: spacing.sm }}>
              {card.text}
            </Body>
          </Card>

          <Row gap={spacing.md}>
            <Btn label="Drop it" variant="outline" onPress={() => decide("discard")} style={{ flex: 1 }} />
            <Btn label="Keep it" onPress={() => decide("keep")} style={{ flex: 1 }} />
          </Row>
          {error && <ErrorNote message={error} />}
        </Screen>
      </>
    );
  }

  // --- Scenario picker ---
  return (
    <>
      <Stack.Screen options={{ title: "Signal vs. Noise" }} />
      <Screen>
        <Card>
          <H2>Signal vs. Noise</H2>
          <Meta>
            A stack of things competing for your attention. Keep the ones that actually
            move the needle, drop the rest. You're scored on accuracy, streak, and how
            fast you decide.
          </Meta>
        </Card>

        {error && <ErrorNote message={error} />}

        <Btn
          label="Surprise me"
          onPress={() => start.mutate(undefined)}
          loading={start.isPending}
        />

        <Label>Or pick a scenario</Label>
        {isLoading ? (
          <Loading />
        ) : !scenarios?.length ? (
          <Empty title="No scenarios" body="The server didn't return any scenarios." />
        ) : (
          scenarios.map((s) => (
            <Card key={s.scenario} onPress={() => start.mutate(s.scenario)}>
              <Row between center>
                <Body style={{ fontWeight: "700", flex: 1, paddingRight: spacing.sm }}>{s.scenario}</Body>
                <Chip label={s.difficulty} color={DIFFICULTY_COLORS[s.difficulty]} small active />
              </Row>
              <Meta>{s.description}</Meta>
              <Meta>{s.cardCount} cards</Meta>
            </Card>
          ))
        )}

        {!!leaderboard?.length && (
          <Card>
            <Label>Top scores</Label>
            {leaderboard.slice(0, 5).map((e, i) => (
              <Row key={e.id} between center style={{ marginTop: spacing.xs }}>
                <Meta>
                  {i + 1}. {e.user?.firstName || "Builder"} {e.user?.lastName || ""}
                </Meta>
                <Body style={{ fontWeight: "700" }}>{e.score}</Body>
              </Row>
            ))}
          </Card>
        )}
      </Screen>
    </>
  );
}
