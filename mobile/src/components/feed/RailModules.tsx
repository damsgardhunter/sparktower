/**
 * The website home rail's discovery modules — New projects, Top projects,
 * People to build with — as boxes dropped between posts on the phone, the way
 * a feed app interleaves suggestions instead of stacking them all at the top.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Avatar } from "../ui";
import { Box, BoxDivider, BoxHeader } from "./Box";

export type RailModuleKind = "top" | "people" | "new";

/** Which module follows which post (by index), and the order any left over are shown after the last post. */
export const RAIL_SLOTS: { after: number; kind: RailModuleKind }[] = [
  { after: 2, kind: "top" },
  { after: 6, kind: "people" },
  { after: 11, kind: "new" },
];

export function RailModule({ kind }: { kind: RailModuleKind }) {
  if (kind === "top") return <TopProjects />;
  if (kind === "people") return <PeopleToBuildWith />;
  return <NewProjects />;
}

interface ProjectRow {
  id: string;
  title: string;
  category?: string | null;
  isPrivate?: boolean;
  views?: number;
  owner?: { firstName?: string | null; email?: string | null } | null;
  profile?: { avatarUrl?: string | null } | null;
}

function Row({ onPress, testID, children }: { onPress: () => void; testID?: string; children: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceRaised }]}>
      {children}
    </Pressable>
  );
}

function NewProjects() {
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ["projects", "all"], queryFn: () => api<ProjectRow[]>("/api/projects") });
  if (isLoading) return null;
  return (
    <Box>
      <BoxHeader title="New projects" onAction={() => router.push("/(tabs)/projects")} />
      {data?.length ? data.slice(0, 5).map((p) => (
        <Row key={p.id} onPress={() => router.push(`/project/${p.id}` as any)} testID={`rail-project-${p.id}`}>
          <Avatar name={p.owner?.firstName || p.title} uri={p.profile?.avatarUrl} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={s.titleRow}>
              {p.isPrivate && <Ionicons name="lock-closed" size={11} color={colors.warning} />}
              <Text style={s.title} numberOfLines={1}>{p.title}</Text>
            </View>
            <Text style={s.sub} numberOfLines={1}>{p.category} · by {p.owner?.firstName || "a builder"}</Text>
          </View>
        </Row>
      )) : <Text style={s.empty}>No projects yet. Start the first one.</Text>}
    </Box>
  );
}

const PODIUM = [
  { bg: "rgba(234,179,8,0.15)", fg: "#CA8A04" },
  { bg: "rgba(148,163,184,0.20)", fg: "#475569" },
  { bg: "rgba(217,119,6,0.15)", fg: "#B45309" },
];

function TopProjects() {
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ["leaderboard", "views", "home"], queryFn: () => api<ProjectRow[]>("/api/leaderboard?sortBy=views") });
  if (isLoading) return null;
  return (
    <Box>
      <BoxHeader title="Top projects" onAction={() => router.push("/(tabs)/leaderboard" as any)} />
      {data?.length ? data.slice(0, 5).map((p, i) => {
        const podium = PODIUM[i];
        return (
          <Row key={p.id} onPress={() => router.push(`/project/${p.id}` as any)} testID={`rail-top-${p.id}`}>
            <View style={[s.rank, { backgroundColor: podium?.bg ?? colors.surfaceRaised }]}>
              {i === 0
                ? <Ionicons name="trophy" size={11} color={podium.fg} />
                : <Text style={[s.rankText, { color: podium?.fg ?? colors.textTertiary }]}>{i + 1}</Text>}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.title} numberOfLines={1}>{p.title}</Text>
              <Text style={s.sub} numberOfLines={1}>by {p.owner?.firstName || p.owner?.email || "a builder"}</Text>
            </View>
            <View style={s.views}>
              <Ionicons name="eye-outline" size={12} color={colors.textTertiary} />
              <Text style={s.sub}>{(p.views ?? 0).toLocaleString()}</Text>
            </View>
          </Row>
        );
      }) : <Text style={s.empty}>Nothing on the leaderboard yet.</Text>}
    </Box>
  );
}

interface MatchRow {
  id: string;
  score: number | null;
  matchedUser: { id: string; firstName?: string | null };
  matchedProfile?: { displayName?: string | null; headline?: string | null; avatarUrl?: string | null } | null;
}

function PeopleToBuildWith() {
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ["matches"], queryFn: () => api<MatchRow[]>("/api/matches") });
  if (isLoading) return null;
  return (
    <Box>
      <BoxHeader title="People to build with" onAction={() => router.push("/matches" as any)} />
      {data?.length ? (
        <>
          {data.slice(0, 4).map((m) => {
            const name = m.matchedProfile?.displayName || m.matchedUser.firstName || "A builder";
            return (
              <Row key={m.id} onPress={() => router.push(`/user/${m.matchedUser.id}` as any)} testID={`rail-match-${m.id}`}>
                <Avatar name={name} uri={m.matchedProfile?.avatarUrl} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.title} numberOfLines={1}>{name}</Text>
                  <Text style={s.sub} numberOfLines={1}>{m.matchedProfile?.headline || "Builder on SparkTower"}</Text>
                </View>
                {m.score != null && <Text style={s.score}>{m.score}%</Text>}
              </Row>
            );
          })}
          <BoxDivider />
          <Pressable onPress={() => router.push("/matches" as any)} style={s.more} testID="rail-see-matches">
            <Ionicons name="person-add-outline" size={13} color={colors.primary} />
            <Text style={s.moreText}>Find more collaborators</Text>
          </Pressable>
        </>
      ) : <Text style={s.empty}>No matches yet — completing your profile is what makes these good.</Text>}
    </Box>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: -spacing.md, paddingHorizontal: spacing.md, paddingVertical: 6 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  title: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.medium, flexShrink: 1 },
  sub: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular },
  empty: { color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular, paddingTop: 4 },
  rank: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rankText: { fontSize: 10, fontFamily: fontFamily.bold },
  views: { flexDirection: "row", alignItems: "center", gap: 3 },
  score: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.semibold },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 2 },
  moreText: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.regular },
});
