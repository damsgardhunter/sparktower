/**
 * A bottom sheet for a short decision, and a notice for how it went.
 *
 * The app's one modal until now was the post composer, which takes the whole
 * screen — right for writing a post, too much for "send a request?". A sheet
 * keeps the card you acted on visible behind it. The notice is the phone's
 * version of the web app's toast: it floats above the list, says what happened
 * in a line, can carry one action ("Open chat"), and goes away on its own.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, fontFamily, radius, shadow, spacing } from "../theme";
import { Icon, type IconName } from "./ui";

export function Sheet({ visible, onClose, title, subtitle, children }: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {/* A light scrim: the page behind stays legible, the way the website's dialogs dim it. */}
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.32)" }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
            paddingBottom: spacing.sm + insets.bottom, ...shadow.raised,
          }}
        >
          <View style={{ alignItems: "center", paddingTop: spacing.sm }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colors.text, fontSize: font.lg, fontFamily: fontFamily.bold }}>{title}</Text>
              {subtitle ? <Text style={{ color: colors.textSecondary, fontSize: font.sm, fontFamily: fontFamily.regular, lineHeight: 19 }}>{subtitle}</Text> : null}
            </View>
          </View>
          {/* A plain View, not a ScrollView: several sheets bring their own scrolling list. */}
          <View style={{ padding: spacing.lg, paddingTop: spacing.md, gap: spacing.md }}>
            {children}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface Notice {
  text: string;
  tone: "success" | "error" | "info";
  action?: { label: string; onPress: () => void };
}

/** One notice at a time; a new one replaces the last. Longer when there's something to tap. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setNotice(null);
  }, []);

  const show = useCallback((next: Notice) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(next);
    timer.current = setTimeout(() => setNotice(null), next.action ? 6000 : 3500);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { notice, show, clear };
}

const TONE: Record<Notice["tone"], { color: string; icon: IconName }> = {
  success: { color: colors.success, icon: "checkmark-circle" },
  error: { color: colors.danger, icon: "alert-circle" },
  info: { color: colors.primary, icon: "information-circle" },
};

/** Floats above the bottom of the screen, so it's seen wherever in the list the tap happened. */
export function NoticeBanner({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  if (!notice) return null;
  const tone = TONE[notice.tone];
  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="alert"
      style={{
        position: "absolute", left: spacing.md, right: spacing.md, bottom: spacing.lg + insets.bottom,
        flexDirection: "row", alignItems: "center", gap: spacing.sm,
        backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1,
        borderLeftWidth: 4, borderLeftColor: tone.color,
        borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, ...shadow.raised,
      }}
    >
      <Icon name={tone.icon} size={20} color={tone.color} />
      <Text style={{ flex: 1, color: colors.text, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.medium }}>{notice.text}</Text>
      {notice.action && (
        <Pressable onPress={() => { notice.action?.onPress(); onDismiss(); }} hitSlop={8}>
          <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.bold }}>{notice.action.label}</Text>
        </Pressable>
      )}
    </Pressable>
  );
}
