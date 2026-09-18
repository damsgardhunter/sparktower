import { Tabs } from "expo-router";
import { colors } from "../../src/theme";
import { AppHeader } from "../../src/components/AppHeader";
import { NovaTabBar } from "../../src/components/nav/NovaTabBar";
import { TabBarVisibilityProvider } from "../../src/components/tab-bar-visibility";

/**
 * What a scrolling screen should leave clear at the bottom of its content: the
 * bar floats over the scene, and the create dome stands proud of the bar.
 * Defined with the Screen component that applies it, re-exported here because
 * this is where people look for it.
 */
export { TAB_BAR_SPACE } from "../../src/components/ui";

export default function TabsLayout() {
  return (
    <TabBarVisibilityProvider>
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
      <Tabs.Screen name="messages" options={{ title: "Messages" }} />
      {/* More lives in this group so its URL stays `/more` — a group's name is
          not part of the path, so every existing link to /more (the header's
          menu button among them) lands on the tab rather than a pushed screen. */}
      <Tabs.Screen name="more" options={{ title: "More" }} />
      {/* Off the bar, still tabs: your profile from the header, the rest from More.
          Projects joins them — off the bar, but the screen stays so its deep links still land. */}
      <Tabs.Screen name="projects" options={{ title: "Projects", href: null }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", href: null }} />
      <Tabs.Screen name="sprints" options={{ title: "Sprints", href: null }} />
      <Tabs.Screen name="leaderboard" options={{ title: "Leaderboard", href: null }} />
      </Tabs>
    </TabBarVisibilityProvider>
  );
}
