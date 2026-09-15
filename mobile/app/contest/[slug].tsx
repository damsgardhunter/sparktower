import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FEATURED_CONTEST as C } from "../../src/featuredContest";
import { colors, font, fontFamily, radius, spacing } from "../../src/theme";
import { Btn, Empty, Icon, NovaGradient } from "../../src/components/ui";
import { GradientAmount, Glow, INK, Pill } from "../../src/components/FeaturedContest";

/**
 * A contest's page — the web's /contests/:slug. Only the $50 Billion Challenge
 * exists, and it's an announcement: the challenge, how it works, basic rules,
 * and no way to enter until the official terms are written.
 */
export default function ContestDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (slug !== C.slug) {
    return (
      <>
        <Stack.Screen options={{ title: "Contest" }} />
        <View style={{ flex: 1, justifyContent: "center", padding: spacing.xl }}>
          <Empty icon="trophy-outline" title="That contest doesn't exist" body="It may have moved." />
          <Btn label="Back to contests" variant="outline" onPress={() => router.replace("/contests" as any)} />
        </View>
      </>
    );
  }
  const label = { color: colors.textTertiary, fontSize: font.xs, fontFamily: fontFamily.semibold, letterSpacing: 0.8, textTransform: "uppercase" as const };

  return (
    <>
      <Stack.Screen options={{ title: C.short + " Challenge", headerStyle: { backgroundColor: INK }, headerTintColor: "#FFFFFF", headerTitleStyle: { color: "#FFFFFF", fontFamily: fontFamily.semibold } }} />
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl * 2 }}>
        {/* Hero */}
        <View style={{ backgroundColor: INK, overflow: "hidden", paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, paddingBottom: spacing.xxl + 12 }}>
          <Glow />
          <View style={{ alignItems: "center" }}>
            <Pill icon="trophy" label="The SparkTower grand prize" gold />
            <Text testID="text-contest-name" style={{ marginTop: spacing.xl, color: "rgba(255,255,255,0.6)", fontSize: 11, letterSpacing: 3, fontFamily: fontFamily.medium, textTransform: "uppercase" }}>{C.name}</Text>
            <View style={{ alignSelf: "stretch", marginTop: spacing.sm }}><GradientAmount size={44} /></View>
            <Text style={{ marginTop: spacing.xl, color: "#FFFFFF", fontSize: 24, lineHeight: 30, fontFamily: fontFamily.semibold, textAlign: "center" }}>{C.headline}</Text>
            <Text style={{ marginTop: spacing.sm, color: "rgba(255,255,255,0.75)", fontSize: 17, lineHeight: 23, fontFamily: fontFamily.regular, textAlign: "center" }}>✦ {C.prize}</Text>
            <View testID="contest-status" style={{ marginTop: spacing.xl, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 16, paddingVertical: 9 }}>
              <Icon name="time-outline" size={15} color="#6EE7B7" />
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: fontFamily.medium }}>{C.status}</Text>
            </View>
          </View>
        </View>

        <View style={{ padding: spacing.lg, gap: spacing.xl }}>
          <View testID="contest-about" style={{ gap: spacing.md }}>
            <Text style={label}>The challenge</Text>
            {C.about.map((p, i) => <Text key={i} style={{ color: colors.text, fontSize: 17, lineHeight: 26, fontFamily: fontFamily.regular }}>{p}</Text>)}
          </View>

          <View style={{ gap: spacing.md, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.xl }}>
            <Text style={label}>How it works</Text>
            {C.steps.map((s, i) => (
              <View key={s.title} style={{ flexDirection: "row", gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg }}>
                <NovaGradient style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: "#FFFFFF", fontSize: 14, fontFamily: fontFamily.bold }}>{i + 1}</Text>
                </NovaGradient>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{s.title}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>{s.body}</Text>
                </View>
              </View>
            ))}
          </View>

          <View testID="contest-rules" style={{ gap: spacing.md, borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.xl }}>
            <Text style={label}>Basic rules</Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }}>
              {C.rules.map((r, i) => (
                <View key={r.title} style={{ flexDirection: "row", gap: spacing.md, padding: spacing.lg, borderTopWidth: i ? 1 : 0, borderColor: colors.border }}>
                  <Text style={{ color: colors.primary, fontSize: font.sm, fontFamily: fontFamily.semibold, width: 22 }}>{String(i + 1).padStart(2, "0")}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>{r.title}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, fontFamily: fontFamily.regular, marginTop: 2 }}>{r.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* Not open — no way to enter, on purpose. */}
          <View testID="contest-not-open" style={{ flexDirection: "row", gap: spacing.md, alignItems: "center", backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
              <Icon name="lock-closed-outline" size={18} color={colors.textTertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: font.base, fontFamily: fontFamily.semibold }}>Entries aren't open yet</Text>
              <Text style={{ color: colors.textSecondary, fontSize: font.sm, lineHeight: 19, fontFamily: fontFamily.regular }}>The full terms and rules are being drafted. Keep building — this is where the challenge will open.</Text>
            </View>
          </View>

          <Text testID="contest-fineprint" style={{ color: colors.textTertiary, fontSize: font.xs + 1, lineHeight: 17, fontFamily: fontFamily.regular }}>{C.fineprint}</Text>
        </View>
      </ScrollView>
    </>
  );
}
