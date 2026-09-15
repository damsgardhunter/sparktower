/**
 * A tall form in a sheet — applying to join, applying to invest, pledging.
 *
 * The shared Sheet is sized for a one-line decision; these forms run longer
 * than a phone screen, so the body scrolls between a fixed title bar and a
 * fixed action bar, and the primary button is always in reach of a thumb.
 */
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Btn, Icon, Meta, type IconName } from "./ui";

export function ProjectFormSheet({
  visible, onClose, title, subtitle, children, action, onAction, actionDisabled, actionLoading, actionIcon, footerNote,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  actionLoading?: boolean;
  actionIcon?: IconName;
  footerNote?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[s.sheet, { paddingBottom: insets.bottom }]}>
          <View style={s.grabber} />
          <View style={s.head}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.title}>{title}</Text>
              {subtitle ? <Meta>{subtitle}</Meta> : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close" style={s.close}>
              <Icon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {action && (
            <View style={s.foot}>
              {footerNote}
              <Btn label={action} onPress={onAction} disabled={actionDisabled} loading={actionLoading} icon={actionIcon} />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** A labelled group inside a form sheet. */
export function FormGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ gap: 2 }}>
        <Text style={s.groupLabel}>{label}</Text>
        {hint ? <Meta>{hint}</Meta> : null}
      </View>
      {children}
    </View>
  );
}

/** A checkbox row — consent, anonymity. */
export function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable onPress={() => onChange(!checked)} style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[s.box, checked && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
        {checked && <Icon name="checkmark" size={14} color="#FFFFFF" />}
      </View>
      <Text style={s.checkText}>{label}</Text>
    </Pressable>
  );
}

/** One-of-many as pills that toggle off when tapped again, like the web's chips. */
export function ChoicePills({ options, value, onChange }: {
  options: readonly { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={s.pills}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(on ? "" : o.id)}
            style={({ pressed }) => [s.pill, on && s.pillOn, pressed && { opacity: 0.7 }]}
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.pillText, on && { color: "#FFFFFF", fontFamily: fontFamily.semibold }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, minHeight: 60, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    maxHeight: "92%",
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: spacing.sm },
  head: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  title: { fontSize: font.lg, fontFamily: fontFamily.bold, color: colors.text },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  body: { padding: spacing.lg, gap: spacing.lg },
  foot: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  groupLabel: { fontSize: font.sm, fontFamily: fontFamily.semibold, color: colors.text },
  check: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  box: {
    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.textTertiary,
    alignItems: "center", justifyContent: "center", marginTop: 1,
  },
  checkText: { flex: 1, fontSize: font.sm, lineHeight: 19, color: colors.textSecondary, fontFamily: fontFamily.regular },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs + 2 },
  pill: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 7, backgroundColor: colors.surface,
  },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: font.sm, color: colors.text, fontFamily: fontFamily.medium },
});
