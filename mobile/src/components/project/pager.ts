/**
 * Which page a tab is, and which pages are worth having in the tree.
 *
 * The project page has nine sections, and several of them are lists that fetch
 * as soon as they mount. A pager that renders all nine on open turns opening a
 * project into nine round trips and a visibly slow first frame, so this decides
 * a small mounted set instead — kept here, away from the view, so the awkward
 * cases (the first and last section, a tab that no longer exists) can be driven
 * in a test rather than by swiping a phone.
 */

/** The page a tab sits on. Unknown tabs land on the first page rather than off the end. */
export function pageIndex<T extends string>(tabs: readonly { value: T }[], value: T | undefined): number {
  const i = tabs.findIndex((t) => t.value === value);
  return i < 0 ? 0 : i;
}

/** The tab a page shows. Out-of-range offsets clamp, so a rubber-band past either end still names a real tab. */
export function tabAt<T extends string>(tabs: readonly { value: T }[], index: number): T {
  return tabs[Math.min(tabs.length - 1, Math.max(0, index))]!.value;
}

/** The page under a horizontal offset. Rounds, because a finger lifts mid-snap. */
export function indexFromOffset(x: number, pageWidth: number, count: number): number {
  if (!(pageWidth > 0)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(x / pageWidth)));
}

/**
 * The pages to keep in the tree: the current one, its two neighbours so a swipe
 * reveals content rather than a blank page mid-gesture, and everything already
 * visited — dropping a visited page would throw away its scroll position and
 * refetch its list the next time you swim back past it, which is exactly the
 * carousel feel we're avoiding.
 */
export function mountedPages(visited: readonly number[], current: number, count: number): number[] {
  const keep = new Set(visited.filter((i) => i >= 0 && i < count));
  for (const i of [current - 1, current, current + 1]) {
    if (i >= 0 && i < count) keep.add(i);
  }
  return [...keep].sort((a, b) => a - b);
}
