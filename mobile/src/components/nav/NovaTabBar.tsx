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
];

/**
 * Where the dome splits the bar: Home and Discover to its left, Alerts and Chat
 * to its right. Two and two, so the halves are genuinely symmetrical and the
 * dome sits on the centre line rather than near it.
 */
const SPLIT = Math.floor(TABS.length / 2);

/**
 * The dome: a semicircle rising out of the bottom edge of the screen with the
 * tower in it, mirroring the web header's semicircle hanging *down* from the
 * top bar. Same mark, same gradient, opposite direction — the phone's chrome is
 * at the bottom, so the shape is too.
 *
 * Sized to read as one step up from a tab, not as a centrepiece: a tab's icon
 * pill is 28pt, so a 64pt dome carrying a ~50pt tower is plainly the bigger
 * target without dominating the bar. Crowding stopped being the constraint
 * when More came off — four tabs share the width either side of a dome this
 * narrow with room to spare.
 */
const DOME_W = 64;
/** How far the dome stands proud of the bar's top edge. Enough to read as the main action, not so much that it covers content. */
const DOME_RISE = 20;
/**
 * How far the dome carries on past the bottom of the screen.
 *
 * The shape reads as something rising out of the edge rather than a lozenge
 * parked on it, and that only works if its bottom is genuinely cut off — the
 * same reason the web's hanging semicircle has no bottom edge. It also buys the
 * mark height without making the dome wider, which is the dimension the tabs
 * either side cannot spare.
 */
const DOME_DROP = 18;

/**
 * How tall the bar reads, and how far it slides away on scroll.
 *
 * Shorter again: 21pt icons to 20, and the label is gone. Four tabs whose
 * meanings are a house, a compass, a bell and a speech bubble do not need
 * naming — and the label was the row's tallest 12pt. What is left is the icon,
 * its pill, and breathing room.
 *
 * The visible row is now 38pt, which is under Apple's 44pt minimum for a
 * *target* — so the target no longer stops at the row. Each tab's Pressable
 * reaches down through the safe-area padding beneath the bar (empty space on
 * every phone with a home indicator, and padded to 12pt on those without), so
 * the thing a thumb can hit stays at least 44pt tall while the thing an eye
 * sees is 38. Shrinking the strip and shrinking the target are different
 * changes, and only one of them is wanted.
 */
const ICON = 20;
const ROW_PAD = 3;
const PILL_PAD = 4;
/** What a tab's touch area must reach, whatever the row measures. */
const MIN_TARGET = 44;

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
        /*
         * `minHeight` plus the bar's own bottom padding is what keeps the
         * target at 44pt while the visible row is 38 — the space below the
         * icons is empty on every phone, so a thumb landing there is landing
         * on the tab it was aiming at.
         */
        style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: ROW_PAD }}
        /*
         * The touch area, not the layout. `minHeight` here would push the row
         * back to 44pt — it made the bar exactly as tall as the target I was
         * trying to keep, which is the opposite of the point. hitSlop grows
         * what a thumb can hit and nothing that occupies space, and it reaches
         * down into the padding below the icons, which is empty on every phone.
         */
        hitSlop={{ top: 6, bottom: MIN_TARGET, left: 4, right: 4 }}
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
  /*
   * Just enough to clear the home indicator, not the whole inset it asks for.
   * The full 34pt is sized for content you can touch; nothing lives down there
   * but the bar's own floor, and reserving it put a band of empty gradient
   * under the icons that read as a bar sitting too high off the bottom.
   */
  const bottomPad = insets.bottom > 0 ? Math.round(insets.bottom * 0.4) : spacing.sm;
  /*
   * A portrait box, not a square. The mark is a tall, narrow tower — its art
   * fills about 86% of the square's height and only 48% of its width — so a
   * square box sizes the whole thing by the width it doesn't use and renders a
   * tower far shorter than the space allows. Giving it a taller box than it is
   * wide lets `contain` fit by height instead, which is the dimension people
   * read the tower by.
   */
  const markW = DOME_W - MARK_INSET * 2;
  /*
   * 1.24: the dome's height is no longer the thing limiting
   * the mark, so the multiplier is what actually sets its size — raise this to
   * grow the tower, `DOME_W` to widen the dome, `DOME_RISE` to lift both.
   */
  const markH = Math.max(markW, Math.min(markW * 1.24, domeH - MARK_INSET - bottomPad * 0.45));

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
      {/* Square across the full width: the rounded top corners made it read as a
          sheet resting on the screen rather than the screen's own edge. */}
      <NovaGradient style={{ flexDirection: "row", alignItems: "flex-start", paddingTop: 2, paddingBottom: bottomPad }}>
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
        onPress={() => router.push("/more")}
        accessibilityRole="button"
        accessibilityLabel="More"
        // Renamed with the behaviour: this opens More now, and a testID that
        // still said "create" would send the next person looking in the wrong
        // place. Creating a project is the button on Home.
        testID="tab-more-dome"
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
          // Centred across, and anchored to the top rather than the middle: the
          // dome's lower half is below the screen edge, so centring vertically
          // would push the tower down into the part nobody sees.
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
