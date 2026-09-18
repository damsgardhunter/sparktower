/**
 * Shared UI primitives.
 *
 * React Native has no Tailwind, so without these every screen ends up with its
 * own 60-line StyleSheet. These are the native counterparts of the web app's
 * shadcn components, in the website's light theme and Space Grotesk, laid out
 * the way a professional network reads on a phone: white cards on a soft gray
 * canvas, round avatars, pill buttons, and real icons.
 */
import React from "react";
import {
  ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { API_URL } from "../api/client";
import { colors, font, fontFamily, novaGradient, radius, shadow, spacing } from "../theme";
import { useHideTabBarOnScroll } from "./tab-bar-visibility";
import { useHeaderSpace } from "./AppHeader";
// The floating bar's footprint, so a list's last row isn't stuck underneath it.
export const TAB_BAR_SPACE = 112;

export type IconName = React.ComponentProps<typeof Ionicons>["name"];

/** Uploaded files come back as `/objects/...` paths; the app needs the API host in front. */
export const assetUri = (uri?: string | null): string | null =>
  !uri ? null : /^https?:\/\//.test(uri) || uri.startsWith("data:") ? uri : `${API_URL}${uri.startsWith("/") ? "" : "/"}${uri}`;

// --- Layout --------------------------------------------------------------

/** Scrolling screen body with consistent padding and pull-to-refresh. */
export function Screen({
  children, onRefresh, refreshing, contentStyle, scroll = true, canvas, hideTabBar,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
  /** The gray feed background, for screens made of stacked cards. */
  canvas?: boolean;
  /**
   * Let the bottom bar slide away as this screen scrolls, and leave room for
   * it at the end of the content. For screens people read down; not for forms,
   * where a bar disappearing mid-answer just loses someone their place.
   */
  hideTabBar?: boolean;
}) {
  const hiding = useHideTabBarOnScroll();
  /*
   * Both ends of the floating chrome. `hideTabBar` says "this screen sits
   * under the bar and the header", so it pays for both: room at the top for a
   * header that owns no layout, and room at the bottom for a bar that doesn't
   * either.
   */
  const headerSpace = useHeaderSpace();
  const base = [s.screenBase, canvas && { backgroundColor: colors.canvas }];
  if (!scroll) {
    return <View style={[...base, contentStyle]}>{children}</View>;
  }
  return (
    <ScrollView
      style={base}
      contentContainerStyle={[s.screenContent, hideTabBar && { paddingTop: headerSpace, paddingBottom: TAB_BAR_SPACE }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      {...(hideTabBar ? hiding : null)}
      refreshControl={
        onRefresh
          ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children, style, onPress, accent,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  /** Left edge highlight, for severity or category. */
  accent?: string;
}) {
  const body = (
    <View style={[s.card, accent ? { borderLeftWidth: 3, borderLeftColor: accent } : null, style]}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && s.pressed}>
      {body}
    </Pressable>
  );
}

/**
 * A full-width white block with an optional title and trailing action — a
 * profile's About or Experience, a settings group. Edge to edge, the way a
 * professional network stacks sections on a phone.
 */
export function Section({
  title, action, onAction, children, style,
}: {
  title?: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.section, style]}>
      {(title || action) && (
        <View style={s.sectionHeader}>
          {title ? <Text style={s.sectionTitle}>{title}</Text> : <View />}
          {action && onAction && (
            <Pressable onPress={onAction} hitSlop={8}>
              <Text style={s.sectionAction}>{action}</Text>
            </Pressable>
          )}
        </View>
      )}
      {children}
    </View>
  );
}

export function Row({
  children, gap = spacing.sm, style, wrap, center, between,
}: {
  children: React.ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  wrap?: boolean;
  center?: boolean;
  between?: boolean;
}) {
  return (
    <View
      style={[
        { flexDirection: "row", gap },
        wrap && { flexWrap: "wrap" },
        center && { alignItems: "center" },
        between && { justifyContent: "space-between", alignItems: "center" },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export const Divider = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={[s.divider, style]} />;

/** A tappable row in a list: icon, title, subtitle, chevron. */
export function ListItem({
  icon, title, subtitle, onPress, right, danger,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.listItem, pressed && { backgroundColor: colors.surfaceRaised }]}>
      {icon && (
        <View style={s.listIcon}>
          <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.textSecondary} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.listTitle, danger && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={s.meta} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} /> : null)}
    </Pressable>
  );
}

/** Nova's green → emerald → purple. */
export function NovaGradient({ children, style, vertical }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; vertical?: boolean }) {
  return (
    <LinearGradient colors={[...novaGradient]} start={{ x: 0, y: vertical ? 0 : 0.5 }} end={{ x: vertical ? 0 : 1, y: vertical ? 1 : 0.5 }} style={style}>
      {children}
    </LinearGradient>
  );
}

// --- Typography ----------------------------------------------------------

export function H1({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.h1, style]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.h2, style]}>{children}</Text>;
}
export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}
export function Body({
  children, style, muted, numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  muted?: boolean;
  numberOfLines?: number;
}) {
  return (
    <Text style={[s.body, muted && { color: colors.textSecondary }, style]} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}
export function Meta({
  children, style, numberOfLines,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return <Text style={[s.meta, style]} numberOfLines={numberOfLines}>{children}</Text>;
}

// --- Controls ------------------------------------------------------------

export function Icon({ name, size = 22, color = colors.textSecondary }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export function IconButton({
  name, onPress, size = 22, color = colors.textSecondary, badge, label,
}: {
  name: IconName;
  onPress?: () => void;
  size?: number;
  color?: string;
  badge?: number;
  label: string;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={({ pressed }) => [{ padding: 4 }, pressed && s.pressed]}>
      <Ionicons name={name} size={size} color={color} />
      {!!badge && badge > 0 && (
        <View style={s.iconBadge}>
          <Text style={s.iconBadgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function Btn({
  label, onPress, variant = "primary", disabled, loading, style, small, icon, testID,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "outline" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  icon?: IconName;
  /** So a test can find the button by name, as it can every other control here. */
  testID?: string;
}) {
  const isDisabled = disabled || loading;
  const textColor = variant === "primary" ? colors.primaryText
    : variant === "danger" ? colors.danger
    : variant === "ghost" ? colors.textSecondary
    : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        variant === "primary" && s.btnPrimary,
        variant === "outline" && s.btnOutline,
        variant === "ghost" && s.btnGhost,
        variant === "danger" && [s.btnOutline, { borderColor: colors.danger }],
        (pressed || isDisabled) && s.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {icon && <Ionicons name={icon} size={small ? 15 : 18} color={textColor} />}
          <Text style={[s.btnText, small && { fontSize: font.sm }, { color: textColor }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Pill used for statuses, categories, and counts. */
export function Chip({
  label, color, active, onPress, small,
}: {
  label: string;
  color?: string;
  active?: boolean;
  onPress?: () => void;
  small?: boolean;
}) {
  const tint = color || colors.primary;
  const content = (
    <View
      style={[
        s.chip,
        small && { paddingHorizontal: spacing.sm, paddingVertical: 2 },
        active && { borderColor: tint, backgroundColor: tint },
      ]}
    >
      {/* Wrapping text so long values — résumé skills, role names — don't
          overflow the way they did on the web. */}
      <Text style={[s.chipText, small && { fontSize: font.xs }, active && { color: "#FFFFFF", fontFamily: fontFamily.semibold }]}>
        {label}
      </Text>
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && s.pressed}>
      {content}
    </Pressable>
  );
}

export function Field({
  label, value, onChangeText, placeholder, multiline, secureTextEntry,
  keyboardType, autoCapitalize, maxLength, numeric, testID,
}: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "numeric";
  autoCapitalize?: "none" | "sentences" | "words";
  maxLength?: number;
  /** So a test can find the input by name, as it can the buttons beside it. */
  testID?: string;
  numeric?: boolean;
}) {
  return (
    <View style={{ gap: spacing.xs }}>
      {label && <Label>{label}</Label>}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        style={[s.input, multiline && { minHeight: 100, textAlignVertical: "top" }]}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        keyboardType={numeric ? "number-pad" : keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        testID={testID}
      />
    </View>
  );
}

/** Horizontal segmented control — the native stand-in for the web's tab bars. */
export function Segments<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={({ pressed }) => [s.segment, value === o.value && s.segmentActive, pressed && s.pressed]}
        >
          <Text style={[s.segmentText, value === o.value && s.segmentTextActive]}>{o.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** Underlined tabs across a screen — a profile's or project's sections. */
export function TabStrip<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabStrip} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.tabStripItem, on && s.tabStripItemActive]}>
            <Text style={[s.tabStripText, on && { color: colors.primary, fontFamily: fontFamily.semibold }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function Avatar({ name, size = 40, uri, ring }: { name?: string | null; size?: number; uri?: string | null; ring?: boolean }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const source = assetUri(uri);
  const frame = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[s.avatar, frame, ring && { borderWidth: Math.max(2, size / 24), borderColor: colors.background }]}>
      {source
        ? <Image source={{ uri: source }} style={[frame, { position: "absolute" }]} />
        : <Text style={{ color: colors.primary, fontSize: size * 0.42, fontFamily: fontFamily.bold }}>{initial}</Text>}
    </View>
  );
}

export function Progress({ value, color = colors.primary }: { value: number; color?: string }) {
  return (
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
    </View>
  );
}

// --- States --------------------------------------------------------------

export function Loading({ label }: { label?: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label && <Meta style={{ marginTop: spacing.md }}>{label}</Meta>}
    </View>
  );
}

export function Empty({
  title, body, action, onAction, icon,
}: {
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
  icon?: IconName;
}) {
  return (
    <View style={s.empty}>
      {icon && <Ionicons name={icon} size={40} color={colors.textTertiary} />}
      <H2 style={{ textAlign: "center" }}>{title}</H2>
      {body && <Body muted style={{ textAlign: "center", maxWidth: 280 }}>{body}</Body>}
      {action && onAction && <Btn label={action} onPress={onAction} variant="outline" small />}
    </View>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <Text style={s.error}>{message}</Text>;
}

/** Credit cost badge, matching the web app's inline price hints. */
export function Cost({ credits }: { credits: number }) {
  return (
    <View style={s.cost}>
      <Text style={s.costText}>{credits}</Text>
    </View>
  );
}

/** "3m" / "5h" / "2d", then a date. */
export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Pulls the server's message out of an ApiError. */
export function errText(err: any, fallback = "Something went wrong."): string {
  return err?.message || fallback;
}

/** Strips the **bold** markers the web renders as bold text. */
export const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1");

const s = StyleSheet.create({
  screenBase: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 3 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, gap: spacing.sm, ...shadow.card,
  },
  section: {
    backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.md,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
  },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold },
  sectionAction: { color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  divider: { height: 1, backgroundColor: colors.borderSubtle },
  listItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  listIcon: { width: 28, alignItems: "center" },
  listTitle: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.medium },
  h1: { color: colors.text, fontSize: font.xl, fontFamily: fontFamily.bold, letterSpacing: -0.3 },
  h2: { color: colors.text, fontSize: font.lg, fontFamily: fontFamily.semibold },
  label: {
    color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold,
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  body: { color: colors.text, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular },
  meta: { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.regular },
  btn: {
    borderRadius: radius.pill, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    alignItems: "center", justifyContent: "center",
  },
  btnSmall: { paddingVertical: 7, paddingHorizontal: spacing.md },
  btnPrimary: { backgroundColor: colors.primary },
  btnOutline: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.surface },
  btnGhost: {},
  btnText: { color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface,
    paddingHorizontal: spacing.md, paddingVertical: 6, flexShrink: 1, maxWidth: "100%",
  },
  chipText: { color: colors.textSecondary, fontSize: font.sm, flexShrink: 1, fontFamily: fontFamily.medium },
  input: {
    backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.text, fontSize: font.base, fontFamily: fontFamily.regular,
  },
  segment: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.semibold },
  segmentTextActive: { color: colors.primaryText },
  tabStrip: { flexGrow: 0, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  tabStripItem: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: 2, borderColor: "transparent" },
  tabStripItemActive: { borderColor: colors.primary },
  tabStripText: { color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.medium },
  avatar: { backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  progressTrack: { height: 6, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.primary, borderRadius: radius.pill },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.xl },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
  error: { color: colors.danger, fontSize: font.sm, fontFamily: fontFamily.regular },
  pressed: { opacity: 0.65 },
  iconBadge: {
    position: "absolute", top: -2, right: -6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
    backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: colors.background,
  },
  iconBadgeText: { color: "#FFFFFF", fontSize: 9, fontFamily: fontFamily.bold },
  cost: {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 1, minWidth: 22, alignItems: "center",
  },
  costText: { color: colors.textSecondary, fontSize: font.xs, fontFamily: fontFamily.semibold },
});
