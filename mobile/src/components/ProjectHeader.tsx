/**
 * The top of a project page, as on client/src/pages/project-dashboard.tsx:
 * the cover, the logo over it, the status / category / private badges, the
 * title, and Follow (with its count), Apply or Applied, Manage and Share.
 */
import { Image, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Btn, Icon, Row, assetUri } from "./ui";
import { ProjectLogo, StatusPill, Tag } from "./ProjectBits";
import { API_URL } from "../api/client";

export function ProjectHeader({
  project, owner, followerCount, following, followPending, onFollow,
  role, applied, onApply, onManage, onOwner, onBack,
}: {
  project: any;
  owner?: { userId: string; name: string; avatarUrl?: string | null } | null;
  followerCount: number;
  following: boolean;
  followPending?: boolean;
  onFollow: () => void;
  role: "owner" | "member" | "visitor";
  applied: boolean;
  onApply: () => void;
  onManage: () => void;
  onOwner: () => void;
  /** Jumps to "Back this project" when the project runs a campaign. */
  onBack?: () => void;
}) {
  const cover = assetUri(project.coverUrl);

  const share = () => {
    const url = `${API_URL}/projects/${project.id}`;
    void Share.share({ message: `${project.title}${project.oneLiner ? ` — ${project.oneLiner}` : ""}\n${url}`, url }).catch(() => {});
  };

  return (
    <View style={s.wrap}>
      <View style={s.cover} testID="project-cover">
        {cover
          ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          : <LinearGradient colors={["#EDE4F3", "#E4DEFB", "#F3F2EF"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        {cover ? <LinearGradient colors={["transparent", "rgba(255,255,255,0.35)"]} style={StyleSheet.absoluteFill} /> : null}
      </View>

      <View style={s.body}>
        <Row between style={{ alignItems: "flex-end" }}>
          <ProjectLogo title={project.title} uri={project.logoUrl} size={80} style={s.logo} />
          <Pressable onPress={share} hitSlop={8} accessibilityLabel="Share" style={({ pressed }) => [s.share, pressed && { opacity: 0.6 }]}>
            <Icon name="share-social-outline" size={19} color={colors.textSecondary} />
          </Pressable>
        </Row>

        <Row wrap gap={6} center style={{ marginTop: spacing.sm }}>
          <StatusPill status={project.status} />
          {project.category ? <Text style={s.category}>{project.category}</Text> : null}
          {project.isPrivate && <Tag icon="lock-closed" label="Private" />}
        </Row>
        <Text style={s.title} testID="text-project-title">{project.title}</Text>

        {owner && (
          <Pressable onPress={onOwner} style={({ pressed }) => [s.owner, pressed && { opacity: 0.7 }]}>
            <Avatar name={owner.name} uri={owner.avatarUrl} size={24} />
            <Text style={s.ownerText} numberOfLines={1}>
              Started by <Text style={{ fontFamily: fontFamily.semibold, color: colors.text }}>{owner.name}</Text>
            </Text>
          </Pressable>
        )}

        <Row gap={spacing.sm} wrap style={{ marginTop: spacing.sm }}>
          <Btn
            label={`${following ? "Following" : "Follow"}${followerCount > 0 ? ` (${followerCount})` : ""}`}
            icon={following ? "heart" : "heart-outline"}
            variant={following ? "primary" : "outline"}
            loading={followPending}
            onPress={onFollow}
            style={{ flexGrow: 1 }}
            small
          />
          {role === "visitor" && !applied && !project.soloMode && (
            <Btn label="Apply" icon="send" onPress={onApply} style={{ flexGrow: 1 }} small />
          )}
          {role === "visitor" && applied && (
            <View style={s.applied}>
              <Icon name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={s.appliedText}>Applied</Text>
            </View>
          )}
          {role !== "visitor" && (
            <Btn label="Manage" icon="settings-outline" variant="outline" onPress={onManage} style={{ flexGrow: 1 }} small />
          )}
          {onBack && role !== "owner" && (
            <Btn label="Back this project" icon="heart" variant="outline" onPress={onBack} style={{ flexGrow: 1 }} small />
          )}
        </Row>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  cover: { height: 150, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 4 },
  logo: { marginTop: -40, borderWidth: 3, borderColor: colors.surface, ...{ shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } } },
  share: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  category: { fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.medium },
  title: { fontSize: font.xxl, fontFamily: fontFamily.bold, color: colors.text, letterSpacing: -0.4, lineHeight: 34 },
  owner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 },
  ownerText: { flex: 1, fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular },
  applied: {
    flexGrow: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: spacing.md,
  },
  appliedText: { fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.textSecondary },
});
