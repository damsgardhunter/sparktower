import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, fetchMe } from "../api/client";
import { colors, font, fontFamily, radius, spacing } from "../theme";
import { Avatar, Icon, IconButton } from "./ui";

/**
 * The top of every main screen, the way a professional network does it on a
 * phone: your photo (your profile), a search pill (people and projects), and
 * messages with the unread count. Titles aren't needed — the tab bar says
 * where you are.
 */
export function AppHeader() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const { data: unread } = useQuery({
    queryKey: ["unread-count"],
    queryFn: () => api<{ count: number }>("/api/messages/unread-count"),
    refetchInterval: 20_000,
  });
  const name = me?.profile?.displayName || me?.user?.firstName || "You";

  return (
    <View
      style={{
        paddingTop: insets.top + spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: spacing.md,
        backgroundColor: colors.background, borderBottomWidth: 1, borderColor: colors.border,
        flexDirection: "row", alignItems: "center", gap: spacing.md,
      }}
    >
      <Pressable onPress={() => router.push("/(tabs)/profile")} accessibilityLabel="Your profile" hitSlop={6}>
        <Avatar name={name} uri={me?.profile?.avatarUrl ?? me?.user?.profileImageUrl} size={34} />
      </Pressable>
      <Pressable
        onPress={() => router.push("/search")}
        accessibilityRole="search"
        style={{
          flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm,
          backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 36,
        }}
      >
        <Icon name="search" size={17} color={colors.textTertiary} />
        <Text style={{ color: colors.textTertiary, fontSize: font.sm, fontFamily: fontFamily.regular }}>Search builders and projects</Text>
      </Pressable>
      <IconButton name="chatbubble-ellipses-outline" label="Messages" color={colors.textSecondary} badge={unread?.count} onPress={() => router.push("/(tabs)/messages")} />
      <IconButton name="menu" label="More" color={colors.textSecondary} onPress={() => router.push("/more")} />
    </View>
  );
}
