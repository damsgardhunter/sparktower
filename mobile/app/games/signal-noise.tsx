import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../src/theme";
import { Btn, Empty, ErrorNote, Icon, Loading, NovaGradient, Progress, TabStrip, errText } from "../../src/components/ui";
import { PageIntro, Pill, Stat, TitledCard, humanize, isSwitchedOff, tintSoft } from "../../src/components/MoreKit";
import { GamesPaused, Leaderboard, useGamesOff } from "../../src/components/more/GameKit";
import { useAuth } from "../../src/auth/AuthContext";

/**
 * Signal vs. Noise — one card at a time, keep or drop.
 *
 * The whole deck arrives when the round starts, so the reaction clock is
 * per-card and client-side; the server scores from the times it's sent. That
 * matches the web version and keeps each call instant.
 */

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: colors.success,
  intermediate: colors.warning,
  advanced: colors.danger,
};

interface SNCard { id: string; text: string; isSignal: boolean }
interface Decision { cardId: string; text: string; choice: "keep" | "discard"; correct: boolean; timeMs: number }

export default function SignalNoise() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const off = useGamesOff();
  const [tab, setTab] = useState<"play" | "leaderboard">("play");
  const [game, setGame] = useState<any>(null);
  const [index, setIndex] = useState(0);
  const [flash, setFlash] = useState<boolean | null>(null);
  const [streak, setStreak] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const shownAt = useRef<number>(Date.now());
  const deciding = useRef(false);

  const { data: scenarios, isLoading, error: loadError } = useQuery({
    queryKey: ["sn-scenarios"],
    queryFn: () => api<any[]>("/api/games/signal-noise/scenarios"),
    enabled: !off,
  });
  const board = useQuery({
    queryKey: ["game-leaderboard", "signal"],
    queryFn: () => api<any[]>("/api/games/leaderboard/signal"),
    enabled: !off && tab === "leaderboard",
  });

  const cards: SNCard[] = useMemo(() => (game?.cards as SNCard[]) || [], [game]);
  const card = cards[index];

  // A running clock for the current card, as on the web.
  useEffect(() => {
    if (!game || result) return;
    const t = setInterval(() => setElapsed(Date.now() - shownAt.current), 100);
    return () => clearInterval(t);
  }, [game, result, index]);

  const start = useMutation({
    mutationFn: (scenario?: string) => api<any>("/api/games/signal-noise/start", { method: "POST", body: { scenario } }),
    onSuccess: (g) => {
      setGame(g); setIndex(0); setFlash(null); setStreak(0); setDecisions([]); setResult(null); setError(null);
      shownAt.current = Date.now();
    },
    onError: (e) => setError(errText(e, "Couldn't deal a round.")),
  });

  const complete = useMutation({
    mutationFn: () => api<any>(`/api/games/signal-noise/${game.id}/complete`, { method: "POST", body: {} }),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ["game-leaderboard", "signal"] }); },
    onError: (e) => setError(errText(e, "Couldn't score that round.")),
  });

  const decide = async (choice: "keep" | "discard") => {
    if (!card || deciding.current) return;
    deciding.current = true;
    const timeMs = Date.now() - shownAt.current;
    try {
      const r = await api<{ correct: boolean }>(`/api/games/signal-noise/${game.id}/decide`, { method: "POST", body: { cardId: card.id, choice, timeMs } });
      const correct = typeof r?.correct === "boolean" ? r.correct : (choice === "keep") === card.isSignal;
      setDecisions((d) => [...d, { cardId: card.id, text: card.text, choice, correct, timeMs }]);
      setFlash(correct);
      setStreak((s) => (correct ? s + 1 : 0));
      setTimeout(() => {
        setFlash(null);
        if (index + 1 >= cards.length) complete.mutate();
        else { setIndex(index + 1); shownAt.current = Date.now(); }
        deciding.current = false;
      }, 380);
    } catch (e) {
      setError(errText(e, "That call didn't save."));
      deciding.current = false;
    }
  };

  const title = <Stack.Screen options={{ title: "Signal vs. Noise" }} />;

  // --- Result ---
  if (result) {
    const missed = decisions.filter((d) => !d.correct);
    return (
      <>
        {title}
        <ScrollView style={page} contentContainerStyle={content}>
          <NovaGradient style={{ borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", gap: 2 }}>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: font.sm, fontFamily: fontFamily.semibold }}>{game.scenario}</Text>
            <Text style={{ color: "#FFFFFF", fontSize: 52, fontFamily: fontFamily.bold }}>{result.score}</Text>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: font.sm, fontFamily: fontFamily.medium }}>points</Text>
          </NovaGradient>
          <View style={[card_, { flexDirection: "row", padding: spacing.sm }]}>
            <Stat value={`${result.accuracy}%`} label="Accuracy" />
            <Stat value={result.streak} label="Best streak" />
            <Stat value={`${Math.round(result.avgReactionMs || 0)}ms`} label="Avg reaction" />
          </View>
          <TitledCard icon="list" title="Decision breakdown" action={<Text style={small}>{decisions.length - missed.length}/{decisions.length} right</Text>} style={{ gap: 0 }}>
            {decisions.map((d, i) => {
              const c = cards.find((x) => x.id === d.cardId);
              return (
                <View key={d.cardId} style={{ flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: i > 0 ? 1 : 0, borderColor: colors.borderSubtle }}>
                  <Text style={[small, { width: 18, paddingTop: 2 }]}>{i + 1}</Text>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={body}>{d.text}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Pill label={d.choice === "keep" ? "Keep" : "Discard"} color={d.choice === "keep" ? colors.success : colors.danger} />
                      <Text style={small}>{d.timeMs}ms</Text>
                      {!d.correct && (
                        <Text style={{ color: colors.warning, fontSize: font.xs, fontFamily: fontFamily.medium }}>
                          {c?.isSignal ? "That was signal." : "That was noise."}
                        </Text>
                      )}
                    </View>
                  </View>
                  <Icon name={d.correct ? "checkmark-circle" : "close-circle"} size={20} color={d.correct ? colors.success : colors.danger} />
                </View>
              );
            })}
          </TitledCard>
          <Btn label="Play again" icon="refresh" onPress={() => start.mutate(game.scenario)} loading={start.isPending} />
          <Btn label="Pick a different scenario" variant="outline" onPress={() => { setGame(null); setResult(null); }} />
        </ScrollView>
      </>
    );
  }

  // --- Playing ---
  if (game && card) {
    const scenario = scenarios?.find((s) => s.scenario === game.scenario);
    const correctCount = decisions.filter((d) => d.correct).length;
    return (
      <>
        <Stack.Screen options={{ title: game.scenario }} />
        <View style={[page, { padding: spacing.md, gap: spacing.md }]}>
          <View style={[card_, { gap: spacing.sm }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Text style={[meta, { flex: 1 }]}>Card {index + 1} of {cards.length}</Text>
              <Pill label={`${correctCount * 10}`} icon="trophy" color="#CA8A04" />
              <Pill label={`${streak}`} icon="flash" color="#EA580C" />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Icon name="timer-outline" size={14} color={colors.textTertiary} />
                <Text style={[meta, { fontVariant: ["tabular-nums"] }]}>{(elapsed / 1000).toFixed(1)}s</Text>
              </View>
            </View>
            <Progress value={((index + 1) / cards.length) * 100} />
          </View>

          <View style={[card_, {
            flex: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md,
            borderWidth: 2, borderColor: flash === null ? colors.border : flash ? colors.success : colors.danger,
            backgroundColor: flash === null ? colors.surface : tintSoft(flash ? colors.success : colors.danger, 0.08),
          }]}>
            <Text style={[meta, { textAlign: "center" }]}>{scenario?.description || "Keep what matters. Drop the rest."}</Text>
            <Text style={{ color: colors.text, fontSize: 22, lineHeight: 30, fontFamily: fontFamily.bold, textAlign: "center" }}>{card.text}</Text>
            {flash !== null && (
              <View style={{ flexDirection: "row", gap: 6, alignSelf: "center", alignItems: "center" }}>
                <Icon name={flash ? "checkmark-circle" : "close-circle"} size={20} color={flash ? colors.success : colors.danger} />
                <Text style={{ color: flash ? colors.success : colors.danger, fontSize: font.base, fontFamily: fontFamily.semibold }}>{flash ? "Good call" : "Not that one"}</Text>
              </View>
            )}
          </View>

          {error && <ErrorNote message={error} />}
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <ChoiceButton label="Noise" sub="Drop it" icon="trash-outline" color={colors.danger} onPress={() => decide("discard")} />
            <ChoiceButton label="Signal" sub="Keep it" icon="radio-outline" color={colors.success} onPress={() => decide("keep")} />
          </View>
        </View>
      </>
    );
  }

  // --- Scenario picker, with the web's Play / Leaderboard tabs ---
  const paused = off || (loadError && isSwitchedOff(loadError)) || (board.error && isSwitchedOff(board.error));
  return (
    <>
      {title}
      <View style={page}>
        <TabStrip options={[{ value: "play", label: "Play" }, { value: "leaderboard", label: "Leaderboard" }]} value={tab} onChange={setTab} />
        <ScrollView style={page} contentContainerStyle={content}>
          <View style={card_}>
            <PageIntro icon="radio" tint={colors.novaPurple} title="Signal vs. Noise"
              body="Sort cards into signal or noise under time pressure. Scored on accuracy, streak, and reaction speed." />
            {tab === "play" && !paused && <Btn label="Surprise me" icon="shuffle" onPress={() => start.mutate(undefined)} loading={start.isPending && start.variables === undefined} />}
          </View>
          {error && <ErrorNote message={error} />}

          {paused ? <GamesPaused /> : tab === "leaderboard" ? (
            <Leaderboard
              entries={board.data}
              loading={board.isLoading}
              meId={user?.id}
              emptyTitle="No leaderboard entries yet."
              row={(e) => ({
                subtitle: e.metadata?.scenario || "-",
                stats: [
                  { label: "Score", value: e.score },
                  { label: "Accuracy", value: `${e.metadata?.accuracy ?? 0}%` },
                  { label: "Streak", value: e.metadata?.streak ?? 0 },
                ],
              })}
            />
          ) : (
            <>
              <Text style={[h3, { paddingHorizontal: 2 }]}>Pick a scenario</Text>
              {isLoading ? <View style={{ height: 160 }}><Loading /></View>
                : loadError ? <Empty icon="cloud-offline-outline" title="Couldn't load scenarios" />
                : !scenarios?.length ? <Empty icon="albums-outline" title="No scenarios" body="The server didn't return any scenarios." />
                : scenarios.map((s) => (
                  <View key={s.scenario} style={card_}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Text style={[h3, { flex: 1, fontSize: font.base }]}>{s.scenario}</Text>
                      <Pill label={humanize(s.difficulty)} color={DIFFICULTY_COLORS[s.difficulty] ?? colors.textSecondary} />
                    </View>
                    <Text style={[meta, { lineHeight: 19 }]}>{s.description}</Text>
                    <Text style={small}>{s.cardCount} cards</Text>
                    <Btn label={start.isPending && start.variables === s.scenario ? "Starting..." : "Play"} icon="play" small
                      disabled={start.isPending} onPress={() => start.mutate(s.scenario)} />
                  </View>
                ))}
            </>
          )}
        </ScrollView>
      </View>
    </>
  );
}

function ChoiceButton({ label, sub, icon, color, onPress }: { label: string; sub: string; icon: "trash-outline" | "radio-outline"; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${sub}`}
      style={({ pressed }) => [{ flex: 1, alignItems: "center", gap: 2, paddingVertical: spacing.lg, borderRadius: radius.lg, borderWidth: 1.5, borderColor: tintSoft(color, 0.5), backgroundColor: tintSoft(color, 0.08) }, pressed && { transform: [{ scale: 0.97 }], backgroundColor: tintSoft(color, 0.18) }]}>
      <Icon name={icon} size={26} color={color} />
      <Text style={{ color, fontSize: font.lg, fontFamily: fontFamily.bold }}>{label}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium }}>{sub}</Text>
    </Pressable>
  );
}

const page = { flex: 1, backgroundColor: colors.canvas } as const;
const content = { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 } as const;
const card_ = { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, ...shadow.card } as const;
const h3 = { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold } as const;
const body = { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular } as const;
const meta = { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular } as const;
const small = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular } as const;
