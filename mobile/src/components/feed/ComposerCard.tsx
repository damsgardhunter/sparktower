import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, font, fontFamily, spacing } from "../../theme";
import { Avatar } from "../ui";
import { useMe } from "../FeedParts";
import { QUICK_POST_TYPES } from "../feedModel";
import { Box } from "./Box";

/**
 * Short enough for one row. The full names live on the post itself, where
 * there is a line to spell them out on; here three of them have to share the
 * width of a phone with their icons.
 */
const QUICK_LABELS: Record<string, string> = {
  project_update: "Update",
  looking_for_help: "Need help",
  looking_for_cofounder: "Co-founder",
};

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
            <Text style={s.quickText} numberOfLines={1}>{QUICK_LABELS[t.type] ?? t.label}</Text>
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
  /*
   * One row, no wrapping. "Project Update", "Looking for Help" and "Looking for
   * Cofounder" are 42 characters between them, so `flexWrap` put them on two or
   * three lines and the card grew a block of stacked buttons where a single
   * strip was meant to be. Equal flex cells share the width instead, and the
   * labels are shortened to fit one — the icon carries the rest of the meaning.
   */
  quick: {
    flexDirection: "row", justifyContent: "center", gap: 2,
    paddingBottom: 10, borderBottomWidth: 1, borderColor: "#D6D6D6",
  },
  quickBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 28, paddingHorizontal: 4, borderRadius: 6 },
  quickText: { color: colors.text, fontSize: 11.5, fontFamily: fontFamily.medium, flexShrink: 1 },
  openRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: 10 },
  pill: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 999,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  pillText: { color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular },
});
