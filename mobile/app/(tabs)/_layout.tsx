import { Tabs } from "expo-router";
import { Pressable, Text, View, type ColorValue } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../src/api/client";
import { colors, font, spacing } from "../../src/theme";

/**
 * Tab icons as emoji.
 *
 * A real icon set (@expo/vector-icons) is the right long-term answer, but
 * emoji keep this dependency-free while the app is still taking shape.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return (
    <Text style={{ fontSize: 20, color, opacity: color === colors.primary ? 1 : 0.65 }}>
      {glyph}
    </Text>
  );
}

/** Header shortcuts: notifications, with the unread count, and the screens that don't warrant a tab. */
function HeaderLinks() {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["notification-count"],
    queryFn: () => api<{ count: number }>("/api/notifications/unread-count"),
    refetchInterval: 30_000,
  });
  const unread = data?.count ?? 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingRight: spacing.md }}>
      <Pressable onPress={() => router.push("/notifications")} hitSlop={8} accessibilityLabel={unread ? `${unread} unread notifications` : "Notifications"}>
        <Text style={{ fontSize: 18 }}>🔔</Text>
        {unread > 0 && (
          <View style={{ position: "absolute", top: -4, right: -8, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{unread > 99 ? "99+" : unread}</Text>
          </View>
        )}
      </Pressable>
      <Pressable onPress={() => router.push("/more")} hitSlop={8}>
        <Text style={{ color: colors.textSecondary, fontSize: font.base }}>More</Text>
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  // Unread count drives the Messages badge.
  const { data: unread } = useQuery({
    queryKey: ["unread-count"],
    queryFn: () => api<{ count: number }>("/api/messages/unread-count"),
    refetchInterval: 20_000,
  });

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.text, fontSize: font.lg, fontWeight: "700" },
        headerShadowVisible: false,
        headerRight: () => <HeaderLinks />,
        sceneStyle: { backgroundColor: colors.background },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarLabelStyle: { fontSize: font.xs },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{ title: "Feed", tabBarIcon: ({ color }) => <TabIcon glyph="📰" color={color} /> }}
      />
      <Tabs.Screen
        name="discover"
        options={{ title: "Discover", tabBarIcon: ({ color }) => <TabIcon glyph="🔍" color={color} /> }}
      />
      <Tabs.Screen
        name="projects"
        options={{ title: "Projects", tabBarIcon: ({ color }) => <TabIcon glyph="🚀" color={color} /> }}
      />
      <Tabs.Screen
        name="sprints"
        options={{ title: "Sprints", tabBarIcon: ({ color }) => <TabIcon glyph="⏱️" color={color} /> }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Inbox",
          tabBarIcon: ({ color }) => <TabIcon glyph="💬" color={color} />,
          tabBarBadge: unread?.count ? unread.count : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.primaryText },
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} /> }}
      />
      {/* Reachable via the header "More" link and deep links, not the tab bar. */}
      <Tabs.Screen name="leaderboard" options={{ href: null, title: "Leaderboard" }} />
    </Tabs>
  );
}
