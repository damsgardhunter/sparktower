/**
 * What the builder has told Nova to keep in mind, and how it accumulates.
 *
 * `projects.novaNotes` is the one thing that outranks the brief, the board and
 * the code (server/project-operations.ts). It is how somebody says "we dropped
 * the quiz", "pricing is per-use now", "the wedge is the three paths" and has
 * every later read start from that.
 *
 * ## Why this file exists
 *
 * Because the chat action that writes it replaced the whole field. Nova is
 * told the note makes "every future conversation and every Nova read start
 * from it", and then the second thing a builder said erased the first: tell it
 * about pricing on Tuesday and the direction you gave it on Monday is gone.
 * Somebody correcting Nova repeatedly was making it know less each time, which
 * is the exact opposite of what the feature promises.
 *
 * So notes are a list, newest last, each dated. Nova adds to them; it replaces
 * one only when the builder has actually changed their mind about that thing,
 * and then the old line goes rather than sitting there contradicting the new
 * one.
 */

/** One thing the builder has told Nova, and when. */
export interface StandingNote {
  /** ISO date, day precision — the day it was said is all anyone needs. */
  on: string;
  text: string;
}

/** The field is capped in the database and in every prompt that carries it. */
export const STANDING_NOTES_MAX = 2000;

const LINE = /^\[(\d{4}-\d{2}-\d{2})\]\s*([\s\S]*)$/;

/**
 * Reads the stored text back into notes.
 *
 * Anything without a date is a note from before this existed, which is most of
 * them on any project that has been used. It is kept, undated, at the front:
 * losing somebody's direction because the format changed under them would be
 * the same bug again.
 */
export function readStandingNotes(raw: string | null | undefined): StandingNote[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  const notes: StandingNote[] = [];
  for (const block of text.split(/\n(?=\[\d{4}-\d{2}-\d{2}\])/)) {
    const line = block.trim();
    if (!line) continue;
    const m = LINE.exec(line);
    if (m) notes.push({ on: m[1], text: m[2].trim() });
    else notes.push({ on: "", text: line });
  }
  return notes;
}

/** Back to the stored form. */
export function writeStandingNotes(notes: StandingNote[]): string {
  return notes
    .map((n) => (n.on ? `[${n.on}] ${n.text}` : n.text))
    .join("\n")
    .trim();
}

/**
 * Adds what was just said to what was already known.
 *
 * `replaces` is how a note is revised rather than piled on: the builder has
 * changed their mind about that specific thing, so the old line is dropped
 * instead of being left to contradict the new one. Matching is on the text
 * Nova quotes back, loosely, because it is quoting from a prompt rather than
 * holding an id.
 *
 * When the result is over the cap the oldest notes go first. They are the ones
 * most likely to have been overtaken, and something has to give: a silently
 * truncated field would cut a sentence in half instead.
 */
export function addStandingNote(
  existing: string | null | undefined,
  text: string,
  opts: { on?: string; replaces?: string | null } = {},
): string {
  const said = text.trim();
  if (!said) return (existing ?? "").trim();

  const on = opts.on ?? new Date().toISOString().slice(0, 10);
  let notes = readStandingNotes(existing);

  if (opts.replaces?.trim()) {
    const needle = normalise(opts.replaces);
    notes = notes.filter((n) => !normalise(n.text).includes(needle) && !needle.includes(normalise(n.text)));
  }

  /* Saying the same thing twice is not two notes. */
  const already = normalise(said);
  notes = notes.filter((n) => normalise(n.text) !== already);

  notes.push({ on, text: said });

  while (notes.length > 1 && writeStandingNotes(notes).length > STANDING_NOTES_MAX) notes.shift();
  return writeStandingNotes(notes).slice(0, STANDING_NOTES_MAX);
}

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
