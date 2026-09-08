/**
 * The weekly check-in: its fields, its rules, and its week.
 *
 * Shared because the composer and the API have to agree exactly. When the
 * client's idea of "valid" is looser than the server's, people lose work they
 * already typed; when it's tighter, the server's rules are never really tested.
 *
 * The constraints come from the Phase 1 spec and they are deliberately tight —
 * the loop only works if a check-in takes under two minutes to write, and a
 * 400-character ceiling is what stops it becoming an essay.
 */

export const CHECK_IN_LIMITS = {
  goal: { min: 5, max: 120 },
  proof: { min: 10, max: 400 },
  blocker: { min: 0, max: 300 },
  nextStep: { min: 5, max: 140 },
} as const;

export const CHECK_IN_VISIBILITY = ["unlisted", "public"] as const;
export type CheckInVisibility = (typeof CHECK_IN_VISIBILITY)[number];

/**
 * Unlisted by default.
 *
 * The spec names "too public → posting anxiety" as the first risk to the loop.
 * Someone's first check-in should be shareable by choice, not published to the
 * world because they didn't find a setting.
 */
export const DEFAULT_VISIBILITY: CheckInVisibility = "unlisted";

/**
 * Words that mean a proof line is describing something that exists.
 *
 * Proof has to be checkable — either a link, or language that names a shipped
 * thing. This is a nudge toward evidence, not a lie detector; someone
 * determined to write "shipped nothing" will pass. It exists to stop
 * "worked on stuff" counting as proof.
 */
export const PROOF_KEYWORDS = [
  "shipped", "launched", "released", "deployed", "merged", "published",
  "fixed", "built", "added", "wrote", "recorded", "demo", "live",
  "signed", "sold", "interviewed", "tested", "migrated", "opened",
];

/**
 * Openers that mean the next step isn't phrased as an action.
 *
 * A real part-of-speech check needs a parser and a dictionary. This catches the
 * common failure — "The next thing is to…", "My plan is…" — while letting any
 * ordinary verb through. Deliberately a small list of determiners, pronouns and
 * prepositions rather than an attempt at grammar.
 */
const NON_VERB_OPENERS = [
  "the", "a", "an", "my", "our", "their", "his", "her", "its",
  "this", "that", "these", "those", "i", "we", "it", "there",
  "in", "on", "for", "to", "at", "by", "with", "about", "maybe",
  "hopefully", "probably", "still", "just", "more", "some",
];

export interface CheckInDraft {
  goal: string;
  proof: string;
  blocker?: string | null;
  nextStep: string;
}

export type CheckInErrors = Partial<Record<keyof CheckInDraft, string>>;

const len = (v: string | null | undefined) => (v ?? "").trim().length;

export function containsUrl(text: string): boolean {
  return /https?:\/\/\S+\.\S+|\b\S+\.(com|org|net|io|dev|app|co|ai|xyz|sh|me)\b/i.test(text);
}

function hasProofSignal(text: string): boolean {
  if (containsUrl(text)) return true;
  const lower = text.toLowerCase();
  return PROOF_KEYWORDS.some((k) => new RegExp(`\\b${k}`, "i").test(lower));
}

function startsWithVerb(text: string): boolean {
  const first = text.trim().toLowerCase().split(/[\s,]+/)[0]?.replace(/[^a-z']/g, "");
  if (!first) return false;
  return !NON_VERB_OPENERS.includes(first);
}

/**
 * Validates a draft. Returns one message per bad field, empty when it's fine.
 *
 * Every message says what to do, not what's wrong — someone two minutes into
 * their week doesn't want to be told their input is invalid, they want to know
 * what to type.
 */
export function validateCheckIn(draft: CheckInDraft): CheckInErrors {
  const errors: CheckInErrors = {};
  const { goal, proof, blocker, nextStep } = CHECK_IN_LIMITS;

  const goalLen = len(draft.goal);
  if (goalLen < goal.min) {
    errors.goal = `Say what you were aiming for this week — at least ${goal.min} characters.`;
  } else if (goalLen > goal.max) {
    errors.goal = `Keep the goal to one sentence (${goalLen}/${goal.max}).`;
  } else if ((draft.goal.match(/[.!?](\s|$)/g) || []).length > 1) {
    errors.goal = "One sentence. Put the detail in Proof.";
  }

  const proofLen = len(draft.proof);
  if (proofLen < proof.min) {
    errors.proof = `Name something that exists now — at least ${proof.min} characters.`;
  } else if (proofLen > proof.max) {
    errors.proof = `Trim the proof (${proofLen}/${proof.max}).`;
  } else if (!hasProofSignal(draft.proof)) {
    errors.proof = "Link it, or say what shipped — \"launched\", \"merged\", \"wrote\", and so on.";
  }

  if (len(draft.blocker) > blocker.max) {
    errors.blocker = `Keep the blocker short (${len(draft.blocker)}/${blocker.max}).`;
  }

  const stepLen = len(draft.nextStep);
  if (stepLen < nextStep.min) {
    errors.nextStep = `One concrete thing you'll do next — at least ${nextStep.min} characters.`;
  } else if (stepLen > nextStep.max) {
    errors.nextStep = `One step, not a plan (${stepLen}/${nextStep.max}).`;
  } else if (!startsWithVerb(draft.nextStep)) {
    errors.nextStep = "Start with a verb — \"Ship…\", \"Interview…\", \"Write…\".";
  }

  return errors;
}

export const isValidCheckIn = (draft: CheckInDraft): boolean =>
  Object.keys(validateCheckIn(draft)).length === 0;

// --- Weeks --------------------------------------------------------------

/**
 * The Monday of a date's week, at UTC midnight.
 *
 * UTC throughout so a check-in doesn't belong to two different weeks depending
 * on who is reading it. The week is part of the artifact's identity — it's in
 * the public page's heading — so it can't shift with the viewer's timezone.
 */
export function weekStartOf(date: Date | string = new Date()): Date {
  const d = new Date(date);
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day.
  const shift = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - shift);
  return utc;
}

/** "Week of 8 September" — the heading a backer or a peer actually reads. */
export function weekLabel(weekStart: Date | string): string {
  const d = new Date(weekStart);
  if (Number.isNaN(d.getTime())) return "";
  return `Week of ${d.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", timeZone: "UTC",
  })}`;
}

/** ISO-ish key for grouping and for the one-per-week rule. */
export function weekKey(weekStart: Date | string): string {
  return new Date(weekStart).toISOString().slice(0, 10);
}

// --- Sharing ------------------------------------------------------------

export const checkInPath = (id: string) => `/c/${id}`;

/**
 * The text that goes on the clipboard beside the link.
 *
 * Pre-written because the moment someone has to compose a post from scratch is
 * the moment they don't share at all.
 */
export function shareText(input: {
  projectTitle: string;
  goal: string;
  nextStep: string;
  url: string;
}): string {
  return [
    `${input.projectTitle} — this week:`,
    input.goal,
    ``,
    `Next: ${input.nextStep}`,
    ``,
    input.url,
  ].join("\n");
}
