/**
 * The project page's sections, side by side and swipeable — the way a fantasy
 * app slides between a team's screens. A page per section, one section per
 * swipe, each with its own vertical scroll.
 *
 * Built on a plain horizontal ScrollView rather than a native pager: the app
 * ships without react-native-pager-view (and without Reanimated or Gesture
 * Handler), and adding one would mean a native rebuild for a gesture that
 * `pagingEnabled` already gives us.
 *
 * Two things that are easy to get wrong here:
 *
 *   - The nested gesture. A vertical scroll inside a horizontal one only
 *     behaves if each owns one axis and nothing else. So the sideways scroller
 *     is locked to its axis (`directionalLockEnabled`, and no vertical content
 *     of its own) and each page's scroller is vertical-only; RN then hands a
 *     drag to whichever direction it started in and the other one stays out of
 *     it. The header and the tab strip sit *outside* the pager entirely — a
 *     header inside a page would slide away sideways with the section, and a
 *     header wrapped around the pager in an outer vertical ScrollView would put
 *     two vertical scrollers in the same column, fighting over every drag.
 *   - Mounting. Nine sections, several of them lists that fetch on mount, so
 *     only the pages `mountedPages` names are in the tree; the rest are empty
 *     spacers holding their width. A visited page is never dropped, so its
 *     scroll position and its data survive a swim to the other end and back.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Platform, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native";
import { colors, spacing } from "../../theme";
import { indexFromOffset, mountedPages } from "./pager";

export interface PagerPage {
  key: string;
  render: () => ReactNode;
}

export interface SectionPagerHandle {
  /** Slide to a page, as tapping its tab does. */
  goTo: (index: number, animated?: boolean) => void;
  /** Scroll within a page — for the header's "Back this project", which jumps to a card inside Overview. */
  scrollPageTo: (index: number, y: number, animated?: boolean) => void;
}

export const SectionPager = forwardRef<SectionPagerHandle, {
  pages: PagerPage[];
  index: number;
  onIndexChange: (index: number) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  testID?: string;
}>(function SectionPager({ pages, index, onIndexChange, refreshing, onRefresh, testID = "project-pager" }, ref) {
  const { width } = useWindowDimensions();
  const strip = useRef<ScrollView>(null);
  const pageScrolls = useRef<Record<number, ScrollView | null>>({});
  const [visited, setVisited] = useState<number[]>([index]);
  // Where the swipe itself has already put us, so answering the `index` prop
  // doesn't re-scroll to the page the user just landed on mid-deceleration.
  const settled = useRef(index);

  const mounted = mountedPages(visited, index, pages.length);

  useEffect(() => {
    setVisited((was) => (was.includes(index) ? was : [...was, index]));
    if (settled.current === index || !width) return;
    settled.current = index;
    strip.current?.scrollTo({ x: index * width, animated: true });
  }, [index, width]);

  // A rotation changes the page width under a fixed offset, which would leave
  // the pager parked between two sections.
  useEffect(() => {
    if (width) strip.current?.scrollTo({ x: index * width, animated: false });
  }, [width]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    goTo: (i, animated = true) => {
      settled.current = i;
      strip.current?.scrollTo({ x: i * width, animated });
    },
    scrollPageTo: (i, y, animated = true) => pageScrolls.current[i]?.scrollTo({ y, animated }),
  }), [width]);

  const land = (x: number) => {
    const i = indexFromOffset(x, width, pages.length);
    if (i === settled.current) return;
    settled.current = i;
    onIndexChange(i);
  };

  return (
    <ScrollView
      ref={strip}
      testID={testID}
      horizontal
      pagingEnabled
      directionalLockEnabled
      showsHorizontalScrollIndicator={false}
      /*
       * iOS snaps on `pagingEnabled` alone; Android's implementation lets a
       * hard fling coast across several pages, so it gets the snap points
       * spelled out — `snapToInterval` plus a fast deceleration, and
       * `disableIntervalMomentum` to hold it to one section per swipe.
       */
      decelerationRate="fast"
      snapToInterval={width}
      snapToAlignment="start"
      disableIntervalMomentum
      // The bounce at either end reads as a page that doesn't exist.
      bounces={false}
      overScrollMode="never"
      scrollEventThrottle={16}
      onMomentumScrollEnd={(e) => land(e.nativeEvent.contentOffset.x)}
      // Android can finish a slow drag without any momentum at all, and then
      // the tab strip would never catch up.
      onScrollEndDrag={(e) => { if (Platform.OS === "android") land(e.nativeEvent.contentOffset.x); }}
      style={{ flex: 1 }}
    >
      {pages.map((p, i) => (
        <View key={p.key} style={{ width }} testID={`${testID}-page-${p.key}`}>
          {mounted.includes(i) ? (
            <ScrollView
              ref={(r) => { pageScrolls.current[i] = r; }}
              // Android won't hand a drag to an inner scroller inside another one without this.
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: spacing.xxl * 3, gap: spacing.sm }}
              refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
              style={{ flex: 1 }}
            >
              {p.render()}
            </ScrollView>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
});
