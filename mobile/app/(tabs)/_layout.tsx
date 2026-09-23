import { Tabs } from "expo-router";
import { colors } from "../../src/theme";
import { AppHeader, PlainHeader } from "../../src/components/AppHeader";
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
        /*
         * Zero, because the header draws its own: the cover photo runs from the
         * very top of the screen so the time and wifi icon sit on the
         * photograph. Left at its default, react-navigation pads the header
         * down by the status bar's height and the photo starts below it, which
         * is the banner-pasted-under-the-furniture look the cover is meant to
         * replace.
         */
        headerStatusBarHeight: 0,
        /*
         * The header floats over the scene rather than sitting above it.
         * Without this it keeps its slot in the layout, so sliding it away on
         * scroll revealed an empty band where it used to be instead of the
         * content underneath — space the scene could never grow into because
         * the header still owned it. Screens leave room with useHeaderSpace().
         */
        headerTransparent: true,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen name="feed" options={{ title: "Home" }} />
      <Tabs.Screen name="discover" options={{ title: "Discover" }} />
      {/*
        * Messages and Sprints say what they are, like More does.
        *
        * The cover header is about you — your photograph, your face, your
        * three numbers — which is the right thing above your feed and an odd
        * thing above a list of conversations or a simulation table: a quarter
        * of the screen given to something the page isn't about. It also slides
        * away on scroll, and the scroll state is shared, so arriving here
        * showed it or didn't depending on what you were reading a moment ago.
        * That was the "sometimes there, sometimes not".
        */}
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          header: () => <PlainHeader title="Messages" subtitle="Your conversations, newest first" />,
        }}
      />
      {/* Sprints has the bar slot Notifications had: notifications are reached
          from the bell in the header, which is where the unread count lives. */}
      <Tabs.Screen
        name="sprints"
        options={{
          title: "Sprints & simulations",
          header: () => <PlainHeader title="Sprints & simulations" subtitle="Run a company against other founders" />,
        }}
      />
      {/* More lives in this group so its URL stays `/more` — a group's name is
          not part of the path, so every existing link to /more lands on the tab
          rather than a pushed screen. It has no button of its own: the dome in
          the middle of the bar is how you get here. */}
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          href: null,
          /* Not the profile header: a menu is for getting somewhere else, and
             this one was showing you yourself and offering a tap to see more
             of it. */
          header: () => <PlainHeader title="Menu" subtitle="Everything that isn't on the bar" />,
        }}
      />
      {/* Off the bar, still tabs: your profile from the header, the rest from More.
          Projects joins them — off the bar, but the screen stays so its deep links still land. */}
      <Tabs.Screen name="projects" options={{ title: "Projects", href: null }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", href: null }} />
      <Tabs.Screen name="notifications" options={{ title: "Notifications", href: null }} />
      <Tabs.Screen name="leaderboard" options={{ title: "Leaderboard", href: null }} />
      </Tabs>
    </TabBarVisibilityProvider>
  );
}
