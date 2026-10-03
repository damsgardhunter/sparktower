/**
 * The dot that says this screen is watching something — the phone's half of
 * `client/src/components/nova/live-dot.tsx`.
 *
 * A ping ring behind a solid dot: it reads as "live" at a glance without a
 * word, which is the whole job. Inactive it stops moving and goes quiet rather
 * than disappearing, because a screen that was live a moment ago and is now
 * silent should say so rather than leave a gap where the signal was.
 *
 * The props are the web's, and for the web's reason: it had been hand-written
 * in five places with dots of two sizes, rings at three opacities and three
 * different greens, none of which meant anything. Size and health meant
 * something; everything else is fixed, so a live dot is a live dot.
 *
 * ## Why this one gets an animation when `Working` refused one
 *
 * `Working.tsx` declined a driven `Animated` loop on the grounds that a screen
 * already waiting on the network should not spend a frame budget on
 * reassurance "that the changing stage name and the ticking elapsed time
 * already provide". That reasoning holds there and does not here: this dot is
 * the only signal on the screen, so there is no other information for the ping
 * to be redundant with. It is also why the loop stops dead when `active` is
 * false — a permanently pinging dot on a stalled screen is a lie, and on a
 * phone it is a lie that costs battery to tell.
 */
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "../../theme";

/** `sm` inline with small print, `md` as a standalone indicator. The web's h-2 and h-2.5. */
const SIZE = { sm: 8, md: 10 } as const;

export function LiveDot({
  active = true, size = "sm", tone = "nova", style, testID = "live-dot", label,
}: {
  /** Pinging, or quiet. Off is a real state: watched, and nothing happening. */
  active?: boolean;
  size?: "sm" | "md";
  /**
   * `warn` for a screen still watching but no longer getting answers. Amber
   * rather than the gradient, because a live dot in Nova's colours on a feed
   * that is failing to refresh is the screen claiming to be fine while it is not.
   */
  tone?: "nova" | "warn";
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** For screen readers; the dot carries meaning no text repeats. */
  label?: string;
}) {
  const box = SIZE[size];
  const ping = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) { ping.setValue(0); return; }
    const loop = Animated.loop(
      Animated.timing(ping, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    /* Stopped on unmount and whenever it goes quiet, so a backgrounded screen animates nothing. */
    return () => { loop.stop(); ping.setValue(0); };
  }, [active, ping]);

  const ringColor = tone === "warn" ? colors.warning : colors.novaGreen;

  return (
    <View
      style={[{ width: box, height: box }, s.wrap, style]}
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole={label ? "image" : undefined}
    >
      {active && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: box, backgroundColor: ringColor },
            {
              /* The web's `animate-ping`: out to double size, fading as it goes. */
              transform: [{ scale: ping.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) }],
              opacity: ping.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            },
          ]}
        />
      )}
      {tone === "warn" ? (
        <View style={[s.fill, { width: box, height: box, borderRadius: box, backgroundColor: colors.warning }]} />
      ) : active ? (
        <LinearGradient
          colors={[colors.novaGreen, colors.novaEmerald, colors.novaPurple]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[s.fill, { width: box, height: box, borderRadius: box }]}
        />
      ) : (
        /* Quiet, not gone: the web's `bg-muted-foreground/40`. */
        <View style={[s.fill, { width: box, height: box, borderRadius: box, backgroundColor: colors.textTertiary, opacity: 0.4 }]} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  fill: { position: "relative" },
});
