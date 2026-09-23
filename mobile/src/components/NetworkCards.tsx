/**
 * The cards of the Network tab and search: a builder in the "people you may
 * know" grid, an invitation, a project to follow, an open call, the news
 * banner. Drawn here so Discover, Matches, Search and Invitations look alike.
 */
import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Icon, assetUri, timeAgo, type IconName } from "./ui";
import { tintFor, updateLabel, type ExploreUpdate } from "../networkData";

/** "3 new posts" — news about something you've looked at. */
export function UpdateBadge({ update }: { update?: Pick<ExploreUpdate, "newPosts" | "more"> | null }) {
  if (!update) return null;
  return (
    <View style={n.badge}>
      <View style={n.badgeDot} />
      <Text style={n.badgeText}>{updateLabel(update)}</Text>
    </View>
  );
}

export function NewBadge() {
  return (
    <View style={[n.badge, { backgroundColor: colors.primary }]}>
      <Text style={[n.badgeText, { color: colors.primaryText }]}>New</Text>
    </View>
  );
}

/** A white block on the gray canvas, with a heading and an optional link. */
export function NetworkBlock({ title, subtitle, action, onAction, children, right, flush }: {
  title?: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  right?: ReactNode;
  children: ReactNode;
  /** No side padding: rows draw their own. */
  flush?: boolean;
}) {
  return (
    <View style={n.block}>
      {(title || action || right) && (
        <View style={n.blockHeader}>
          <View style={{ flex: 1, gap: 2 }}>
            {title ? <Text style={n.blockTitle}>{title}</Text> : null}
            {subtitle ? <Text style={n.meta}>{subtitle}</Text> : null}
          </View>
          {right}
          {action && onAction ? (
            <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
              <Text style={n.blockAction}>{action}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      <View style={flush ? null : { paddingHorizontal: spacing.lg }}>{children}</View>
    </View>
  );
}

/** "Show more" / "Show less" under a list, full width, LinkedIn-style. */
export function ShowMore({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [n.showMore, pressed && { backgroundColor: colors.surfaceRaised }]} accessibilityRole="button">
      <Text style={n.showMoreText}>{label}</Text>
    </Pressable>
  );
}

/** A builder in the grid: cover band, photo, who, why — and one action. */
export function PersonGridCard({ width, name, headline, avatarUrl, coverUrl, reason, skills, score, isNew, update, onOpen, onDismiss, action }: {
  width: number;
  name: string;
  headline?: string | null;
  avatarUrl?: string | null;
  coverUrl?: string | null;
  reason?: string | null;
  /** Their top skills, as the web's builder card shows them. */
  skills?: string[];
  score?: number;
  isNew?: boolean;
  update?: ExploreUpdate;
  onOpen: () => void;
  onDismiss?: () => void;
  action: ReactNode;
}) {
  const cover = assetUri(coverUrl);
  return (
    <View style={[n.gridCard, { width }]}>
      <Pressable onPress={onOpen} style={({ pressed }) => [{ alignItems: "center" }, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Open ${name}'s profile`}>
        <View style={n.cover}>
          {cover
            ? <Image source={{ uri: assetUri(cover)! }} style={StyleSheet.absoluteFill} />
            : <LinearGradient colors={[colors.primarySoft, colors.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />}
        </View>
        <View style={n.gridAvatar}>
          <Avatar name={name} uri={avatarUrl} size={72} ring />
        </View>
        <View style={n.gridBody}>
          <Text style={n.gridName} numberOfLines={1}>{name}</Text>
          <Text style={n.gridHeadline} numberOfLines={2}>{headline || " "}</Text>
          {reason ? (
            <View style={n.reasonRow}>
              <Icon name="sparkles" size={12} color={colors.primary} />
              <Text style={n.reasonText} numberOfLines={2}>{reason}</Text>
            </View>
          ) : skills?.length ? null : <View style={{ height: 30 }} />}
          {skills?.length ? (
            <View style={[n.badgeRow, { flexWrap: "nowrap", overflow: "hidden", alignSelf: "stretch" }]}>
              {skills.slice(0, 2).map((sk) => <Text key={sk} style={[n.rolePill, { maxWidth: (width - spacing.lg * 2) / 2 }]} numberOfLines={1}>{sk}</Text>)}
            </View>
          ) : null}
          <View style={n.badgeRow}>
            {score !== undefined && <Text style={n.meta}>{score}% match</Text>}
            {isNew && <NewBadge />}
            <UpdateBadge update={update} />
          </View>
        </View>
      </Pressable>
      <View style={{ paddingHorizontal: spacing.sm, paddingBottom: spacing.md, alignItems: "stretch" }}>{action}</View>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={8} style={n.dismiss} accessibilityLabel={`Hide ${name}`}>
          <Icon name="close" size={16} color="#FFFFFF" />
        </Pressable>
      )}
    </View>
  );
}

/** A square tile with a project's initial, tinted steadily by its title. */
export function ProjectTile({ title, size = 48 }: { title: string; size?: number }) {
  const tint = tintFor(title);
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: tint + "1F", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: tint, fontFamily: fontFamily.bold, fontSize: size * 0.42 }}>{(title.trim()[0] || "?").toUpperCase()}</Text>
    </View>
  );
}

/** A project as a row: tile, title, who and why, and Follow on the right. */
export function ProjectRowItem({ title, owner, category, blurb, reason, roles, isNew, update, onOpen, action }: {
  title: string;
  owner?: string;
  category?: string | null;
  blurb?: string | null;
  reason?: string | null;
  roles?: string[];
  isNew?: boolean;
  update?: ExploreUpdate;
  onOpen: () => void;
  action?: ReactNode;
}) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [n.row, { alignItems: "flex-start" }, pressed && { backgroundColor: colors.surfaceRaised }]} accessibilityRole="button">
      <ProjectTile title={title} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={n.rowTitle} numberOfLines={1}>{title}</Text>
        <Text style={n.rowSub} numberOfLines={1}>{[owner && `by ${owner}`, category].filter(Boolean).join(" · ")}</Text>
        {blurb ? <Text style={n.rowBody} numberOfLines={2}>{blurb}</Text> : null}
        {reason ? (
          <View style={[n.reasonRow, { marginTop: 2, minHeight: 0 }]}>
            <Icon name="sparkles" size={12} color={colors.primary} />
            <Text style={n.reasonText} numberOfLines={1}>{reason}</Text>
          </View>
        ) : null}
        {(roles?.length || isNew || update) ? (
          <View style={[n.badgeRow, { justifyContent: "flex-start", marginTop: 4 }]}>
            {isNew && <NewBadge />}
            <UpdateBadge update={update} />
            {roles?.map((r) => <Text key={r} style={n.rolePill} numberOfLines={1}>{r}</Text>)}
          </View>
        ) : null}
      </View>
      {action ? <View style={{ alignSelf: "flex-start" }}>{action}</View> : null}
    </Pressable>
  );
}

/** A person as a row — search results, connections, matches' header. */
export function PersonRowItem({ name, headline, meta, avatarUrl, onOpen, right, size = 52, children }: {
  name: string;
  headline?: string | null;
  meta?: string | null;
  avatarUrl?: string | null;
  onOpen: () => void;
  right?: ReactNode;
  size?: number;
  children?: ReactNode;
}) {
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [n.row, pressed && { backgroundColor: colors.surfaceRaised }]} accessibilityRole="button">
      <Avatar name={name} uri={avatarUrl} size={size} />
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text style={n.rowTitle} numberOfLines={1}>{name}</Text>
        {headline ? <Text style={n.rowSub} numberOfLines={2}>{headline}</Text> : null}
        {meta ? <Text style={n.meta} numberOfLines={1}>{meta}</Text> : null}
        {children}
      </View>
      {right ? <View style={{ alignSelf: "center" }}>{right}</View> : null}
    </Pressable>
  );
}

/** A received connection request: who, their note, and Ignore / Accept as round buttons. */
export function InvitationRow({ name, headline, avatarUrl, note, createdAt, onOpen, onAccept, onIgnore, busy }: {
  name: string;
  headline?: string | null;
  avatarUrl?: string | null;
  note?: string | null;
  createdAt?: string;
  onOpen: () => void;
  onAccept: () => void;
  onIgnore: () => void;
  busy?: boolean;
}) {
  return (
    <View style={[n.row, { alignItems: "flex-start" }]}>
      <Pressable onPress={onOpen} accessibilityLabel={`Open ${name}'s profile`}>
        <Avatar name={name} uri={avatarUrl} size={56} />
      </Pressable>
      <Pressable onPress={onOpen} style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text style={n.rowTitle} numberOfLines={1}>{name}</Text>
        {headline ? <Text style={n.rowSub} numberOfLines={2}>{headline}</Text> : null}
        {createdAt ? <Text style={n.meta}>{timeAgo(createdAt)}</Text> : null}
        {note ? (
          <View style={n.note}>
            <Text style={n.noteText} numberOfLines={4}>{note}</Text>
          </View>
        ) : null}
      </Pressable>
      <View style={{ flexDirection: "row", gap: spacing.sm, opacity: busy ? 0.5 : 1 }}>
        <RoundAction icon="close" label={`Ignore ${name}`} onPress={onIgnore} disabled={busy} />
        <RoundAction icon="checkmark" label={`Accept ${name}`} onPress={onAccept} disabled={busy} primary />
      </View>
    </View>
  );
}

export function RoundAction({ icon, label, onPress, primary, disabled }: { icon: IconName; label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [n.round, primary && { borderColor: colors.primary }, pressed && { backgroundColor: primary ? colors.primarySoft : colors.surfaceRaised }]}
    >
      <Icon name={icon} size={20} color={primary ? colors.primary : colors.textSecondary} />
    </Pressable>
  );
}

/** Someone's open call for collaborators. */
export function LookingForCardView({ name, headline, avatarUrl, lookingFor, onOpen, action }: {
  name: string;
  headline?: string | null;
  avatarUrl?: string | null;
  lookingFor: { role?: string; industries?: string[]; commitment?: string | null; stage?: string | null; equityAvailable?: boolean | null; details?: string | null };
  onOpen: () => void;
  action?: ReactNode;
}) {
  const lf = lookingFor;
  const facts: { icon: IconName; text: string }[] = [
    ...(lf.commitment ? [{ icon: "time-outline" as IconName, text: lf.commitment }] : []),
    ...(lf.stage ? [{ icon: "layers-outline" as IconName, text: lf.stage }] : []),
    ...(lf.equityAvailable ? [{ icon: "pie-chart-outline" as IconName, text: "Equity available" }] : []),
  ];
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm }}>
      <Pressable onPress={onOpen} style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
        <Avatar name={name} uri={avatarUrl} size={48} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={n.rowTitle} numberOfLines={1}>{name}</Text>
          {headline ? <Text style={n.rowSub} numberOfLines={1}>{headline}</Text> : null}
        </View>
      </Pressable>
      <View style={n.lookingPill}>
        <Icon name="search" size={14} color={colors.primary} />
        <Text style={n.lookingText} numberOfLines={2}>Looking for {lf.role || "collaborators"}</Text>
      </View>
      {(facts.length > 0 || (lf.industries?.length ?? 0) > 0) && (
        <View style={[n.badgeRow, { justifyContent: "flex-start", gap: spacing.sm }]}>
          {facts.map((f) => (
            <View key={f.text} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon name={f.icon} size={13} color={colors.textTertiary} />
              <Text style={n.rowSub}>{f.text}</Text>
            </View>
          ))}
          {(lf.industries ?? []).map((i) => <Text key={i} style={n.rolePill}>{i}</Text>)}
        </View>
      )}
      {lf.details ? <Text style={n.rowBody} numberOfLines={3}>{lf.details}</Text> : null}
      {action}
    </View>
  );
}

/** "Welcome back — new since you last looked", with a way straight to it. */
export function NewsBanner({ title, detail, primary, secondary, onDismiss }: {
  title: string;
  detail?: string;
  primary?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  onDismiss?: () => void;
}) {
  return (
    <View style={n.news}>
      <View style={n.newsIcon}>
        <Icon name="sparkles" size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={n.rowTitle}>{title}</Text>
        {detail ? <Text style={n.rowSub} numberOfLines={3}>{detail}</Text> : null}
        {(primary || secondary) && (
          <View style={{ flexDirection: "row", gap: spacing.md, marginTop: 4, flexWrap: "wrap" }}>
            {primary && (
              <Pressable onPress={primary.onPress} style={n.newsBtn} accessibilityRole="button">
                <Text style={n.newsBtnText}>{primary.label}</Text>
              </Pressable>
            )}
            {secondary && (
              <Pressable onPress={secondary.onPress} hitSlop={6} style={{ justifyContent: "center" }} accessibilityRole="button">
                <Text style={n.blockAction}>{secondary.label}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
      {onDismiss && (
        <Pressable onPress={onDismiss} hitSlop={10} accessibilityLabel="Dismiss">
          <Icon name="close" size={18} color={colors.textTertiary} />
        </Pressable>
      )}
    </View>
  );
}

export const networkStyles = StyleSheet.create({
  meta: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular },
  rowTitle: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  rowSub: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, lineHeight: 18 },
  rowBody: { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular, lineHeight: 19 },
  divider: { height: 1, backgroundColor: colors.borderSubtle, marginLeft: 84 },
});

const n = StyleSheet.create({
  ...networkStyles,
  block: { backgroundColor: colors.surface, paddingVertical: spacing.md, gap: spacing.sm },
  blockHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xs },
  blockTitle: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.semibold },
  blockAction: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  showMore: { borderTopWidth: 1, borderColor: colors.borderSubtle, paddingVertical: spacing.md, alignItems: "center", marginTop: spacing.xs, marginBottom: -spacing.md },
  showMoreText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  badgeText: { color: colors.primary, fontSize: 10, fontFamily: fontFamily.semibold },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 6 },
  gridCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden", justifyContent: "space-between" },
  cover: { height: 56, alignSelf: "stretch", overflow: "hidden", backgroundColor: colors.primarySoft },
  gridAvatar: { marginTop: -38 },
  gridBody: { alignItems: "center", paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.sm, gap: 3, alignSelf: "stretch" },
  gridName: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold, textAlign: "center" },
  gridHeadline: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, fontFamily: fontFamily.regular, textAlign: "center", minHeight: 32 },
  reasonRow: { flexDirection: "row", gap: 4, alignItems: "flex-start", minHeight: 30 },
  reasonText: { flexShrink: 1, color: colors.textTertiary, fontSize: font.xs, lineHeight: 15, fontFamily: fontFamily.regular },
  dismiss: { position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", gap: spacing.md, alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rolePill: { color: colors.textSecondary, fontSize: 11, fontFamily: fontFamily.medium, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, maxWidth: 160 },
  note: { marginTop: 6, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, borderTopLeftRadius: 2, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  noteText: { color: colors.text, fontSize: font.sm, lineHeight: 18, fontFamily: fontFamily.regular },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  lookingPill: { flexDirection: "row", gap: 6, alignItems: "center", alignSelf: "flex-start", backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5, maxWidth: "100%" },
  lookingText: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold, flexShrink: 1 },
  news: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.surface, padding: spacing.lg, borderLeftWidth: 3, borderLeftColor: colors.primary },
  newsIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  newsBtn: { borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  newsBtnText: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold },
});
