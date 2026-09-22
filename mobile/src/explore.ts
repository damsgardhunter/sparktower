/**
 * The Explore loop, from the app — the counterpart of client/src/lib/explore.ts.
 *
 *   Open Discover → open a profile or project → follow / connect / message →
 *   come back.
 *
 * Only the app knows when Discover opened, what was tapped and when the app
 * was left, so it sends those to /api/track. The actions themselves are
 * recorded by the follow, connect and message endpoints when they succeed;
 * the app just adds `exploreContext()` to those requests so the server knows
 * where they came from. Names are restated from shared/explore-events.ts,
 * where the server checks them — this app doesn't import the shared folder.
 *
 * Best-effort: nothing here may slow down or break what someone was doing.
 */
import { AppState } from "react-native";
import { api, currentVisit } from "./api/client";

export const EXPLORE = {
  openDiscover: "explore.open_discover",
  /**
   * A card at least half on screen. Once per card per visit to a list.
   *
   * This was missing, which made the funnel's second step ("Saw a match") read
   * zero for every phone session — not "the app is bad at this", but "the app
   * never said". Everything after it looked like people leaping from opening
   * Discover straight to opening a profile.
   */
  viewMatchCard: "explore.view_match_card",
  openProfile: "explore.open_profile",
  openProject: "explore.open_project",
  returnToDiscover: "explore.return_to_discover",
  sessionEnd: "explore.session_end",
} as const;

/**
 * All eight of shared/explore-events.ts's sources, restated.
 *
 * Four of them were missing here, and the funnel pays for a gap in a mirror
 * quietly: the server drops a `source` it doesn't recognise (sanitizeExploreProps)
 * and stores the event anyway, so a wrong or absent source is an event that
 * counts under the wrong heading rather than an error anyone sees. Screens
 * worked around the short union by casting or by sending "discover" from
 * Matches and Search, which is how two surfaces came to report themselves as a
 * third.
 */
export const EXPLORE_SOURCES = [
  "discover", "matches", "projects", "profile_page", "project_page", "messages", "feed", "post_page",
  "search",
] as const;

export type ExploreSource = (typeof EXPLORE_SOURCES)[number];

/** What the server adds to the event it records for an action. */
export interface ExploreContext {
  source: ExploreSource;
  rankPosition?: number;
  timeToActionMs?: number;
}

/** When Discover last opened, for time to action. */
let openedAt = 0;
/** The visit in which Discover last opened — opening again in it is a return. */
let openedInVisit = "";
/** Something happened in the loop, so leaving the app is worth recording. */
let active = false;
/** Cards already counted as seen, so one card scrolled past twice is one impression. */
const impressions = new Set<string>();

type Props = { matchType?: "builder" | "project"; targetId?: string; rankPosition?: number; source?: ExploreSource };

export function trackExplore(name: (typeof EXPLORE)[keyof typeof EXPLORE], props: Props = {}, path = "/discover") {
  active = true;
  // Sent at once rather than batched: the open has to be stored before an
  // action a few seconds later, which its endpoint records immediately.
  void api("/api/track", { method: "POST", body: { events: [{ name, path, props }] } }).catch(() => {});
}

/**
 * Remembering that you looked at a builder or project, on the server — so what
 * they post next counts as news for you on Discover, on any device.
 */
export function markSeen(kind: "builder" | "project", id: string) {
  void api("/api/discover/seen", { method: "POST", body: { kind, id } }).catch(() => {});
}

/** Opening Discover moves its badge's "since" to now. Resolves when recorded. */
export function recordDiscoverVisit(): Promise<unknown> {
  return api("/api/discover/visit", { method: "POST" }).catch(() => {});
}

/** The Discover tab's badge: new posts from what you've looked at since your last visit. */
export const DISCOVER_NEW_KEY = ["discover-new-count"];

/** Discover came into view. A second time in the same visit is also a return. */
export function openDiscover() {
  const visit = currentVisit().id;
  const returning = openedInVisit === visit;
  openedInVisit = visit;
  openedAt = Date.now();
  // "Saw it" means on this visit to the list, as it does on the web.
  impressions.clear();
  trackExplore(EXPLORE.openDiscover, { source: "discover" });
  if (returning) trackExplore(EXPLORE.returnToDiscover, { source: "discover" });
}

/**
 * "Saw a match": a card at least half on screen, counted once.
 *
 * Rendering isn't seeing — a FlatList holds rows above and below the viewport,
 * and counting those would make every list look fully read. The caller is the
 * viewability callback, which already applies the 50% threshold the web's
 * IntersectionObserver uses, so the only thing left to do here is refuse the
 * repeats a viewability callback naturally produces as a row wobbles in and
 * out of view.
 */
export function viewMatchCard(
  props: { matchType: "builder" | "project"; targetId: string; source: ExploreSource; rankPosition?: number },
  path = "/discover",
) {
  const key = `${props.source}:${props.matchType}:${props.targetId}`;
  if (impressions.has(key)) return;
  impressions.add(key);
  trackExplore(EXPLORE.viewMatchCard, props, path);
}

/** Sent as `explore` with a follow, connection request or message. */
export function exploreContext(source: ExploreSource, rankPosition?: number): ExploreContext {
  active = true;
  return {
    source,
    ...(rankPosition ? { rankPosition } : {}),
    ...(openedAt ? { timeToActionMs: Date.now() - openedAt } : {}),
  };
}

AppState.addEventListener("change", (state) => {
  if (state !== "background" || !active) return;
  active = false;
  trackExplore(EXPLORE.sessionEnd, {});
});
