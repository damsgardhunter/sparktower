import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../../src/theme";
import { Avatar, Btn, Empty, ErrorNote, Icon, Loading, NovaGradient, Progress, errText } from "../../../src/components/ui";
import { PageIntro, Pill, Stat, TitledCard, isSwitchedOff, tintSoft } from "../../../src/components/MoreKit";
import { NoticeBanner, useNotice } from "../../../src/components/Sheet";
import { BoardRow, GamesPaused, copyRaceLink, gameStyles as g, playerName, shareRace, useGamesOff } from "../../../src/components/more/GameKit";
import { useAuth } from "../../../src/auth/AuthContext";

interface Run { wpm: number; accuracy: number; score?: number; finishTimeMs?: number }

/**
 * One typing race — the web's /games/typing/:id. The same screen covers the
 * waiting room, the race itself, and the results, driven by the race's status
 * (polled every 1.5s, as on the web) and by your own player row.
 *
 * Autocorrect, autocapitalisation, and spellcheck are all off — on a phone
 * they'd silently rewrite what you typed and wreck the accuracy score.
 */
export default function TypingRace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const raceId = String(id ?? "");
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const off = useGamesOff();
  const { notice, show, clear } = useNotice();

  const [typed, setTyped] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [errors, setErrors] = useState(0);
  const [result, setResult] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const counted = useRef(false);
  const inputRef = useRef<TextInput>(null);

  const raceQ = useQuery({
    queryKey: ["typing-race", raceId],
    queryFn: () => api<any>(`/api/games/typing/${raceId}`),
    enabled: !off && !!raceId,
    refetchInterval: (q) => (q.state.data?.status === "finished" || q.state.error ? false : 1500),
    retry: (n, e: any) => e?.status !== 404 && n < 1,
  });
  const race = raceQ.data;
  const players: any[] = race?.players ?? [];
  const me = players.find((p) => p.userId === user?.id);
  const prompt: string = race?.promptText || "";

  const backToLobby = () => (router.canGoBack() ? router.back() : router.replace("/games/typing"));
  const refreshRace = () => qc.invalidateQueries({ queryKey: ["typing-race", raceId] });

  const join = useMutation({
    mutationFn: () => api(`/api/games/typing/${raceId}/join`, { method: "POST", body: {} }),
    onSuccess: () => { refreshRace(); qc.invalidateQueries({ queryKey: ["typing-lobby"] }); },
    onError: (e) => show({ tone: "error", text: errText(e, "Error joining race.") }),
  });
  const start = useMutation({
    mutationFn: () => api(`/api/games/typing/${raceId}/start`, { method: "POST", body: {} }),
    onSuccess: refreshRace,
    onError: (e) => show({ tone: "error", text: errText(e, "Error starting race.") }),
  });
  const again = useMutation({
    mutationFn: () => api<{ id: string }>("/api/games/typing/create", { method: "POST", body: {} }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["typing-lobby"] }); router.replace(`/games/typing/${r.id}`); },
    onError: (e) => show({ tone: "error", text: errText(e, "Error creating race.") }),
  });
  const finish = useMutation({
    mutationFn: (body: { wpm: number; accuracy: number; finishTimeMs: number; charsTyped: number }) =>
      api<Run>(`/api/games/typing/${raceId}/finish`, { method: "POST", body }),
    onSuccess: (r) => {
      setResult(r);
      refreshRace();
      qc.invalidateQueries({ queryKey: ["game-leaderboard", "typing"] });
    },
    onError: (e) => setError(errText(e, "Couldn't submit your time.")),
  });

  // --- Live stats ---
  const correctChars = useMemo(() => {
    let n = 0;
    for (let i = 0; i < typed.length; i++) if (typed[i] === prompt[i]) n++;
    return n;
  }, [typed, prompt]);
  const minutes = startedAt ? (Date.now() - startedAt) / 60000 : 0;
  const wpm = minutes > 0 ? Math.round(correctChars / 5 / minutes) : 0;
  const accuracy = correctChars + errors === 0 ? 100 : Math.round((correctChars / (correctChars + errors)) * 100);
  const progressPct = prompt.length ? Math.round((typed.length / prompt.length) * 100) : 0;

  const racing = race?.status === "active" && me?.status === "racing" && !result;

  // 3-2-1 once the race goes live, as on the web, so nobody starts mid-sentence.
  useEffect(() => {
    if (racing && !counted.current) { counted.current = true; setCountdown(3); }
  }, [racing]);
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { setCountdown(null); setTimeout(() => inputRef.current?.focus(), 50); return; }
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // Progress every two seconds so opponents see you move. The numbers live in
  // a ref: putting them in the effect's deps would reset the interval on every
  // keystroke, and a steady typist would never send a single ping.
  const stats = useRef({ wpm, accuracy, progress: progressPct, charsTyped: typed.length, errors });
  stats.current = { wpm, accuracy, progress: progressPct, charsTyped: typed.length, errors };
  useEffect(() => {
    if (!racing || !startedAt) return;
    const t = setInterval(() => {
      api(`/api/games/typing/${raceId}/progress`, { method: "POST", body: stats.current }).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [racing, startedAt, raceId]);

  // Clock starts on the first keystroke, not when the countdown ends —
  // otherwise the pause while the keyboard animates in counts against you.
  const onChange = useCallback((value: string) => {
    if (!racing || countdown !== null || finish.isPending || value.length > prompt.length) return;
    const begin = startedAt ?? Date.now();
    if (!startedAt) setStartedAt(begin);
    // Count a mistake once, as it's made, rather than re-counting on backspace.
    let nextErrors = errors;
    if (value.length > typed.length) {
      for (let i = typed.length; i < value.length; i++) if (value[i] !== prompt[i]) nextErrors++;
      if (nextErrors !== errors) setErrors(nextErrors);
    }
    setTyped(value);
    if (value === prompt) {
      const finishTimeMs = Date.now() - begin;
      finish.mutate({
        wpm: Math.round(prompt.length / 5 / (finishTimeMs / 60000)),
        accuracy: Math.round((prompt.length / (prompt.length + nextErrors || 1)) * 100),
        finishTimeMs,
        charsTyped: value.length,
      });
    }
  }, [racing, countdown, finish, prompt, startedAt, errors, typed.length]);

  const wrap = (title: string, children: React.ReactNode) => (
    <>
      <Stack.Screen options={{ title }} />
      {children}
      <NoticeBanner notice={notice} onDismiss={clear} />
    </>
  );

  // --- Gates ---
  if (off || (raceQ.error && isSwitchedOff(raceQ.error) && (raceQ.error as any)?.message !== "Race not found")) {
    return wrap("Typing Arena", <View style={g.page}><GamesPaused /></View>);
  }
  if (raceQ.isLoading) return wrap("Typing Arena", <Loading label="Loading race…" />);
  if (raceQ.error || !race) {
    return wrap("Typing Arena", (
      <View style={[g.page, { padding: spacing.md }]}>
        {(raceQ.error as any)?.status === 404
          ? <Empty icon="flag-outline" title="Race not found" body="It may have been cleared out. Open a new one from the lobby." action="Back to lobby" onAction={backToLobby} />
          : <Empty icon="cloud-offline-outline" title="Couldn't load this race" action="Try again" onAction={() => raceQ.refetch()} />}
      </View>
    ));
  }

  const myRun: Run | null = result ?? (me?.status === "finished" ? { wpm: me.wpm, accuracy: me.accuracy, score: me.score, finishTimeMs: me.finishTimeMs } : null);

  // --- Results: the race is over, or you've finished your run ---
  if (race.status === "finished" || myRun) {
    const standings = [...players].sort((a, b) => {
      const fa = a.status === "finished", fb = b.status === "finished";
      if (fa !== fb) return fa ? -1 : 1;
      return fa ? (b.score ?? 0) - (a.score ?? 0) : (b.progress ?? 0) - (a.progress ?? 0);
    });
    const stillRacing = race.status !== "finished" && players.some((p) => p.status === "racing");
    return wrap("Race results", (
      <ScrollView style={g.page} contentContainerStyle={g.content}>
        {myRun && (
          <>
            <NovaGradient style={{ borderRadius: radius.lg, padding: spacing.xl, alignItems: "center", gap: 2 }}>
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: font.sm, fontFamily: fontFamily.semibold }}>Your run</Text>
              <Text style={{ color: "#FFFFFF", fontSize: 56, fontFamily: fontFamily.bold }}>{myRun.wpm}</Text>
              <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: font.sm, fontFamily: fontFamily.medium }}>words per minute</Text>
            </NovaGradient>
            <View style={[g.card, { flexDirection: "row", padding: spacing.sm }]}>
              <Stat value={`${myRun.accuracy}%`} label="Accuracy" />
              <Stat value={`${((myRun.finishTimeMs || 0) / 1000).toFixed(1)}s`} label="Time" />
              <Stat value={myRun.score ?? "—"} label="Score" />
            </View>
          </>
        )}
        <TitledCard icon="trophy" tint="#CA8A04" title="Race results" style={{ gap: 0 }}
          action={stillRacing ? <Pill label="Others still racing" icon="time-outline" color={colors.warning} /> : undefined}>
          {standings.map((p, i) => (
            <BoardRow key={p.id} rank={i + 1} user={p.user} highlight={p.userId === user?.id}
              subtitle={p.status === "finished" ? (p.finishTimeMs ? `${(p.finishTimeMs / 1000).toFixed(1)}s` : "Finished") : p.status === "racing" ? `Racing · ${p.progress ?? 0}%` : "Didn't finish"}
              stats={[{ label: "WPM", value: p.wpm ?? 0 }, { label: "Accuracy", value: p.status === "finished" ? `${p.accuracy ?? 0}%` : "—" }, { label: "Score", value: p.score ?? "—" }]}
              style={i > 0 ? { borderTopWidth: 1, borderColor: colors.borderSubtle } : undefined} />
          ))}
        </TitledCard>
        <Btn label="Race again" icon="refresh" onPress={() => again.mutate()} loading={again.isPending} />
        <Btn label="Back to lobby" variant="outline" onPress={backToLobby} />
      </ScrollView>
    ));
  }

  // --- Waiting room ---
  if (race.status === "waiting") {
    const full = players.length >= (race.maxPlayers ?? 6);
    return wrap("Typing race", (
      <ScrollView style={g.page} contentContainerStyle={g.content}>
        <View style={g.card}>
          <PageIntro icon="hourglass-outline" title="Waiting for players" tint={colors.success}
            body={me
              ? `${players.length} of ${race.maxPlayers ?? 6} in. Start whenever you're ready — the countdown begins for everyone at once.`
              : `${players.length} of ${race.maxPlayers ?? 6} in. Join to race on the same prompt.`} />
          {race.promptCategory ? <Pill label={race.promptCategory} color={colors.success} /> : null}
          {me
            ? <Btn label="Start race" icon="play" onPress={() => start.mutate()} loading={start.isPending} />
            : <Btn label={full ? "Race is full" : "Join race"} icon="enter-outline" disabled={full} onPress={() => join.mutate()} loading={join.isPending} />}
        </View>

        <TitledCard icon="people" title={`Players (${players.length})`}>
          {players.map((p) => (
            <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 3 }}>
              <Avatar name={playerName(p.user)} uri={p.user?.profileImageUrl} size={30} />
              <Text style={[g.body, { flex: 1 }]} numberOfLines={1}>{playerName(p.user)}</Text>
              {p.userId === user?.id && <Pill label="You" />}
            </View>
          ))}
        </TitledCard>

        {me && (
          <TitledCard icon="share-social-outline" title="Invite racers">
            <Text style={g.meta}>Send the link — it opens this race on the website or in the app.</Text>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Btn label="Share" icon="share-outline" small style={{ flex: 1 }} onPress={() => shareRace(raceId)} />
              <Btn label="Copy link" icon="copy-outline" small variant="outline" style={{ flex: 1 }}
                onPress={() => copyRaceLink(raceId).then(() => show({ tone: "success", text: "Race link copied." }), () => show({ tone: "error", text: "Couldn't copy the link." }))} />
            </View>
          </TitledCard>
        )}

        <TitledCard icon="document-text-outline" title="The prompt">
          <Text style={[g.body, { color: colors.textSecondary, fontSize: font.base, lineHeight: 23 }]}>{prompt}</Text>
        </TitledCard>
        <Btn label="Back to lobby" variant="outline" onPress={backToLobby} />
      </ScrollView>
    ));
  }

  // --- Under way, but you're not in it ---
  if (!racing) {
    return wrap("Race under way", (
      <ScrollView style={g.page} contentContainerStyle={g.content}>
        <View style={g.card}>
          <PageIntro icon="flag-outline" tint={colors.warning} title="This race has started"
            body="Races lock once the countdown begins. Watch it finish, or open a new one." />
          <Btn label="Create race" icon="add" onPress={() => again.mutate()} loading={again.isPending} />
        </View>
        <RacersCard players={players} meId={user?.id} />
        <Btn label="Back to lobby" variant="outline" onPress={backToLobby} />
      </ScrollView>
    ));
  }

  // --- Racing. Per-character colouring so mistakes are obvious without looking away from the text. ---
  const others = players.filter((p) => p.userId !== user?.id);
  return wrap(race.promptCategory || "Racing", (
    <ScrollView style={g.page} contentContainerStyle={g.content} keyboardShouldPersistTaps="handled">
      <View style={[g.card, { padding: spacing.sm }]}>
        <View style={{ flexDirection: "row" }}>
          <Stat value={wpm} label="WPM" color={colors.primary} />
          <Stat value={`${accuracy}%`} label="Accuracy" />
          <Stat value={`${progressPct}%`} label="Done" />
        </View>
        <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.xs }}><Progress value={progressPct} /></View>
      </View>

      <View style={[g.card, { padding: spacing.lg }]}>
        {countdown !== null ? (
          <View style={{ alignItems: "center", paddingVertical: spacing.xl, gap: 4 }}>
            <Text style={{ color: colors.primary, fontSize: 64, fontFamily: fontFamily.bold }}>{countdown > 0 ? countdown : "GO!"}</Text>
            <Text style={g.small}>Get ready…</Text>
          </View>
        ) : (
          <Text style={{ fontSize: font.lg, lineHeight: 28, fontFamily: fontFamily.regular }} onPress={() => inputRef.current?.focus()}>
            {prompt.split("").map((ch, i) => {
              const done = i < typed.length;
              const ok = done && typed[i] === ch;
              return (
                <Text key={i} style={{
                  fontFamily: fontFamily.regular,
                  color: !done ? colors.textTertiary : ok ? colors.success : colors.danger,
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
        editable={countdown === null && !finish.isPending}
        multiline
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        keyboardAppearance="light"
        placeholder={countdown === null ? "Start typing the text above…" : "Hold on…"}
        placeholderTextColor={colors.textTertiary}
        style={{
          backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md,
          color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular, minHeight: 90, padding: spacing.md, textAlignVertical: "top",
        }}
      />
      {finish.isPending && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center" }}>
          <Icon name="flag" size={14} color={colors.success} />
          <Text style={[g.meta, { color: colors.success }]}>Finished — submitting your time…</Text>
        </View>
      )}
      {error && (
        <>
          <ErrorNote message={error} />
          {typed === prompt && startedAt && (
            <Btn label="Submit my time again" icon="refresh" small variant="outline" loading={finish.isPending}
              onPress={() => { setError(null); const ms = Date.now() - startedAt; finish.mutate({ wpm: Math.round(prompt.length / 5 / (ms / 60000)), accuracy: Math.round((prompt.length / (prompt.length + errors || 1)) * 100), finishTimeMs: ms, charsTyped: prompt.length }); }} />
          )}
        </>
      )}

      {others.length > 0 && <RacersCard players={players} meId={user?.id} />}
    </ScrollView>
  ));
}

function RacersCard({ players, meId }: { players: any[]; meId?: string }) {
  return (
    <TitledCard icon="people" title="Racers">
      {players.map((p) => (
        <View key={p.id} style={{ gap: 4, paddingTop: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Avatar name={playerName(p.user)} uri={p.user?.profileImageUrl} size={22} />
            <Text style={[g.body, { flex: 1 }]} numberOfLines={1}>{playerName(p.user)}{p.userId === meId ? " (you)" : ""}</Text>
            <Text style={g.small}>{p.wpm ?? 0} WPM</Text>
            {p.status === "finished" && <Pill label="Finished" icon="checkmark" color={colors.success} />}
          </View>
          <Progress value={p.progress || 0} color={p.userId === meId ? colors.primary : colors.novaEmerald} />
        </View>
      ))}
    </TitledCard>
  );
}
