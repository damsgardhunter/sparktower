/**
 * The events the weekly loop is measured by.
 *
 * Phase 1 names six numbers that decide whether the loop works: check-in
 * started and submitted, a share artifact created, a comment created,
 * comment-within-24h, and time-to-post. None of them were measurable — the
 * `project_analytics_events` table is a creator-managed list of metric
 * *definitions*, and nothing in the app ever emitted anything.
 *
 * This is the actual stream. Deliberately small: six names, one table, no
 * general-purpose analytics layer. Every event here exists because a specific
 * number in the spec needs it, and an event nobody computes from is one more
 * thing to keep true for nothing.
 */

export const LOOP_EVENTS = {
  /** Composer opened. Paired with `checkInSubmitted` by `sessionId`. */
  checkInStarted: "check_in.started",
  /** A check-in was published or updated. */
  checkInSubmitted: "check_in.submitted",
  /** The share artifact was created — someone copied the link. */
  shareInitiated: "check_in.share_initiated",
  /** Feedback landed on a check-in. */
  commentCreated: "check_in.comment_created",
  /** A permalink was opened by anyone, signed in or not. */
  checkInViewed: "check_in.viewed",
} as const;

export type LoopEventName = (typeof LOOP_EVENTS)[keyof typeof LOOP_EVENTS];

export const LOOP_EVENT_NAMES: string[] = Object.values(LOOP_EVENTS);

/**
 * Targets from the spec, kept next to the metrics that measure them so a
 * dashboard can say "at target" rather than leaving a reader to remember.
 */
export const LOOP_TARGETS = {
  /** "time-to-post P50 <= 2m" */
  timeToPostP50Ms: 2 * 60 * 1000,
  /** ">=1 comment within 24h for new users" */
  commentWithinHours: 24,
} as const;

/** Formats a duration the way a person reads one. */
export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

export const formatPercent = (n: number | null): string =>
  n == null || !Number.isFinite(n) ? "—" : `${Math.round(n)}%`;
