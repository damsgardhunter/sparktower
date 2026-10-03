/**
 * The strip that answers "where am I, and what now" — the phone's half of
 * `client/src/components/nova/glance.tsx`.
 *
 * Two or three facts and one button, above everything else. The Codebase tab is
 * the model: *Code* — which repository; *Last read* — when, and whether it is
 * live; *Do now* — the button. Somebody who opens the screen knows where they
 * stand before reading a sentence.
 *
 * The alternative, which most of this product still does, is a paragraph
 * explaining the feature followed by a button — read once by somebody new and
 * skipped for ever by the person who uses the screen daily, so the screen is
 * optimised for its least frequent visitor.
 *
 * ## This is the web's phone layout, not a new design
 *
 * The web's version is `grid-cols-1` with ruled columns only from `sm` up, so it
 * is already a stack at phone width — the dividers and the hidden action label
 * are its desktop form. Implementing the stack is therefore matching the web
 * rather than inventing for the phone, which is why there are no dividers here
 * and why `GlanceAction` always shows its label: on the web that label is
 * `sm:hidden`, visible at exactly the width this file is for.
 *
 * ## The rules that make it work, carried over verbatim
 *
 * **Short labels.** One or two words, upper case, quiet. "Last read", not
 * "When this project's code was most recently analysed".
 *
 * **A value that is a fact, not a sentence.** A date, a count, a name, a state.
 * If it needs a verb it belongs in the line underneath.
 *
 * **One action.** There is only ever one of it. Two primary buttons is a screen
 * that has not decided.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, font, fontFamily, spacing } from "../../theme";

export function Glance({ children, style, testID = "glance" }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return <View style={[s.strip, style]} testID={testID}>{children}</View>;
}

/** One fact: a label, the fact, and optionally a quieter line under it. */
export function GlanceStat({ label, value, note, style, testID }: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[s.stat, style]} testID={testID}>
      <Text style={s.label} numberOfLines={1}>{label}</Text>
      {typeof value === "string" || typeof value === "number"
        ? <Text style={s.value} numberOfLines={1}>{value}</Text>
        : <View style={s.valueRow}>{value}</View>}
      {note != null && (
        typeof note === "string" || typeof note === "number"
          ? <Text style={s.note} numberOfLines={1}>{note}</Text>
          : <View style={s.noteRow}>{note}</View>
      )}
    </View>
  );
}

/**
 * The last column: what to do next.
 *
 * Its label always shows here. On the web it is `sm:hidden` — present exactly
 * when the columns have become a stack and the button under them is no longer
 * self-evidently the action, which is this width.
 */
export function GlanceAction({ children, label = "Do now", style, testID }: {
  children: ReactNode;
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[s.action, style]} testID={testID}>
      <Text style={s.label} numberOfLines={1}>{label}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  /* The web's `gap-4` between stacked rows. */
  strip: { gap: spacing.md },
  stat: { minWidth: 0, gap: 2 },
  /*
   * The web's GLANCE_LABEL — 11px, semibold, upper case, tracking-wider, muted.
   * The phone's own convention for this label is already the same numbers, which
   * is why nothing here is a conversion: font.xs is 11, and 0.5 at 11px is what
   * tracking-wider comes to.
   */
  label: {
    color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold,
    letterSpacing: 0.5, textTransform: "uppercase",
  },
  value: { color: colors.text, fontSize: font.sm, fontFamily: fontFamily.medium },
  valueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  note: { color: colors.textSecondary, fontSize: font.xs },
  noteRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  action: { gap: 4, justifyContent: "center" },
});
