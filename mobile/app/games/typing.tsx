import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, radius, spacing } from "../../src/theme";
import {
  Body, Btn, Card, Chip, Empty, ErrorNote, H2, Label, Loading, Meta, Progress,
  Row, Screen, errText,
} from "../../src/components/ui";
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

  const { data: lobby, isLoading: lobbyLoading } = useQuery({
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
  };

  // --- Result ---
  if (result) {
    return (
      <>
        <Stack.Screen options={{ title: "Race result" }} />
        <Screen>
          <Card accent={colors.primary}>
            <Label>Your run</Label>
            <Text style={{ color: colors.primary, fontSize: 44, fontWeight: "800" }}>{result.wpm}</Text>
            <Meta>words per minute</Meta>
          </Card>

          <Card>
            <Row between>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>{result.accuracy}%</Body>
                <Meta>accuracy</Meta>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>
                  {((result.finishTimeMs || 0) / 1000).toFixed(1)}s
                </Body>
                <Meta>time</Meta>
              </View>
              <View style={{ flex: 1, alignItems: "center" }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>{result.score}</Body>
                <Meta>score</Meta>
              </View>
            </Row>
          </Card>

          {others.length > 0 && (
            <Card>
              <Label>Everyone else</Label>
              {others.map((p: any) => (
                <Row key={p.id} between center style={{ marginTop: spacing.xs }}>
                  <Meta>{name(p.user)}</Meta>
                  <Meta>{p.status === "finished" ? `${p.wpm} wpm · ${p.accuracy}%` : `${p.progress}%`}</Meta>
                </Row>
              ))}
            </Card>
          )}

          <Btn label="Race again" onPress={() => { leaveRace(); create.mutate(); }} loading={create.isPending} />
          <Btn label="Back to the lobby" variant="outline" onPress={leaveRace} />
        </Screen>
      </>
    );
  }

  // --- In a race ---
  if (raceId) {
    if (!race) {
      return (
        <>
          <Stack.Screen options={{ title: "Typing Arena" }} />
          <Screen><Loading label="Joining…" /></Screen>
        </>
      );
    }

    if (race.status === "waiting") {
      return (
        <>
          <Stack.Screen options={{ title: "Waiting room" }} />
          <Screen>
            <Card accent={colors.primary}>
              <Label>{race.promptCategory || "Race"}</Label>
              <Meta>
                {race.players.length} of {race.maxPlayers} in. Start whenever you like — you
                can race alone, and anyone who joins later gets their own run.
              </Meta>
            </Card>

            <Card>
              <Label>Players</Label>
              {race.players.map((p: any) => (
                <Row key={p.id} between center style={{ marginTop: spacing.xs }}>
                  <Body>{name(p.user)}</Body>
                  {p.userId === user?.id && <Chip label="You" small active />}
                </Row>
              ))}
            </Card>

            <Card>
              <Label>The prompt</Label>
              <Body muted>{race.promptText}</Body>
            </Card>

            {error && <ErrorNote message={error} />}
            <Btn label="Start racing" onPress={() => startRace.mutate()} loading={startRace.isPending} />
            <Btn label="Leave" variant="ghost" small onPress={leaveRace} />
          </Screen>
        </>
      );
    }

    // Active. Render the prompt with per-character colouring so mistakes are
    // obvious without needing to look away from the text.
    return (
      <>
        <Stack.Screen options={{ title: race.promptCategory || "Racing" }} />
        <Screen>
          <Card>
            <Row between center>
              <View style={{ alignItems: "center", flex: 1 }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>{wpm}</Body>
                <Meta>wpm</Meta>
              </View>
              <View style={{ alignItems: "center", flex: 1 }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>{accuracy}%</Body>
                <Meta>accuracy</Meta>
              </View>
              <View style={{ alignItems: "center", flex: 1 }}>
                <Body style={{ fontWeight: "800", fontSize: 20 }}>{progressPct}%</Body>
                <Meta>done</Meta>
              </View>
            </Row>
            <Progress value={progressPct} />
          </Card>

          <Card>
            <Text style={{ fontSize: font.lg, lineHeight: 26 }}>
              {prompt.split("").map((ch, i) => {
                const done = i < typed.length;
                const ok = done && typed[i] === ch;
                return (
                  <Text
                    key={i}
                    style={{
                      color: !done
                        ? colors.textSecondary
                        : ok
                          ? colors.primary
                          : colors.danger,
                      backgroundColor: done && !ok ? `${colors.danger}33` : undefined,
                      textDecorationLine: i === typed.length ? "underline" : "none",
                    }}
                  >
                    {ch}
                  </Text>
                );
              })}
            </Text>
          </Card>

          <TextInput
            ref={inputRef}
            value={typed}
            onChangeText={onChange}
            autoFocus
            multiline
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            keyboardAppearance="dark"
            placeholder="Start typing the text above…"
            placeholderTextColor={colors.textTertiary}
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              color: colors.text,
              fontSize: font.base,
              minHeight: 90,
              padding: spacing.md,
              textAlignVertical: "top",
            }}
          />

          {others.length > 0 && (
            <Card>
              <Label>Opponents</Label>
              {others.map((p: any) => (
                <View key={p.id} style={{ marginTop: spacing.sm, gap: spacing.xs }}>
                  <Row between center>
                    <Meta>{name(p.user)}</Meta>
                    <Meta>{p.status === "finished" ? `done · ${p.wpm} wpm` : `${p.wpm} wpm`}</Meta>
                  </Row>
                  <Progress value={p.progress || 0} />
                </View>
              ))}
            </Card>
          )}

          {error && <ErrorNote message={error} />}
          <Btn label="Give up" variant="ghost" small onPress={leaveRace} />
        </Screen>
      </>
    );
  }

  // --- Lobby ---
  return (
    <>
      <Stack.Screen options={{ title: "Typing Arena" }} />
      <Screen>
        <Card>
          <H2>Typing Arena</H2>
          <Meta>
            Same prompt, everyone racing at once. Scored on words per minute and
            accuracy — a fast run full of typos won't beat a clean one.
          </Meta>
        </Card>

        {error && <ErrorNote message={error} />}

        <Btn label="Open a new race" onPress={() => create.mutate()} loading={create.isPending} />

        <Label>Open races</Label>
        {lobbyLoading ? (
          <Loading />
        ) : !lobby?.length ? (
          <Empty title="Nobody waiting" body="Open a race and see who turns up, or run it solo." />
        ) : (
          lobby.map((r) => (
            <Card key={r.id} onPress={() => join.mutate(r.id)}>
              <Row between center>
                <Body style={{ fontWeight: "700" }}>{r.promptCategory || "Race"}</Body>
                <Chip label={`${r.playerCount}/${r.maxPlayers}`} small active />
              </Row>
              <Meta numberOfLines={2}>{r.promptText}</Meta>
              <Meta>{r.players.map((p: any) => name(p.user)).join(", ")}</Meta>
            </Card>
          ))
        )}

        {!!leaderboard?.length && (
          <Card>
            <Label>Fastest builders</Label>
            {leaderboard.slice(0, 5).map((e, i) => (
              <Row key={e.id} between center style={{ marginTop: spacing.xs }}>
                <Meta>{i + 1}. {name(e.user)}</Meta>
                <Body style={{ fontWeight: "700" }}>
                  {e.metadata?.wpm ?? "—"} wpm
                </Body>
              </Row>
            ))}
          </Card>
        )}
      </Screen>
    </>
  );
}
