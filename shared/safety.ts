/**
 * The admin safety loop: review the signals, act, see what the action did,
 * and come back tomorrow.
 *
 *   Review reports, rate-limit refusals and content volume → take an action
 *   (remove, ban, switch a surface off) → watch its impact → the next daily
 *   review starts from what changed since this one.
 *
 * The rules — what counts as a spike, a stale report, a review that's due, how
 * an action's before and after are compared — live here, where they're
 * tested on their own, so the page and the server can't disagree about them.
 */

/** A limit refused someone. Recorded in `activity_events`, so it can be counted. */
export const SAFETY_EVENTS = {
  limitRefused: "safety.limit_refused",
} as const;

/** The moderation-log action a completed daily review is recorded as. */
export const SAFETY_REVIEW_ACTION = "safety_review_completed";

/**
 * The writes that are someone putting content in front of other people.
 * Matched against `activity_events.pattern` (ids already replaced by `:id`).
 */
export const CONTENT_WRITE_PATTERNS = [
  "/api/feed",
  "/api/feed/:id/comments",
  "/api/projects/:id/comments",
  "/api/messages/:id",
] as const;

/** A report open longer than this is overdue. */
export const STALE_REPORT_HOURS = 24;
/** A review is due this long after the last one. */
export const REVIEW_DUE_HOURS = 24;
/** The longest a review looks back, however long since the last one. */
export const MAX_REVIEW_WINDOW_HOURS = 7 * 24;
/** How far either side of an action its impact is measured. */
export const IMPACT_WINDOW_HOURS = 24;
/** Less than this after an action, and there's nothing to read yet. */
export const IMPACT_MIN_HOURS = 1;
/** A limit is spiking at this many refusals or more… */
export const SPIKE_MIN_REFUSALS = 5;
/** …and at least this many times the previous window's count. */
export const SPIKE_RATIO = 2;
/** New reports spike on the same ratio, from this many. */
export const REPORT_SPIKE_MIN = 3;

/** What a reviewer confirms before a review counts as done. */
export const SAFETY_CHECKLIST = [
  { id: "reports", label: "Open reports triaged", detail: `Nothing left open longer than ${STALE_REPORT_HOURS} hours.` },
  { id: "limits", label: "Rate-limit spikes looked at", detail: "A spike is a script, a raid, or a limit set too tight — decide which." },
  { id: "impact", label: "Impact of recent actions checked", detail: "Each action did what it was for, and nothing it wasn't." },
  { id: "surfaces", label: "Switched-off surfaces reconsidered", detail: "Anything off still needs to be off." },
] as const;

export type SafetyChecklistId = (typeof SAFETY_CHECKLIST)[number]["id"];
export const SAFETY_CHECKLIST_IDS: readonly string[] = SAFETY_CHECKLIST.map((c) => c.id);

/** True when a limit's refusals count as a spike against the window before. */
export function isSpike(now: number, before: number, min = SPIKE_MIN_REFUSALS): boolean {
  return now >= min && now >= Math.max(1, before) * SPIKE_RATIO;
}

export interface WindowComparison {
  before: number;
  after: number;
  /** How much of the after-window has happened so far. */
  afterHours: number;
  /** `after` scaled to a full window, so a six-hour after reads against a day before. */
  afterPace: number;
  /** Relative change of the pace against before; null when before was zero. */
  changePercent: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * One metric either side of an action. The after side is usually still
 * filling up, so it's compared as a pace over a full window rather than a raw
 * count — three reports in six hours is a busier day than five in twenty-four.
 */
export function compareWindows(before: number, after: number, afterHours: number, windowHours = IMPACT_WINDOW_HOURS): WindowComparison {
  const hours = Math.max(0, Math.min(windowHours, afterHours));
  const afterPace = hours > 0 ? Math.round((after * windowHours / hours) * 10) / 10 : 0;
  const changePercent = before > 0 ? Math.round(((afterPace - before) / before) * 100) : null;
  const delta = afterPace - before;
  // Within half an event either way is noise, not a direction.
  const direction = Math.abs(delta) < 0.5 ? "flat" : delta > 0 ? "up" : "down";
  return { before, after, afterHours: Math.round(hours * 10) / 10, afterPace, changePercent, direction };
}

export interface SafetyAlertInput {
  openReports: number;
  oldestOpenHours: number | null;
  newReports: number;
  newReportsBefore: number;
  limits: { action: string; refused: number; refusedBefore: number }[];
  hoursSinceReview: number | null;
  surfacesOff: string[];
}

export interface SafetyAlert {
  id: string;
  level: "urgent" | "warn" | "info";
  title: string;
  detail: string;
  /** Which checklist item this belongs to. */
  area: SafetyChecklistId;
}

/**
 * What needs looking at, most urgent first. In-app, on purpose: this is the
 * list the daily review opens with and the sidebar counts, not a pager.
 */
export function safetyAlerts(input: SafetyAlertInput): SafetyAlert[] {
  const alerts: SafetyAlert[] = [];

  if (input.oldestOpenHours != null && input.oldestOpenHours >= STALE_REPORT_HOURS) {
    alerts.push({
      id: "stale-reports", level: "urgent", area: "reports",
      title: `${input.openReports} open ${input.openReports === 1 ? "report" : "reports"}, oldest ${Math.floor(input.oldestOpenHours)}h`,
      detail: `Past the ${STALE_REPORT_HOURS}-hour mark. Someone flagged this and is waiting.`,
    });
  } else if (input.openReports > 0) {
    alerts.push({
      id: "open-reports", level: "warn", area: "reports",
      title: `${input.openReports} open ${input.openReports === 1 ? "report" : "reports"}`,
      detail: "In the queue and inside the window.",
    });
  }

  if (isSpike(input.newReports, input.newReportsBefore, REPORT_SPIKE_MIN)) {
    alerts.push({
      id: "report-spike", level: "warn", area: "reports",
      title: `Reports up: ${input.newReports} against ${input.newReportsBefore} the window before`,
      detail: "More people are flagging things than usual.",
    });
  }

  for (const limit of input.limits) {
    if (!isSpike(limit.refused, limit.refusedBefore)) continue;
    alerts.push({
      id: `limit-spike-${limit.action}`, level: "warn", area: "limits",
      title: `"${limit.action}" limit spiking: ${limit.refused} refused (was ${limit.refusedBefore})`,
      detail: "See who's hitting it before loosening or tightening anything.",
    });
  }

  if (input.hoursSinceReview == null || input.hoursSinceReview >= REVIEW_DUE_HOURS) {
    alerts.push({
      id: "review-due", level: "info", area: "reports",
      title: input.hoursSinceReview == null ? "No safety review yet" : `Last review ${Math.floor(input.hoursSinceReview)}h ago`,
      detail: `A review is due every ${REVIEW_DUE_HOURS} hours.`,
    });
  }

  if (input.surfacesOff.length > 0) {
    alerts.push({
      id: "surfaces-off", level: "info", area: "surfaces",
      title: `${input.surfacesOff.length} ${input.surfacesOff.length === 1 ? "surface" : "surfaces"} switched off`,
      detail: input.surfacesOff.join(", "),
    });
  }

  const rank = { urgent: 0, warn: 1, info: 2 } as const;
  return alerts.sort((a, b) => rank[a.level] - rank[b.level]);
}
