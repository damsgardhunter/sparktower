/**
 * The website's home boxes, for the phone.
 *
 * client/src/components/rail-card.tsx: flat, 8px-rounded, hairline-bordered
 * white boxes that sit against the gray page — not the app's floating Card with
 * a shadow. The feed's posts, the composer and the folded-in rail modules all
 * use this one shape so the screen reads like the website's home.
 */
import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { assetUri, type IconName } from "../ui";

export const BOX_BORDER = colors.border;
/** The primary at the web's /5, /10, /30 and /40 opacities. */
export const primaryTint = (alpha: number) => `rgba(151,69,181,${alpha})`;

export function Box({
  children, style, padded = true, testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Off for boxes whose first child is full-bleed (a cover band, a divided list). */
  padded?: boolean;
  testID?: string;
}) {
  return <View style={[s.box, padded && s.padded, style]} testID={testID}>{children}</View>;
}

/** A module's title row, with an optional "See all". */
export function BoxHeader({ title, action = "See all", onAction, icon, tint }: {
  title: string;
  action?: string;
  onAction?: () => void;
  icon?: IconName;
  tint?: string;
}) {
  return (
    <View style={s.header}>
      <View style={s.headerTitle}>
        {icon && <Ionicons name={icon} size={15} color={tint ?? colors.text} />}
        <Text style={[s.title, tint ? { color: tint } : null]}>{title}</Text>
      </View>
      {onAction && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={s.action}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** A tappable row inside a box: icon, label and sublabel, then a number or a chevron. */
export function BoxRow({ icon, label, sublabel, value, onPress, testID }: {
  icon?: IconName;
  label: string;
  sublabel?: string;
  value?: string | number;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      testID={testID}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      {icon && <Ionicons name={icon} size={15} color={colors.textTertiary} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowLabel} numberOfLines={1}>{label}</Text>
        {sublabel ? <Text style={s.rowSub} numberOfLines={1}>{sublabel}</Text> : null}
      </View>
      {value !== undefined
        ? <Text style={s.rowValue}>{value}</Text>
        : <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
    </Pressable>
  );
}

export const BoxDivider = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={[s.divider, style]} />;

/**
 * The web's `.btn-glossy`: the primary with a soft top sheen and a hairline
 * inner highlight, full width.
 */
export function GlossyButton({ label, icon, onPress, testID }: { label: string; icon?: IconName; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={({ pressed }) => [s.glossy, pressed && { opacity: 0.9 }]}>
      <LinearGradient
        colors={["rgba(255,255,255,0.30)", "rgba(255,255,255,0.08)", "rgba(0,0,0,0.06)", "rgba(0,0,0,0.14)"]}
        locations={[0, 0.45, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.glossyShine} />
      {icon && <Ionicons name={icon} size={17} color={colors.primaryText} />}
      <Text style={s.glossyText}>{label}</Text>
    </Pressable>
  );
}

/** A project's logo, or its first two letters on a gray tile. */
export function ProjectTile({ title, uri, size = 32 }: { title: string; uri?: string | null; size?: number }) {
  const src = assetUri(uri);
  if (src) {
    return <Image source={{ uri: assetUri(src)! }} style={[s.logo, { width: size, height: size }]} resizeMode="contain" />;
  }
  return (
    <View style={[s.tile, { width: size, height: size }]}>
      <Text style={s.tileText}>{title.slice(0, 2).toUpperCase()}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: colors.surface, marginHorizontal: spacing.sm, borderRadius: radius.sm,
    borderWidth: 1, borderColor: BOX_BORDER, overflow: "hidden",
  },
  padded: { padding: spacing.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginBottom: 4 },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  title: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.semibold },
  action: { color: colors.primary, fontSize: 12, fontFamily: fontFamily.medium },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: -spacing.md, paddingHorizontal: spacing.md, paddingVertical: 7 },
  rowLabel: { color: colors.text, fontSize: font.sm + 1, fontFamily: fontFamily.regular },
  rowSub: { color: colors.textTertiary, fontSize: 12, fontFamily: fontFamily.regular },
  rowValue: { color: colors.primary, fontSize: font.sm + 1, fontFamily: fontFamily.semibold },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: -spacing.md, marginVertical: spacing.sm },
  glossy: {
    marginHorizontal: spacing.sm, height: 44, borderRadius: 6, overflow: "hidden", backgroundColor: colors.primary,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
  },
  glossyShine: { position: "absolute", top: 0, left: 0, right: 0, height: 1, backgroundColor: "rgba(255,255,255,0.4)" },
  glossyText: { color: colors.primaryText, fontSize: font.base, fontFamily: fontFamily.semibold },
  logo: { borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tile: { borderRadius: 6, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  tileText: { color: colors.textTertiary, fontSize: 11, fontFamily: fontFamily.semibold },
});
