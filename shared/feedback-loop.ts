/**
 * The build loop: publish a progress post → get feedback → apply it → the
 * next post says what was acted on, and the people who gave it hear so.
 *
 * Built on feed posts (weekly check-ins were retired). A
 * project's post can carry up to four specific asks; comments on it from
 * outside the team are the feedback. Each comment moves through:
 *
 *   open     — nobody on the team has acted on it
 *   applied  — a teammate turned it into a task
 *   closed   — a later update from the project credited it
 *
 * Pure, so the rules are tested without a database.
 */

export const MAX_ASKS = 4;
export const ASK_MIN = 5;
export const ASK_MAX = 200;
/** One update can credit a good deal of feedback, but not an unbounded list. */
export const MAX_CLOSES = 20;

export type FeedbackState = "open" | "applied" | "closed";

/** The asks, trimmed and deduplicated, or the reason they can't be posted. */
export function validateAsks(raw: unknown): { asks: string[] } | { error: string } {
  if (raw == null) return { asks: [] };
  if (!Array.isArray(raw)) return { error: "Asks must be a list of questions." };
  const asks: string[] = [];
  for (const item of raw) {
    const ask = String(item ?? "").trim().replace(/\s+/g, " ");
    if (!ask) continue;
    if (ask.length < ASK_MIN) return { error: `"${ask}" is too short to answer — ask something specific.` };
    if (ask.length > ASK_MAX) return { error: `Keep each ask under ${ASK_MAX} characters.` };
    if (!asks.some((a) => a.toLowerCase() === ask.toLowerCase())) asks.push(ask);
  }
  if (asks.length > MAX_ASKS) return { error: `Up to ${MAX_ASKS} asks — the more you ask, the less each gets answered.` };
  return { asks };
}

export function feedbackStateOf(c: { appliedAt: Date | string | null; closedByPostId: string | null }): FeedbackState {
  if (c.closedByPostId) return "closed";
  if (c.appliedAt) return "applied";
  return "open";
}

/**
 * Whether a comment counts as feedback for the project: someone outside the
 * team, on a post about the project. The team talking among themselves isn't
 * feedback, and a comment is never feedback on the commenter's own work.
 */
export const isFeedback = (c: { authorId: string }, teamIds: Set<string>) => !teamIds.has(c.authorId);

/**
 * New since the team last looked. A post nobody has opened the feedback on
 * yet counts everything on it as new.
 */
export function isNewFeedback(c: { createdAt: Date | string }, post: { feedbackSeenAt: Date | string | null }) {
  return !post.feedbackSeenAt || new Date(c.createdAt).getTime() > new Date(post.feedbackSeenAt).getTime();
}

/** A comment's first line, short enough for a task title. */
export function taskTitleFromComment(content: string, authorName: string): string {
  const line = content.replace(/\s+/g, " ").trim();
  const clipped = line.length > 80 ? `${line.slice(0, 77).trimEnd()}…` : line;
  return `Feedback from ${authorName}: ${clipped}`;
}

/** The line an update carries when it acts on feedback, naming who gave it. */
export function creditLine(names: string[]): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (!unique.length) return "";
  const who = unique.length === 1 ? unique[0] : unique.length === 2 ? `${unique[0]} and ${unique[1]}` : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  return `Acts on feedback from ${who}.`;
}
