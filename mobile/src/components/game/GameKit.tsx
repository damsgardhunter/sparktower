/**
 * Ten Years From Now, on a phone.
 *
 * The web version's furniture, rebuilt against the native primitives: one
 * header, one clock, one way of showing a card. Rounds differ in what they
 * ask, not in how they look — a player has about six minutes per round and
 * none of it should go on relearning where things are.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Icon } from "../ui";
import { clockText, type DeckCard } from "./model";

export type { DeckCard };

/**
 * The round's clock.
 *
 * Amber under a minute, red under fifteen seconds. That colour change is the
 * only urgency signal on the screen — a clock that shouts the whole way
 * through teaches a player to ignore it, which is the opposite of what a
 * deadline is for.
 */
export function RoundClock({ secondsLeft }: { secondsLeft: number | null }) {
  const urgent = secondsLeft !== null && secondsLeft <= 15;
  const soon = secondsLeft !== null && secondsLeft <= 60;
  const tint = urgent ? colors.danger : soon ? colors.warning : colors.textSecondary;

  return (
    <View
      testID="round-clock"
      style={{
        flexDirection: "row", alignItems: "center", gap: 6,
        backgroundColor: urgent ? "#FDECEB" : soon ? "#FEF3E2" : colors.surfaceRaised,
        paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
      }}
    >
      <Icon name="time-outline" size={14} color={tint} />
      <Text style={{ color: tint, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
        {clockText(secondsLeft)}
      </Text>
    </View>
  );
}

/** Where you are in the five. */
export function RoundRail({ rounds, current }: { rounds: string[]; current: string }) {
  const at = rounds.indexOf(current);
  return (
    <View style={{ flexDirection: "row", gap: 6 }} testID="round-rail">
      {rounds.map((r, i) => (
        <View
          key={r}
          style={{
            flex: 1, height: 5, borderRadius: radius.pill,
            backgroundColor: i < at ? colors.primary : i === at ? colors.accent : colors.surfaceRaised,
          }}
        />
      ))}
    </View>
  );
}

export function RoundHeader({
  title, blurb, secondsLeft, rounds, current,
}: {
  title: string; blurb: string; secondsLeft: number | null;
  rounds: string[]; current: string;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }} testID="round-title">
            {title}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, marginTop: 2 }}>{blurb}</Text>
        </View>
        <RoundClock secondsLeft={secondsLeft} />
      </View>
      <RoundRail rounds={rounds} current={current} />
    </View>
  );
}

export interface GamePlayer {
  id: string; name: string; avatar: string | null; isBot: boolean; isYou: boolean;
}

/**
 * Who is playing, and whether they've answered.
 *
 * "Waiting on Ada" is the most useful thing this screen can say while a clock
 * runs — the difference between a pause that feels like a game and one that
 * feels broken.
 */
export function Players({ players, answered }: { players: GamePlayer[]; answered: Record<string, boolean> }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }} testID="players">
      {players.map((p) => (
        <View
          key={p.id}
          style={{
            flexDirection: "row", alignItems: "center", gap: 6,
            borderWidth: 1, borderColor: answered[p.id] ? colors.primary : colors.border,
            backgroundColor: answered[p.id] ? colors.primarySoft : colors.surface,
            paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill,
          }}
        >
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>
            {p.isYou ? "You" : p.name}
          </Text>
          {/* A bot carries an ordinary name so the game reads like a game.
              This is what keeps that honest. */}
          {p.isBot ? (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 5 }}>
              <Text style={{ color: colors.textTertiary, fontSize: 10 }}>Bot</Text>
            </View>
          ) : null}
          <Icon
            name={answered[p.id] ? "checkmark-circle" : "ellipsis-horizontal"}
            size={14}
            color={answered[p.id] ? colors.primary : colors.textTertiary}
          />
        </View>
      ))}
    </View>
  );
}

/**
 * One card.
 *
 * The consequence stays visible rather than hiding behind a tap. The deck's
 * whole design rule is that every card is specific enough to be wrong, and a
 * player who must open each of eighteen to find that out will pick from the
 * three they happened to open.
 */
export function PickCard({
  card, picked, byPartner, onPick,
}: { card: DeckCard; picked: boolean; byPartner: boolean; onPick: () => void }) {
  return (
    <Pressable
      onPress={onPick}
      testID={`card-${card.id}`}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: picked ? colors.primary : colors.border,
        backgroundColor: picked ? colors.primarySoft : colors.surface,
        borderRadius: radius.lg,
        padding: spacing.lg,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>
          {card.label}
        </Text>
        {picked ? <Icon name="checkmark-circle" size={18} color={colors.primary} /> : null}
      </View>

      <Text style={{ color: colors.textSecondary, fontSize: font.sm, marginTop: 4 }}>{card.detail}</Text>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.borderSubtle, marginTop: spacing.md, paddingTop: spacing.sm }}>
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 17 }}>{card.consequence}</Text>
      </View>

      {/* Your partner's pick, on the card itself. You cannot argue somebody
          round if you have to look somewhere else to see what they chose. */}
      {byPartner ? (
        <View style={{
          position: "absolute", top: -8, right: spacing.md,
          backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2,
        }}>
          <Text style={{ fontSize: 10, color: colors.text, fontFamily: fontFamily.medium }}>Their pick</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

