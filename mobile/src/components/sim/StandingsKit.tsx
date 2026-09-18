/**
 * The pieces the standings screen is made of.
 *
 * The same gradient header and section headings as the desk and the market,
 * with one thing they don't have: a chart. It is drawn with Views — a bar per
 * year, scaled in standings.ts — because a charting library for nine
 * rectangles would be a dependency somebody maintains forever in exchange for
 * rounded corners.
 *
 * ## The table shows the incumbents
 *
 * They hold most of the market. A league table with only the five player teams
 * in it would tell everybody they were doing three times better than they are,
 * which is the single easiest way to make this screen a lie. Fourth of nine is
 * the honest answer and it is the one on the card.
 */
import React from "react";
import { Text, View } from "react-native";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../theme";
import { Icon, NovaGradient } from "../ui";
import { Pill, tintSoft } from "../MoreKit";
import { exact, money, signed } from "./desk";
import {
  ordinal, reputationRead, shareRead, soldUp,
  type StandingRow, type TrajectoryPoint,
} from "./standings";

/**
 * The top of the table: where you are, in both of the ways that count.
 *
 * The position is the headline rather than the share, because "4th of 9" is
 * the sentence somebody repeats to four other people in a group chat, and the
 * share is the number that explains it.
 */
export function StandingsBanner({ year, totalYears, you, line, gap }: {
  year: number;
  totalYears: number;
  you: StandingRow | null;
  /** "4th of 9 in the market, 2nd of the 5 teams." */
  line: string | null;
  /** How far behind whoever is immediately ahead. */
  gap: string | null;
}) {
  return (
    <NovaGradient style={{ borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm, ...shadow.card }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.6 }}>
            YEAR {year} OF {totalYears} · STANDINGS
          </Text>
          <Text style={{ color: "#FFFFFF", fontSize: font.xl, fontFamily: fontFamily.bold, letterSpacing: -0.3 }}>
            {line ?? "Where everyone stands"}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.92)", fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
            {gap ?? "Teams and incumbents in one table. The incumbents were here first and they hold most of the market — a table without them would flatter everybody."}
          </Text>
        </View>
        {you ? (
          <View
            testID="standings-your-rank"
            accessibilityLabel={`You are ${ordinal(you.rank)}`}
            style={{
              alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
              borderRadius: radius.sm, backgroundColor: "rgba(0,0,0,0.18)", minWidth: 74,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 24, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>
              {ordinal(you.rank)}
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, fontFamily: fontFamily.semibold, letterSpacing: 0.4 }}>
              {shareRead(you.share)}
            </Text>
          </View>
        ) : null}
      </View>
    </NovaGradient>
  );
}

/**
 * One company in the league table.
 *
 * The bar is share of the whole market, scaled against the leader rather than
 * against 100% — otherwise every team in a market with a 40% incumbent gets a
 * sliver and the table reads as nine identical rows. The number beside it is
 * the true share, so nothing the bar exaggerates goes unlabelled.
 */
export function StandingRowView({ row, leaderShare }: { row: StandingRow; leaderShare: number }) {
  const tone = row.isYou ? colors.primary : row.kind === "incumbent" ? colors.textSecondary : colors.novaPurple;
  const fraction = leaderShare > 0 ? Math.max(0, Math.min(1, row.share / leaderShare)) : 0;

  return (
    <View
      testID={`standings-row-${row.id}`}
      accessibilityLabel={`${ordinal(row.rank)}, ${row.name}, ${shareRead(row.share)} of the market`}
      style={{
        flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
        paddingVertical: spacing.sm, paddingHorizontal: row.isYou ? spacing.sm : 0,
        borderRadius: radius.sm,
        backgroundColor: row.isYou ? tintSoft(colors.primary, 0.08) : "transparent",
      }}
    >
      <Text style={{
        width: 26, color: row.isYou ? colors.primary : colors.textTertiary, fontSize: font.sm,
        fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"], textAlign: "right", paddingTop: 1,
      }}>
        {row.rank}
      </Text>

      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: row.isYou ? fontFamily.bold : fontFamily.medium }}>
            {row.name}
          </Text>
          {row.isYou ? <Pill label="You" color={colors.primary} solid /> : null}
          {row.kind === "incumbent" ? <Pill label="Incumbent" color={colors.textSecondary} /> : null}
          {row.distress && row.distress !== "healthy" ? (
            <Pill
              label={row.distress === "insolvent" ? "Insolvent" : row.distress === "distressed" ? "In trouble" : "Stretched"}
              color={row.distress === "strained" ? colors.warning : colors.danger}
            />
          ) : null}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
            <View style={{ width: `${fraction * 100}%`, height: "100%", backgroundColor: tone }} />
          </View>
          <Text style={{
            width: 48, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold,
            fontVariant: ["tabular-nums"], textAlign: "right",
          }}>
            {shareRead(row.share)}
          </Text>
        </View>

        <Text style={{ color: colors.textTertiary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular, fontVariant: ["tabular-nums"] }}>
          {money(row.customers)} customers · {money(row.revenue)} revenue · {exact(row.price)} a head · {reputationRead(row.reputation)} ({row.reputation})
        </Text>

        {/* A team with nothing left has sold the business, and that is a
            strategy rather than a collapse. Saying so here stops the row from
            reading as somebody who was knocked out. */}
        {soldUp(row) ? (
          <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular }}>
            Sold the business. They keep the company, the seats and the cash, and are rebuilding from here.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The season as a shape: one bar a year, and what each year actually was.
 *
 * This is the part of the screen that answers "was that a good year?". A
 * table tells you where you are; only the trajectory tells you which direction
 * you got there from, and a team that has climbed from ninth to sixth is
 * having a completely different season from one that has fallen from third.
 *
 * Bars are share, scaled to the company's best year (standings.ts explains
 * why), coloured by whether the year made money — the two facts that can
 * disagree, and the disagreement is the interesting part.
 */
export function Trajectory({ points }: { points: TrajectoryPoint[] }) {
  if (points.length === 0) return null;

  return (
    <View testID="standings-trajectory" style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.xs, height: 120 }}>
        {points.map((point) => (
          <View key={point.year} style={{ flex: 1, alignItems: "center", gap: 4 }}>
            <Text style={{ color: colors.textTertiary, fontSize: 9, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
              {shareRead(point.share)}
            </Text>
            <View style={{ width: "100%", height: 84, justifyContent: "flex-end" }}>
              <View
                testID={`standings-bar-${point.year}`}
                accessibilityLabel={`Year ${point.year}: ${shareRead(point.share)} of the market, ${ordinal(point.rank)}`}
                style={{
                  width: "100%",
                  height: `${point.height * 100}%`,
                  borderRadius: 4,
                  backgroundColor: point.profitable ? colors.novaEmerald : colors.warning,
                  opacity: point.peak ? 1 : 0.8,
                }}
              />
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 10, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
              Y{point.year}
            </Text>
            <Text style={{ color: colors.textTertiary, fontSize: 9, fontFamily: fontFamily.regular }}>
              {ordinal(point.rank)}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        <Legend color={colors.novaEmerald} label="Year made a profit" />
        <Legend color={colors.warning} label="Year lost money" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }}>{label}</Text>
    </View>
  );
}

/** A year of the story in numbers, under the bars, newest first. */
export function HistoryRow({ point, previousShare }: { point: TrajectoryPoint; previousShare: number | null }) {
  const change = previousShare == null ? null : (point.share - previousShare) * 100;
  return (
    <View
      testID={`standings-history-${point.year}`}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.borderSubtle }}
    >
      <Text style={{ width: 28, color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"] }}>
        Y{point.year}
      </Text>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium, fontVariant: ["tabular-nums"] }}>
          {shareRead(point.share)} · {money(point.customers)} customers · {ordinal(point.rank)}
        </Text>
        {change != null ? (
          <Text style={{
            color: Math.abs(change) < 0.05 ? colors.textTertiary : change > 0 ? colors.success : colors.danger,
            fontSize: font.xs, fontFamily: fontFamily.regular, fontVariant: ["tabular-nums"],
          }}>
            {Math.abs(change) < 0.05 ? "Level on the year before" : `${signed(change, 1)}pp on the year before`}
          </Text>
        ) : null}
      </View>
      <Text style={{
        color: point.profitable ? colors.success : colors.danger, fontSize: font.sm,
        fontFamily: fontFamily.semibold, fontVariant: ["tabular-nums"],
      }}>
        {point.profit >= 0 ? money(point.profit) : `−${money(Math.abs(point.profit))}`}
      </Text>
    </View>
  );
}

/** Before the first year resolves there is no story yet, and saying so beats an empty chart. */
export function NoHistoryYet({ year }: { year: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
      <Icon name="hourglass-outline" size={15} color={colors.textTertiary} />
      <Text style={{ flex: 1, color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>
        Year {year} hasn't resolved yet, so there is nothing to plot. The shape of the season starts after the first tick.
      </Text>
    </View>
  );
}
