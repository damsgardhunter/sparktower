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
  openProfile: "explore.open_profile",
  openProject: "explore.open_project",
  returnToDiscover: "explore.return_to_discover",
  sessionEnd: "explore.session_end",
} as const;

export type ExploreSource = "discover" | "profile_page" | "project_page" | "messages";

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
  trackExplore(EXPLORE.openDiscover, { source: "discover" });
  if (returning) trackExplore(EXPLORE.returnToDiscover, { source: "discover" });
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
