/**
 * Rate limits, report reasons, and what a moderator can do about them.
 *
 * Shared so the client can show a limit before someone hits it, and so the
 * reasons on a report form are the same strings the queue filters by.
 *
 * The limits are deliberately generous. They exist to stop a script, not to
 * police a person having a productive afternoon — a limit a real user trips is
 * a bug, and the first thing it costs you is the user.
 */

export interface RateLimit {
  /** Actions allowed inside the window. */
  max: number;
  windowMinutes: number;
  /** Shown when someone hits it. Says what to do, not what went wrong. */
  message: string;
}

export const RATE_LIMITS = {
  checkIn: {
    max: 12, windowMinutes: 60,
    message: "That's a lot of check-ins at once. Try again in a few minutes.",
  },
  comment: {
    max: 20, windowMinutes: 10,
    message: "Slow down a moment — you can comment again shortly.",
  },
  feedPost: {
    max: 10, windowMinutes: 60,
    message: "You've posted a lot in the last hour. Try again later.",
  },
  message: {
    max: 60, windowMinutes: 10,
    message: "You're sending messages very quickly. Try again in a few minutes.",
  },
  project: {
    max: 5, windowMinutes: 60,
    message: "You've created several projects already. Try again in an hour.",
  },
  report: {
    max: 10, windowMinutes: 60,
    message: "You've filed several reports. We'll look at those first.",
  },
  react: {
    max: 60, windowMinutes: 10,
    message: "You're reacting very quickly. Give it a minute.",
  },
  upload: {
    max: 30, windowMinutes: 60,
    message: "That's a lot of uploads in an hour. Try again a little later.",
  },
  /*
   * One limit for every AI endpoint, enforced at the credit check they all
   * pass through. Credits cap the month; this caps the minute, which is the
   * shape a script has and a person doesn't.
   */
  ai: {
    max: 30, windowMinutes: 10,
    message: "Nova needs a moment — that's a lot of requests at once. Try again in a few minutes.",
  },
} as const satisfies Record<string, RateLimit>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

// --- Duplicate content --------------------------------------------------

/**
 * A count limit catches volume. It does not catch the same sentence posted
 * twenty times — and tightening the counts far enough to catch that would
 * punish everyone having a productive afternoon, which is the failure mode the
 * limits above are written to avoid.
 *
 * So these rules ask a different question alongside the counts: not "how much?"
 * but "how much of it is the same thing?" Spam is repetitive by nature, because
 * whatever the sender is pushing is the one thing they came to say. Someone
 * doing real work rarely says the same thing twice.
 */
export interface DuplicateRule {
  /** How many times the same text may already exist before another is refused. */
  max: number;
  windowMinutes: number;
  /**
   * Minimum length, once normalised, before repetition is judged at all.
   * People say "thanks", "+1" and "congrats" all day and are right to — below
   * this a message carries too little to tell repetition from ordinary talk.
   */
  minLength: number;
  /** Shown when it trips. Says what to do about it. */
  message: string;
}

const HOUR = 60;
const DAY = 60 * 24;

export const DUPLICATE_RULES = {
  /*
   * Aimed at last week's check-in reposted word for word to keep a streak
   * alive. That's not a check-in, and the honesty of this number is the one
   * thing the whole product is judged on.
   */
  checkIn: {
    max: 1, windowMinutes: 30 * DAY, minLength: 40,
    message: "That's word for word a check-in you've already posted. A quiet week is worth saying plainly — but say it as it was.",
  },
  comment: {
    max: 2, windowMinutes: 6 * HOUR, minLength: 20,
    message: "You've left that same comment a few times already. Add something new to it and it'll go through.",
  },
  feedPost: {
    max: 1, windowMinutes: DAY, minLength: 20,
    message: "You've already posted this today.",
  },
  /*
   * The same note sent to person after person is the outreach blast. Five
   * leaves room for a founder contacting a handful of people with the same
   * honest introduction, which is a real and reasonable thing to do.
   */
  message: {
    max: 5, windowMinutes: HOUR, minLength: 30,
    message: "You've sent that same message to several people already. Write to them individually and it'll go through.",
  },
  project: {
    max: 1, windowMinutes: 7 * DAY, minLength: 30,
    message: "You already have a project with this title and description.",
  },
} as const satisfies Partial<Record<RateLimitAction, DuplicateRule>>;

export type DuplicateAction = keyof typeof DUPLICATE_RULES;

// --- Reports ------------------------------------------------------------

export const REPORT_TARGETS = ["check_in", "comment", "feed_post", "project", "user"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_TARGET_LABEL: Record<ReportTarget, string> = {
  check_in: "Check-in",
  comment: "Comment",
  feed_post: "Post",
  project: "Project",
  user: "Person",
};

/**
 * Why someone is reporting.
 *
 * Kept short. A long list makes people pick the first plausible option, which
 * makes the category useless for triage — five real reasons sort a queue
 * better than fifteen precise ones nobody reads.
 */
export const REPORT_REASONS = [
  { id: "spam", label: "Spam or advertising" },
  { id: "abuse", label: "Harassment or abuse" },
  { id: "misleading", label: "Misleading or fake" },
  { id: "inappropriate", label: "Sexual or graphic content" },
  { id: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];
export const REPORT_REASON_IDS = REPORT_REASONS.map((r) => r.id);

export const reportReasonLabel = (id: string): string =>
  REPORT_REASONS.find((r) => r.id === id)?.label ?? id;

export const REPORT_STATUSES = ["open", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** Free-text on a report. Enough for context, not enough for an essay. */
export const REPORT_NOTE_MAX = 500;
