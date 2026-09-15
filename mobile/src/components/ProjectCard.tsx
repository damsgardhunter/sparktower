/**
 * A project in the Projects list — the native counterpart of
 * client/src/components/project-card.tsx, in the same order: title (with the
 * private lock), the "new posts" badge and status; the description; up to
 * three roles or Solo Builder; the owner with views and donations; and Follow
 * on the browse list. Your own projects add where Nova's path stands.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Icon, Meta, Progress, Row } from "./ui";
import { ProjectLogo } from "./ProjectBits";

export const ownerNameOf = (p: any) =>
  p.profile?.displayName || [p.owner?.firstName, p.owner?.lastName].filter(Boolean).join(" ") || p.owner?.email || "A builder";

export interface PathSummary { phase: string; progress: { done: number; total: number }; next: { title: string } | null }

export function ProjectCard({ project, onPress, follow, update, path, onContinue, isOwner }: {
  project: any;
  onPress: () => void;
  /** The Follow button on the browse list; nothing for your own project. */
  follow?: React.ReactNode;
  /** "3 new posts" since you last looked. */
  update?: string | null;
  /** Your own projects: where the path is, and one tap back into it. */
  path?: PathSummary | null;
  onContinue?: () => void;
  isOwner?: boolean;
}) {
  const solo = !!project.soloMode;
  const roles: string[] = project.rolesNeeded || [];
  const pct = path?.progress?.total ? Math.round((path.progress.done / path.progress.total) * 100) : 0;
  const active = project.status === "active";

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, pressed && { backgroundColor: "#FAFAFA" }]} testID={`card-project-${project.id}`}>
      <Row gap={spacing.md} center>
        <ProjectLogo title={project.title} uri={project.logoUrl} size={40} />
        <Row center gap={6} style={{ flex: 1 }}>
          {project.isPrivate && <Icon name="lock-closed" size={14} color={colors.textTertiary} />}
          <Text style={s.title} numberOfLines={1}>{project.title}</Text>
        </Row>
        <Row center gap={6}>
          {update ? <Badge label={update} bg={`${colors.primary}26`} fg={colors.primary} /> : null}
          <Badge label={project.status} bg={active ? colors.primary : colors.surfaceRaised} fg={active ? "#FFFFFF" : colors.text} />
        </Row>
      </Row>

      <Text style={s.desc} numberOfLines={2}>{project.description}</Text>

      <Row wrap gap={4} center>
        {solo ? (
          <View style={[s.outline, { borderColor: `${colors.primary}4D`, flexDirection: "row", alignItems: "center", gap: 4 }]}>
            <Icon name="rocket-outline" size={11} color={colors.primary} />
            <Text style={[s.outlineText, { color: colors.primary }]}>Solo Builder</Text>
          </View>
        ) : (
          <>
            {roles.slice(0, 3).map((r) => (
              <View key={r} style={s.skill}><Text style={s.skillText}>{r}</Text></View>
            ))}
            {roles.length > 3 ? <Meta>+{roles.length - 3} more</Meta> : null}
          </>
        )}
      </Row>

      <Row between>
        <Row center gap={spacing.sm} style={{ flex: 1 }}>
          <Avatar name={ownerNameOf(project)} uri={project.profile?.avatarUrl} size={24} />
          <Text style={s.owner} numberOfLines={1}>{isOwner ? "You" : ownerNameOf(project)}</Text>
        </Row>
        <Row center gap={spacing.md}>
          <Row center gap={4}>
            <Icon name="eye-outline" size={16} color={colors.textTertiary} />
            <Text style={s.stat}>{project.views ?? 0}</Text>
          </Row>
          <Row center gap={2}>
            <Icon name="logo-usd" size={14} color={colors.textTertiary} />
            <Text style={s.stat}>{(project.totalDonations ?? 0) / 100}</Text>
          </Row>
        </Row>
      </Row>

      {path ? (
        <Pressable onPress={onContinue} style={({ pressed }) => [s.path, pressed && { opacity: 0.8 }]}>
          <Row between>
            <Text style={s.phase} numberOfLines={1}>{path.phase}</Text>
            <Meta>{path.progress.done}/{path.progress.total} steps</Meta>
          </Row>
          <Progress value={pct} />
          <Row between>
            <Text style={s.next} numberOfLines={1}>{path.next ? `Next: ${path.next.title}` : "Path complete"}</Text>
            <Row center gap={2}>
              <Text style={s.continue}>Continue</Text>
              <Icon name="chevron-forward" size={14} color={colors.primary} />
            </Row>
          </Row>
        </Pressable>
      ) : null}

      {follow ? <View style={{ alignSelf: "flex-start" }}>{follow}</View> : null}
    </Pressable>
  );
}

function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color: fg, fontSize: font.xs, fontFamily: fontFamily.semibold }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, marginHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md + 2, gap: spacing.md,
  },
  title: { flexShrink: 1, fontSize: font.lg + 1, fontFamily: fontFamily.bold, color: colors.text },
  desc: { fontSize: font.sm + 1, lineHeight: 20, minHeight: 40, color: colors.textSecondary, fontFamily: fontFamily.regular },
  outline: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  outlineText: { fontSize: font.xs, fontFamily: fontFamily.semibold },
  skill: { backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  skillText: { fontSize: font.xs, color: colors.textSecondary, fontFamily: fontFamily.medium },
  owner: { flex: 1, fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular },
  stat: { fontSize: font.sm, color: colors.textTertiary, fontFamily: fontFamily.regular },
  path: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, padding: spacing.md, gap: 8 },
  phase: { flex: 1, fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text },
  next: { flex: 1, fontSize: font.sm, color: colors.textSecondary, fontFamily: fontFamily.regular },
  continue: { fontSize: font.sm, color: colors.primary, fontFamily: fontFamily.semibold },
});
