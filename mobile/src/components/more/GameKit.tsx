/**
 * Shared pieces for the games screens (app/games/**): the paused state, the
 * leaderboard list both games show on their Leaderboard tab, player names,
 * and the invite link for a typing race.
 */
import React from "react";
import { Share, Text, View, type StyleProp, type ViewStyle } from "react-native";
import * as Clipboard from "expo-clipboard";
import { API_URL } from "../../api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../theme";
import { Avatar, Empty, Icon, Loading, type IconName } from "../ui";
import { useSurfaces } from "../MoreKit";

export const gameStyles = {
  page: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, ...shadow.card },
  h3: { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold },
  body: { color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular },
  meta: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular },
  small: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular },
} as const;

/** A player's display name from the joined user row; the web falls back to "Player". */
export const playerName = (u: any, fallback = "Player") =>
  [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.username || fallback;

/** Games is a kill-switched surface (off by default). True once we know it's off. */
export function useGamesOff() {
  const { on, loaded } = useSurfaces();
  return loaded && !on("games");
}

export function GamesPaused() {
  return <Empty icon="pause-circle-outline" title="Games are switched off" body="They're paused on SparkTower right now. Check back soon." />;
}

/** The web page for a race — the same /games/typing/:id link the website routes. */
export const raceLink = (id: string) => `${API_URL}/games/typing/${id}`;

export async function shareRace(id: string) {
  const url = raceLink(id);
  try {
    await Share.share({ message: `Race me in the Velocity Type Arena on SparkTower: ${url}`, url });
  } catch {
    // Share sheet dismissed or unavailable (web preview): fall back to the clipboard.
    await Clipboard.setStringAsync(url).catch(() => {});
  }
}

export async function copyRaceLink(id: string) {
  await Clipboard.setStringAsync(raceLink(id));
}

export interface BoardStat { label: string; value: React.ReactNode }

/** Rank, avatar, name, a subtitle, and up to three numbers — the web's leaderboard rows. */
export function BoardRow({ rank, user, subtitle, stats, highlight, style }: {
  rank: number;
  user: any;
  subtitle?: string | null;
  stats: BoardStat[];
  highlight?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const name = playerName(user);
  return (
    <View style={[{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm }, style]}>
      <View style={{ width: 26, alignItems: "center" }}>
        {rank === 1
          ? <Icon name="trophy" size={18} color="#CA8A04" />
          : <Text style={{ color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.bold }}>#{rank}</Text>}
      </View>
      <Avatar name={name} uri={user?.profileImageUrl} size={30} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: highlight ? colors.primary : colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }} numberOfLines={1}>{name}</Text>
        {subtitle ? <Text style={gameStyles.small} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {stats.map((s) => (
        <View key={s.label} style={{ alignItems: "center", minWidth: 44 }}>
          <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>{s.value}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontFamily: fontFamily.regular }}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** A full leaderboard in one white card, with its loading and empty states. */
export function Leaderboard({ entries, loading, emptyTitle, emptyIcon = "trophy-outline", row, meId }: {
  entries: any[] | undefined;
  loading: boolean;
  emptyTitle: string;
  emptyIcon?: IconName;
  row: (e: any) => { subtitle?: string | null; stats: BoardStat[] };
  meId?: string | null;
}) {
  if (loading) return <View style={{ height: 160 }}><Loading /></View>;
  if (!entries?.length) {
    return <View style={[gameStyles.card, { borderStyle: "dashed" }]}><Empty icon={emptyIcon} title={emptyTitle} /></View>;
  }
  return (
    <View style={[gameStyles.card, { paddingVertical: spacing.xs, gap: 0 }]}>
      {entries.map((e, i) => {
        const r = row(e);
        return (
          <BoardRow key={e.id ?? i} rank={i + 1} user={e.user} subtitle={r.subtitle} stats={r.stats} highlight={!!meId && e.userId === meId}
            style={i > 0 ? { borderTopWidth: 1, borderColor: colors.borderSubtle } : undefined} />
        );
      })}
    </View>
  );
}
