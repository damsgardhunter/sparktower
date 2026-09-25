/**
 * Small pieces the project screens share: the logo tile, a block on the
 * project page, a status pill, and an AI visual.
 */
import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Icon, assetUri, type IconName } from "./ui";

/** Deterministic tint for a project without a logo, so the list isn't a column of identical grey squares. */
const TINTS = ["#9745B5", "#2563EB", "#0891B2", "#16A34A", "#D97706", "#E11D48", "#7C3AED", "#0F766E"];
const tintFor = (seed: string) => TINTS[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length];

/** A company-page logo: the uploaded mark on white, or the project's initials on a tint. */
export function ProjectLogo({ title, uri, size = 48, bordered = true, style }: {
  title: string;
  uri?: string | null;
  size?: number;
  bordered?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const src = assetUri(uri);
  const initials = title.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const frame = { width: size, height: size, borderRadius: Math.max(6, size * 0.14) };
  if (src) {
    return (
      <View style={[s.logo, frame, bordered && s.logoBorder, style]}>
        <Image source={{ uri: assetUri(src, 96)! }} style={{ width: size * 0.86, height: size * 0.86 }} resizeMode="contain" />
      </View>
    );
  }
  return (
    <View style={[s.logo, frame, { backgroundColor: tintFor(title) }, bordered && s.logoBorder, style]}>
      <Text style={{ color: "#FFFFFF", fontFamily: fontFamily.bold, fontSize: size * 0.36 }}>{initials}</Text>
    </View>
  );
}

/** A full-width white block on the gray canvas — LinkedIn's section. */
export function Block({ title, icon, action, onAction, children, style, flush }: {
  title?: string;
  icon?: IconName;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** No horizontal padding, for lists whose rows carry their own. */
  flush?: boolean;
}) {
  return (
    <View style={[s.block, flush && { paddingHorizontal: 0 }, style]}>
      {(title || action) && (
        <View style={[s.blockHead, flush && { paddingHorizontal: spacing.lg }]}>
          {icon && <Icon name={icon} size={18} color={colors.primary} />}
          <Text style={s.blockTitle}>{title}</Text>
          {action && onAction && (
            <Pressable onPress={onAction} hitSlop={8}>
              <Text style={s.blockAction}>{action}</Text>
            </Pressable>
          )}
        </View>
      )}
      {children}
    </View>
  );
}

const STATUS: Record<string, { bg: string; fg: string }> = {
  active: { bg: "#DCFCE7", fg: "#15803D" },
  planning: { bg: "#F3E8F8", fg: colors.primary },
  completed: { bg: "#DBEAFE", fg: "#1D4ED8" },
};

export function StatusPill({ status }: { status?: string | null }) {
  if (!status) return null;
  const c = STATUS[status] ?? { bg: colors.surfaceRaised, fg: colors.textSecondary };
  return (
    <View style={[s.pill, { backgroundColor: c.bg }]}>
      <Text style={[s.pillText, { color: c.fg }]}>{status.charAt(0).toUpperCase() + status.slice(1)}</Text>
    </View>
  );
}

/** A small neutral tag: "Private", "Solo Builder", a stack item. */
export function Tag({ label, icon, tone = "neutral" }: { label: string; icon?: IconName; tone?: "neutral" | "primary" | "warning" }) {
  const fg = tone === "primary" ? colors.primary : tone === "warning" ? colors.warning : colors.textSecondary;
  const bg = tone === "primary" ? colors.primarySoft : tone === "warning" ? "#FEF3C7" : colors.surfaceRaised;
  return (
    <View style={[s.pill, { backgroundColor: bg, flexDirection: "row", alignItems: "center", gap: 4 }]}>
      {icon && <Icon name={icon} size={11} color={fg} />}
      <Text style={[s.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** One AI visual beside the text it illustrates, or nothing. */
export function ProjectVisualImage({ uri, square }: { uri: string | null; square?: boolean }) {
  const src = assetUri(uri);
  if (!src) return null;
  return (
    <Image
      source={{ uri: assetUri(src, 640)! }}
      style={{ width: "100%", aspectRatio: square ? 1 : 3 / 2, borderRadius: radius.md, backgroundColor: colors.surfaceRaised }}
      resizeMode="cover"
    />
  );
}

/** Icon + text, the way a stat reads under a title. */
export function IconLine({ icon, children, color = colors.textSecondary }: { icon: IconName; children: ReactNode; color?: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Icon name={icon} size={14} color={color} />
      <Text style={{ color, fontSize: font.sm, fontFamily: fontFamily.regular, flexShrink: 1 }}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  logo: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, overflow: "hidden" },
  logoBorder: { borderWidth: 1, borderColor: colors.border },
  block: {
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  blockHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  blockTitle: { flex: 1, color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold },
  blockAction: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  pill: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: "flex-start" },
  pillText: { fontSize: font.xs, fontFamily: fontFamily.semibold },
});
