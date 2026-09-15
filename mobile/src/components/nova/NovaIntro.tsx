import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fontFamily, novaGradient, spacing } from "../../theme";
import { Icon } from "../ui";

/*
 * Nova's introduction — client/src/pages/nova-intro.tsx, on the phone: a grid
 * and drifting particles, the chip with its pulsing pins, and "Nova", the
 * subtitle and the tagline decrypting in one after another before the button
 * appears. Tapping anywhere skips ahead to the button.
 */

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%&*!?<>{}[]=/\\|~^";
const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" });
const EMERALD = colors.novaEmerald;
const randomChar = () => CHARS[Math.floor(Math.random() * CHARS.length)];

function useDecryptText(target: string, active: boolean, speed = 70) {
  const [display, setDisplay] = useState("");
  useEffect(() => {
    if (!active) { setDisplay(""); return; }
    let frame = 0;
    const total = target.length * 3;
    const id = setInterval(() => {
      frame++;
      const resolved = Math.floor((frame / total) * target.length);
      let out = "";
      for (let i = 0; i < target.length; i++) out += i < resolved || target[i] === " " ? target[i] : randomChar();
      if (frame >= total) { clearInterval(id); out = target; }
      setDisplay(out);
    }, speed);
    return () => clearInterval(id);
  }, [target, active, speed]);
  return display;
}

/** A looping 0→1→0 value. */
function useLoop(duration: number, delay = 0, easing = Easing.inOut(Easing.ease)) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: duration / 2, easing, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: duration / 2, easing, useNativeDriver: true }),
    ]));
    const t = setTimeout(() => anim.start(), delay);
    return () => { clearTimeout(t); anim.stop(); };
  }, [v, duration, delay, easing]);
  return v;
}

/** Fades and slides in once when mounted. */
function Appear({ children, from = 20, scaleFrom, duration = 600, delay = 0 }: {
  children: React.ReactNode; from?: number; scaleFrom?: number; duration?: number; delay?: number;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, duration, delay]);
  const transform: any[] = [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }];
  if (scaleFrom !== undefined) transform.push({ scale: v.interpolate({ inputRange: [0, 1], outputRange: [scaleFrom, 1] }) });
  return <Animated.View style={{ opacity: v, transform, alignItems: "center" }}>{children}</Animated.View>;
}

function DecryptionLine() {
  const [chars, setChars] = useState(() => Array.from({ length: 28 }, randomChar));
  useEffect(() => {
    const id = setInterval(() => setChars((c) => c.map(randomChar)), 150);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={{ flexDirection: "row", marginBottom: spacing.lg }}>
      {chars.map((c, i) => (
        <Text key={i} style={{ width: 9, textAlign: "center", fontFamily: MONO, fontSize: 10, color: EMERALD, opacity: 0.4 }}>{c}</Text>
      ))}
    </View>
  );
}

function Particle({ x, y, size, duration, delay }: { x: number; y: number; size: number; duration: number; delay: number }) {
  const v = useLoop(duration, delay);
  return (
    <Animated.View style={{
      position: "absolute", left: `${x}%`, top: `${y}%`, width: size, height: size, borderRadius: size,
      backgroundColor: colors.novaGreen,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.6] }),
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -30] }) }],
    }} />
  );
}

function ParticleField() {
  const particles = useMemo(() => Array.from({ length: 40 }, (_, i) => ({
    id: i, x: Math.random() * 100, y: Math.random() * 100, size: Math.random() * 3 + 1,
    duration: Math.random() * 4000 + 3000, delay: Math.random() * 2000,
  })), []);
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{particles.map((p) => <Particle key={p.id} {...p} />)}</View>;
}

function GridOverlay() {
  const { width, height } = useWindowDimensions();
  const step = 60;
  const line = { position: "absolute" as const, backgroundColor: EMERALD };
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: 0.08 }]}>
      {Array.from({ length: Math.ceil(width / step) + 1 }, (_, i) => <View key={`v${i}`} style={[line, { left: i * step, top: 0, bottom: 0, width: 1 }]} />)}
      {Array.from({ length: Math.ceil(height / step) + 1 }, (_, i) => <View key={`h${i}`} style={[line, { top: i * step, left: 0, right: 0, height: 1 }]} />)}
    </View>
  );
}

function Pin({ side, pos, delay }: { side: "top" | "bottom" | "left" | "right"; pos: number; delay: number }) {
  const v = useLoop(1500, delay, Easing.linear);
  const horizontal = side === "top" || side === "bottom";
  const style = horizontal
    ? { left: `${pos}%` as const, marginLeft: -1, width: 2, height: 10, [side]: -10 }
    : { top: `${pos}%` as const, marginTop: -1, height: 2, width: 10, [side]: -10 };
  return (
    <Animated.View style={[{ position: "absolute", backgroundColor: colors.novaGreen }, style,
      { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] }) }]} />
  );
}

export function ChipIcon({ size = 96 }: { size?: number }) {
  const sides = ["top", "bottom", "left", "right"] as const;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <LinearGradient colors={[...novaGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 16, shadowColor: EMERALD, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 }]} />
      <View style={{ position: "absolute", top: 3, left: 3, right: 3, bottom: 3, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.92)" }} />
      <View style={{ position: "absolute", top: 6, left: 6, right: 6, bottom: 6, borderRadius: 10, borderWidth: 1, borderColor: "rgba(16,185,129,0.3)" }} />
      <Icon name="hardware-chip-outline" size={size * 0.42} color={colors.novaGreen} />
      {sides.map((side) => [25, 50, 75].map((pos, i) => (
        <Pin key={`${side}-${i}`} side={side} pos={pos} delay={i * 200 + (side === "bottom" || side === "right" ? 500 : 0)} />
      )))}
    </View>
  );
}

/** "Nova" in the gradient, emerald → green → purple. */
function GradientTitle({ text }: { text: string }) {
  const title = <Text style={s.title}>{text || " "}</Text>;
  if (Platform.OS === "web") return <Text style={[s.title, { color: EMERALD }]}>{text || " "}</Text>;
  return (
    <MaskedView maskElement={title}>
      <LinearGradient colors={["#34D399", "#86EFAC", "#C084FC"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}>
        <Text style={[s.title, { opacity: 0 }]}>{text || " "}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

function Glow() {
  const big = useLoop(3000);
  const ring = useLoop(2500);
  return (
    <>
      <Animated.View pointerEvents="none" style={{
        position: "absolute", top: -32, left: -32, right: -32, bottom: -32,
        opacity: big.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] }),
        transform: [{ scale: big.interpolate({ inputRange: [0, 1], outputRange: [1, 1.4] }) }],
      }}>
        {/* No blur in React Native: stacked, fading circles stand in for the web's blur-2xl. */}
        {[0, 1, 2].map((i) => (
          <LinearGradient key={i} colors={["rgba(74,222,128,0.12)", "rgba(16,185,129,0.06)", "rgba(168,85,247,0.12)"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ position: "absolute", top: i * 12, left: i * 12, right: i * 12, bottom: i * 12, borderRadius: 999 }} />
        ))}
      </Animated.View>
      <Animated.View pointerEvents="none" style={{
        position: "absolute", top: -16, left: -16, right: -16, bottom: -16, borderRadius: 26, borderWidth: 1, borderColor: "rgba(16,185,129,0.25)",
        opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
        transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }],
      }} />
    </>
  );
}

function ShimmerButton({ label, onPress }: { label: string; onPress: () => void }) {
  const x = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(200);
  useEffect(() => {
    const anim = Animated.loop(Animated.timing(x, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true }));
    anim.start();
    return () => anim.stop();
  }, [x]);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID="button-begin-nova"
      style={({ pressed }) => [s.button, pressed && { transform: [{ scale: 0.97 }] }]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
        transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-w, w * 2] }) }],
      }]}>
        <LinearGradient colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.22)", "rgba(255,255,255,0)"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
          style={{ width: w, height: "100%" }} />
      </Animated.View>
      <Text style={s.buttonText}>{label}</Text>
      <Icon name="arrow-forward" size={20} color="#FFFFFF" />
    </Pressable>
  );
}

function StatusDot() {
  const v = useLoop(2000);
  return <Animated.View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.novaGreen, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) }} />;
}

export function NovaIntro({ onBegin, onClose }: { onBegin: () => void; onClose?: () => void }) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState(0);
  const nova = useDecryptText("Nova", phase >= 1, 50);
  const subtitle = useDecryptText("Your AI Project Partner", phase >= 2, 25);
  const tagline = useDecryptText("Let's build something extraordinary together.", phase >= 3, 18);

  const chip = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(chip, { toValue: 1, stiffness: 150, damping: 12, mass: 1, delay: 100, useNativeDriver: true }).start();
    const timers = [600, 1800, 3000, 4200].map((ms, i) => setTimeout(() => setPhase((p) => Math.max(p, i + 1)), ms));
    return () => timers.forEach(clearTimeout);
  }, [chip]);

  return (
    <Pressable style={s.root} onPress={() => setPhase(4)} accessible={false}>
      <GridOverlay />
      <ParticleField />
      <LinearGradient pointerEvents="none" colors={["rgba(16,185,129,0.06)", "rgba(255,255,255,0)", "rgba(168,85,247,0.06)"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

      {onClose && (
        <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close" style={[s.close, { top: insets.top + spacing.sm }]}>
          <Icon name="close" size={24} color={colors.textSecondary} />
        </Pressable>
      )}

      <View style={s.center}>
        <DecryptionLine />
        <Animated.View style={{ opacity: chip, transform: [{ scale: chip }], marginBottom: spacing.xl }}>
          <Glow />
          <ChipIcon />
        </Animated.View>

        <View style={{ minHeight: 64, alignItems: "center" }}>
          {phase >= 1 && (
            <Appear>
              <GradientTitle text={nova} />
              <Appear from={0} delay={300} duration={800}>
                <LinearGradient colors={["#34D399", colors.novaPurple]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={{ height: 2, width: 64, marginTop: 6 }} />
              </Appear>
            </Appear>
          )}
        </View>
        <View style={{ minHeight: 34, marginTop: spacing.md }}>
          {phase >= 2 && <Appear from={15}><Text style={s.subtitle}>{subtitle}</Text></Appear>}
        </View>
        <View style={{ minHeight: 40, marginTop: spacing.sm }}>
          {phase >= 3 && <Appear from={15}><Text style={s.tagline}>{tagline}</Text></Appear>}
        </View>
        <View style={{ minHeight: 60, marginTop: spacing.xl }}>
          {phase >= 4 && <Appear from={0} scaleFrom={0.9} duration={400}><ShimmerButton label="Begin" onPress={onBegin} /></Appear>}
        </View>
      </View>

      {phase >= 4 && (
        <View style={[s.footer, { bottom: insets.bottom + spacing.xl }]}>
          <Appear from={0} delay={300}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <StatusDot />
              <Text style={s.footerText}>SparkTower AI Systems Online</Text>
            </View>
          </Appear>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, overflow: "hidden" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  close: { position: "absolute", left: spacing.lg, zIndex: 5, padding: 4 },
  title: { fontSize: 40, fontWeight: "700", fontFamily: MONO, letterSpacing: -1, color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 17, fontFamily: MONO, color: colors.textTertiary, textAlign: "center", lineHeight: 26 },
  tagline: { fontSize: 13, fontFamily: MONO, color: colors.textTertiary, opacity: 0.75, textAlign: "center", lineHeight: 19, maxWidth: 320 },
  button: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, overflow: "hidden",
    backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 32, height: 50,
    shadowColor: EMERALD, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontFamily: fontFamily.semibold },
  footer: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  footerText: { fontSize: 11, fontFamily: MONO, color: colors.textTertiary, opacity: 0.6 },
});
