import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { useRouter } from "expo-router";
import { FEATURED_CONTEST as C } from "../featuredContest";
import { fontFamily, novaGradient, spacing } from "../theme";
import { Icon } from "./ui";

export const INK = "#07060D";
const AMOUNT_COLORS = ["#6EE7B7", "#BBF7D0", "#D8B4FE"] as const;

/**
 * "$50,000,000,000" in the emerald → purple gradient (solid emerald on web,
 * where masking isn't reliable). Sized to the width it has — auto-shrinking
 * text doesn't work everywhere, and the number must never be cut off.
 */
export function GradientAmount({ size: max }: { size: number }) {
  const [width, setWidth] = useState(0);
  // Space Grotesk bold runs about 0.62em a character across this string.
  const size = width ? Math.min(max, Math.floor(width / (C.amount.length * 0.62))) : max;
  const style: StyleProp<TextStyle> = { fontSize: size, lineHeight: size * 1.1, fontFamily: fontFamily.bold, letterSpacing: -0.5, textAlign: "center" };
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ alignSelf: "stretch", opacity: width ? 1 : 0 }}>
      <AmountText style={style} />
    </View>
  );
}

function AmountText({ style }: { style: StyleProp<TextStyle> }) {
  if (Platform.OS === "web") return <Text style={[style, { color: "#6EE7B7" }]} numberOfLines={1}>{C.amount}</Text>;
  return (
    <MaskedView maskElement={<Text style={style} numberOfLines={1}>{C.amount}</Text>}>
      <LinearGradient colors={[...AMOUNT_COLORS]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}>
        <Text style={[style, { opacity: 0 }]} numberOfLines={1}>{C.amount}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

/** Soft emerald and purple light in the corners of a dark panel. */
export function Glow() {
  return (
    <>
      <LinearGradient pointerEvents="none" colors={["rgba(16,185,129,0.35)", "rgba(16,185,129,0)"]} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.6 }} style={StyleSheet.absoluteFill} />
      <LinearGradient pointerEvents="none" colors={["rgba(147,51,234,0)", "rgba(147,51,234,0.45)"]} start={{ x: 0.3, y: 0.4 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    </>
  );
}

export function Pill({ icon, label, gold }: { icon?: "trophy" | "ellipse"; label: string; gold?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5,
      borderColor: gold ? "rgba(252,211,77,0.45)" : "rgba(255,255,255,0.18)", backgroundColor: gold ? "rgba(252,211,77,0.1)" : "rgba(255,255,255,0.06)" }}>
      {icon === "trophy" ? <Icon name="trophy" size={12} color="#FDE68A" /> : icon === "ellipse" ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#34D399" }} /> : null}
      <Text style={{ color: gold ? "#FDE68A" : "rgba(255,255,255,0.75)", fontSize: 10, letterSpacing: 1.6, fontFamily: fontFamily.semibold, textTransform: "uppercase" }}>{label}</Text>
    </View>
  );
}

/** The main contest, filling the contests section. Tapping anywhere opens its page. */
export function FeaturedContestCard() {
  const router = useRouter();
  return (
    <Pressable testID="card-featured-contest" accessibilityRole="button" accessibilityLabel={`${C.name}. ${C.headline} ${C.prize}`}
      onPress={() => router.push(`/contest/${C.slug}` as any)} style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
      <LinearGradient colors={[...novaGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 26, padding: 1.5 }}>
        <View style={{ borderRadius: 24.5, backgroundColor: INK, overflow: "hidden", paddingHorizontal: spacing.lg, paddingVertical: spacing.xxl + 8 }}>
          <Glow />
          <View style={{ alignItems: "center" }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
              <Pill icon="trophy" label="Grand prize" gold />
              <Pill icon="ellipse" label={C.status} />
            </View>
            <Text style={{ marginTop: spacing.xl, color: "rgba(255,255,255,0.6)", fontSize: 11, letterSpacing: 3, fontFamily: fontFamily.medium, textTransform: "uppercase" }}>{C.name}</Text>
            <View style={{ alignSelf: "stretch", marginTop: spacing.sm }}><GradientAmount size={40} /></View>
            <Text style={{ marginTop: spacing.lg, color: "#FFFFFF", fontSize: 21, lineHeight: 27, fontFamily: fontFamily.semibold, textAlign: "center" }}>{C.headline}</Text>
            <Text style={{ marginTop: spacing.xs, color: "rgba(255,255,255,0.72)", fontSize: 15, lineHeight: 21, fontFamily: fontFamily.regular, textAlign: "center" }}>✦ {C.prize}</Text>
            <View style={{ marginTop: spacing.xl, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 }}>
              <Text style={{ color: INK, fontSize: 14, fontFamily: fontFamily.semibold }}>See the challenge</Text>
              <Icon name="arrow-forward" size={16} color={INK} />
            </View>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
