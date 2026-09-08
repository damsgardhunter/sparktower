/**
 * The behaviour stream: what people actually do on the site, as they do it.
 *
 * Separate from `shared/loop-events.ts` on purpose. That file is five names
 * chosen because five specific numbers in the spec need them, and it stays
 * small so those numbers stay trustworthy. This is the opposite kind of thing —
 * broad, high volume, and read by a person watching rather than by a metric.
 * Mixing them would mean every new event risked moving a number the product is
 * judged on.
 *
 * Two sources, and between them they cover the whole surface:
 *
 *  - Every write the API receives, captured by one middleware. Nothing has to
 *    be remembered at the call site, so nothing can be forgotten when a route
 *    is added.
 *  - Every page someone opens, sent by the client. The server never sees these:
 *    routing happens in the browser, so a page view is a fact only the client
 *    holds.
 *
 * Reads are deliberately not captured. They are mostly polling — messages
 * refetch every 3 seconds, a sprint dashboard every 5 — and recording them
 * would bury a day of real activity under a hundred thousand rows of a tab left
 * open. What someone is looking at comes from the page views instead, which is
 * the honest source for it anyway.
 *
 * Request *bodies* are never stored. The stream says someone sent a message,
 * never what it said.
 */

export const ACTIVITY_EVENTS = {
  /** A page opened in the SPA. Sent by the client on every route change. */
  pageView: "page.view",
  /** First event of a visit, after 30 minutes idle or on first arrival. */
  sessionStart: "session.start",
  /** Any write the API accepted or refused. Captured by middleware. */
  apiWrite: "api.write",
} as const;

export type ActivityEventName = (typeof ACTIVITY_EVENTS)[keyof typeof ACTIVITY_EVENTS];

/** How long a gap ends a session and starts a new one. */
export const SESSION_IDLE_MINUTES = 30;

/** Someone counts as here now if they've done anything inside this window. */
export const ONLINE_WINDOW_MINUTES = 5;

/** Raw events older than this are swept. Aggregates outlive them; rows don't. */
export const RETENTION_DAYS = 90;

/** Client batches are flushed at least this often, and on page hide. */
export const CLIENT_FLUSH_MS = 4000;

/** A single client batch is capped so a stuck tab can't post a megabyte. */
export const MAX_BATCH_EVENTS = 40;

// --- Turning routes into English -----------------------------------------

/**
 * Paths carry ids; a stream grouped by raw path has one row per project and no
 * useful totals. Normalising to a pattern — `/api/projects/:id/check-ins` —
 * makes "what do people do here" answerable with a GROUP BY.
 *
 * Stored at write time, because the pattern is a fact about the request. The
 * friendly label below is applied when the stream is read, so wording can be
 * improved later without rewriting history.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function routePattern(path: string): string {
  return path
    .split("?")[0]
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (UUID.test(seg)) return ":id";
      if (/^\d+$/.test(seg)) return ":id";
      // Long opaque tokens — share slugs, Stripe ids — are ids too.
      if (seg.length > 24 && !seg.includes(".")) return ":id";
      return seg;
    })
    .join("/");
}

/**
 * What a route means in a sentence someone can read at a glance.
 *
 * Ordered: the first pattern that matches wins, so specific routes are listed
 * before the prefixes that would also match them. Anything unmatched falls back
 * to "METHOD /the/path", which is ugly on purpose — an unreadable line in the
 * feed is a prompt to add the route here.
 */
const ACTION_LABELS: { method?: string; pattern: RegExp; label: string }[] = [
  // Getting started
  { method: "POST", pattern: /^\/api\/auth\/register$/, label: "Created an account" },
  { method: "POST", pattern: /^\/api\/auth\/login$/, label: "Signed in" },
  { method: "POST", pattern: /^\/api\/(auth\/)?logout$/, label: "Signed out" },
  { method: "PATCH", pattern: /^\/api\/profile$/, label: "Edited their profile" },
  { method: "POST", pattern: /^\/api\/profile$/, label: "Set up their profile" },

  // The loop
  { method: "POST", pattern: /^\/api\/projects\/:id\/check-ins\/draft$/, label: "Asked Nova to draft a check-in" },
  { method: "POST", pattern: /^\/api\/projects\/:id\/check-ins$/, label: "Published a check-in" },
  { method: "POST", pattern: /^\/api\/projects\/:id\/comments$/, label: "Commented on a project" },
  { method: "POST", pattern: /^\/api\/feed\/:id\/comments$/, label: "Commented on a post" },
  { method: "POST", pattern: /^\/api\/check-ins\/:id\/share$/, label: "Shared a check-in" },

  // Building
  { method: "POST", pattern: /^\/api\/projects$/, label: "Created a project" },
  { method: "PATCH", pattern: /^\/api\/projects\/:id$/, label: "Edited a project" },
  { method: "DELETE", pattern: /^\/api\/projects\/:id$/, label: "Deleted a project" },
  { method: "POST", pattern: /^\/api\/projects\/:id\/tasks/, label: "Added a task" },
  { method: "PATCH", pattern: /^\/api\/projects\/:id\/tasks/, label: "Moved a task" },
  { method: "POST", pattern: /^\/api\/projects\/:id\/milestones/, label: "Added a milestone" },
  { method: "POST", pattern: /^\/api\/projects\/:id\/documents/, label: "Worked on a document" },

  // Nova
  { pattern: /^\/api\/projects\/:id\/nova\/apply$/, label: "Applied a Nova suggestion" },
  { pattern: /^\/api\/projects\/:id\/nova\/suggest$/, label: "Asked Nova for help" },
  { pattern: /^\/api\/projects\/:id\/roadmap/, label: "Worked on the roadmap" },
  { pattern: /^\/api\/nova/, label: "Talked to Nova" },
  { pattern: /^\/api\/.*\/audit/, label: "Ran a code audit" },

  // People
  { method: "POST", pattern: /^\/api\/feed$/, label: "Posted to the feed" },
  { method: "POST", pattern: /^\/api\/messages\/:id$/, label: "Sent a message" },
  { method: "POST", pattern: /^\/api\/connections/, label: "Asked to connect" },
  { method: "POST", pattern: /^\/api\/projects\/:id\/follow$/, label: "Followed a project" },

  // Money
  { pattern: /^\/api\/backing/, label: "Backed a project" },
  { pattern: /^\/api\/(stripe|subscription|checkout)/, label: "Touched billing" },

  // Housekeeping worth seeing
  { method: "POST", pattern: /^\/api\/reports$/, label: "Reported something" },
  { pattern: /^\/api\/admin\//, label: "Used a moderator tool" },
];

export function actionLabel(method: string, pattern: string): string {
  for (const rule of ACTION_LABELS) {
    if (rule.method && rule.method !== method) continue;
    if (rule.pattern.test(pattern)) return rule.label;
  }
  return `${method} ${pattern}`;
}

/** Page paths read as places, not routes. */
export function pageLabel(path: string): string {
  const p = routePattern(path);
  const named: Record<string, string> = {
    "/": "Home",
    "/projects": "Projects",
    "/projects/new": "New project — intro",
    "/projects/new/create": "New project — talking to Nova",
    "/projects/:id": "A project dashboard",
    "/projects/:id/manage": "Managing a project",
    "/profile": "Their profile",
    "/profile/:id": "Someone's profile",
    "/discover": "Discover",
    "/matches": "Matches",
    "/messages": "Messages",
    "/leaderboard": "Leaderboard",
    "/feedback": "Feedback queue",
    "/pricing": "Pricing",
    "/onboarding": "Onboarding",
    "/c/:id": "A shared check-in",
  };
  return named[p] ?? p;
}

/**
 * Whether a response counts as the person failing to do the thing.
 *
 * 4xx and 5xx both count. A 409 from the duplicate guard and a 500 from a bug
 * are different problems, but both are someone who tried and didn't get what
 * they came for, and that's what's worth seeing in a feed.
 */
export const isFailure = (status: number | null | undefined): boolean =>
  typeof status === "number" && status >= 400;

/** How long ago, in the words a person would use. */
export function timeAgo(iso: string | Date): string {
  const then = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
