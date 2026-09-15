/**
 * Project rows for the Projects tab: a company-style card for exploring, and
 * a progress card for your own.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Btn, Icon, Meta, Progress, Row } from "./ui";
import { ProjectLogo, StatusPill, Tag } from "./ProjectBits";
import { projectGoal } from "../projectData";

export const ownerNameOf = (p: any) =>
  p.profile?.displayName || [p.owner?.firstName, p.owner?.lastName].filter(Boolean).join(" ") || "A builder";

/** Explore: logo, name, pitch, what it is, who's behind it, Follow. */
export function ExploreProjectCard({ project, onPress, follow, update }: {
  project: any;
  onPress: () => void;
  /** The Follow button, or nothing for your own project. */
  follow?: React.ReactNode;
  /** "3 new posts" since you last looked. */
  update?: string | null;
}) {
  const roles: string[] = project.soloMode ? [] : (project.rolesNeeded || []);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { backgroundColor: "#FAFAFA" }]}>
      <Row gap={spacing.md} style={{ alignItems: "flex-start" }}>
        <ProjectLogo title={project.title} uri={project.logoUrl} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row center gap={6}>
            {project.isPrivate && <Icon name="lock-closed" size={13} color={colors.textTertiary} />}
            <Text style={s.title} numberOfLines={1}>{project.title}</Text>
          </Row>
          <Text style={s.pitch} numberOfLines={2}>{project.oneLiner || project.description}</Text>
          <Meta style={s.meta} numberOfLines={1}>
            {[project.category, `${project.views ?? 0} views`].filter(Boolean).join(" · ")}
          </Meta>
        </View>
      </Row>

      <Row wrap gap={6} center>
        <StatusPill status={project.status} />
        {update ? <Tag icon="sparkles" tone="primary" label={update} /> : null}
        {project.soloMode ? <Tag icon="rocket-outline" tone="primary" label="Solo Builder" /> : null}
        {roles.slice(0, 2).map((r) => <Tag key={r} label={r} />)}
        {roles.length > 2 ? <Meta>+{roles.length - 2} roles</Meta> : null}
      </Row>

      <Row between>
        <Row center gap={6} style={{ flex: 1 }}>
          <Avatar name={ownerNameOf(project)} uri={project.profile?.avatarUrl} size={22} />
          <Meta style={{ fontSize: font.sm, flex: 1 }} numberOfLines={1}>{ownerNameOf(project)}</Meta>
        </Row>
        {follow}
      </Row>
    </Pressable>
  );
}

/** Yours: where the path is, this week's check-in, and one tap back into it. */
export function MyProjectCard({ project, isOwner, path, checkIn, onOpen, onManage }: {
  project: any;
  isOwner: boolean;
  path?: { phase: string; progress: { done: number; total: number }; next: { title: string } | null } | null;
  checkIn?: { checkedIn: boolean; streak: number } | null;
  onOpen: () => void;
  onManage: () => void;
}) {
  const pct = path?.progress?.total ? Math.round((path.progress.done / path.progress.total) * 100) : null;
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [s.card, pressed && { backgroundColor: "#FAFAFA" }]}>
      <Row gap={spacing.md} center>
        <ProjectLogo title={project.title} uri={project.logoUrl} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row center gap={6}>
            {project.isPrivate && <Icon name="lock-closed" size={13} color={colors.textTertiary} />}
            <Text style={s.title} numberOfLines={1}>{project.title}</Text>
          </Row>
          <Meta style={s.meta} numberOfLines={1}>
            {[isOwner ? "Owner" : "Member", projectGoal(project.goal).label, `${project.views ?? 0} views`].join(" · ")}
          </Meta>
        </View>
        <StatusPill status={project.status} />
      </Row>

      {path ? (
        <View style={s.path}>
          <Row between>
            <Text style={s.phase} numberOfLines={1}>{path.phase}</Text>
            <Meta>{path.progress.done}/{path.progress.total} steps</Meta>
          </Row>
          <Progress value={pct ?? 0} />
          {path.next ? (
            <Row center gap={6}>
              <Icon name="arrow-forward-circle-outline" size={15} color={colors.primary} />
              <Text style={s.next} numberOfLines={1}>Next: {path.next.title}</Text>
            </Row>
          ) : null}
        </View>
      ) : (
        <Text style={s.pitch} numberOfLines={2}>{project.oneLiner || project.description}</Text>
      )}

      <Row between>
        <Row center gap={spacing.md}>
          {checkIn ? (
            <Row center gap={4}>
              <Icon name={checkIn.checkedIn ? "checkmark-circle" : "time-outline"} size={15} color={checkIn.checkedIn ? colors.success : colors.warning} />
              <Meta style={{ fontSize: font.sm }}>{checkIn.checkedIn ? "Checked in" : "Check-in due"}</Meta>
            </Row>
          ) : null}
          {checkIn && checkIn.streak > 0 ? (
            <Row center gap={4}>
              <Icon name="flame" size={15} color={colors.warning} />
              <Meta style={{ fontSize: font.sm }}>{checkIn.streak}w</Meta>
            </Row>
          ) : null}
        </Row>
        <Btn small label={path ? "Continue path" : "Manage"} icon={path ? "play" : "settings-outline"} onPress={onManage} />
      </Row>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  title: { flexShrink: 1, fontSize: font.base + 1, fontFamily: fontFamily.bold, color: colors.text },
  pitch: { fontSize: font.sm, lineHeight: 19, color: colors.text, fontFamily: fontFamily.regular },
  meta: { fontSize: font.xs + 1, color: colors.textTertiary },
  path: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: spacing.md, gap: 8 },
  phase: { flex: 1, fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text },
  next: { flex: 1, fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular },
});
