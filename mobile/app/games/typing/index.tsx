import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../src/api/client";
import { colors, font, fontFamily, spacing } from "../../../src/theme";
import { Btn, Empty, Icon, Loading, TabStrip, errText } from "../../../src/components/ui";
import { PageIntro, Pill, isSwitchedOff } from "../../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../../src/components/Sheet";
import { GamesPaused, Leaderboard, gameStyles as g, playerName, useGamesOff } from "../../../src/components/more/GameKit";
import { useAuth } from "../../../src/auth/AuthContext";

type Tab = "play" | "leaderboard";

/**
 * Velocity Type Arena lobby — the web's /games/typing: a Play tab (open races,
 * create one) and a Leaderboard tab. Creating or joining a race moves you to
 * /games/typing/:id, the same URL the website uses, so a race link opens here.
 */
export default function TypingLobby() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const off = useGamesOff();
  const { notice, show, clear } = useNotice();
  const [tab, setTab] = useState<Tab>("play");

  const lobby = useQuery({
    queryKey: ["typing-lobby"],
    queryFn: () => api<any[]>("/api/games/typing/lobby"),
    refetchInterval: tab === "play" && !off ? 5000 : false,
    enabled: !off,
  });
  const board = useQuery({
    queryKey: ["game-leaderboard", "typing"],
    queryFn: () => api<any[]>("/api/games/leaderboard/typing"),
    enabled: !off && tab === "leaderboard",
  });

  const create = useMutation({
    mutationFn: () => api<{ id: string }>("/api/games/typing/create", { method: "POST", body: {} }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["typing-lobby"] }); router.push(`/games/typing/${r.id}`); },
    onError: (e) => show({ tone: "error", text: errText(e, "Error creating race.") }),
  });
  const join = useMutation({
    mutationFn: (id: string) => api(`/api/games/typing/${id}/join`, { method: "POST", body: {} }),
    onSuccess: (_r, id) => { qc.invalidateQueries({ queryKey: ["typing-lobby"] }); router.push(`/games/typing/${id}`); },
    onError: (e: any, id) => {
      // Already a racer (opened a second time) — just go back into the race.
      if (e?.status === 400 && /already in race/i.test(e?.message ?? "")) { router.push(`/games/typing/${id}`); return; }
      show({ tone: "error", text: errText(e, "Error joining race.") });
    },
  });

  const pausedByServer = (lobby.error && isSwitchedOff(lobby.error)) || (board.error && isSwitchedOff(board.error));

  return (
    <>
      <Stack.Screen options={{ title: "Typing Arena" }} />
      <View style={g.page}>
        <TabStrip options={[{ value: "play", label: "Play" }, { value: "leaderboard", label: "Leaderboard" }]} value={tab} onChange={setTab} />
        <ScrollView style={g.page} contentContainerStyle={g.content}>
          <View style={g.card}>
            <PageIntro icon="speedometer" tint={colors.success} title="Velocity Type Arena"
              body="Race others typing builder-focused prompts. Speed, accuracy, and execution under pressure." />
          </View>

          {off || pausedByServer ? <GamesPaused /> : tab === "play" ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 2 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[g.h3, { fontSize: font.base }]}>Open races</Text>
                  <Text style={g.small}>Join a race or create your own</Text>
                </View>
                <Btn label="Create race" icon="add" small onPress={() => create.mutate()} loading={create.isPending} />
              </View>

              {lobby.isLoading ? <View style={{ height: 140 }}><Loading /></View>
                : lobby.error ? <Empty icon="cloud-offline-outline" title="Couldn't load races" action="Try again" onAction={() => lobby.refetch()} />
                : !lobby.data?.length ? (
                  <View style={[g.card, { borderStyle: "dashed" }]}>
                    <Empty icon="keypad-outline" title="No races available" body="Create one to get started!" />
                  </View>
                ) : lobby.data.map((r) => {
                  const mine = r.players?.some((p: any) => p.userId === user?.id);
                  const joining = join.isPending && join.variables === r.id;
                  return (
                    <Pressable key={r.id} onPress={() => (mine ? router.push(`/games/typing/${r.id}`) : join.mutate(r.id))} disabled={joining}
                      style={({ pressed }) => [g.card, pressed && { opacity: 0.85 }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                        <Icon name="keypad-outline" size={18} color={colors.textSecondary} />
                        <Text style={[g.h3, { flex: 1, fontSize: font.base }]}>{r.promptCategory || "Random"}</Text>
                        <Pill label={`${r.playerCount} player${r.playerCount !== 1 ? "s" : ""}`} icon="people" color={colors.textSecondary} />
                      </View>
                      <Text style={g.small} numberOfLines={1}>{(r.players || []).map((p: any) => playerName(p.user)).join(", ")}</Text>
                      <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 3 }}>
                        <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{joining ? "Joining…" : mine ? "Rejoin" : "Join"}</Text>
                        <Icon name="arrow-forward" size={13} color={colors.primary} />
                      </View>
                    </Pressable>
                  );
                })}
            </>
          ) : (
            <Leaderboard
              entries={board.data}
              loading={board.isLoading}
              meId={user?.id}
              emptyTitle="No leaderboard data yet. Play a race!"
              row={(e) => ({
                subtitle: e.metadata?.finishTimeMs ? `${(e.metadata.finishTimeMs / 1000).toFixed(1)}s${e.metadata?.category ? ` · ${e.metadata.category}` : ""}` : e.metadata?.category,
                stats: [
                  { label: "WPM", value: e.metadata?.wpm ?? 0 },
                  { label: "Accuracy", value: `${e.metadata?.accuracy ?? 0}%` },
                  { label: "Score", value: e.score },
                ],
              })}
            />
          )}
        </ScrollView>
      </View>
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );
}
