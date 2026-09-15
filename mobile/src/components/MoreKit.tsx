/**
 * Small building blocks for the "More" side of the app — the menu, sprints,
 * leaderboard, plans, contests and the review queues. They sit on top
 * of ui.tsx and only exist where several of those screens would otherwise
 * restate the same layout.
 */
import React from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { colors, font, fontFamily, radius, shadow, spacing } from "../theme";
import { Icon, type IconName } from "./ui";

/** Which feature areas are switched on — GET /api/surfaces, like the web's useSurfaces. */
export function useSurfaces() {
  const { data, isLoading } = useQuery({
    queryKey: ["surfaces"],
    queryFn: () => api<{ enabled: Record<string, boolean> }>("/api/surfaces"),
    staleTime: 5 * 60_000,
    retry: false,
  });
  // Shipped defaults for the one that starts off (shared/surfaces.ts), so an
  // outage doesn't advertise it.
  const enabled = data?.enabled ?? { liveChat: false };
  return { isLoading, loaded: !!data, on: (id: string) => enabled[id] !== false };
}

/** A white, edge-to-edge group of rows with hairlines between them. */
export function Group({ title, children, style, footer }: {
  title?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  footer?: string;
}) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {title ? (
        <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          {title}
        </Text>
      ) : null}
      <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border }}>
        {items.map((child, i) => (
          <View key={i}>
            {i > 0 && <View style={{ height: 1, backgroundColor: colors.borderSubtle, marginLeft: 60 }} />}
            {child}
          </View>
        ))}
      </View>
      {footer ? (
        <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, lineHeight: 16 }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** A menu row with a tinted icon tile, LinkedIn-style. */
export function MenuRow({ icon, title, subtitle, onPress, badge, tint = colors.primary, danger, right, testID }: {
  icon: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  badge?: string | number | null;
  tint?: string;
  danger?: boolean;
  right?: React.ReactNode;
  testID?: string;
}) {
  const color = danger ? colors.danger : tint;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      accessibilityRole="button"
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", gap: spacing.md,
        paddingVertical: 11, paddingHorizontal: spacing.lg, backgroundColor: colors.surface,
      }, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: danger ? "#FDECEB" : tintSoft(color), alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: danger ? colors.danger : colors.text, fontSize: font.base, fontFamily: fontFamily.medium }}>{title}</Text>
        {subtitle ? <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular }} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {badge != null && badge !== "" && badge !== 0 ? <CountBadge value={badge} /> : null}
      {right ?? (onPress && !danger ? <Icon name="chevron-forward" size={17} color={colors.textTertiary} /> : null)}
    </Pressable>
  );
}

/** A hex colour at ~12% on white, for icon tiles and soft chips. */
export function tintSoft(hex: string, alpha = 0.12): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return colors.primarySoft;
  const mix = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * alpha + 255 * (1 - alpha));
  return `rgb(${mix(0)}, ${mix(2)}, ${mix(4)})`;
}

export function CountBadge({ value, color = colors.danger }: { value: string | number; color?: string }) {
  return (
    <View style={{ minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: color, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#FFFFFF", fontSize: 11, fontFamily: fontFamily.bold }}>{value}</Text>
    </View>
  );
}

/** A soft, rounded label: a status, a difficulty, "Your plan". */
export function Pill({ label, color = colors.primary, icon, solid, style }: {
  label: string;
  color?: string;
  icon?: IconName;
  solid?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{
      flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
      paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
      backgroundColor: solid ? color : tintSoft(color),
    }, style]}>
      {icon ? <Icon name={icon} size={12} color={solid ? "#FFFFFF" : color} /> : null}
      <Text style={{ color: solid ? "#FFFFFF" : color, fontSize: 11, fontFamily: fontFamily.semibold }}>{label}</Text>
    </View>
  );
}

/** A number with a caption, in a row of two to four. */
export function Stat({ value, label, color = colors.text, style }: {
  value: React.ReactNode;
  label: string;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flex: 1, alignItems: "center", gap: 2, paddingVertical: spacing.sm }, style]}>
      <Text style={{ color, fontSize: 20, fontFamily: fontFamily.bold, fontVariant: ["tabular-nums"] }}>{value}</Text>
      <Text style={{ color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular, textAlign: "center" }}>{label}</Text>
    </View>
  );
}

/** A tappable option card with an icon, used for picking a duration, a style, a decision. */
export function OptionCard({ icon, title, body, selected, onPress, compact, style }: {
  icon: IconName;
  title: string;
  body?: string;
  selected?: boolean;
  onPress: () => void;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [{
        flexDirection: compact ? "column" : "row", alignItems: compact ? "center" : "flex-start", gap: compact ? 6 : spacing.md,
        padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primarySoft : colors.surface,
      }, pressed && { opacity: 0.8 }, style]}
    >
      <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: selected ? colors.primary : colors.surfaceRaised }}>
        <Icon name={icon} size={19} color={selected ? "#FFFFFF" : colors.textSecondary} />
      </View>
      <View style={{ flex: compact ? undefined : 1, gap: 2, alignItems: compact ? "center" : undefined }}>
        <Text style={{ color: colors.text, fontSize: compact ? font.sm : font.base, fontFamily: fontFamily.semibold, textAlign: compact ? "center" : "left" }}>{title}</Text>
        {body ? <Text style={{ color: colors.textSecondary, fontSize: font.xs, lineHeight: 16, fontFamily: fontFamily.regular, textAlign: compact ? "center" : "left" }}>{body}</Text> : null}
      </View>
      {!compact && selected ? <Icon name="checkmark-circle" size={20} color={colors.primary} /> : null}
    </Pressable>
  );
}

/** The heading block at the top of a pushed screen: tinted icon, title, one line of why. */
export function PageIntro({ icon, title, body, tint = colors.primary, right }: {
  icon: IconName;
  title: string;
  body?: string;
  tint?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: tintSoft(tint), alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={22} color={tint} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold, letterSpacing: -0.3 }}>{title}</Text>
        {body ? <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{body}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** A card with a titled header row, the phone's version of the web's CardHeader + CardTitle. */
export function TitledCard({ icon, title, action, children, style, tint = colors.primary }: {
  icon?: IconName;
  title: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tint?: string;
}) {
  return (
    <View style={[{
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
      padding: spacing.md, gap: spacing.sm, ...shadow.card,
    }, style]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {icon ? <Icon name={icon} size={17} color={tint} /> : null}
        <Text style={{ flex: 1, color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** A tinted notice box inside a card or page: info, warning, success. */
export function Callout({ icon, title, body, tone = "info", children }: {
  icon?: IconName;
  title?: string;
  body?: string;
  tone?: "info" | "warn" | "success" | "danger";
  children?: React.ReactNode;
}) {
  const color = tone === "warn" ? colors.warning : tone === "success" ? colors.success : tone === "danger" ? colors.danger : colors.primary;
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: tintSoft(color, 0.08), borderWidth: 1, borderColor: tintSoft(color, 0.35) }}>
      <Icon name={icon ?? (tone === "warn" ? "warning" : tone === "success" ? "checkmark-circle" : tone === "danger" ? "alert-circle" : "information-circle")} size={18} color={color} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={{ color: colors.text, fontSize: font.sm, fontFamily: fontFamily.semibold }}>{title}</Text> : null}
        {body ? <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{body}</Text> : null}
        {children}
      </View>
    </View>
  );
}

/** Title-cases an id: "past_due" → "Past due". */
export const humanize = (id?: string | null) =>
  !id ? "" : id.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** A surface is switched off on the server: say so instead of showing an error. */
export const isSwitchedOff = (err: any) => err?.status === 404 || err?.status === 403 || err?.body?.code === "surface_off";
