/**
 * The Nova gradient outline — the phone's `.nova-ring` and `.nova-ring-soft`.
 *
 * The web gets a gradient border from one element: a card-coloured fill clipped
 * to the padding box over the gradient clipped to the border box. A phone has
 * neither, so the equivalent is two views — the gradient fills the outer one and
 * a surface-coloured inner view sits on top, inset by the border width — which
 * is the same idea with the clipping done by geometry instead of by CSS.
 *
 * It lives here, once, for the reason the web's CSS comment gives for making it
 * a class: "so the look spreads by adding a class, not by wrapping every card in
 * a padded gradient div". On the phone the padded gradient div is unavoidable;
 * what is avoidable is writing it out at each of the sixty-seven places the web
 * uses this.
 *
 * `nova` is the full-strength ring the web puts on the one thing on a screen
 * that should draw the eye; `soft` is the same gradient at 45%, for the
 * secondary cards that make up most of a list. The hexes come from the theme and
 * are held to the web's values by `nova-gradient-parity.test.ts`.
 */
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius as themeRadius } from "../../theme";

const WIDTH = { nova: 1.5, soft: 1 } as const;

/** Typed as the tuple expo-linear-gradient wants: at least two stops. */
const STOPS: Record<"nova" | "soft", readonly [string, string, ...string[]]> = {
  nova: [colors.novaGreen, colors.novaEmerald, colors.novaPurple],
  /* The web's `.nova-ring-soft`: the same three at 0.45 alpha. */
  soft: ["rgba(74,222,128,0.45)", "rgba(16,185,129,0.45)", "rgba(168,85,247,0.45)"],
};

export function NovaRing({
  children, strength = "soft", radius = themeRadius.sm, glow, style, innerStyle, testID,
}: {
  children: ReactNode;
  /** `nova` is the lit ring; `soft` the quieter one most cards wear. */
  strength?: "nova" | "soft";
  /** The outer radius. The inner view is inset by the border width so the curve stays true. */
  radius?: number;
  /** The web's `.nova-glow`, approximated — see the note on the style below. */
  glow?: boolean;
  style?: StyleProp<ViewStyle>;
  /** For the surface inside the ring: padding, gap, whatever the card had. */
  innerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const width = WIDTH[strength];
  return (
    <LinearGradient
      colors={STOPS[strength]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[{ borderRadius: radius, padding: width }, glow && s.glow, style]}
      testID={testID}
    >
      <View style={[s.inner, { borderRadius: Math.max(0, radius - width) }, innerStyle]}>
        {children}
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  inner: { backgroundColor: colors.surface, overflow: "hidden" },
  /*
   * The web's `.nova-glow` throws two shadows, green to the left and purple to
   * the right. React Native allows one shadow colour per view, so this is the
   * purple half — the side that reads as "lit" rather than as a drop shadow.
   * Said plainly because it is a deliberate approximation, not an oversight.
   */
  glow: {
    shadowColor: colors.novaPurple, shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
});
