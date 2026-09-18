/**
 * The pieces both simulation screens are made of.
 *
 * Sits on top of ui.tsx and MoreKit the way SprintKit does, and only holds
 * what the market picker and the room would otherwise each restate: the
 * gradient phase banner, a seat in a list, an open seat with its levers, and
 * the two ways of reading a market.
 */
import React from "react";
import { Pressable, Text, View } from "react-native";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../theme";
import { Avatar, Btn, Icon, NovaGradient } from "../ui";
import { Pill, tintSoft } from "../MoreKit";
import {
  POSTURE_COPY, clockIsUrgent, formatCount, loyaltyRead, seatStatus,
  type RoomCopy, type SimIncumbent, type SimRole, type SimSeat, type SimSegment,
} from "./lobby";

/**
 * The top of the room: what phase it is, and how long is left.
 *
 * Nova's gradient, as the home screen uses it — this is the one moment in the
 * app where five people are looking at the same surface at the same time, and
 * it should look like the front of the product rather than a status bar.
 */
export function PhaseBanner({ copy, clock, seconds, showClock = true }: {
  copy: RoomCopy;
  clock: string;
  seconds: number;
  showClock?: boolean;
}) {
  return (
    <NovaGradient style={{ borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, ...shadow.card }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: "#FFFFFF", fontSize: font.xl, fontFamily: fontFamily.bold, letterSpacing: -0.3 }}>
            {copy.title}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            {copy.body}
          </Text>
        </View>
        {showClock && (
          <View
            testID="sim-countdown"
            accessibilityLabel={`${clock} left`}
            style={{
              alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
              borderRadius: radius.sm, backgroundColor: "rgba(0,0,0,0.18)", minWidth: 74,
            }}
          >
            <Text style={{
              color: "#FFFFFF", fontSize: 24, fontFamily: fontFamily.bold,
              fontVariant: ["tabular-nums"],
              // The last minute is a deadline rather than a fact; it should look like one.
              opacity: clockIsUrgent(seconds) ? 1 : 0.92,
            }}>
              {clock}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
              {clockIsUrgent(seconds) ? "HURRY" : "LEFT"}
            </Text>
          </View>
        )}
      </View>
      {showClock && copy.deadline ? (
        <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: font.xs, fontFamily: fontFamily.medium }}>
          {clock} {copy.deadline}
        </Text>
      ) : null}
    </NovaGradient>
  );
}

/** One person in the room: who they are, what they hold, and whether they chose it. */
export function SeatRow({ seat, roleTitle }: { seat: SimSeat; roleTitle: string | null }) {
  const status = seatStatus(seat, roleTitle);
  return (
    <View
      testID={`sim-seat-${seat.userId}`}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm }}
    >
      <Avatar name={seat.name} uri={seat.avatarUrl} size={36} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{seat.name}</Text>
          {seat.isYou ? <Pill label="You" color={colors.primary} /> : null}
        </View>
        <Text
          style={{
            color: status.settled ? colors.textSecondary : colors.textTertiary,
            fontSize: font.sm,
            fontFamily: status.settled ? fontFamily.medium : fontFamily.regular,
            fontStyle: status.settled ? "normal" : "italic",
          }}
        >
          {status.label}
        </Text>
        {/* Being dealt a seat is a different experience from choosing one, and
            a player who isn't told assumes the game picked for them at random. */}
        {status.note ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="shuffle" size={12} color={colors.warning} />
            <Text style={{ color: colors.warning, fontSize: font.xs, fontFamily: fontFamily.medium }}>{status.note}</Text>
          </View>
        ) : null}
      </View>
      {status.settled ? <Icon name="checkmark-circle" size={20} color={colors.success} /> : null}
    </View>
  );
}

/** A place in the room nobody has arrived in yet. */
export function EmptySeatRow({ index }: { index: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, opacity: 0.6 }}>
      <View style={{
        width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderStyle: "dashed",
        borderColor: colors.border, alignItems: "center", justifyContent: "center",
      }}>
        <Icon name="person-add-outline" size={16} color={colors.textTertiary} />
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular }}>
        Waiting for someone{index === 0 ? " to join" : ""}…
      </Text>
    </View>
  );
}

/** What a seat controls, bulleted — the reason anyone argues over it. */
export function LeverList({ levers, color = colors.textSecondary }: { levers: string[]; color?: string }) {
  return (
    <View style={{ gap: 3 }}>
      {levers.map((lever) => (
        <View key={lever} style={{ flexDirection: "row", gap: 6 }}>
          <Text style={{ color: colors.textTertiary, fontSize: font.sm, lineHeight: 18 }}>·</Text>
          <Text style={{ flex: 1, color, fontSize: font.sm, lineHeight: 18, fontFamily: fontFamily.regular }}>{lever}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * An open seat, with what it actually controls and a button to take it.
 *
 * `claiming` is deliberately per-seat while `disabled` covers all of them: a
 * claim is a race the server settles, so exactly one request is allowed to be
 * in flight and the others grey out until it comes back with an answer.
 */
export function OpenSeatCard({ role, onClaim, claiming, disabled }: {
  role: SimRole;
  onClaim: () => void;
  claiming: boolean;
  disabled: boolean;
}) {
  return (
    <View style={{
      borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm, ...shadow.card,
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{
          width: 32, height: 32, borderRadius: 9, backgroundColor: tintSoft(colors.primary),
          alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ color: colors.primary, fontSize: font.xs, fontFamily: fontFamily.bold }}>
            {role.id.toUpperCase()}
          </Text>
        </View>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{role.title}</Text>
      </View>
      <LeverList levers={role.levers} />
      <Btn
        label={claiming ? "Taking it…" : "Take this seat"}
        icon="hand-left-outline"
        small
        variant="outline"
        loading={claiming}
        disabled={disabled}
        onPress={onClaim}
        testID={`sim-claim-${role.id}`}
      />
    </View>
  );
}

/** A customer segment, with the loyalty that decides whether it's winnable. */
export function SegmentRow({ segment, share }: { segment: SimSegment; share: number }) {
  const read = loyaltyRead(segment.loyalty);
  return (
    <View style={{ gap: 4, paddingVertical: spacing.sm, borderTopWidth: 1, borderColor: colors.borderSubtle }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{segment.name}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
          {formatCount(segment.size)} · {share}%
        </Text>
      </View>
      <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 17, fontFamily: fontFamily.regular }}>
        {segment.description}
      </Text>
      {/* Loyalty drawn as well as named: a bar makes three segments comparable
          in a glance, the words say what the bar means. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
          <View style={{ width: `${Math.round(segment.loyalty * 100)}%`, height: "100%", backgroundColor: read.color }} />
        </View>
        <Pill label={read.label} color={read.color} />
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>{read.hint}</Text>
    </View>
  );
}

/** An incumbent, and how it will fight back. */
export function IncumbentRow({ incumbent }: { incumbent: SimIncumbent }) {
  const posture = POSTURE_COPY[incumbent.posture] ?? { label: incumbent.posture, hint: "" };
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: 5 }}>
      <Text style={{
        width: 40, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.bold,
        fontVariant: ["tabular-nums"], textAlign: "right",
      }}>
        {Math.round(incumbent.share * 100)}%
      </Text>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium }}>
          {incumbent.name} <Text style={{ color: colors.textTertiary, fontFamily: fontFamily.regular }}>· {posture.label}</Text>
        </Text>
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>{posture.hint}</Text>
      </View>
    </View>
  );
}

/** A section heading inside a scrolling screen — matches the sprints tab's. */
export function SimSectionTitle({ icon, title, color = colors.primary }: {
  icon: React.ComponentProps<typeof Icon>["name"];
  title: string;
  color?: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2 }}>
      <Icon name={icon} size={16} color={color} />
      <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{title}</Text>
    </View>
  );
}

/** A tappable disclosure header, for the seats list on the market picker. */
export function Disclosure({ label, open, onPress, testID }: {
  label: string;
  open: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: spacing.xs }, pressed && { opacity: 0.65 }]}
    >
      <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{label}</Text>
      <Icon name={open ? "chevron-up" : "chevron-down"} size={15} color={colors.primary} />
    </Pressable>
  );
}
