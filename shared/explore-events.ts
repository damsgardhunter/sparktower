/**
 * The Explore loop: what a builder does between opening Discover and coming back.
 *
 *   Open Discover → see a match → open their profile or project →
 *   follow / connect / message → come back later and do it again.
 *
 * Nine events and five properties, deliberately. The step that asked for this
 * named the risk itself — instrumenting everything slows shipping and buries
 * the few numbers that matter — so this is the smallest set that answers the
 * three questions the loop is judged on: how far people get (the funnel), how
 * long it takes to do something (time to first action), and whether they come
 * back (repeat rate).
 *
 * These ride the behaviour stream (`activity_events`, via `/api/track`), not
 * `shared/loop-events.ts`. That file is the check-in loop's five numbers and is
 * kept small on purpose; this is a second loop with its own names, and mixing
 * them would put the check-in metrics one typo away from moving.
 *
 * Shared, so the server's allow-list and the browser's calls can't disagree
 * about a name — a mismatch there is an event that's sent, answered 202, and
 * silently never stored.
 */

export const EXPLORE_EVENTS = {
  /** Discover, Matches or the project list opened. */
  openDiscover: "explore.open_discover",
  /** A builder or project card at least half on screen. Once per card per visit to the page. */
  viewMatchCard: "explore.view_match_card",
  /** A builder's card clicked, from an Explore surface. */
  openProfile: "explore.open_profile",
  /** A project's card clicked, from an Explore surface. */
  openProject: "explore.open_project",
  /** Started following a builder or a project. Unfollowing isn't the loop. */
  follow: "explore.follow",
  /** A connection request sent. */
  connectRequest: "explore.connect_request",
  /** A message sent. */
  messageSent: "explore.message_sent",
  /** Discover opened again in a tab that had already opened it. */
  returnToDiscover: "explore.return_to_discover",
  /** The tab was left after doing something in the loop. */
  sessionEnd: "explore.session_end",
} as const;

export type ExploreEventName = (typeof EXPLORE_EVENTS)[keyof typeof EXPLORE_EVENTS];

export const EXPLORE_EVENT_NAMES: readonly ExploreEventName[] = Object.values(EXPLORE_EVENTS);

export const isExploreEvent = (name: string): name is ExploreEventName =>
  (EXPLORE_EVENT_NAMES as readonly string[]).includes(name);

/** What the loop is for. Time to first action is measured to the first of these. */
export const EXPLORE_ACTIONS: readonly ExploreEventName[] = [
  EXPLORE_EVENTS.follow, EXPLORE_EVENTS.connectRequest, EXPLORE_EVENTS.messageSent,
];

/**
 * The funnel, in loop order, counted in sessions. Opening a profile and
 * opening a project are one step — looking closer — and the three actions are
 * another, because "which action" is a different question from "how many got
 * as far as acting".
 */
export const EXPLORE_FUNNEL = [
  { key: "opened", label: "Opened Discover", events: [EXPLORE_EVENTS.openDiscover] },
  { key: "viewed", label: "Saw a match", events: [EXPLORE_EVENTS.viewMatchCard] },
  { key: "lookedCloser", label: "Opened a profile or project", events: [EXPLORE_EVENTS.openProfile, EXPLORE_EVENTS.openProject] },
  { key: "acted", label: "Followed, connected or messaged", events: [...EXPLORE_ACTIONS] },
  { key: "returned", label: "Came back to Discover", events: [EXPLORE_EVENTS.returnToDiscover] },
] as const;

export const EXPLORE_LABEL: Record<ExploreEventName, string> = {
  "explore.open_discover": "Opened Discover",
  "explore.view_match_card": "Saw a match",
  "explore.open_profile": "Opened a builder's profile",
  "explore.open_project": "Opened a project",
  "explore.follow": "Followed a builder or project",
  "explore.connect_request": "Sent a connection request",
  "explore.message_sent": "Sent a message",
  "explore.return_to_discover": "Came back to Discover",
  "explore.session_end": "Left after exploring",
};

/** For the live feed: a readable line for an Explore row, or null for anything else. */
export const exploreLabel = (name: string): string | null => (isExploreEvent(name) ? EXPLORE_LABEL[name] : null);

export const EXPLORE_MATCH_TYPES = ["builder", "project"] as const;
export const EXPLORE_SOURCES = ["discover", "matches", "projects", "profile_page", "project_page", "messages"] as const;

export type ExploreMatchType = (typeof EXPLORE_MATCH_TYPES)[number];
export type ExploreSource = (typeof EXPLORE_SOURCES)[number];

/** The five properties. Everything else a client sends is dropped. */
export interface ExploreProps {
  matchType?: ExploreMatchType;
  /** The builder's user id or the project's id — which one, `matchType` says. */
  targetId?: string;
  /** Position in the list, from 1. */
  rankPosition?: number;
  /** Where it happened. */
  source?: ExploreSource;
  /** Milliseconds since Discover opened in this tab. Only on actions. */
  timeToActionMs?: number;
}

/** Six hours. Anything longer isn't a reaction to a list someone was looking at. */
const MAX_TIME_TO_ACTION_MS = 6 * 60 * 60 * 1000;

/**
 * Holds what a browser sent to the five properties and their ranges.
 *
 * The endpoint is open to anyone, signed in or not, so this is the boundary:
 * unknown keys are dropped rather than stored, enums are checked, numbers are
 * bounded, and an id is an id. What reaches the table is small and boring by
 * construction, which is what a table read by an aggregate query should be.
 */
export function sanitizeExploreProps(raw: unknown): ExploreProps {
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: ExploreProps = {};
  if ((EXPLORE_MATCH_TYPES as readonly unknown[]).includes(input.matchType)) out.matchType = input.matchType as ExploreMatchType;
  if (typeof input.targetId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(input.targetId)) out.targetId = input.targetId;
  if (typeof input.rankPosition === "number" && Number.isInteger(input.rankPosition) && input.rankPosition >= 1 && input.rankPosition <= 500) {
    out.rankPosition = input.rankPosition;
  }
  if ((EXPLORE_SOURCES as readonly unknown[]).includes(input.source)) out.source = input.source as ExploreSource;
  if (typeof input.timeToActionMs === "number" && Number.isFinite(input.timeToActionMs)
    && input.timeToActionMs >= 0 && input.timeToActionMs <= MAX_TIME_TO_ACTION_MS) {
    out.timeToActionMs = Math.round(input.timeToActionMs);
  }
  return out;
}

/**
 * Full passes round the loop, per session: open Discover → act (follow,
 * connect or message) → come back. The return that closes one pass opens the
 * next, so a session that acts and returns twice has two.
 *
 * "Sessions with two or more cycles" is the repeat trigger's measure — not
 * whether someone came back at all (the repeat rate says that), but whether
 * coming back led to doing something again. Events must be in the order they
 * happened within each session; sessions that never opened Discover are
 * absent from the result.
 */
export function countCycles(events: readonly { session: string; name: string }[]): Map<string, number> {
  const stage = new Map<string, "opened" | "acted">();
  const cycles = new Map<string, number>();
  for (const { session, name } of events) {
    const opens = name === EXPLORE_EVENTS.openDiscover || name === EXPLORE_EVENTS.returnToDiscover;
    if (opens) {
      if (stage.get(session) === "acted") cycles.set(session, (cycles.get(session) ?? 0) + 1);
      else if (!cycles.has(session)) cycles.set(session, 0);
      stage.set(session, "opened");
    } else if (EXPLORE_ACTIONS.includes(name as ExploreEventName) && stage.has(session)) {
      stage.set(session, "acted");
    }
  }
  return cycles;
}
