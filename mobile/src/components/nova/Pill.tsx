/**
 * A small bordered badge for a state — the phone's half of
 * `client/src/components/nova/pill.tsx`.
 *
 * The tinted, thin-bordered shape a dozen of which can sit in a row without the
 * screen shouting. `tone` keeps the colour decisions in one place rather than as
 * a colour picked at every call site, which is what the phone was doing: twenty
 * pills reached for `colors.success`, `colors.warning`, `colors.info` or
 * `colors.danger` by hand, so "what does green mean here" was answered
 * separately twenty times.
 *
 * ## The tone that matters most
 *
 * `unknown` is dashed and blue, never red — carried over from the web verbatim,
 * because the reasoning is the point: "nobody has checked" is a question and
 * `bad` is an answer, and drawing them alike is how a screen tells somebody they
 * have a problem they do not have.
 *
 * ## Where this sits among the phone's other pills
 *
 * There are two others, in `MoreKit` and `profile/kit`, and they are not
 * redundant with this one: they take an arbitrary colour or a variant, for a
 * tier badge or a post type — decoration keyed to something that is not a state.
 * This one is for states, and it is the only one that should ever carry a
 * severity. The three are not merged because merging them means deciding that a
 * tier and a severity are the same kind of thing, and they are not.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "../ui";
import { colors, font, fontFamily, radius } from "../../theme";

export type PillTone = "good" | "warn" | "bad" | "info" | "neutral" | "unknown";

/**
 * Each tone as a tint, a border and a text colour — the web's `/10` fill and
 * `/30` border, in the phone's palette.
 *
 * The phone has one blue where the web has blue and sky, so `info` and
 * `unknown` share a hue and are told apart by the dashed border. That is the
 * half of the distinction that carries the meaning; the half that is lost is a
 * shade.
 */
export const PILL_TONE: Record<PillTone, { bg: string; border: string; text: string; dashed?: boolean }> = {
  good: { bg: tint(colors.success), border: edge(colors.success), text: colors.success },
  warn: { bg: tint(colors.warning), border: edge(colors.warning), text: colors.warning },
  bad: { bg: tint(colors.danger), border: edge(colors.danger), text: colors.danger },
  info: { bg: tint(colors.info), border: edge(colors.info), text: colors.info },
  neutral: { bg: colors.surfaceRaised, border: colors.border, text: colors.textSecondary },
  unknown: { bg: tint(colors.info), border: edge(colors.info, 0.4), text: colors.info, dashed: true },
};

/** `#RRGGBB` at a tenth, the web's `/10`. */
function tint(hex: string): string { return alpha(hex, 0.1); }
/** The same at three tenths, the web's `/30`. */
function edge(hex: string, a = 0.3): string { return alpha(hex, a); }
function alpha(hex: string, a: number): string {
  const n = hex.replace("#", "");
  const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function Pill({ label, tone = "neutral", icon, style, testID, children }: {
  /** The state, in a word or two. */
  label?: string;
  tone?: PillTone;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** For a pill whose content is not a plain string. */
  children?: ReactNode;
}) {
  const t = PILL_TONE[tone];
  return (
    <View
      style={[
        s.pill,
        { backgroundColor: t.bg, borderColor: t.border },
        t.dashed && { borderStyle: "dashed" },
        style,
      ]}
      testID={testID}
    >
      {icon ? <Icon name={icon} size={12} color={t.text} /> : null}
      {label != null ? <Text style={[s.label, { color: t.text }]} numberOfLines={1}>{label}</Text> : null}
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  /* The web's `rounded-full border px-2 py-0.5 text-[11px] font-medium gap-1`. */
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1,
  },
  label: { fontSize: font.xs, fontFamily: fontFamily.medium, flexShrink: 1 },
});
