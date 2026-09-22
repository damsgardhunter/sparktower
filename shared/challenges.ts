/**
 * Sponsored challenges: the rules, said once, as pure functions.
 *
 * A company puts up a real problem with a stated prize; founders answer it; the
 * company shortlists and picks winners. The server enforces these rules and
 * the screens use the same functions to decide what to offer, so "can I still
 * enter?" never has two answers.
 *
 * The prize is stated, never held. No money moves through SparkTower: the
 * company pays its winners directly, under its own terms, and an entrant
 * accepts those terms to enter — the same stance the investor introductions
 * take (INVESTMENT_DISCLAIMER in shared/investment.ts).
 */
import { INDUSTRIES } from "./companies";

export const CHALLENGE_DISCLAIMER =
  "SparkTower doesn't hold or pay prizes. The prize is stated by the company, which pays its winners directly under its own terms. By entering you agree to those terms with the company, not with SparkTower.";

export const CHALLENGE_LIMITS = {
  title: { min: 5, max: 120 },
  brief: { min: 50, max: 4000 },
  criteria: { max: 2000 },
  prize: { max: 200 },
  terms: { min: 50, max: 4000 },
  /** How far ahead a deadline may be. A year is long enough for a real problem, and short enough that the prize still means something. */
  maxDeadlineDays: 365,
} as const;

export const ENTRY_LIMITS = {
  title: { min: 3, max: 120 },
  pitch: { min: 50, max: 3000 },
  link: { max: 500 },
  feedback: { max: 1000 },
} as const;

export const CHALLENGE_STATUSES = ["open", "judging", "closed"] as const;
export type ChallengeStatus = (typeof CHALLENGE_STATUSES)[number];
export const ENTRY_STATUSES = ["entered", "shortlisted", "winner", "withdrawn"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
/** What a judge may set. "entered" is there so a shortlisting can be taken back. */
export const JUDGED_STATUSES = ["entered", "shortlisted", "winner"] as const;
export type JudgedStatus = (typeof JUDGED_STATUSES)[number];

const DAY = 24 * 60 * 60 * 1000;

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

/** Trimmed text, or null when empty. Anything that isn't a string counts as absent. */
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function lengthError(label: string, value: string | null, lim: { min?: number; max: number }, required: boolean): string | null {
  if (!value) return required ? `${label} is required.` : null;
  if (lim.min && value.length < lim.min) return `${label} needs at least ${lim.min} characters.`;
  if (value.length > lim.max) return `${label} can be at most ${lim.max} characters.`;
  return null;
}

/** An http(s) URL, or null. Other schemes (javascript:, data:) are how a link becomes an attack. */
export function safeUrl(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A deadline the company may set: a real date, in the future, at most a year
 * out. `now` is passed in, so the rule is the same on the server and in a test.
 */
export function checkDeadline(raw: unknown, now: number): Result<Date> {
  if (typeof raw !== "string" && !(raw instanceof Date)) return fail("Deadline is required.");
  const d = new Date(raw as string);
  if (Number.isNaN(d.getTime())) return fail("Deadline isn't a date.");
  if (d.getTime() <= now) return fail("Deadline has to be in the future.");
  if (d.getTime() > now + CHALLENGE_LIMITS.maxDeadlineDays * DAY) return fail("Deadline can be at most a year from now.");
  return { ok: true, value: d };
}

export interface ChallengeInput {
  title: string; brief: string; criteria: string | null; prize: string | null;
  terms: string; industry: string | null; deadline: Date;
}

/**
 * A new challenge, or — with `partial` — the fields an edit sends. An edit
 * checks only what it changes, so a company fixing a typo in the brief isn't
 * asked to re-send the deadline.
 */
export function validateChallenge(raw: any, now: number, opts: { partial?: boolean } = {}): Result<Partial<ChallengeInput>> {
  const partial = !!opts.partial;
  const has = (k: string) => !partial || (raw && k in raw);
  const out: Partial<ChallengeInput> = {};
  const L = CHALLENGE_LIMITS;

  const fields: [keyof ChallengeInput, string, { min?: number; max: number }, boolean][] = [
    ["title", "Title", L.title, true],
    ["brief", "Brief", L.brief, true],
    ["criteria", "Criteria", L.criteria, false],
    ["prize", "Prize", L.prize, false],
    ["terms", "Terms", L.terms, true],
  ];
  for (const [key, label, lim, required] of fields) {
    if (!has(key)) continue;
    const v = text(raw?.[key]);
    const err = lengthError(label, v, lim, required);
    if (err) return fail(err);
    (out as any)[key] = v;
  }
  if (has("industry")) {
    const v = text(raw?.industry);
    if (v && !(INDUSTRIES as readonly string[]).includes(v)) return fail("That isn't one of the industries.");
    out.industry = v;
  }
  if (has("deadline")) {
    const d = checkDeadline(raw?.deadline, now);
    if (!d.ok) return d;
    out.deadline = d.value;
  }
  return { ok: true, value: out };
}

export interface EntryInput { title: string; pitch: string; link: string | null; projectId: string | null }

/**
 * An entry, or the fields an edit sends. Accepting the terms is checked by the
 * caller on a new entry only: an edit is made under terms already accepted.
 */
export function validateEntry(raw: any, opts: { partial?: boolean } = {}): Result<Partial<EntryInput>> {
  const partial = !!opts.partial;
  const has = (k: string) => !partial || (raw && k in raw);
  const out: Partial<EntryInput> = {};
  if (has("title")) {
    const v = text(raw?.title);
    const err = lengthError("Title", v, ENTRY_LIMITS.title, true);
    if (err) return fail(err);
    out.title = v!;
  }
  if (has("pitch")) {
    const v = text(raw?.pitch);
    const err = lengthError("Pitch", v, ENTRY_LIMITS.pitch, true);
    if (err) return fail(err);
    out.pitch = v!;
  }
  if (has("link")) {
    const given = text(raw?.link);
    const url = safeUrl(given);
    if (given && !url) return fail("The link has to be a web address starting with http:// or https://.");
    if (url && url.length > ENTRY_LIMITS.link.max) return fail("That link is too long.");
    out.link = url;
  }
  if (has("projectId")) out.projectId = text(raw?.projectId);
  return { ok: true, value: out };
}

type Dated = { status: string; deadline: Date | string };
const ms = (d: Date | string) => new Date(d).getTime();

/**
 * Whether a challenge takes entries right now. Past its deadline it doesn't,
 * whatever the status says: nothing moves a challenge to judging when the
 * clock runs out, so the stored status alone would keep the door open.
 */
export const acceptsEntries = (c: Dated, now: number): boolean => c.status === "open" && ms(c.deadline) > now;

/** The status as a founder should read it: an open challenge past its deadline is being judged, as far as they're concerned. */
export function effectiveStatus(c: Dated, now: number): ChallengeStatus {
  if (c.status === "open" && ms(c.deadline) <= now) return "judging";
  return c.status as ChallengeStatus;
}

/** Whole days left before the deadline, rounded up; 0 once it has passed. */
export const daysLeft = (deadline: Date | string, now: number): number => Math.max(0, Math.ceil((ms(deadline) - now) / DAY));

/** The countdown a card shows. */
export function deadlineLabel(deadline: Date | string, now: number): string {
  const d = daysLeft(deadline, now);
  if (d <= 0) return "Entries closed";
  return d === 1 ? "Last day to enter" : `${d} days left`;
}

/** Editing the challenge is for while it's open. Once entries are being judged, what they were judged against must hold still. */
export const canEditChallenge = (status: string): boolean => status === "open";
/** Shortlisting and picking winners happen only in judging: before, entries are still arriving; after, the results are out. */
export const canJudge = (status: string): boolean => status === "judging";
export const canCloseEntries = (status: string): boolean => status === "open";
export const canAnnounce = (status: string): boolean => status === "judging";

/**
 * The terms and the prize are what entrants agreed to. Once anybody has
 * entered, changing either would change the deal under them.
 */
export const LOCKED_ONCE_ENTERED = ["terms", "prize"] as const;

/** What an entrant is told when the results come out. */
export function resultExcerpt(companyName: string, challengeTitle: string, status: EntryStatus): string {
  const outcome =
    status === "winner" ? "You won." :
    status === "shortlisted" ? "You were shortlisted." :
    "Not picked this time.";
  return `${companyName} · ${challengeTitle}: ${outcome}`;
}

export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = {
  entered: "Entered", shortlisted: "Shortlisted", winner: "Winner", withdrawn: "Withdrawn",
};
export const CHALLENGE_STATUS_LABEL: Record<ChallengeStatus, string> = {
  open: "Open", judging: "Judging", closed: "Results out",
};
