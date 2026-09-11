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
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme";
import { Body, Btn, H2, Meta } from "./ui";

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
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
            borderTopWidth: 1, borderColor: colors.border,
            padding: spacing.lg, paddingBottom: spacing.lg + insets.bottom, gap: spacing.md,
          }}
        >
          <H2>{title}</H2>
          {subtitle && <Meta>{subtitle}</Meta>}
          {children}
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

/** Floats above the bottom of the screen, so it's seen wherever in the list the tap happened. */
export function NoticeBanner({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  if (!notice) return null;
  const tint = notice.tone === "error" ? colors.danger : notice.tone === "success" ? colors.success : colors.info;
  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="alert"
      style={{
        position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg + insets.bottom,
        flexDirection: "row", alignItems: "center", gap: spacing.sm,
        backgroundColor: colors.surfaceRaised, borderColor: tint, borderWidth: 1, borderRadius: radius.md, padding: spacing.md,
      }}
    >
      <Body style={{ flex: 1 }}>{notice.text}</Body>
      {notice.action && (
        <Btn label={notice.action.label} small variant="outline" onPress={() => { notice.action?.onPress(); onDismiss(); }} />
      )}
    </Pressable>
  );
}
