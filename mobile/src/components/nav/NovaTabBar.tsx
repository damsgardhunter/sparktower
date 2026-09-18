import { useRouter } from "expo-router";
import { useState, type ComponentProps } from "react";
import { Animated, Image, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Tabs } from "expo-router";
import { DISCOVER_NEW_KEY } from "../../explore";
import { api } from "../../api/client";
import { colors, fontFamily, novaGradient, shadow, spacing } from "../../theme";
import { Icon, NovaGradient, type IconName } from "../ui";
import { useTabBarVisibility } from "../tab-bar-visibility";
import { MARK_INSET, TOWER_MARK } from "./tower-mark";

/** What expo-router hands a custom tab bar. */
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/**
 * The tabs either side of the create dome, in order — the left half first.
 *
 * Mirrors the web sidebar's primary group: Discover is the standing outward
 * destination now that it has absorbed browsing projects, matches and the
 * leaderboard, and Chat and More come down off the top header so the five
 * places you actually move between are all under your thumb. Projects stays
 * off the bar — your own projects are reached from the create dome, the feed
 * and your profile, never by browsing to a list of them.
 */
const TABS: { name: string; label: string; icon: IconName; iconActive: IconName; testID?: string }[] = [
  { name: "feed", label: "Home", icon: "home-outline", iconActive: "home" },
  { name: "discover", label: "Discover", icon: "compass-outline", iconActive: "compass" },
  { name: "notifications", label: "Alerts", icon: "notifications-outline", iconActive: "notifications" },
  // Named Chat on the bar and Messages everywhere else: "Chat" is a third the
  // width at a tenth-of-a-point font, which is what makes five labels fit.
  { name: "messages", label: "Chat", icon: "chatbubble-ellipses-outline", iconActive: "chatbubble-ellipses" },
  // The same glyph the header used for it, so the move down doesn't cost anyone the habit.
  // `tab-more` is already the manage screen's section chrome, so this one is
  // spelled out rather than derived, to keep the two apart in a test.
  { name: "more", label: "More", icon: "menu-outline", iconActive: "menu", testID: "tab-more-menu" },
];

/**
 * Where the create dome splits the bar: Home and Discover to its left, Alerts,
 * Chat and More to its right. The odd tab goes right because the two on the
 * left are the ones people hit blind, and giving them the wider halves is worth
 * more than an even split.
 */
const SPLIT = Math.floor(TABS.length / 2);

/**
 * The dome: a semicircle rising out of the bottom edge of the screen with the
 * tower in it, mirroring the web header's semicircle hanging *down* from the
 * top bar. Same mark, same gradient, opposite direction — the phone's chrome is
 * at the bottom, so the shape is too.
 *
 * `DOME_W` is the crowding dial, and five tabs plus a dome is genuinely tight:
 * the row reserves exactly this width, so every point here comes off the tabs
 * either side. The halves keep equal flex so the dome stays centred, which
 * means the three-tab half sets the floor — at 375pt (SE, 13 mini) 104 leaves
 * Alerts, Chat and More ~45pt each and Home and Discover ~68pt, so the
 * narrowest target clears 44pt in both directions (the row is 48pt tall).
 * Anything wider than ~111 here would push those three under the floor.
 */
const DOME_W = 104;
/** How far the dome stands proud of the bar's top edge. Enough to read as the main action, not so much that it covers content. */
const DOME_RISE = 30;
/**
 * How far the dome carries on past the bottom of the screen.
 *
 * The shape reads as something rising out of the edge rather than a lozenge
 * parked on it, and that only works if its bottom is genuinely cut off — the
 * same reason the web's hanging semicircle has no bottom edge. It also buys the
 * mark height without making the dome wider, which is the dimension the tabs
 * either side cannot spare.
 */
const DOME_DROP = 24;

/**
 * The bar's own height, which is also how far it slides away on scroll and
 * roughly what a scrolling screen leaves clear (TAB_BAR_SPACE in ui.tsx).
 * Shallower than it was: the icons lost 2pt, the pill lost 3pt of padding and
 * the label 1pt, which is 11pt off the footer without taking a tab target
 * under 44pt — the row below still measures 48pt before the safe-area inset.
 */
const ICON = 21;
const ROW_PAD = 4;
const PILL_PAD = 3;

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
 * The bottom bar: Nova's gradient, five tabs, and the tower rising in the
 * middle to start a project — the one thing the whole product is for, one tap
 * from anywhere.
 */
export function NovaTabBar({ state, navigation }: BottomTabBarProps) {
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
  /*
   * The same query the header runs for its messages button — same key, so the
   * two share one cache entry and one poll rather than counting the same
   * unread threads twice.
   */
  const { data: unread } = useQuery({
    queryKey: ["unread-count"],
    queryFn: () => api<{ count: number }>("/api/messages/unread-count"),
    refetchInterval: 20_000,
  });
  const cap = (n?: number) => (n ? (n > 99 ? "99+" : n) : undefined);
  const badges: Record<string, number | string | undefined> = {
    notifications: cap(notes?.count),
    messages: cap(unread?.count),
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
        style={{ flex: 1, alignItems: "center", paddingVertical: ROW_PAD }}
        testID={t.testID ?? `tab-${t.name}`}
      >
        {/*
          * The active tab is a soft pill behind the icon rather than a rule
          * under the label: it reads at a glance, it doesn't add a third row of
          * pixels to the bar's height, and it keeps the bar shallow, which is
          * most of what makes one feel sleek rather than heavy.
          */}
        <View style={{
          paddingHorizontal: 10, paddingVertical: PILL_PAD, borderRadius: 999,
          backgroundColor: focused ? "rgba(255,255,255,0.18)" : "transparent",
          alignItems: "center",
        }}>
          <View>
            <Icon name={focused ? t.iconActive : t.icon} size={ICON} color="#FFFFFF" />
            <Badge value={badges[t.name]} />
          </View>
        </View>
        {/*
          * One line, always. Five labels in the width of a small phone leaves
          * "Discover" a couple of points of slack, and a wrapped label would
          * put the height back on the bar that this pass took off.
          */}
        <Text
          numberOfLines={1}
          style={{
            marginTop: 1, color: "#FFFFFF", fontSize: 9.5, lineHeight: 12,
            fontFamily: focused ? fontFamily.semibold : fontFamily.medium, opacity: focused ? 1 : 0.7,
          }}
        >
          {t.label}
        </Text>
      </Pressable>
    );
  };

  const visibility = useTabBarVisibility();
  const [height, setHeight] = useState(86);
  const domeH = height + DOME_RISE + DOME_DROP;
  /*
   * The mark is drawn whole in the dome's shoulder rather than half-cropped by
   * the screen edge: the square's artwork runs nearly its full height, so
   * cropping would take the bolts off the top. It therefore has to fit between
   * MARK_INSET below the curve and clear of the home indicator at the bottom,
   * which is why it shrinks with the dome on a phone that has no indicator.
   */
  const bottomPad = Math.max(insets.bottom, spacing.sm);
  /*
   * A portrait box, not a square. The mark is a tall, narrow tower — its art
   * fills about 86% of the square's height and only 48% of its width — so a
   * square box sizes the whole thing by the width it doesn't use and renders a
   * tower far shorter than the space allows. Giving it a taller box than it is
   * wide lets `contain` fit by height instead, which is the dimension people
   * read the tower by.
   */
  const markW = DOME_W - MARK_INSET * 2;
  const markH = Math.max(markW, Math.min(markW * 1.3, domeH - MARK_INSET - bottomPad * 0.6));

  return (
    /*
     * Absolutely positioned, which is what lets it slide away over the content
     * rather than leaving a blank strip where it used to sit. The screens that
     * opt into hiding it pad their lists by `TAB_BAR_SPACE` so nothing is stuck
     * underneath at the bottom of a scroll.
     */
    <Animated.View
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        transform: [{
          translateY: (visibility?.hidden ?? new Animated.Value(0)).interpolate({
            inputRange: [0, 1],
            // The dome, not the bar: it stands proud of the gradient, so sliding
            // by the bar's height alone would leave the tower peeking.
            outputRange: [0, domeH],
          }),
        }],
      }}
    >
      <NovaGradient style={{ flexDirection: "row", alignItems: "flex-start", paddingTop: 2, paddingBottom: Math.max(insets.bottom, spacing.sm), borderTopLeftRadius: 22, borderTopRightRadius: 22 }}>
        {/* Halves of equal flex, so the dome stays centred whether or not the two sides hold the same number of tabs. */}
        <View style={{ flex: 1, flexDirection: "row" }}>{TABS.slice(0, SPLIT).map(tab)}</View>
        {/*
          * The dome's own column. The gutter is what stops the dome from
          * swallowing taps meant for its neighbours: no tab is ever laid out
          * underneath it, so the two hit areas can't overlap however tall the
          * dome gets.
          */}
        <View style={{ width: DOME_W }} />
        <View style={{ flex: 1, flexDirection: "row" }}>{TABS.slice(SPLIT).map(tab)}</View>
      </NovaGradient>
      {/*
        * Last child, so it paints over the gradient instead of being clipped by
        * it — and `elevation` says the same thing to Android, which orders by
        * elevation before document order.
        */}
      <Pressable
        onPress={() => router.push("/project/new")}
        accessibilityRole="button"
        accessibilityLabel="Create a project"
        testID="tab-create-project"
        style={({ pressed }) => [{
          // Below the edge on purpose: the part that hangs off the bottom is
          // what makes it read as rising out of the screen (DOME_DROP).
          position: "absolute", alignSelf: "center", bottom: -DOME_DROP, width: DOME_W, height: domeH,
          // A dome, not a half-circle drawn to scale: the corner radii are the
          // full half-width, exactly as the web hang's `rounded-b-full` is, so a
          // taller bar gives a taller shoulder rather than a wider footprint.
          borderTopLeftRadius: DOME_W / 2, borderTopRightRadius: DOME_W / 2,
          // The gradient's middle colour, which is what the bar already is at
          // its centre — so the dome and the bar meet with no seam, the same
          // trick the web header's hanging semicircle uses.
          backgroundColor: novaGradient[1],
          alignItems: "center", justifyContent: "flex-start", paddingTop: MARK_INSET, overflow: "hidden",
          ...shadow.raised, zIndex: 1,
        }, pressed && { opacity: 0.9, transform: [{ scale: 0.97 }] }]}
      >
        {/*
          * Never tinted: the mark is already white line art, and a tint would
          * flatten the bolts. Sat in the shoulder of the dome, which is the
          * part above the bar's top edge and above the home indicator — the
          * half of the dome anyone actually looks at.
          */}
        <Image
          source={TOWER_MARK}
          style={{ width: markW, height: markH }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Pressable>
    </Animated.View>
  );
}
