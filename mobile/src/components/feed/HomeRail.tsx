/**
 * The website home's rail, folded into the top of the phone's feed.
 *
 * On a desktop these sit beside the posts (client/src/pages/home.tsx): your
 * profile card, your projects, and "new since you last looked". A phone has one column, so they stack above the composer — each
 * compact, and each hidden when it has nothing to say, the way the web's are.
 */
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "../../api/client";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Avatar, assetUri } from "../ui";
import { Box, BoxHeader, ProjectTile, primaryTint } from "./Box";

// --- Profile ---------------------------------------------------------------

interface ProfileSummary {
  profile: { userId: string; displayName?: string | null; headline?: string | null; avatarUrl?: string | null; coverUrl?: string | null; location?: string | null } | null;
  stats: {
    projects: number;
    projectViews: number;
    following: number;
    connections: number;
    tasksCompleted: number;
    reputationScore: number | null;
    badges: number;
  };
}

/** profile-rail-card.tsx coverGradient: seeded from the user id, so it's stable and different per person. */
function coverColors(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return [`hsl(${hash}, 62%, 42%)`, `hsl(${(hash + 48) % 360}, 68%, 55%)`];
}

/**
 * The web's profile rail card, compact: cover band, avatar over its edge, who
 * you are, and the three "is anyone seeing this" numbers across one row.
 */
export function ProfileCard() {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ["profile-summary"],
    queryFn: () => api<ProfileSummary>("/api/profile/summary"),
  });
  if (isLoading) {
    return <Box padded={false} style={{ height: 118 }}><View style={s.coverBand} /></Box>;
  }
  if (!data) return null;
  const { profile, stats } = data;
  const name = profile?.displayName || "Your profile";
  const cover = assetUri(profile?.coverUrl, 640);

  const stat = (label: string, value: number | string, onPress: () => void, testID: string) => (
    <Pressable key={label} onPress={onPress} style={({ pressed }) => [s.stat, pressed && { backgroundColor: colors.surfaceRaised }]} testID={testID}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  return (
    <Box padded={false} testID="home-profile-card">
      <Pressable onPress={() => router.push("/(tabs)/profile")} accessibilityLabel="Your profile">
        {cover
          ? <Image source={{ uri: assetUri(cover)! }} style={s.coverBand} resizeMode="cover" />
          : <LinearGradient colors={coverColors(profile?.userId || name)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.coverBand} />}
        <View style={s.identity}>
          <View style={s.avatarWrap}>
            <Avatar name={name} uri={profile?.avatarUrl} size={56} ring />
          </View>
          <View style={{ flex: 1, minWidth: 0, paddingTop: 6 }}>
            <Text style={s.name} numberOfLines={1}>{name}</Text>
            {profile?.headline ? <Text style={s.headline} numberOfLines={2}>{profile.headline}</Text> : null}
            {profile?.location ? (
              <View style={s.location}>
                <Ionicons name="location-outline" size={11} color={colors.textTertiary} />
                <Text style={s.locationText} numberOfLines={1}>{profile.location}</Text>
              </View>
            ) : null}
            {!profile && <Text style={s.finish} onPress={() => router.push("/profile-builder" as any)}>Finish setting up your profile</Text>}
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} style={{ marginTop: 10 }} />
        </View>
      </Pressable>
      <View style={s.stats}>
        {stat("Project views", stats.projectViews.toLocaleString(), () => router.push("/(tabs)/projects"), "rail-stat-views")}
        <View style={s.statRule} />
        {stat("Connections", stats.connections, () => router.push("/network/connections" as any), "rail-stat-connections")}
        <View style={s.statRule} />
        {stats.reputationScore !== null
          ? stat("Builder index", stats.reputationScore, () => router.push("/(tabs)/leaderboard" as any), "rail-stat-reputation")
          : stat("Projects", stats.projects, () => router.push("/(tabs)/projects"), "rail-link-projects")}
      </View>
    </Box>
  );
}

// --- Your feedback was used -----------------------------------------------

interface FeedbackUsed {
  items: { commentId: string; comment: string; project: { id: string; title: string }; update: { id: string; excerpt: string; asks?: string[] } }[];
}

const EMERALD = "#059669";

/** feedback-inbox.tsx FeedbackUsedCard: a builder acted on something you said. */
export function FeedbackUsedCard() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["feedback-used"], queryFn: () => api<FeedbackUsed>("/api/me/feedback-used") });
  const dismiss = useMutation({
    mutationFn: (commentIds: string[]) => api("/api/me/feedback-used/seen", { method: "POST", body: { commentIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback-used"] }),
  });
  const items = data?.items ?? [];
  if (!items.length) return null;
  return (
    <Box style={s.usedBox} testID="feedback-used-card">
      <View style={s.usedHead}>
        <Ionicons name="repeat" size={16} color={EMERALD} />
        <Text style={s.usedTitle}>Your feedback was used</Text>
        <Pressable onPress={() => dismiss.mutate(items.map((i) => i.commentId))} disabled={dismiss.isPending} hitSlop={10} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      {items.map((i) => (
        <View key={i.commentId} style={{ gap: 6 }}>
          <Text style={s.usedText}>
            <Text style={{ fontFamily: fontFamily.medium }} onPress={() => router.push(`/project/${i.project.id}` as any)}>{i.project.title}</Text>
            <Text style={{ color: colors.textTertiary }}> acted on "{i.comment}" — </Text>
            <Text onPress={() => router.push(`/post/${i.update.id}` as any)}>{i.update.excerpt}</Text>
          </Text>
          {!!i.update.asks?.length && (
            <View style={s.usedAsks}>
              <Text style={s.usedAsksLabel}>Now they're asking:</Text>
              {i.update.asks.map((a) => <Text key={a} style={s.usedAsk}>•  {a}</Text>)}
            </View>
          )}
          <Pressable onPress={() => router.push(`/post/${i.update.id}` as any)} style={s.outlineBtn}>
            <Ionicons name="chatbox-ellipses-outline" size={13} color={colors.text} />
            <Text style={s.outlineBtnText}>{i.update.asks?.length ? "Answer their questions" : "See the update"}</Text>
          </Pressable>
        </View>
      ))}
    </Box>
  );
}

// --- Your projects ---------------------------------------------------------

interface MyProject {
  id: string;
  title: string;
  logoUrl: string | null;
  views: number;
}

/**
 * Your projects, most recently touched first, with a way into each one's
 * workspace. Side-scrolling on the phone so it costs one row.
 */
export function MyProjectsCard() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["my-projects"],
    queryFn: () => api<MyProject[]>("/api/user/projects"),
  });
  if (!data) return null;
  const projects = data;

  if (!projects.length) {
    return (
      <Box>
        <BoxHeader title="Your projects" />
        <Text style={s.emptyCopy}>Start one, then post updates as you build — what shipped, what's next, and what you want feedback on.</Text>
        <Pressable onPress={() => router.push("/project/new" as any)} style={[s.outlineBtn, { alignSelf: "stretch", marginTop: spacing.sm }]} testID="rail-create-project">
          <Ionicons name="add" size={15} color={colors.text} />
          <Text style={s.outlineBtnText}>Create project</Text>
        </Pressable>
      </Box>
    );
  }

  return (
    <Box padded={false}>
      <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
        <BoxHeader title="Your projects" onAction={() => router.push("/(tabs)/projects")} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.projectsRow}>
        {projects.map((p) => (
          <View key={p.id} style={s.projectCard} testID={`rail-project-${p.id}`}>
            <Pressable onPress={() => router.push(`/project/${p.id}` as any)} style={s.projectTop}>
              <ProjectTile title={p.title} uri={p.logoUrl} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.projectTitle} numberOfLines={1}>{p.title}</Text>
                <View style={s.projectMeta}>
                  <Ionicons name="eye-outline" size={11} color={colors.textTertiary} />
                  <Text style={s.projectMetaText}>{(p.views ?? 0).toLocaleString()}</Text>
                </View>
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.push(`/manage/${p.id}` as any)}
              style={[s.outlineBtn, { alignSelf: "stretch", height: 28 }]}
              accessibilityLabel="Manage project"
              testID={`rail-manage-${p.id}`}
            >
              <Ionicons name="settings-outline" size={12} color={colors.textSecondary} />
              <Text style={s.outlineBtnText}>Manage</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </Box>
  );
}

const s = StyleSheet.create({
  coverBand: { height: 48, width: "100%", backgroundColor: colors.surfaceRaised },
  identity: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  avatarWrap: { marginTop: -26 },
  name: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  headline: { color: colors.textTertiary, fontSize: 12, lineHeight: 16, fontFamily: fontFamily.regular, marginTop: 1 },
  location: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  locationText: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular },
  finish: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.medium, marginTop: 2 },
  stats: { flexDirection: "row", borderTopWidth: 1, borderColor: colors.border },
  stat: { flex: 1, alignItems: "center", paddingVertical: 8 },
  statRule: { width: 1, backgroundColor: colors.border, marginVertical: 8 },
  statValue: { color: colors.primary, fontSize: font.base, fontFamily: fontFamily.semibold },
  statLabel: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular },
  tinted: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, marginHorizontal: spacing.sm,
    borderRadius: 8, borderWidth: 1, borderColor: primaryTint(0.4), backgroundColor: primaryTint(0.05),
    paddingHorizontal: spacing.md, paddingVertical: 10,
  },
  tintedText: { flex: 1, color: colors.text, fontSize: font.sm + 1, lineHeight: 19, fontFamily: fontFamily.regular },
  usedBox: { borderColor: "rgba(16,185,129,0.4)", backgroundColor: "#F2FBF7", gap: spacing.md },
  usedHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  usedTitle: { flex: 1, color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.semibold },
  usedText: { color: colors.text, fontSize: font.sm + 1, lineHeight: 20, fontFamily: fontFamily.regular },
  usedAsks: { backgroundColor: "rgba(255,255,255,0.7)", borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, gap: 2 },
  usedAsksLabel: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular },
  usedAsk: { color: colors.text, fontSize: 12, fontFamily: fontFamily.regular },
  outlineBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "flex-start",
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 6, paddingHorizontal: 10, height: 30,
  },
  outlineBtnText: { color: colors.text, fontSize: 12, fontFamily: fontFamily.medium },
  emptyCopy: { color: colors.textTertiary, fontSize: 12, lineHeight: 18, fontFamily: fontFamily.regular },
  projectsRow: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: 4, paddingBottom: spacing.md },
  projectCard: { width: 212, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, gap: 8 },
  projectTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  projectTitle: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.medium },
  projectMeta: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 },
  projectMetaText: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.regular, marginRight: 5 },
});
