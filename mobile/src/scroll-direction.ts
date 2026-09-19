/**
 * Should the bottom bar be hidden right now?
 *
 * The decision behind the X-style disappearing bar, kept as a pure function so
 * it can be driven through the awkward cases in a test rather than by scrolling
 * a phone and squinting. The component around it (components/tab-bar-visibility)
 * owns the animation; this owns the judgement.
 *
 * Three rules, each from a way the naive version feels wrong:
 *
 *   - Small movements decide nothing. A resting thumb produces a pixel or two
 *     either way, and a bar that answers those flickers.
 *   - Near the top of a list, the bar is always shown. It's where people arrive,
 *     and where a bounce produces downward movement that isn't a scroll.
 *   - Overscroll is ignored entirely — the rubber-band at either end moves the
 *     offset without anyone deciding anything.
 */

/** Below this much movement, it's a thumb resting rather than a scroll. */
export const SCROLL_THRESHOLD = 8;
/** Within this far from the top, the bar always shows. */
export const TOP_ZONE = 48;

export interface ScrollFrame {
  /** Current offset from the top. */
  y: number;
  /** Where the content was when we last made a decision. */
  lastY: number;
  /** Total scrollable content height. */
  contentHeight: number;
  /** Height of the visible window onto it. */
  viewportHeight: number;
}

export interface BarDecision {
  /** Null means "nothing has changed enough to act on" — leave the bar as it is. */
  hidden: boolean | null;
  /** Where to measure the next frame from. Unchanged while a movement is too small to count. */
  lastY: number;
}

export function decideBar({ y, lastY, contentHeight, viewportHeight }: ScrollFrame): BarDecision {
  const delta = y - lastY;

  // The rubber-band at either end: the offset moves, nobody decided anything.
  // `+1` because a list scrolled exactly to its end reports a hair over.
  const overscrolled = y < 0 || y + viewportHeight > contentHeight + 1;

  if (Math.abs(delta) < SCROLL_THRESHOLD) return { hidden: null, lastY };
  if (overscrolled) return { hidden: null, lastY: y };

  // The top of a list always shows its controls, whichever way the last
  // movement went.
  if (y <= TOP_ZONE) return { hidden: false, lastY: y };

  return { hidden: delta > 0, lastY: y };
}
