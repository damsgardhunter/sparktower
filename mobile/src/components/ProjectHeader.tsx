/**
 * The top of a project page, laid out like a company page: cover banner, the
 * logo overlapping it, the name, what it is, who runs it, and the actions.
 */
import { Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, font, fontFamily, spacing } from "../theme";
import { Avatar, Btn, Icon, Meta, Row, assetUri } from "./ui";
import { ProjectLogo, StatusPill, Tag } from "./ProjectBits";
import { projectGoal } from "../projectData";

export function ProjectHeader({
  project, owner, followerCount, memberCount, following, followPending, onFollow,
  role, applied, onApply, onManage, onVisibility, onStoryboards, onOwner,
}: {
  project: any;
  owner?: { userId: string; name: string; avatarUrl?: string | null; headline?: string | null } | null;
  followerCount: number;
  memberCount: number;
  following: boolean;
  followPending?: boolean;
  onFollow: () => void;
  role: "owner" | "member" | "visitor";
  applied: boolean;
  onApply: () => void;
  onManage: () => void;
  onVisibility: () => void;
  onStoryboards: () => void;
  onOwner: () => void;
}) {
  const cover = assetUri(project.coverUrl);
  const recruiting = !project.soloMode && (project.rolesNeeded?.length ?? 0) > 0;

  const share = () => {
    void Share.share({ message: `${project.title}${project.oneLiner ? ` — ${project.oneLiner}` : ""} on SparkTower` }).catch(() => {});
  };

  return (
    <View style={s.wrap}>
      <View style={s.cover}>
        {cover
          ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          : <LinearGradient colors={["#E9D5F5", "#D9D1FF", "#CFFAFE"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
      </View>

      <View style={s.body}>
        <Row between style={{ alignItems: "flex-end" }}>
          <ProjectLogo title={project.title} uri={project.logoUrl} size={84} style={s.logo} />
          <Pressable onPress={share} hitSlop={8} accessibilityLabel="Share" style={s.share}>
            <Icon name="share-social-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        </Row>

        <Text style={s.title}>{project.title}</Text>
        {project.oneLiner ? <Text style={s.tagline}>{project.oneLiner}</Text> : null}

        <Text style={s.meta}>
          {[project.category, projectGoal(project.goal).label].filter(Boolean).join(" · ")}
        </Text>
        <Text style={s.metaStrong}>
          {followerCount} follower{followerCount === 1 ? "" : "s"} · {memberCount} on the team · {project.views ?? 0} views
        </Text>

        <Row wrap gap={6} center style={{ marginTop: 2 }}>
          <StatusPill status={project.status} />
          {project.isPrivate && <Tag icon="lock-closed" label="Private" />}
          {project.soloMode ? <Tag icon="rocket-outline" tone="primary" label="Solo Builder" /> : recruiting ? <Tag icon="briefcase-outline" tone="primary" label="Hiring" /> : null}
        </Row>

        {owner && (
          <Pressable onPress={onOwner} style={({ pressed }) => [s.owner, pressed && { opacity: 0.7 }]}>
            <Avatar name={owner.name} uri={owner.avatarUrl} size={28} />
            <Text style={s.ownerText} numberOfLines={1}>
              Started by <Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>{owner.name}</Text>
            </Text>
          </Pressable>
        )}

        {role === "owner" ? (
          <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
            <Row gap={spacing.sm}>
              <Btn label="Manage" icon="settings-outline" onPress={onManage} style={{ flex: 1 }} small />
              <Btn label="Public page" icon="eye-outline" variant="outline" onPress={onVisibility} style={{ flex: 1 }} small />
            </Row>
            <Pressable onPress={onStoryboards} style={({ pressed }) => [s.novaRow, pressed && { opacity: 0.7 }]}>
              <Icon name="sparkles" size={16} color={colors.primary} />
              <Text style={s.novaText}>AI storyboards</Text>
              <Meta>Only you can see these</Meta>
              <View style={{ flex: 1 }} />
              <Icon name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>
        ) : (
          <Row gap={spacing.sm} style={{ marginTop: spacing.xs }}>
            <Btn
              label={following ? "Following" : "Follow"}
              icon={following ? "checkmark" : "add"}
              variant={following ? "outline" : "primary"}
              loading={followPending}
              onPress={onFollow}
              style={{ flex: 1 }}
              small
            />
            {role === "member" ? (
              <Btn label="Manage" icon="settings-outline" variant="outline" onPress={onManage} style={{ flex: 1 }} small />
            ) : applied ? (
              <Btn label="Applied" icon="time-outline" variant="ghost" disabled style={{ flex: 1 }} small />
            ) : !project.soloMode ? (
              <Btn label="Apply to join" icon="send-outline" variant="outline" onPress={onApply} style={{ flex: 1 }} small />
            ) : null}
          </Row>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cover: { height: 116, backgroundColor: colors.primarySoft, overflow: "hidden" },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: 4 },
  logo: { marginTop: -42, borderWidth: 3, borderColor: colors.surface },
  share: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  title: { fontSize: font.xl + 2, fontFamily: fontFamily.bold, color: colors.text, letterSpacing: -0.3, marginTop: spacing.sm },
  tagline: { fontSize: font.base, lineHeight: 21, fontFamily: fontFamily.regular, color: colors.text },
  meta: { fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular, marginTop: 2 },
  metaStrong: { fontSize: font.sm, color: colors.textTertiary, fontFamily: fontFamily.regular },
  owner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  ownerText: { flex: 1, fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular },
  novaRow: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    backgroundColor: colors.primarySoft, borderRadius: 999,
  },
  novaText: { fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.primary },
});
