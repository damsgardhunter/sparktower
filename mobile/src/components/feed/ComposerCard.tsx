import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Avatar } from "../ui";
import { useMe } from "../FeedParts";
import { QUICK_POST_TYPES } from "../feedModel";
import { Box } from "./Box";

/**
 * The web's closed composer (feed-composer.tsx): what kind of update first,
 * centred, then your avatar and "Share what you're building…". Picking a kind
 * opens the full-screen composer ready for it.
 */
export function ComposerCard() {
  const router = useRouter();
  const me = useMe();
  if (!me.id) return null;
  return (
    <Box testID="card-composer-collapsed">
      <View style={s.quick} testID="composer-quick-types">
        {QUICK_POST_TYPES.map((t) => (
          <Pressable
            key={t.type}
            onPress={() => router.push(`/post/new?type=${t.type}` as any)}
            style={({ pressed }) => [s.quickBtn, pressed && { backgroundColor: colors.surfaceRaised }]}
            testID={`button-quick-${t.type}`}
          >
            <Ionicons name={t.icon} size={14} color={colors.text} />
            <Text style={s.quickText} numberOfLines={1}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.openRow}>
        <Pressable onPress={() => router.push("/(tabs)/profile")} accessibilityLabel="Your profile">
          <Avatar name={me.name} uri={me.avatar} size={40} />
        </Pressable>
        <Pressable
          onPress={() => router.push("/post/new")}
          style={({ pressed }) => [s.pill, pressed && { backgroundColor: colors.surfaceRaised }]}
          accessibilityRole="button"
          testID="button-open-composer"
        >
          <Text style={s.pillText}>Share what you're building…</Text>
        </Pressable>
      </View>
    </Box>
  );
}

const s = StyleSheet.create({
  quick: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 2,
    paddingBottom: 10, borderBottomWidth: 1, borderColor: "#D6D6D6",
  },
  quickBtn: { flexDirection: "row", alignItems: "center", gap: 5, height: 28, paddingHorizontal: 8, borderRadius: 6 },
  quickText: { color: colors.text, fontSize: 12, fontFamily: fontFamily.medium },
  openRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: 10 },
  pill: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 999,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  pillText: { color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular },
});
