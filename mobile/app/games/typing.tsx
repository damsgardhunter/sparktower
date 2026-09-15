import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../src/theme";
import { Avatar, Btn, Empty, ErrorNote, Icon, Loading, NovaGradient, Progress, errText } from "../../src/components/ui";
import { PageIntro, Pill, Stat, isSwitchedOff, tintSoft } from "../../src/components/MoreKit";
import { useAuth } from "../../src/auth/AuthContext";

/** Everyone in a race is scored on the same prompt. */
const name = (u: any) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "Builder";

/**
 * Typing Arena.
 *
 * Autocorrect, autocapitalisation, and spellcheck are all off — on a phone
 * they'd silently rewrite what you typed and wreck the accuracy score.
 */
export default function TypingArena() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const [raceId, setRaceId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [errors, setErrors] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  // 3-2-1 once the race goes live, as on the web, so nobody starts mid-sentence.
  const [countdown, setCountdown] = useState<number | null>(null);
  const counted = useRef<string | null>(null);

  const { data: lobby, isLoading: lobbyLoading, error: lobbyError } = useQuery({
    queryKey: ["typing-lobby"],
    queryFn: () => api<any[]>("/api/games/typing/lobby"),
    refetchInterval: raceId ? false : 5000,
    enabled: !raceId,
  });

  const { data: race } = useQuery({
    queryKey: ["typing-race", raceId],
    queryFn: () => api<any>(`/api/games/typing/${raceId}`),
    enabled: !!raceId && !result,
    // Poll while waiting or racing so other players' progress bars move.
    refetchInterval: 2000,
  });

  const { data: leaderboard } = useQuery({
    queryKey: ["game-leaderboard", "typing"],
    queryFn: () => api<any[]>("/api/games/leaderboard/typing"),
  });

  const prompt: string = race?.promptText || "";
  const me = (race?.players || []).find((p: any) => p.userId === user?.id);
  const others = (race?.players || []).filter((p: any) => p.userId !== user?.id);

  const correctChars = useMemo(() => {
    let n = 0;
    for (let i = 0; i < typed.length; i++) if (typed[i] === prompt[i]) n++;
    return n;
  }, [typed, prompt]);

  const wpm = useMemo(() => {
    if (!startedAt) return 0;
    const minutes = (Date.now() - startedAt) / 60000;
    if (minutes <= 0) return 0;
    return Math.round(correctChars / 5 / minutes);
  }, [startedAt, correctChars, typed]);

  const accuracy = typed.length === 0 ? 100 : Math.round((correctChars / typed.length) * 100);
  const progressPct = prompt.length ? Math.round((typed.length / prompt.length) * 100) : 0;

  const create = useMutation({
    mutationFn: () => api<any>("/api/games/typing/create", { method: "POST", body: {} }),
    onSuccess: (r) => { setRaceId(r.id); setError(null); },
    onError: (e) => setError(errText(e, "Couldn't open a race.")),
  });

  const join = useMutation({
    mutationFn: (id: string) => api<any>(`/api/games/typing/${id}/join`, { method: "POST", body: {} }),
    onSuccess: (r) => { setRaceId(r.id); setError(null); },
    onError: (e) => setError(errText(e, "Couldn't join that race.")),
  });

  const startRace = useMutation({
    mutationFn: () => api<any>(`/api/games/typing/${raceId}/start`, { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["typing-race", raceId] }),
    onError: (e) => setError(errText(e, "Couldn't start the race.")),
  });

  const finish = useMutation({
    mutationFn: (body: any) => api<any>(`/api/games/typing/${raceId}/finish`, { method: "POST", body }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["game-leaderboard", "typing"] });
    },
    onError: (e) => setError(errText(e, "Couldn't submit your time.")),
  });

  useEffect(() => {
    if (race?.status === "active" && raceId && counted.current !== raceId) {
      counted.current = raceId;
      setCountdown(3);
    }
  }, [race?.status, raceId]);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { setCountdown(null); setTimeout(() => inputRef.current?.focus(), 50); return; }
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Clock starts on the first keystroke, not when the race flips to active —
  // otherwise the pause while the keyboard animates in counts against you.
  const onChange = useCallback((value: string) => {
    if (value.length > prompt.length) return;
    const begin = startedAt ?? Date.now();
    if (!startedAt) setStartedAt(begin);

    // Count a mistake once, as it's made, rather than re-counting on backspace.
    if (value.length > typed.length) {
      const i = value.length - 1;
      if (value[i] !== prompt[i]) setErrors((n) => n + 1);
    }
    setTyped(value);

    if (value === prompt) {
      const finishTimeMs = Date.now() - begin;
      const finalWpm = Math.round(prompt.length / 5 / (finishTimeMs / 60000));
      const total = prompt.length + errors;
      finish.mutate({
        wpm: finalWpm,
        accuracy: Math.round((prompt.length / (total || 1)) * 100),
        finishTimeMs,
        charsTyped: value.length,
      });
    }
  }, [prompt, startedAt, typed.length, errors, finish]);

  // Report progress every couple of seconds so opponents see you move.
  useEffect(() => {
    if (!raceId || race?.status !== "active" || result || !startedAt) return;
    const t = setInterval(() => {
      api(`/api/games/typing/${raceId}/progress`, {
        method: "POST",
        body: { wpm, accuracy, progress: progressPct, charsTyped: typed.length, errors },
      }).catch(() => {}); // A dropped progress ping is cosmetic; the finish call is what counts.
    }, 2000);
    return () => clearInterval(t);
  }, [raceId, race?.status, result, startedAt, wpm, accuracy, progressPct, typed.length, errors]);

  const leaveRace = () => {
    setRaceId(null);
    setTyped("");
    setStartedAt(null);
    setErrors(0);
    setResult(null);
    setError(null);
    setCountdown(null);
    counted.current = null;
  };

  // --- Result ---
  if (result) {
    const board = [...(race?.players || [])].sort((a: any, b: any) => (b.status === "finished" ? b.wpm : -1) - (a.status === "finished" ? a.wpm : -1));
    return (
      <>
        <Stack.Screen options={{ title: "Race result" }} />
        <ScrollView style={page} contentContainerStyle={content}>
          <NovaGradient style={{ borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", gap: 2 }}>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: font.sm, fontFamily: fontFamily.semibold }}>Your run</Text>
            <Text style={{ color: "#FFFFFF", fontSize: 56, fontFamily: fontFamily.bold }}>{result.wpm}</Text>
            <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: font.sm, fontFamily: fontFamily.medium }}>words per minute</Text>
          </NovaGradient>
          <View style={[card, { flexDirection: "row", padding: spacing.sm }]}>
            <Stat value={`${result.accuracy}%`} label="Accuracy" />
            <Stat value={`${((result.finishTimeMs || 0) / 1000).toFixed(1)}s`} label="Time" />
            <Stat value={result.score ?? "—"} label="Score" />
          </View>
          {board.length > 1 && (
            <View style={card}>
              <Text style={h3}>Standings</Text>
              {board.map((p: any, i: number) => (
                <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 }}>
                  <Text style={[small, { width: 16, fontFamily: fontFamily.bold }]}>{i + 1}</Text>
                  <Avatar name={name(p.user)} uri={p.user?.profileImageUrl} size={26} />
                  <Text style={[body, { flex: 1 }]} numberOfLines={1}>{name(p.user)}{p.userId === user?.id ? " (you)" : ""}</Text>
                  <Text style={small}>{p.status === "finished" ? `${p.wpm} wpm · ${p.accuracy}%` : `${p.progress ?? 0}%`}</Text>
                </View>
              ))}
            </View>
          )}
          <Btn label="Race again" icon="refresh" onPress={() => { leaveRace(); create.mutate(); }} loading={create.isPending} />
          <Btn label="Back to the lobby" variant="outline" onPress={leaveRace} />
        </ScrollView>
      </>
    );
  }

  // --- In a race ---
  if (raceId) {
    if (!race) {
      return (
        <>
          <Stack.Screen options={{ title: "Typing Arena" }} />
          <Loading label="Joining…" />
        </>
      );
    }

    if (race.status === "waiting") {
      return (
        <>
          <Stack.Screen options={{ title: "Waiting room" }} />
          <ScrollView style={page} contentContainerStyle={content}>
            <View style={card}>
              <PageIntro icon="hourglass-outline" title="Waiting room" tint={colors.success}
                body={`${race.players.length} of ${race.maxPlayers} in. Start whenever you like — you can race alone, and anyone who joins later gets their own run.`} />
              {race.promptCategory ? <Pill label={race.promptCategory} color={colors.success} /> : null}
            </View>
            <View style={card}>
              <Text style={h3}>Players</Text>
              {race.players.map((p: any) => (
                <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 3 }}>
                  <Avatar name={name(p.user)} uri={p.user?.profileImageUrl} size={30} />
                  <Text style={[body, { flex: 1 }]}>{name(p.user)}</Text>
                  {p.userId === user?.id && <Pill label="You" />}
                </View>
              ))}
            </View>
            <View style={card}>
              <Text style={h3}>The prompt</Text>
              <Text style={[body, { color: colors.textSecondary, fontSize: font.base, lineHeight: 23 }]}>{race.promptText}</Text>
            </View>
            {error && <ErrorNote message={error} />}
            <Btn label="Start racing" icon="flag" onPress={() => startRace.mutate()} loading={startRace.isPending} />
            <Btn label="Leave" variant="ghost" small onPress={leaveRace} />
          </ScrollView>
        </>
      );
    }

    // Active. Per-character colouring so mistakes are obvious without looking away from the text.
    return (
      <>
        <Stack.Screen options={{ title: race.promptCategory || "Racing" }} />
        <ScrollView style={page} contentContainerStyle={content} keyboardShouldPersistTaps="handled">
          <View style={[card, { padding: spacing.sm }]}>
            <View style={{ flexDirection: "row" }}>
              <Stat value={wpm} label="WPM" color={colors.primary} />
              <Stat value={`${accuracy}%`} label="Accuracy" />
              <Stat value={`${progressPct}%`} label="Done" />
            </View>
            <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.xs }}><Progress value={progressPct} /></View>
          </View>

          <View style={[card, { padding: spacing.lg }]}>
            {countdown !== null ? (
              <View style={{ alignItems: "center", paddingVertical: spacing.xl, gap: 4 }}>
                <Text style={{ color: colors.primary, fontSize: 64, fontFamily: fontFamily.bold }}>{countdown > 0 ? countdown : "Go"}</Text>
                <Text style={small}>Get ready…</Text>
              </View>
            ) : (
              <Text style={{ fontSize: font.lg, lineHeight: 28, fontFamily: fontFamily.regular }}>
                {prompt.split("").map((ch, i) => {
                  const done = i < typed.length;
                  const ok = done && typed[i] === ch;
                  return (
                    <Text key={i} style={{
                      color: !done ? colors.textTertiary : ok ? colors.text : colors.danger,
                      backgroundColor: done && !ok ? tintSoft(colors.danger, 0.18) : i === typed.length ? colors.primarySoft : undefined,
                      textDecorationLine: i === typed.length ? "underline" : "none",
                    }}>{ch}</Text>
                  );
                })}
              </Text>
            )}
          </View>

          <TextInput
            ref={inputRef}
            value={typed}
            onChangeText={onChange}
            editable={countdown === null}
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            keyboardAppearance="light"
            placeholder={countdown === null ? "Start typing the text above…" : "Hold on…"}
            placeholderTextColor={colors.textTertiary}
            style={{
              backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md,
              color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular, minHeight: 90, padding: spacing.md, textAlignVertical: "top",
            }}
          />

          {others.length > 0 && (
            <View style={card}>
              <Text style={h3}>Opponents</Text>
              {others.map((p: any) => (
                <View key={p.id} style={{ gap: 4, paddingTop: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Avatar name={name(p.user)} uri={p.user?.profileImageUrl} size={22} />
                    <Text style={[body, { flex: 1 }]} numberOfLines={1}>{name(p.user)}</Text>
                    <Text style={small}>{p.status === "finished" ? `Done · ${p.wpm} wpm` : `${p.wpm ?? 0} wpm`}</Text>
                  </View>
                  <Progress value={p.progress || 0} color={colors.novaEmerald} />
                </View>
              ))}
            </View>
          )}

          {error && <ErrorNote message={error} />}
          <Btn label="Give up" variant="ghost" small onPress={leaveRace} />
        </ScrollView>
      </>
    );
  }

  // --- Lobby ---
  return (
    <>
      <Stack.Screen options={{ title: "Typing Arena" }} />
      <ScrollView style={page} contentContainerStyle={content}>
        <View style={card}>
          <PageIntro icon="speedometer" tint={colors.success} title="Velocity Type Arena"
            body="Same prompt, everyone racing at once. Scored on words per minute and accuracy — a fast run full of typos won't beat a clean one." />
          <Btn label="Open a new race" icon="add" onPress={() => create.mutate()} loading={create.isPending} />
        </View>
        {error && <ErrorNote message={error} />}

        <Text style={[h3, { paddingHorizontal: 2 }]}>Open races</Text>
        {lobbyLoading ? <View style={{ height: 140 }}><Loading /></View>
          : lobbyError && isSwitchedOff(lobbyError) ? <Empty icon="pause-circle-outline" title="Games are switched off" body="Check back soon." />
          : !lobby?.length ? (
            <View style={[card, { borderStyle: "dashed" }]}>
              <Empty icon="people-outline" title="Nobody waiting" body="Open a race and see who turns up, or run it solo." />
            </View>
          ) : lobby.map((r) => (
            <Pressable key={r.id} onPress={() => join.mutate(r.id)} style={({ pressed }) => [card, pressed && { opacity: 0.85 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Text style={[h3, { flex: 1, fontSize: font.base }]}>{r.promptCategory || "Race"}</Text>
                <Pill label={`${r.playerCount}/${r.maxPlayers}`} icon="people" />
              </View>
              <Text style={[body, { color: colors.textSecondary }]} numberOfLines={2}>{r.promptText}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={small} numberOfLines={1}>{r.players.map((p: any) => name(p.user)).join(", ")}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Join</Text>
                  <Icon name="arrow-forward" size={13} color={colors.primary} />
                </View>
              </View>
            </Pressable>
          ))}

        {!!leaderboard?.length && (
          <View style={card}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name="trophy" size={16} color="#CA8A04" /><Text style={h3}>Fastest builders</Text>
            </View>
            {leaderboard.slice(0, 5).map((e, i) => (
              <View key={e.id ?? i} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4 }}>
                <Text style={[small, { width: 16, fontFamily: fontFamily.bold }]}>{i + 1}</Text>
                <Avatar name={name(e.user)} uri={e.user?.profileImageUrl} size={26} />
                <Text style={[body, { flex: 1 }]} numberOfLines={1}>{name(e.user)}</Text>
                <Text style={[body, { fontFamily: fontFamily.bold }]}>{e.metadata?.wpm ?? "—"} wpm</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

const page = { flex: 1, backgroundColor: colors.canvas } as const;
const content = { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 } as const;
const card = { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, ...shadow.card } as const;
const h3 = { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold } as const;
const body = { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular } as const;
const small = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular } as const;
