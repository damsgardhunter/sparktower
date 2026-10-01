/**
 * "Is there a problem? Report it" — what a person can send, and what happens
 * to it afterwards.
 *
 * Deliberately not the content-report flow (`shared/moderation.ts`), which is
 * about people and posts and ends in moderation. This is about the product
 * being broken, and ends in a fix. Sharing a pipe would have meant a screen
 * that won't load queued behind somebody's abuse report, triaged by whoever
 * happened to be on safety duty.
 *
 * The shape is kept small on purpose: a sentence or two and the page they were
 * on. Anything that asks a person to categorise their own bug gets a wrong
 * category and one fewer report.
 */

/** Short enough to write in the moment, long enough to say what happened. */
export const PROBLEM_MESSAGE_MIN = 4;
export const PROBLEM_MESSAGE_MAX = 1_000;

/** Where a report stands. Only ever moved by someone reading it. */
export const PROBLEM_STATUSES = ["new", "looking", "fixed", "not-a-bug"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export const PROBLEM_STATUS_COPY: Record<ProblemStatus, { label: string; blurb: string }> = {
  new: { label: "New", blurb: "Nobody has read this yet." },
  looking: { label: "Looking", blurb: "Someone is on it." },
  fixed: { label: "Fixed", blurb: "Shipped, or was never broken again." },
  "not-a-bug": { label: "Not a bug", blurb: "Working as intended, or too little to act on." },
};

export const isProblemStatus = (v: unknown): v is ProblemStatus =>
  typeof v === "string" && (PROBLEM_STATUSES as readonly string[]).includes(v);

/**
 * What a report has to have to be worth storing.
 *
 * Returns the cleaned message, or the reason it can't be taken — said in the
 * words the person will read, because the dialog shows it verbatim.
 */
export function readProblemMessage(raw: unknown): { ok: true; message: string } | { ok: false; reason: string } {
  /*
   * A string, not something that can be turned into one. `String({})` is
   * "[object Object]" — fifteen characters, long enough to pass a length
   * check, and meaningless in the queue.
   */
  if (typeof raw !== "string") return { ok: false, reason: "Tell us what went wrong, even in a few words." };
  const message = raw.trim();
  if (message.length < PROBLEM_MESSAGE_MIN) {
    return { ok: false, reason: "Tell us what went wrong, even in a few words." };
  }
  if (message.length > PROBLEM_MESSAGE_MAX) {
    return { ok: false, reason: `That's longer than ${PROBLEM_MESSAGE_MAX.toLocaleString("en-GB")} characters — trim it a little.` };
  }
  return { ok: true, message };
}

/**
 * The page someone was on, as a path and nothing else.
 *
 * Stored so a report can be reproduced without asking. Query strings and
 * fragments are dropped: they carry search terms and whatever else was in the
 * box, and none of that is needed to find the screen.
 */
export function readProblemPath(raw: unknown): string {
  const value = String(raw ?? "").trim();
  /*
   * The same rule as `safeReturnPath` in shared/credits.ts, and for a sharper
   * reason: `/admin/problems` renders this as `<Link href={r.path}>`, and the
   * report endpoint deliberately takes no session. So a stranger could submit
   * `//evil.test`, which starts with a slash and passed, be stored, and show a
   * reviewer a link to another origin that reads like one of ours. Protocol-
   * relative and backslash forms are both treated as a host by browsers.
   */
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "";
  if (/[\u0000-\u001f]/.test(value)) return "";
  return value.split(/[?#]/)[0].slice(0, 300);
}
