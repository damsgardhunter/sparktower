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
  /**
   * Connection requests. They carry a note to someone who hasn't agreed to
   * hear from you yet, which makes them a way to reach strangers — so they're
   * limited on their own rather than only by the floor under every write.
   */
  connect: {
    max: 20, windowMinutes: 60,
    message: "That's a lot of connection requests. Try again in a little while.",
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
  /*
   * Keyed by IP rather than account, since there is no account yet. The old
   * limiter was an in-memory map — per instance, and forgotten on restart,
   * which on autoscale meant N times the limit and a free reset every deploy.
   */
  login: {
    max: 8, windowMinutes: 15,
    message: "Too many sign-in attempts. Try again in 15 minutes.",
  },
  ai: {
    max: 30, windowMinutes: 10,
    message: "Nova needs a moment — that's a lot of requests at once. Try again in a few minutes.",
  },
  /**
   * The floor under every write. Generous — a person editing a board for
   * an hour stays far below it — but a script hammering any endpoint,
   * including ones nobody thought to limit, hits it. Per user when signed
   * in, per address otherwise.
   */
  write: {
    max: 240, windowMinutes: 10,
    message: "That's a lot of changes at once. Give it a few minutes.",
  },
  /**
   * Content writes that have no table of their own to count — sprint
   * messages, live chat, waitlist entries, interview notes, feedback on
   * findings. Tighter than the write floor, looser than a public post.
   */
  post: {
    max: 60, windowMinutes: 10,
    message: "That's a lot of posting at once. Give it a few minutes.",
  },
  /** Analytics beacons from the browser: per address, since they're unauthenticated. */
  track: {
    max: 600, windowMinutes: 10,
    message: "Too many events from this address. Try again shortly.",
  },
  /**
   * Reviewer actions: taking content down, deciding reports, suspending. A
   * person working the queue quickly stays well under it; a stolen reviewer
   * session can't sweep the site in one go. (Platform admins are exempt, as
   * from every limit.)
   */
  review: {
    max: 120, windowMinutes: 10,
    message: "That's a lot of moderation in a few minutes. Give it a moment.",
  },
  /** Backing decisions and releases — the routes that move money. Rare by nature, so tight. */
  payout: {
    max: 20, windowMinutes: 60,
    message: "That's a lot of backing decisions in an hour. Try again later.",
  },
} as const satisfies Record<string, RateLimit>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

/** The machine-readable code on every rate-limit refusal. */
export const RATE_LIMITED = "rate_limited" as const;

/**
 * What a rate-limited request gets back, from every limited endpoint alike:
 * status 429, this body, and a `Retry-After` header equal to
 * `retryAfterSeconds`. The server writes it in one place (`refuse` in
 * server/moderation.ts); the client reads it in one place (`errorText`).
 *
 * `retryAfterSeconds` is when room next opens — the oldest counted use
 * leaving the window — not the window's whole length.
 */
export interface RateLimitedBody {
  message: string;
  code: typeof RATE_LIMITED;
  action: RateLimitAction;
  retryAfterSeconds: number;
  /** The same wait, rounded up, for anything that only speaks minutes. */
  retryAfterMinutes: number;
}

/** How long a note on a connection request may be. A hello, not a letter. */
export const CONNECTION_NOTE_MAX = 280;

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

// --- Acting on a report ---------------------------------------------------

/**
 * The content types the queue can act on directly. Comments first; other
 * types still use the older hide/restore and suspend buttons.
 */
export const ACTIONABLE_TARGETS = ["comment"] as const satisfies readonly ReportTarget[];
export const isActionableTarget = (t: string): boolean => (ACTIONABLE_TARGETS as readonly string[]).includes(t);

/** What a reviewer can do about a reported comment. */
export const MODERATION_ACTIONS = [
  { id: "remove", label: "Remove", detail: "Hidden from everyone, its author included." },
  { id: "shadow_hide", label: "Shadow-hide", detail: "Hidden from everyone but its author, who still sees it as posted." },
  { id: "ban", label: "Ban author", detail: "Suspends the author's account and removes the comment." },
  { id: "dismiss", label: "Dismiss", detail: "No rule broken. The comment stays; the report closes." },
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number]["id"];
export const MODERATION_ACTION_IDS: readonly string[] = MODERATION_ACTIONS.map((a) => a.id);

/**
 * Why a reviewer acted, as a code rather than prose, so a mistaken action is
 * easy to find later ("every removal for 'spam' last Tuesday"). Violations
 * go with remove, shadow-hide and ban; dismissals only with dismiss — a
 * removal can't be for "no rule broken", and a dismissal can't be for spam.
 */
export const MODERATION_REASON_CODES = [
  { id: "spam", label: "Spam or advertising", kind: "violation" },
  { id: "harassment", label: "Harassment or abuse", kind: "violation" },
  { id: "hate", label: "Hate or slurs", kind: "violation" },
  { id: "sexual", label: "Sexual or graphic content", kind: "violation" },
  { id: "misleading", label: "Misleading or a scam", kind: "violation" },
  { id: "off_topic", label: "Off-topic or disruptive", kind: "violation" },
  { id: "no_violation", label: "No rule broken", kind: "dismissal" },
  { id: "duplicate", label: "Already handled", kind: "dismissal" },
  { id: "insufficient_context", label: "Not enough to act on", kind: "dismissal" },
] as const;
export type ModerationReasonCode = (typeof MODERATION_REASON_CODES)[number]["id"];

export const reasonCodesFor = (action: ModerationAction) =>
  MODERATION_REASON_CODES.filter((r) => r.kind === (action === "dismiss" ? "dismissal" : "violation"));
export const isReasonCode = (id: string): boolean => MODERATION_REASON_CODES.some((r) => r.id === id);
export const moderationReasonLabel = (id: string | null | undefined): string =>
  MODERATION_REASON_CODES.find((r) => r.id === id)?.label ?? (id || "No reason code");
