import { useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../../src/theme";
import { Avatar, Empty, ErrorState, Icon, Loading, Screen, Segments, TabStrip, assetUri, errText, type IconName } from "../../src/components/ui";
import { Pill, isSwitchedOff, tintSoft } from "../../src/components/MoreKit";

type Board = "builder" | "views" | "donations";
type Filter = "all" | "solo" | "team";

const RANK_COLORS = ["#CA8A04", "#94A3B8", "#B45309"];

/** The Builder Index tier names and colours, as on the web. */
function indexTier(score: number): { label: string; color: string } {
  if (score >= 80) return { label: "Elite", color: "#D97706" };
  if (score >= 60) return { label: "Advanced", color: colors.novaPurple };
  if (score >= 40) return { label: "Rising", color: colors.info };
  if (score >= 20) return { label: "Emerging", color: colors.novaEmerald };
  return { label: "New builder", color: colors.textTertiary };
}

const SCORES: { key: string; label: string; icon: IconName; color: string }[] = [
  { key: "executionScore", label: "Execution", icon: "flash", color: "#F59E0B" },
  { key: "contributionScore", label: "Contribution", icon: "people", color: colors.info },
  { key: "marketSignalScore", label: "Market signal", icon: "trending-up", color: colors.novaEmerald },
  { key: "strategicThinkingScore", label: "Strategy", icon: "bulb", color: colors.novaPurple },
];

/** Top builders by Builder Index, and top projects by views and funding — filtered to solo or team builds. */
export default function Leaderboard() {
  const router = useRouter();
  const [board, setBoard] = useState<Board>("builder");
  const [filter, setFilter] = useState<Filter>("all");

  const projects = useQuery({
    queryKey: ["leaderboard", board, filter],
    queryFn: () => api<any[]>(`/api/leaderboard?sortBy=${board}&filter=${filter}`),
    enabled: board !== "builder",
  });
  const builders = useQuery({
    queryKey: ["leaderboard", "reputation", filter],
    queryFn: () => api<any[]>(`/api/leaderboard/reputation?filter=${filter}&limit=20`),
    enabled: board === "builder",
  });
  const active = board === "builder" ? builders : projects;
  const list = active.data ?? [];

  return (
    <Screen canvas onRefresh={() => active.refetch()} refreshing={active.isRefetching} contentStyle={{ paddingHorizontal: 0, paddingTop: 0 }}>
      <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold }}>Leaderboard</Text>
          <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular }}>Top projects and builders making waves on SparkTower.</Text>
        </View>
        <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
          <Segments options={[{ value: "all" as Filter, label: "All projects" }, { value: "solo" as Filter, label: "Solo builds" }, { value: "team" as Filter, label: "Team builds" }]} value={filter} onChange={setFilter} />
        </View>
        <TabStrip
          options={[{ value: "builder" as Board, label: "Builder Index" }, { value: "views" as Board, label: "Most visited" }, { value: "donations" as Board, label: "Most funded" }]}
          value={board} onChange={setBoard}
        />
      </View>

      <View style={{ paddingHorizontal: spacing.md, gap: spacing.md }}>
        {active.isLoading ? <View style={{ height: 240 }}><Loading /></View>
          : active.error && isSwitchedOff(active.error) ? <Empty icon="pause-circle-outline" title="The leaderboard is paused" body="It's switched off right now. Check back soon." />
          /*
           * Any other failure. It used to fall through to the empty state, so
           * a dropped request read as "No projects ranked yet" — a claim about
           * SparkTower having nobody on it, on a screen whose whole purpose is
           * to show that people are building. Pull-to-refresh was the only way
           * back and nothing said so.
           */
          : active.error && !active.data ? (
            <ErrorState
              title="Couldn't load the leaderboard"
              message={errText(active.error, "We couldn't reach the server.")}
              onRetry={() => void active.refetch()}
            />
          )
          : list.length === 0 ? (
            <Empty icon="trophy-outline"
              title={board === "builder" ? "No builder scores yet" : "No projects ranked yet"}
              body={board === "builder" ? "Calculate your Builder Reputation Index from your profile to appear here." : "Public projects show up here as they gain views and backing."} />
          ) : board === "builder" ? (
            <>
              <BuilderHero entry={list[0]} onPress={() => router.push(`/user/${list[0].userId}`)} />
              {list.length > 1 && (
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {list.slice(1, 3).map((e, i) => (
                    <PodiumTile key={e.userId} rank={i + 2} onPress={() => router.push(`/user/${e.userId}`)}
                      top={<Avatar name={e.user?.firstName || "Builder"} uri={e.user?.profileImageUrl} size={48} />}
                      title={nameOf(e.user)} sub={indexTier(e.builderIndex).label} subColor={indexTier(e.builderIndex).color}
                      metric={String(e.builderIndex)} metricLabel="Builder Index" />
                  ))}
                  {list.length === 2 && <View style={{ flex: 1 }} />}
                </View>
              )}
              {list.length > 3 && (
                <ListCard>
                  {list.slice(3).map((e, i) => {
                    const tier = indexTier(e.builderIndex);
                    return (
                      <Row key={e.userId} rank={i + 4} onPress={() => router.push(`/user/${e.userId}`)}
                        lead={<Avatar name={e.user?.firstName || "Builder"} uri={e.user?.profileImageUrl} size={38} />}
                        title={nameOf(e.user)}
                        sub={<View style={{ gap: 5 }}>
                          <Pill label={tier.label} color={tier.color} />
                          <View style={{ flexDirection: "row", gap: 6 }}>
                            {SCORES.map((s) => <MiniBar key={s.key} icon={s.icon} color={s.color} value={e[s.key] ?? 0} />)}
                          </View>
                        </View>}
                        metric={<Text style={{ color: colors.primary, fontSize: font.lg, fontFamily: fontFamily.bold }}>{e.builderIndex}</Text>} />
                    );
                  })}
                </ListCard>
              )}
            </>
          ) : (
            <>
              <ProjectHero project={list[0]} metric={board} onPress={() => router.push(`/project/${list[0].id}`)} />
              {list.length > 1 && (
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {list.slice(1, 3).map((p, i) => (
                    <PodiumTile key={p.id} rank={i + 2} onPress={() => router.push(`/project/${p.id}`)}
                      top={<ProjectMark project={p} size={48} />}
                      title={p.title} sub={`by ${p.owner?.firstName || "a builder"}`}
                      metric={metricValue(p, board)} metricLabel={board === "views" ? "views" : "raised"} lock={p.isPrivate} />
                  ))}
                  {list.length === 2 && <View style={{ flex: 1 }} />}
                </View>
              )}
              {list.length > 3 && (
                <ListCard>
                  {list.slice(3).map((p, i) => (
                    <Row key={p.id} rank={i + 4} onPress={() => router.push(`/project/${p.id}`)}
                      lead={<ProjectMark project={p} size={38} />}
                      title={p.title} lock={p.isPrivate}
                      sub={<View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Text style={meta}>by {p.owner?.firstName || p.owner?.email || "a builder"}</Text>
                        {p.soloMode ? <Pill label="Solo" /> : (p.rolesNeeded ?? []).slice(0, 2).map((r: string) => <Pill key={r} label={r} color={colors.textSecondary} />)}
                      </View>}
                      metric={<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Icon name={board === "views" ? "eye-outline" : "cash-outline"} size={15} color={colors.textSecondary} />
                        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{metricValue(p, board)}</Text>
                      </View>} />
                  ))}
                </ListCard>
              )}
            </>
          )}
      </View>
    </Screen>
  );
}

const nameOf = (u: any) => u?.firstName || u?.email || "Unknown";
const metricValue = (p: any, board: Board) =>
  board === "views" ? (p.views ?? 0).toLocaleString() : `$${Math.round((p.totalDonations ?? 0) / 100).toLocaleString()}`;

function RankBadge({ rank, size = 26 }: { rank: number; size?: number }) {
  const c = RANK_COLORS[rank - 1] ?? colors.textTertiary;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tintSoft(c, 0.16), borderWidth: 1, borderColor: tintSoft(c, 0.45), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: c, fontSize: size * 0.48, fontFamily: fontFamily.bold }}>{rank}</Text>
    </View>
  );
}

function BuilderHero({ entry, onPress }: { entry: any; onPress: () => void }) {
  const tier = indexTier(entry.builderIndex);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [card, { borderColor: colors.primary, borderWidth: 1.5, marginTop: spacing.md }, pressed && { opacity: 0.85 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <View>
          <Avatar name={entry.user?.firstName || "Builder"} uri={entry.user?.profileImageUrl} size={64} />
          <View style={{ position: "absolute", top: -6, right: -6 }}><Icon name="trophy" size={22} color={RANK_COLORS[0]} /></View>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <RankBadge rank={1} size={22} />
            <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold, flexShrink: 1 }} numberOfLines={1}>{nameOf(entry.user)}</Text>
          </View>
          <Pill label={tier.label} color={tier.color} />
        </View>
        <View style={{ alignItems: "center" }}>
          <Text style={{ color: colors.primary, fontSize: 34, fontFamily: fontFamily.bold }}>{entry.builderIndex}</Text>
          <Text style={meta}>Builder Index</Text>
        </View>
      </View>
      <View style={{ gap: 6, marginTop: spacing.xs }}>
        {SCORES.map((s) => (
          <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name={s.icon} size={13} color={s.color} />
            <Text style={[meta, { width: 88 }]}>{s.label}</Text>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
              <View style={{ width: `${Math.min(100, entry[s.key] ?? 0)}%`, height: "100%", backgroundColor: s.color, borderRadius: 3 }} />
            </View>
            <Text style={[meta, { width: 24, textAlign: "right", color: colors.text }]}>{entry[s.key] ?? 0}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function ProjectHero({ project: p, metric, onPress }: { project: any; metric: Board; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [card, { borderColor: colors.primary, borderWidth: 1.5, marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md }, pressed && { opacity: 0.85 }]}>
      <View>
        <ProjectMark project={p} size={64} />
        <View style={{ position: "absolute", top: -6, right: -6 }}><Icon name="trophy" size={22} color={RANK_COLORS[0]} /></View>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <RankBadge rank={1} size={22} />
          {p.isPrivate && <Icon name="lock-closed" size={13} color={colors.textTertiary} />}
          <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold, flexShrink: 1 }} numberOfLines={1}>{p.title}</Text>
        </View>
        <Text style={meta}>by {p.owner?.firstName || p.owner?.email || "a builder"}</Text>
        {p.soloMode ? <Pill label="Solo" /> : null}
      </View>
      <View style={{ alignItems: "center" }}>
        <Text style={{ color: colors.primary, fontSize: 24, fontFamily: fontFamily.bold }}>{metricValue(p, metric)}</Text>
        <Text style={meta}>{metric === "views" ? "views" : "raised"}</Text>
      </View>
    </Pressable>
  );
}

function PodiumTile({ rank, top, title, sub, subColor, metric, metricLabel, onPress, lock }: {
  rank: number; top: React.ReactNode; title: string; sub: string; subColor?: string; metric: string; metricLabel: string; onPress: () => void; lock?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [card, { flex: 1, alignItems: "center", gap: 4 }, pressed && { opacity: 0.85 }]}>
      <View style={{ position: "absolute", top: 8, left: 8 }}><RankBadge rank={rank} size={22} /></View>
      {top}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
        {lock && <Icon name="lock-closed" size={12} color={colors.textTertiary} />}
        <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold, flexShrink: 1 }} numberOfLines={1}>{title}</Text>
      </View>
      <Text style={[meta, { color: subColor ?? colors.textSecondary, fontSize: font.xs }]} numberOfLines={1}>{sub}</Text>
      <Text style={{ color: colors.primary, fontSize: 20, fontFamily: fontFamily.bold }}>{metric}</Text>
      <Text style={[meta, { fontSize: font.xs }]}>{metricLabel}</Text>
    </Pressable>
  );
}

function ListCard({ children }: { children: React.ReactNode }) {
  return <View style={[card, { padding: 0, gap: 0, overflow: "hidden" }]}>{children}</View>;
}

function Row({ rank, lead, title, sub, metric, onPress, lock }: {
  rank: number; lead: React.ReactNode; title: string; sub: React.ReactNode; metric: React.ReactNode; onPress: () => void; lock?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderTopWidth: rank > 4 ? 1 : 0, borderColor: colors.borderSubtle }, pressed && { backgroundColor: colors.surfaceRaised }]}>
      <Text style={{ width: 22, textAlign: "center", color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.bold }}>{rank}</Text>
      {lead}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {lock && <Icon name="lock-closed" size={12} color={colors.textTertiary} />}
          <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold, flexShrink: 1 }} numberOfLines={1}>{title}</Text>
        </View>
        {sub}
      </View>
      {metric}
    </Pressable>
  );
}

function MiniBar({ icon, color, value }: { icon: IconName; color: string; value: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, width: 40 }}>
      <Icon name={icon} size={10} color={color} />
      <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceRaised, overflow: "hidden" }}>
        <View style={{ width: `${Math.min(100, value)}%`, height: "100%", backgroundColor: color }} />
      </View>
    </View>
  );
}

function ProjectMark({ project, size }: { project: any; size: number }) {
  const uri = assetUri(project.logoUrl);
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm + 2, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
      {uri ? <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
        : <Text style={{ color: colors.primary, fontSize: size * 0.42, fontFamily: fontFamily.bold }}>{(project.title || "?").charAt(0).toUpperCase()}</Text>}
    </View>
  );
}

const card = {
  backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  padding: spacing.md, gap: spacing.sm, ...shadow.card,
} as const;
const meta = { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular } as const;
