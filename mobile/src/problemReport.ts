/**
 * The phone's copy of `shared/problem-reports.ts`.
 *
 * Metro cannot resolve `@shared`, so the rules a report has to satisfy are
 * written twice, and `test/unit/mobile-mirror.test.ts` runs both on the same
 * inputs. No imports at all, which is what keeps that comparison possible.
 *
 * The point of checking on this side as well as the server's is the wording. The
 * server answers 400 with a sentence meant to be shown verbatim, but a round
 * trip to be told "tell us what went wrong" is a round trip to be told something
 * the screen already knew — and on a phone, often on a bad connection, that is
 * the difference between a report sent and a report abandoned. The server still
 * checks; this only saves the journey.
 */

/** Mirrors PROBLEM_MESSAGE_MIN. */
export const PROBLEM_MESSAGE_MIN = 4;
/** Mirrors PROBLEM_MESSAGE_MAX. */
export const PROBLEM_MESSAGE_MAX = 1_000;

/** Mirrors `readProblemMessage`, refusals and all, because the refusal is shown as written. */
export function readProblemMessage(raw: unknown): { ok: true; message: string } | { ok: false; reason: string } {
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
 * Mirrors `readProblemPath`.
 *
 * On a phone the "path" is the route the person was on, which expo-router names
 * the same way the web does — so the same rule applies: a path and nothing else,
 * no query, no fragment, and nothing that is not ours.
 */
export function readProblemPath(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/")) return "";
  return value.split(/[?#]/)[0].slice(0, 300);
}
