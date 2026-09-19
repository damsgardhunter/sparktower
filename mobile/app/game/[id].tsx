/**
 * One game of Ten Years From Now, on a phone.
 *
 * Same five rounds, same clocks, same server. The differences are the ones a
 * phone forces: the chat is a sheet rather than a column beside the board, and
 * the budget uses steppers rather than sliders.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Icon, Screen, TAB_BAR_SPACE } from "../../src/components/ui";
import { Sheet } from "../../src/components/Sheet";
import { Players, PickCard, RoundHeader, type GamePlayer } from "../../src/components/game/GameKit";
import { GameBudgetRound } from "../../src/components/game/GameBudget";
import {
  MAX_CLAIMS, MAX_CORE_CLAIMS, MAX_CUSTOM_CARDS, PLAYABLE_ROUNDS, ROUND_COPY, SETTLE_COPY, SCORE_MAX,
  allocated, money, ordinal, scoreBand,
  type Allocation, type Claim, type DeckCard, type SpendOption,
} from "../../src/components/game/model";

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);

  /*
   * A second while a round is open, five once it's over. The clock is what's
   * being watched and a stale one is the whole game feeling broken; after the
   * verdict there is nothing left to change.
   */
  const { data: state, isLoading } = useQuery<any>({
    queryKey: ["game", id],
    queryFn: () => api<any>(`/api/games/${id}`),
    refetchInterval: (q) => {
      const round = (q.state.data as any)?.round;
      return round === "verdict" || round === "abandoned" ? 5000 : 1000;
    },
  });

  const { data: rules } = useQuery<any>({
    queryKey: ["game-rules"],
    queryFn: () => api<any>("/api/games/rules"),
    staleTime: Infinity,
  });

  const submit = useMutation({
    mutationFn: (payload: any) => api(`/api/games/${id}/submit`, { method: "POST", body: payload }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["game", id] }),
  });

  const leave = useMutation({
    mutationFn: () => api(`/api/games/${id}/leave`, { method: "POST", body: {} }),
    onSuccess: () => router.replace("/(tabs)/sprints"),
  });

  if (isLoading || !state) {
    return (
      <Screen>
        <View style={{ paddingVertical: 80, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  const round: string = state.round;
  const players: GamePlayer[] = state.players ?? [];
  const you = players.find((p) => p.isYou);
  const them = players.find((p) => !p.isYou);

  if (round === "abandoned") {
    const whoLeft = state.game.abandonedById === you?.id ? "You" : them?.name ?? "Your partner";
    return (
      <Screen>
        <View style={{ paddingVertical: 80, alignItems: "center", gap: spacing.md }}>
          <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>That game ended</Text>
          <Text style={{ color: colors.textSecondary }}>{whoLeft} left before it finished.</Text>
          <Btn label="Back" onPress={() => router.replace("/(tabs)/sprints")} />
        </View>
      </Screen>
    );
  }

  const copy = ROUND_COPY[round] ?? ROUND_COPY.idea;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: TAB_BAR_SPACE, gap: spacing.lg }}>
        {round !== "verdict" ? (
          <>
            <RoundHeader
              title={copy.title}
              blurb={copy.blurb}
              secondsLeft={state.secondsLeft}
              rounds={PLAYABLE_ROUNDS}
              current={round}
            />
            <Players
              players={players}
              answered={{ [you?.id ?? ""]: !!state.yours, [them?.id ?? ""]: !!state.theirs }}
            />
            <LastRoundNote settledBy={state.game.settledBy} round={round} />
          </>
        ) : null}

        <RoundBody
          // Keyed by the round so its drafts don't survive into the next one.
          // See the web page for why the current behaviour is luck, not design.
          key={round}
          gameId={String(id)}
          state={state}
          round={round}
          rules={rules}
          busy={submit.isPending}
          onSubmit={(payload) => submit.mutate(payload)}
          onDone={() => router.replace("/(tabs)/sprints")}
        />

        {round !== "verdict" ? (
          <Pressable onPress={() => leave.mutate()} style={{ paddingVertical: spacing.md, alignItems: "center" }}>
            <Text style={{ color: colors.textTertiary, fontSize: font.sm }}>Leave the game</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* The argument. A sheet rather than a column: there is no room beside
          the board on a phone, and the round is decided in here. */}
      {round !== "verdict" ? (
        <Pressable
          onPress={() => setChatOpen(true)}
          style={{
            position: "absolute", right: spacing.lg, bottom: TAB_BAR_SPACE,
            backgroundColor: colors.primary, width: 52, height: 52, borderRadius: 26,
            alignItems: "center", justifyContent: "center",
          }}
          testID="button-open-chat"
        >
          <Icon name="chatbubble-ellipses" size={22} color={colors.primaryText} />
        </Pressable>
      ) : null}

      <Sheet visible={chatOpen} onClose={() => setChatOpen(false)} title="Talk it out">
        <Chat gameId={String(id)} players={players} />
      </Sheet>
    </Screen>
  );
}

function LastRoundNote({ settledBy, round }: { settledBy: Record<string, string> | null; round: string }) {
  const previous = PLAYABLE_ROUNDS[PLAYABLE_ROUNDS.indexOf(round) - 1];
  const reason = previous && settledBy?.[previous];
  if (!reason || reason === "agreed") return null;
  return (
    <View style={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: spacing.md }}>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs }}>{SETTLE_COPY[reason]}</Text>
    </View>
  );
}

function RoundBody({
  gameId, state, round, rules, busy, onSubmit, onDone,
}: {
  gameId: string; state: any; round: string; rules: any; busy: boolean;
  onSubmit: (payload: any) => void; onDone: () => void;
}) {
  const [claims, setClaims] = useState<Claim[]>(state.yours?.claims ?? []);
  const [allocation, setAllocation] = useState<Allocation>(state.yours?.allocation ?? {});
  const [ideaName, setIdeaName] = useState(state.yours?.name ?? "");
  const [ideaPitch, setIdeaPitch] = useState(state.yours?.pitch ?? "");
  const [claimText, setClaimText] = useState("");
  const [customs, setCustoms] = useState<DeckCard[]>([]);
  const [adding, setAdding] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customDetail, setCustomDetail] = useState("");
  const youId: string = (state.players ?? []).find((p: any) => p.isYou)?.id ?? "me";

  const { data: deck } = useQuery<any>({
    queryKey: ["game-deck", gameId, round],
    queryFn: () => api<any>(`/api/games/${gameId}/deck/${round}`),
    enabled: round === "customer" || round === "model",
  });

  /*
   * Asked for only once the game is known to have a placing. A poll keyed on
   * `scored` either stopped before the standings existed or ran forever on a
   * game that was never scored — there is nothing to wait for either way.
   */
  const { data: standings } = useQuery<any>({
    queryKey: ["game-standings", gameId],
    queryFn: () => api<any>(`/api/games/${gameId}/standings`),
    enabled: round === "verdict" && !!state.verdict?.fromModel,
  });

  if (round === "verdict") {
    return <Verdict state={state} standings={standings} onDone={onDone} />;
  }

  if (round === "idea") {
    return (
      <View style={{ gap: spacing.lg }}>
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Your idea</Text>
          <TextInput
            value={ideaName}
            onChangeText={setIdeaName}
            placeholder="What's it called?"
            placeholderTextColor={colors.textTertiary}
            maxLength={80}
            testID="input-idea-name"
            style={inputStyle}
          />
          <TextInput
            value={ideaPitch}
            onChangeText={setIdeaPitch}
            placeholder="The pitch. Two or three sentences."
            placeholderTextColor={colors.textTertiary}
            maxLength={600}
            multiline
            style={[inputStyle, { minHeight: 84, textAlignVertical: "top" }]}
          />
          <Btn
            label={state.yours?.name === ideaName.trim() ? "Updated" : "Put this forward"}
            disabled={busy || !ideaName.trim()}
            onPress={() => onSubmit({ idea: { name: ideaName.trim(), pitch: ideaPitch.trim() } })}
            testID="button-put-forward"
          />
        </View>

        {state.theirs ? (
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Their idea</Text>
            <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{state.theirs.name}</Text>
            {state.theirs.pitch ? <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>{state.theirs.pitch}</Text> : null}
            <Btn
              label="Build theirs instead"
              variant="outline"
              disabled={busy}
              onPress={() => onSubmit({ idea: state.theirs })}
            />
          </View>
        ) : null}
      </View>
    );
  }

  if (round === "customer" || round === "model") {
    const cards: DeckCard[] = deck?.cards ?? [];
    const groups = [...new Set(cards.map((c) => c.group))];

    /*
     * Cards either of you invented, rebuilt from what the server holds rather
     * than kept in this screen's state. Your partner's invention is in neither
     * the dealt deck nor your own list, so without this the card marked "their
     * pick" does not render at all — in a game whose premise is arguing about
     * what the other person chose. Yours would likewise vanish on a reload.
     */
    const invented: DeckCard[] = [state.yours, state.theirs]
      .filter((sub: any) => sub?.cardId && String(sub.cardId).startsWith("custom:"))
      .map((sub: any) => ({
        id: sub.cardId,
        label: sub.label,
        detail: sub.detail ?? "",
        consequence: "Invented for this game.",
        group: "Yours",
      }));
    const seen = new Set(invented.map((c) => c.id));
    const mine = [...invented, ...customs.filter((c) => !seen.has(c.id))];

    const pick = (card: DeckCard) =>
      !busy && onSubmit({ cardId: card.id, label: card.label, detail: card.detail });

    return (
      <View style={{ gap: spacing.xl }}>
        {groups.map((group) => (
          <View key={group} style={{ gap: spacing.md }}>
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{group}</Text>
            {cards.filter((c) => c.group === group).map((card) => (
              <PickCard
                key={card.id}
                card={card}
                picked={state.yours?.cardId === card.id}
                byPartner={state.theirs?.cardId === card.id}
                onPick={() => pick(card)}
              />
            ))}
          </View>
        ))}

        {/* The deck is a prompt, not a cage: the best answer is often somebody
            the two of you actually know. */}
        <View style={{ gap: spacing.md }}>
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>Yours</Text>
          {mine.map((card) => (
            <PickCard
              key={card.id}
              card={card}
              picked={state.yours?.cardId === card.id}
              byPartner={state.theirs?.cardId === card.id}
              onPick={() => pick(card)}
            />
          ))}

          {customs.length + invented.length < MAX_CUSTOM_CARDS ? (
            adding ? (
              <View style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface }}>
                <TextInput
                  value={customLabel}
                  onChangeText={setCustomLabel}
                  placeholder="Who, specifically?"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={80}
                  autoFocus
                  testID="input-custom-label"
                  style={inputStyle}
                />
                <TextInput
                  value={customDetail}
                  onChangeText={setCustomDetail}
                  placeholder="What makes them different?"
                  placeholderTextColor={colors.textTertiary}
                  maxLength={200}
                  style={inputStyle}
                />
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Btn
                    label="Add"
                    disabled={!customLabel.trim()}
                    onPress={() => {
                      // Owned by you, so your invention and your partner's can
                      // never be read as the same card.
                      setCustoms([...customs, {
                        id: `custom:${youId}:${customs.length + invented.length}`,
                        label: customLabel.trim(),
                        detail: customDetail.trim(),
                        consequence: "Invented for this game.",
                        group: "Yours",
                      }]);
                      setCustomLabel("");
                      setCustomDetail("");
                      setAdding(false);
                    }}
                    testID="button-save-custom"
                  />
                  <Btn label="Cancel" variant="ghost" onPress={() => setAdding(false)} />
                </View>
              </View>
            ) : (
              <Pressable
                onPress={() => setAdding(true)}
                testID="button-add-custom"
                style={{
                  borderWidth: 1, borderStyle: "dashed", borderColor: colors.border,
                  borderRadius: radius.lg, padding: spacing.lg,
                  alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6,
                }}
              >
                <Icon name="add" size={16} color={colors.textSecondary} />
                <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>Add your own</Text>
              </Pressable>
            )
          ) : null}
        </View>
      </View>
    );
  }

  if (round === "product") {
    const coreCount = claims.filter((c) => c.core).length;
    return (
      <View style={{ gap: spacing.lg }}>
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>What does it do better?</Text>
            <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontVariant: ["tabular-nums"] }}>
              {claims.length}/{MAX_CLAIMS} · {coreCount}/{MAX_CORE_CLAIMS} core
            </Text>
          </View>

          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <TextInput
              value={claimText}
              onChangeText={setClaimText}
              placeholder="One thing it beats the alternatives at…"
              placeholderTextColor={colors.textTertiary}
              maxLength={160}
              editable={claims.length < MAX_CLAIMS}
              testID="input-claim"
              style={[inputStyle, { flex: 1 }]}
            />
            <Pressable
              onPress={() => {
                const t = claimText.trim();
                if (!t || claims.length >= MAX_CLAIMS) return;
                setClaims([...claims, { text: t, core: false }]);
                setClaimText("");
              }}
              style={{ width: 44, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="add" size={20} color={colors.primary} />
            </Pressable>
          </View>

          {claims.map((claim, i) => (
            <View
              key={`${claim.text}-${i}`}
              testID={`claim-${i}`}
              style={{
                flexDirection: "row", alignItems: "center", gap: spacing.sm,
                borderWidth: 1, borderColor: claim.core ? colors.primary : colors.border,
                backgroundColor: claim.core ? colors.primarySoft : colors.surface,
                borderRadius: radius.md, padding: spacing.md,
              }}
            >
              <Pressable
                onPress={() => {
                  // The cap binds here rather than silently dropping it later.
                  if (!claim.core && coreCount >= MAX_CORE_CLAIMS) return;
                  const next = [...claims];
                  next[i] = { ...claim, core: !claim.core };
                  setClaims(next);
                }}
                hitSlop={8}
              >
                <Icon name={claim.core ? "star" : "star-outline"} size={18} color={claim.core ? colors.primary : colors.textTertiary} />
              </Pressable>
              <Text style={{ flex: 1, color: colors.text, fontSize: font.sm }}>{claim.text}</Text>
              <Pressable onPress={() => setClaims(claims.filter((_, j) => j !== i))} hitSlop={8}>
                <Icon name="trash-outline" size={16} color={colors.textTertiary} />
              </Pressable>
            </View>
          ))}

          {claims.length > 0 && coreCount === 0 ? (
            <Text style={{ color: colors.warning, fontSize: font.xs }}>
              Star at least one — the reason this exists, not something nice it also does.
            </Text>
          ) : null}

          <Btn
            label={state.yours ? "Update my list" : "Put my list in"}
            disabled={busy || claims.length === 0 || coreCount === 0}
            onPress={() => onSubmit({ claims })}
            testID="button-commit-claims"
          />
        </View>

        {/* Both lists get kept, so seeing theirs is about not repeating them. */}
        {(state.theirs?.claims ?? []).length > 0 ? (
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface }}>
            <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>
              Theirs — both lists get kept
            </Text>
            {state.theirs.claims.map((c: Claim, i: number) => (
              <View key={i} style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
                <Icon name={c.core ? "star" : "star-outline"} size={14} color={c.core ? colors.primary : colors.textTertiary} />
                <Text style={{ flex: 1, color: colors.text, fontSize: font.sm }}>{c.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  const options: SpendOption[] = rules?.spendOptions ?? [];
  return (
    <View style={{ gap: spacing.lg }}>
      <GameBudgetRound
        allocation={allocation}
        onChange={setAllocation}
        options={options}
        partnerTotal={state.theirs?.allocation ? allocated(state.theirs.allocation) : null}
      />
      <Btn
        label={state.yours ? "Update my budget" : "Lock in my budget"}
        disabled={busy || allocated(allocation) === 0}
        onPress={() => onSubmit({ allocation })}
        testID="button-commit-budget"
      />
    </View>
  );
}

/** The reveal. */
function Verdict({ state, standings, onDone }: { state: any; standings: any; onDone: () => void }) {
  const v = state.verdict;

  if (!v) {
    return (
      <View style={{ paddingVertical: 60, alignItems: "center", gap: spacing.md }}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.semibold }}>
          Working out what you built…
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>Ten years is a long time.</Text>
      </View>
    );
  }

  /*
   * The model couldn't be reached. Said plainly rather than shown as a score —
   * a middling number presented as a judgement is one the product did not make
   * and cannot support.
   */
  if (!v.fromModel) {
    return (
      <View style={{ paddingVertical: 40, alignItems: "center", gap: spacing.md }}>
        <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>
          {state.game.idea?.name ?? "Your company"}
        </Text>
        <Text style={{ color: colors.textSecondary, textAlign: "center" }}>{v.summary}</Text>
        <Btn label="Play again" onPress={onDone} />
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
        backgroundColor: colors.primarySoft, padding: spacing.xl, alignItems: "center", gap: spacing.sm,
      }}>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>
          {state.game.idea?.name ?? "Your company"}, ten years from now
        </Text>
        <Text
          testID="verdict-ten-year"
          style={{ color: colors.text, fontSize: 40, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}
        >
          {money(v.tenYear)}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>
          Peak {money(v.peak)} in year {v.peakYear} · Overall {v.overall} ({scoreBand(v.overall)})
        </Text>
      </View>

      {v.summary ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.text, fontSize: font.sm, lineHeight: 21 }}>{v.summary}</Text>
        </View>
      ) : null}

      {standings?.scored ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>How you scored</Text>
          {standings.standings.map((row: any) => (
            <ScoreBar key={row.id} row={row} />
          ))}
        </View>
      ) : null}

      {(v.advice ?? []).length > 0 ? (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface }}>
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
            What would have made it worth more
          </Text>
          {v.advice.map((a: string, i: number) => (
            <Text key={i} style={{ color: colors.textSecondary, fontSize: font.sm }}>{i + 1}. {a}</Text>
          ))}
        </View>
      ) : null}

      <Btn label="Play again" onPress={onDone} testID="button-play-again" />
    </View>
  );
}

function ScoreBar({ row }: { row: any }) {
  /*
   * Filled by how *good* the score is, not its raw value, so the risk bar
   * doesn't read as a triumph when it is the opposite. The number stays the
   * real one — the board is called "lowest risk" and a fudge would show.
   */
  const goodness = row.id === "risk" ? SCORE_MAX - row.score : row.score;
  const pct = Math.max(2, (goodness / SCORE_MAX) * 100);
  const tint = pct >= 77.5 ? colors.success : pct >= 45 ? colors.info : pct >= 27.5 ? colors.warning : colors.danger;

  return (
    <View testID={`score-${row.id}`} style={{ gap: 5 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>{row.title}</Text>
        <Text style={{ color: colors.text, fontSize: font.sm, fontVariant: ["tabular-nums"] }}>
          <Text style={{ fontFamily: fontFamily.semibold }}>{row.score}</Text>
          <Text style={{ color: colors.textTertiary }}>/{SCORE_MAX}</Text>
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
        <View style={{ width: `${pct}%`, height: "100%", backgroundColor: tint, borderRadius: radius.pill }} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ flex: 1, color: colors.textTertiary, fontSize: font.xs }}>{row.blurb}</Text>
        {/* A number alone means nothing. A placing is the bit people read. */}
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium }}>
          {row.band} · {ordinal(row.rank)} of {row.of}
        </Text>
      </View>
    </View>
  );
}

function Chat({ gameId, players }: { gameId: string; players: GamePlayer[] }) {
  const [body, setBody] = useState("");
  const qc = useQueryClient();
  const { data } = useQuery<any>({
    queryKey: ["game-messages", gameId],
    queryFn: () => api<any>(`/api/games/${gameId}/messages`),
    refetchInterval: 2000,
  });

  const send = useMutation({
    mutationFn: () => api(`/api/games/${gameId}/messages`, { method: "POST", body: { body } }),
    onSuccess: () => { setBody(""); qc.invalidateQueries({ queryKey: ["game-messages", gameId] }); },
  });

  const messages = data?.messages ?? [];

  return (
    <View style={{ gap: spacing.md, maxHeight: 420 }}>
      <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
        {messages.length === 0 ? (
          <Text style={{ color: colors.textSecondary, fontSize: font.sm }}>
            This is where you argue. The round settles when you agree — or when the clock does it for you.
          </Text>
        ) : null}
        {messages.map((m: any) => {
          const who = players.find((p) => p.id === m.userId);
          return (
            <View key={m.id} style={{ alignItems: who?.isYou ? "flex-end" : "flex-start" }}>
              <Text style={{ color: colors.textTertiary, fontSize: font.xs }}>{who?.isYou ? "You" : who?.name ?? "Them"}</Text>
              <View style={{
                backgroundColor: who?.isYou ? colors.primary : colors.surfaceRaised,
                borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxWidth: "85%",
              }}>
                <Text style={{ color: who?.isYou ? colors.primaryText : colors.text, fontSize: font.sm }}>{m.body}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Say something"
          placeholderTextColor={colors.textTertiary}
          maxLength={1000}
          testID="input-chat"
          style={[inputStyle, { flex: 1 }]}
        />
        <Pressable
          onPress={() => body.trim() && send.mutate()}
          disabled={!body.trim() || send.isPending}
          style={{
            width: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center",
            backgroundColor: body.trim() ? colors.primary : colors.surfaceRaised,
          }}
        >
          <Icon name="send" size={18} color={body.trim() ? colors.primaryText : colors.textTertiary} />
        </Pressable>
      </View>
    </View>
  );
}

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.md,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.md,
  color: colors.text,
  fontSize: font.base,
  backgroundColor: colors.surface,
} as const;
