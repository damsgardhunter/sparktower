/**
 * Small pieces the project manager's screens share: a notice context (the
 * web's toasts), tappable answer bubbles, a full-screen editor sheet, a
 * note well, and the "open on the web" row.
 */
import React, { createContext, useContext } from "react";
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NoticeBanner, useNotice, type Notice } from "../Sheet";
import { colors, font, fontFamily, radius, spacing } from "../../theme";
import { Btn, H2, Icon, IconButton, Meta, errText, type IconName } from "../ui";
import { webUrl } from "./shared";

// --- Notices ----------------------------------------------------------------

type Notify = (text: string, tone?: Notice["tone"], action?: Notice["action"]) => void;
const NoticeContext = createContext<{ notify: Notify; fail: (e: unknown, fallback?: string) => void }>({
  notify: () => {}, fail: () => {},
});

export function NoticeProvider({ children }: { children: React.ReactNode }) {
  const { notice, show, clear } = useNotice();
  const notify: Notify = (text, tone = "success", action) => show({ text, tone, action });
  const fail = (e: unknown, fallback = "Something went wrong.") => show({ text: errText(e, fallback), tone: "error" });
  return (
    <NoticeContext.Provider value={{ notify, fail }}>
      <View style={{ flex: 1 }}>
        {children}
        <NoticeBanner notice={notice} onDismiss={clear} />
      </View>
    </NoticeContext.Provider>
  );
}
export const useNotify = () => useContext(NoticeContext);

// --- Bubbles ------------------------------------------------------------------

/** A tap-to-answer choice, the web's rounded-full intake button. */
export function Bubble({ label, on, onPress, note, small }: { label: string; on: boolean; onPress: () => void; note?: string; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [{
        borderWidth: 1, borderRadius: radius.pill,
        borderColor: on ? colors.primary : colors.border,
        backgroundColor: on ? colors.primary : colors.surface,
        paddingHorizontal: small ? spacing.md - 2 : spacing.md + 2, paddingVertical: small ? 5 : 8,
        flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%",
      }, pressed && { opacity: 0.7 }]}
    >
      <Text style={{ color: on ? colors.primaryText : colors.text, fontSize: small ? font.xs + 1 : font.sm, fontFamily: on ? fontFamily.semibold : fontFamily.medium, flexShrink: 1 }}>{label}</Text>
      {note ? <Text style={{ color: on ? "rgba(255,255,255,0.85)" : colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.medium }}>{note}</Text> : null}
    </Pressable>
  );
}

/** A small tinted label — a status, a loop kind, a state. */
export function Tag({ label, color = colors.primary, solid }: { label: string; color?: string; solid?: boolean }) {
  return (
    <View style={{ borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: solid ? color : `${color}1A`, alignSelf: "flex-start" }}>
      <Text style={{ color: solid ? "#FFFFFF" : color, fontSize: 10.5, fontFamily: fontFamily.semibold }}>{label}</Text>
    </View>
  );
}

/** A muted well for Nova's notes, answers and the step in hand. */
export function Well({ children, style, tone }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: "warning" | "primary" }) {
  const tint = tone === "warning" ? colors.warning : tone === "primary" ? colors.primary : null;
  return (
    <View style={[{
      backgroundColor: tint ? `${tint}10` : colors.surfaceRaised, borderRadius: radius.sm, padding: spacing.md, gap: 6,
      borderWidth: tint ? 1 : 0, borderColor: tint ? `${tint}55` : "transparent",
    }, style]}>
      {children}
    </View>
  );
}

export function Overline({ children, color }: { children: React.ReactNode; color?: string }) {
  return <Text style={{ fontSize: 10.5, fontFamily: fontFamily.semibold, color: color ?? colors.textTertiary, textTransform: "uppercase", letterSpacing: 0.6 }}>{children}</Text>;
}

/** A multi-line input without a label, for inline forms. */
export function Area({ value, onChangeText, placeholder, rows = 4, maxLength }: { value: string; onChangeText: (v: string) => void; placeholder?: string; rows?: number; maxLength?: number }) {
  return (
    <TextInput
      value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textTertiary}
      multiline maxLength={maxLength}
      style={{
        minHeight: rows * 20 + 20, textAlignVertical: "top", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius.sm, padding: spacing.md, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular, lineHeight: 20,
      }}
    />
  );
}

/** A single-line input without a label. */
export function Line({ value, onChangeText, placeholder, maxLength, numeric }: { value: string; onChangeText: (v: string) => void; placeholder?: string; maxLength?: number; numeric?: boolean }) {
  return (
    <TextInput
      value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textTertiary} maxLength={maxLength}
      keyboardType={numeric ? "number-pad" : "default"}
      style={{
        backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
        paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text, fontSize: font.sm, fontFamily: fontFamily.regular,
      }}
    />
  );
}

// --- Full-screen editor -------------------------------------------------------

/** A page-sized modal with a close button and a pinned primary action — task and check-in editors. */
export function EditorSheet({
  visible, onClose, title, subtitle, children, action, footer,
}: {
  visible: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode;
  action?: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean };
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: Platform.OS === "android" ? insets.top : spacing.md, borderBottomWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md }}>
            <IconButton name="close" label="Close" onPress={onClose} color={colors.text} />
            <View style={{ flex: 1 }}>
              <H2>{title}</H2>
              {subtitle ? <Meta>{subtitle}</Meta> : null}
            </View>
            {action && <Btn small label={action.label} onPress={action.onPress} disabled={action.disabled} loading={action.loading} />}
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl * 2 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={{ padding: spacing.lg, paddingBottom: spacing.lg + insets.bottom, borderTopWidth: 1, borderColor: colors.border }}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- The web ------------------------------------------------------------------

export function openWeb(path: string) {
  void Linking.openURL(webUrl(path)).catch(() => {});
}

/** Shares text through the system sheet — the phone's stand-in for the web's Copy buttons. */
export async function shareText(message: string) {
  try {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(message);
      return "copied" as const;
    }
    await Share.share({ message });
    return "shared" as const;
  } catch {
    return "failed" as const;
  }
}

/** A row that hands a big tool to the website. */
export function WebToolRow({ icon, title, subtitle, path }: { icon: IconName; title: string; subtitle: string; path: string }) {
  return (
    <Pressable onPress={() => openWeb(path)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md }, pressed && { opacity: 0.6 }]}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: font.base, fontFamily: fontFamily.semibold, color: colors.text }}>{title}</Text>
        <Meta numberOfLines={2}>{subtitle}</Meta>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ fontSize: font.xs, color: colors.primary, fontFamily: fontFamily.semibold }}>Web</Text>
        <Icon name="open-outline" size={16} color={colors.primary} />
      </View>
    </Pressable>
  );
}

/** Check / empty circle, the web's CheckCircle2 and Circle. */
export function Tick({ done, size = 18 }: { done: boolean; size?: number }) {
  return <Icon name={done ? "checkmark-circle" : "ellipse-outline"} size={size} color={done ? colors.success : colors.textTertiary} />;
}
