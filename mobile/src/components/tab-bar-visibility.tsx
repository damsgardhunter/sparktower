/**
 * The bottom bar gets out of the way while you're reading, and comes back the
 * moment you reach for it.
 *
 * The behaviour people know from X and Instagram: scrolling down slides the bar
 * off the bottom, any upward drag brings it straight back, and it is always
 * there at the top of a list. On a phone the bar is roughly a tenth of the
 * screen, and a feed is the one place that tenth is worth more as content.
 *
 * Three things make it feel right rather than nervous, and all three are the
 * difference between this and a naive `onScroll` handler:
 *
 *   - **A threshold.** A few pixels of movement is a thumb resting, not a
 *     decision. Under it, nothing happens, so the bar doesn't flicker while
 *     someone holds the screen still.
 *   - **Nothing hides near the top.** Rubber-banding at the top of a list
 *     produces downward deltas; hiding the bar there feels like a glitch.
 *   - **It reappears on the way back, immediately.** Coming back is the
 *     gesture that means "I want the controls", so it is answered at the first
 *     upward pixel past the threshold rather than at the end of the scroll.
 *
 * The animation runs on the native thread (`useNativeDriver`), so the bar keeps
 * moving smoothly while JavaScript is busy rendering the list it's sliding
 * away from — which is exactly when it would otherwise stutter.
 */
import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
// The judgement lives in a pure function so it can be tested without a phone.
import { decideBar } from "../scroll-direction";

const HIDE_MS = 220;
const SHOW_MS = 160;

interface TabBarVisibility {
  /** 0 shown, 1 hidden. The bar interpolates its own height against this. */
  hidden: Animated.Value;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Bring it back — for leaving a screen, or any action that needs the bar visible. */
  reveal: () => void;
}

const Ctx = createContext<TabBarVisibility | null>(null);

export function TabBarVisibilityProvider({ children }: { children: React.ReactNode }) {
  const hidden = useRef(new Animated.Value(0)).current;
  const lastY = useRef(0);
  /** What we last asked for, so a scroll doesn't restart the same animation on every frame. */
  const wantHidden = useRef(false);

  const set = useCallback((next: boolean) => {
    if (wantHidden.current === next) return;
    wantHidden.current = next;
    Animated.timing(hidden, {
      toValue: next ? 1 : 0,
      duration: next ? HIDE_MS : SHOW_MS,
      useNativeDriver: true,
    }).start();
  }, [hidden]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const decision = decideBar({
      y: contentOffset.y,
      lastY: lastY.current,
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
    });
    lastY.current = decision.lastY;
    if (decision.hidden !== null) set(decision.hidden);
  }, [set]);

  const reveal = useCallback(() => { lastY.current = 0; set(false); }, [set]);

  const value = useMemo(() => ({ hidden, onScroll, reveal }), [hidden, onScroll, reveal]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Props to spread onto a screen's ScrollView or FlatList.
 *
 * Opt-in per screen on purpose. A list you read benefits; a short form or a
 * settings page does not, and a bar that vanishes while someone is filling in
 * a field is a bar that has lost their place for them.
 */
export function useHideTabBarOnScroll() {
  const ctx = useContext(Ctx);
  return {
    onScroll: ctx?.onScroll,
    // 16ms ≈ one frame. Lower and the handler runs more often than the screen redraws.
    scrollEventThrottle: 16,
  } as const;
}

/** For the bar itself, and for anything that needs to force it back into view. */
export function useTabBarVisibility() {
  return useContext(Ctx);
}
