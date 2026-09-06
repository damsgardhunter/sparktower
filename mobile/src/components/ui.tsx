/**
 * Shared UI primitives.
 *
 * React Native has no Tailwind, so without these every screen ends up with its
 * own 60-line StyleSheet. These are the native counterparts of the web app's
 * shadcn components — same names where it helps, same visual language.
 */
import React from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle,
} from "react-native";
import { colors, font, radius, spacing } from "../theme";

// --- Layout --------------------------------------------------------------

/** Scrolling screen body with consistent padding and pull-to-refresh. */
export function Screen({
  children, onRefresh, refreshing, contentStyle, scroll = true,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  scroll?: boolean;
}) {
  if (!scroll) {
    return <View style={[s.screenBase, contentStyle]}>{children}</View>;
  }
  return (
    <ScrollView
      style={s.screenBase}
      contentContainerStyle={[s.screenContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
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

export const Divider = () => <View style={s.divider} />;

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

export function Btn({
  label, onPress, variant = "primary", disabled, loading, style, small,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "outline" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        variant === "primary" && s.btnPrimary,
        variant === "outline" && s.btnOutline,
        variant === "ghost" && s.btnGhost,
        variant === "danger" && s.btnOutline,
        (pressed || isDisabled) && s.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.primaryText : colors.primary} size="small" />
      ) : (
        <Text
          style={[
            s.btnText,
            small && { fontSize: font.sm },
            variant === "primary" && { color: colors.primaryText },
            variant === "danger" && { color: colors.danger },
            variant === "ghost" && { color: colors.textSecondary },
          ]}
        >
          {label}
        </Text>
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
        active && { borderColor: tint, backgroundColor: `${tint}22` },
      ]}
    >
      {/* Wrapping text so long values — résumé skills, role names — don't
          overflow the way they did on the web. */}
      <Text style={[s.chipText, small && { fontSize: font.xs }, active && { color: colors.text, fontWeight: "700" }]}>
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
  keyboardType, autoCapitalize, maxLength, numeric,
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

export function Avatar({ name, size = 40, uri }: { name?: string | null; size?: number; uri?: string | null }) {
  const initial = (name || "?").charAt(0).toUpperCase();
  return (
    <View
      style={[
        s.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={{ color: colors.text, fontSize: size * 0.42, fontWeight: "700" }}>{initial}</Text>
    </View>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <View style={s.progressTrack}>
      <View style={[s.progressFill, { width: `${Math.max(0, Math.min(100, value))}%` }]} />
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
  title, body, action, onAction,
}: {
  title: string;
  body?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={s.empty}>
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
  screenContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, gap: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.borderSubtle },
  h1: { color: colors.text, fontSize: font.xl, fontWeight: "800", letterSpacing: -0.3 },
  h2: { color: colors.text, fontSize: font.lg, fontWeight: "700" },
  label: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.5,
  },
  body: { color: colors.text, fontSize: font.sm, lineHeight: 20 },
  meta: { color: colors.textTertiary, fontSize: font.xs },
  btn: {
    borderRadius: radius.sm, paddingVertical: spacing.md, paddingHorizontal: spacing.lg,
    alignItems: "center", justifyContent: "center",
  },
  btnSmall: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  btnPrimary: { backgroundColor: colors.primary },
  btnOutline: { borderWidth: 1, borderColor: colors.border },
  btnGhost: {},
  btnText: { color: colors.text, fontSize: font.base, fontWeight: "700" },
  chip: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexShrink: 1, maxWidth: "100%",
  },
  chipText: { color: colors.textSecondary, fontSize: font.sm, flexShrink: 1 },
  input: {
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    color: colors.text, fontSize: font.base,
  },
  segment: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  segmentActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: "600" },
  segmentTextActive: { color: colors.primaryText },
  avatar: { backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 6, backgroundColor: colors.surfaceRaised, borderRadius: radius.pill, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.primary, borderRadius: radius.pill },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.xl },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
  error: { color: colors.danger, fontSize: font.sm },
  pressed: { opacity: 0.65 },
  cost: {
    backgroundColor: colors.surfaceRaised, borderRadius: radius.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 1, minWidth: 22, alignItems: "center",
  },
  costText: { color: colors.textSecondary, fontSize: font.xs, fontWeight: "700" },
});
