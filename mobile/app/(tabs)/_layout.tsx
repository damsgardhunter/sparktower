import { Tabs, useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DISCOVER_NEW_KEY } from "../../src/explore";
import { api } from "../../src/api/client";
import { colors, font, fontFamily, shadow, spacing } from "../../src/theme";
import { Icon, NovaGradient, type IconName } from "../../src/components/ui";
import { AppHeader } from "../../src/components/AppHeader";

/** What expo-router hands a custom tab bar. */
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/**
 * The tabs either side of the create button, in order — the left half first.
 *
 * Mirrors the web sidebar's primary group now that Discover has absorbed
 * browsing projects, matches and the leaderboard: Discover is the standing
 * outward destination, and Projects came off the bar because your own projects
 * are reached from the create button, the feed and your profile, never by
 * browsing to a list of them. Discover already sat here, so it keeps its slot
 * rather than sliding right into the one Projects vacated — moving the whole
 * bar under people's thumbs would cost more than the symmetry is worth.
 */
const TABS: { name: string; label: string; icon: IconName; iconActive: IconName }[] = [
  { name: "feed", label: "Home", icon: "home-outline", iconActive: "home" },
  { name: "discover", label: "Discover", icon: "compass-outline", iconActive: "compass" },
  { name: "notifications", label: "Alerts", icon: "notifications-outline", iconActive: "notifications" },
];

/** Where the create button splits the bar. Left of it gets the extra tab when the count is odd. */
const SPLIT = Math.ceil(TABS.length / 2);

function Badge({ value }: { value?: number | string }) {
  if (!value) return null;
  return (
    <View style={{
      position: "absolute", top: -4, right: -10, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
      backgroundColor: colors.danger, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#FFFFFF",
    }}>
      <Text style={{ color: "#FFFFFF", fontSize: 9, fontFamily: fontFamily.bold }}>{value}</Text>
    </View>
  );
}

/**
 * The bottom bar: Nova's gradient, the tabs, and the big button in the middle
 * that starts a project — the one thing the whole product is for, one tap from
 * anywhere.
 */
function NovaTabBar({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data: notes } = useQuery({
    queryKey: ["notification-count"],
    queryFn: () => api<{ count: number }>("/api/notifications/unread-count"),
    refetchInterval: 30_000,
  });
  const { data: discoverNew } = useQuery({
    queryKey: DISCOVER_NEW_KEY,
    queryFn: () => api<{ count: number; more: boolean }>("/api/discover/new-count"),
    refetchInterval: 60_000,
  });
  const badges: Record<string, number | string | undefined> = {
    notifications: notes?.count ? (notes.count > 99 ? "99+" : notes.count) : undefined,
    discover: discoverNew?.count ? `${Math.min(discoverNew.count, 99)}${discoverNew.more || discoverNew.count > 99 ? "+" : ""}` : undefined,
  };
  const current = state.routes[state.index]?.name;

  const tab = (t: (typeof TABS)[number]) => {
    const focused = current === t.name;
    return (
      <Pressable
        key={t.name}
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={t.label}
        onPress={() => {
          const route = state.routes.find((r: { name: string; key: string }) => r.name === t.name);
          const event = navigation.emit({ type: "tabPress", target: route?.key ?? t.name, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(t.name);
        }}
        style={{ flex: 1, alignItems: "center", gap: 2, paddingTop: spacing.sm }}
        testID={`tab-${t.name}`}
      >
        <View>
          <Icon name={focused ? t.iconActive : t.icon} size={24} color="#FFFFFF" />
          <Badge value={badges[t.name]} />
        </View>
        <Text style={{ color: "#FFFFFF", fontSize: font.xs, fontFamily: focused ? fontFamily.bold : fontFamily.medium, opacity: focused ? 1 : 0.85 }}>
          {t.label}
        </Text>
        <View style={{ height: 3, width: 18, borderRadius: 2, backgroundColor: focused ? "#FFFFFF" : "transparent", marginTop: 1 }} />
      </Pressable>
    );
  };

  return (
    <View style={{ backgroundColor: "transparent" }}>
      <NovaGradient style={{ flexDirection: "row", alignItems: "flex-start", paddingBottom: Math.max(insets.bottom, spacing.sm), borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
        {/* Halves of equal flex, so the create button stays centred whether or not the two sides hold the same number of tabs. */}
        <View style={{ flex: 1, flexDirection: "row" }}>{TABS.slice(0, SPLIT).map(tab)}</View>
        <View style={{ width: 76 }} />
        <View style={{ flex: 1, flexDirection: "row" }}>{TABS.slice(SPLIT).map(tab)}</View>
      </NovaGradient>
      {/* Raised above the bar so it reads as the main action. */}
      <Pressable
        onPress={() => router.push("/project/new")}
        accessibilityRole="button"
        accessibilityLabel="Create a project"
        testID="tab-create-project"
        style={({ pressed }) => [{
          position: "absolute", alignSelf: "center", top: -26, width: 66, height: 66, borderRadius: 33,
          backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", ...shadow.raised,
        }, pressed && { transform: [{ scale: 0.95 }] }]}
      >
        <NovaGradient style={{ width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" }}>
          <Icon name="add" size={34} color="#FFFFFF" />
        </NovaGradient>
      </Pressable>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <NovaTabBar {...props} />}
      screenOptions={{
        header: () => <AppHeader />,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen name="feed" options={{ title: "Home" }} />
      <Tabs.Screen name="discover" options={{ title: "Discover" }} />
      <Tabs.Screen name="notifications" options={{ title: "Notifications" }} />
      {/* Off the bar, still tabs: messages and your profile from the header, the rest from More.
          Projects joins them — off the bar, but the screen stays so its deep links still land. */}
      <Tabs.Screen name="projects" options={{ title: "Projects", href: null }} />
      <Tabs.Screen name="messages" options={{ title: "Messages", href: null }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", href: null }} />
      <Tabs.Screen name="sprints" options={{ title: "Sprints", href: null }} />
      <Tabs.Screen name="leaderboard" options={{ title: "Leaderboard", href: null }} />
    </Tabs>
  );
}
