/**
 * The Explore loop, from the browser.
 *
 * Only the browser can see most of this loop: a card scrolling into view, a
 * click on it, how long someone looked before doing something. The server sees
 * the follow or the message as a write, but not that it came three seconds
 * after opening Discover. So those facts are sent from here, through the same
 * batched tracker as page views — see shared/explore-events.ts for the names
 * and the five properties, and docs/explore-loop.md for what they add up to.
 *
 * Best-effort, like all analytics here: nothing in this file may slow down or
 * break the thing someone was actually doing.
 */
import {
  EXPLORE_ACTIONS, EXPLORE_EVENTS, type ExploreEventName, type ExploreProps, type ExploreSource,
} from "@shared/explore-events";
import { onBeforeLeave, trackEvent } from "@/lib/analytics";

/** This tab has opened Discover before. sessionStorage: it lives exactly as long as the tab. */
const OPENED_KEY = "st_explore_opened";

/** When Discover last opened in this tab. Time to action is measured from here. */
let openedAt = 0;
/** Something happened in the loop since the tab was last left, so leaving is worth recording. */
let active = false;
/** Cards already counted as seen on this visit to the page. */
const impressions = new Set<string>();
/** The last open, to ignore React's development double-mount rather than count a return. */
let lastOpen = { source: "", at: 0 };

export function trackExplore(name: ExploreEventName, props: ExploreProps = {}) {
  const timed = EXPLORE_ACTIONS.includes(name) && openedAt ? { ...props, timeToActionMs: Date.now() - openedAt } : props;
  active = true;
  trackEvent(name, { ...timed });
}

/**
 * Discover, Matches or the project list opened.
 *
 * Every open counts as an open — the funnel starts there — and one in a tab
 * that has opened it before also counts as a return, which is the loop
 * closing. Impressions reset, because "saw it" means on this visit to the page.
 */
export function openDiscover(source: ExploreSource) {
  const now = Date.now();
  if (lastOpen.source === source && now - lastOpen.at < 1000) return;
  lastOpen = { source, at: now };

  let before = false;
  try {
    before = sessionStorage.getItem(OPENED_KEY) === "1";
    sessionStorage.setItem(OPENED_KEY, "1");
  } catch { /* storage refused: every open is a first open */ }

  impressions.clear();
  openedAt = now;
  trackExplore(EXPLORE_EVENTS.openDiscover, { source });
  if (before) trackExplore(EXPLORE_EVENTS.returnToDiscover, { source });
}

/**
 * Whether this tab had opened Discover before. Read during a page's first
 * render — before `openDiscover` runs — it answers "is this a return?".
 */
export function wasOpenedBefore(): boolean {
  try { return sessionStorage.getItem(OPENED_KEY) === "1"; } catch { return false; }
}

/** True the first time a card is seen on this visit to the page. */
export function firstImpression(key: string): boolean {
  if (impressions.has(key)) return false;
  impressions.add(key);
  return true;
}

onBeforeLeave(() => {
  if (!active) return;
  active = false;
  trackEvent(EXPLORE_EVENTS.sessionEnd, {});
});
