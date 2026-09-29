/**
 * How long the things Nova writes are allowed to be, and how they are cut if
 * they overrun.
 *
 * Its own module, with no imports, for two reasons: every prompt that produces
 * something a founder keeps should state the same budget, and this is the one
 * piece of that machinery worth unit-testing on its own — the rest of
 * phase-trees-nova reaches the database through `entitlements`, and a test of
 * where a string gets cut should not need a Postgres.
 */

/**
 * These are the artifacts a founder keeps — a data model, five loops, the
 * empty and error states of a product. The limits used to be a bare
 * `.slice(0, 4000)` applied to whatever came back, with nothing in the prompt
 * saying a limit existed, so a good answer to a big milestone was cut in the
 * middle of a word: one real run ended its data model at "- status (enum:
 * draft, rea". A fifth of everything that build wrote stopped mid-sentence,
 * and nothing on the screen said so — the text simply ended, and the person
 * who paid for it had no way to know they were reading two thirds of an answer.
 *
 * So: the budget is stated in the prompt, it is generous enough for the
 * milestones that legitimately need the room, and if a model still overruns,
 * the cut lands on a paragraph or sentence boundary and says what it did.
 */
export const WRITTEN_LIMIT = 12_000;
export const TEMPLATE_LIMIT = 12_000;
const TRIMMED_NOTE = "\n\n— trimmed here; ask Nova to continue this step if you want the rest.";

/** The budget, in the words the prompts use, so every shape says the same thing. */
export const lengthRule = (limit: number) =>
  `Keep every piece of writing complete and self-contained within ${limit.toLocaleString("en-US")} characters. ` +
  `Finish the thought you are on rather than running to the limit and stopping mid-sentence: if the subject is larger than the budget, ` +
  `cover the most important part fully and say in one closing line what you left out.`;

/**
 * Cut at a boundary, not mid-word — and admit it.
 *
 * Prefers the last paragraph break in the final fifth of the allowance, then
 * the last sentence end, then the last space. A caller that gets back
 * something shorter than the limit gets it back untouched.
 */
export function clampWritten(raw: unknown, limit = WRITTEN_LIMIT): string {
  const text = String(raw ?? "");
  if (text.length <= limit) return text;
  const room = limit - TRIMMED_NOTE.length;
  const head = text.slice(0, room);
  const floor = Math.floor(room * 0.8);
  const boundary = [head.lastIndexOf("\n\n"), head.search(/[.!?][^.!?]*$/) >= 0 ? head.lastIndexOf(".") : -1, head.lastIndexOf(" ")]
    .find((i) => i > floor) ?? -1;
  const cut = boundary > 0 ? head.slice(0, boundary === head.lastIndexOf(".") ? boundary + 1 : boundary) : head;
  return `${cut.trimEnd()}${TRIMMED_NOTE}`;
}
