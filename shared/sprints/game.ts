/**
 * Ten Years From Now — the co-founder sprint as a game rather than a form.
 *
 * Two strangers get half an hour to invent a startup together, and then an
 * AI tells them what it thinks the thing is worth in a decade.
 *
 * ## Why it replaced a questionnaire
 *
 * The old sprint asked people to type paragraphs into boxes: the real problem,
 * the target user, the riskiest assumption. It is a reasonable set of
 * questions and a terrible thing to do with a stranger for a day. Everyone
 * types alone, nobody reads the other's answers, and the "collaboration" is
 * two documents side by side.
 *
 * So every round here is a *decision* — a thing you pick, argue about in the
 * chat and settle — rather than a thing you write. The only free text left is
 * where free text is genuinely the point: naming your idea, and saying what
 * your product does better than what already exists.
 *
 * ## The five rounds
 *
 * Each one narrows the thing you are building, in the order a real company
 * actually finds out:
 *
 *   1. **Idea** — what are we even making? Each of you brings one; you pick one.
 *   2. **Customer** — who is it for? Cards, plus anyone you two invent.
 *   3. **Model** — how does it make money?
 *   4. **Product** — what does it do better than what exists? Which of those
 *      are the point, and which are nice to have?
 *   5. **The first million** — you have been lent a million dollars and a
 *      year. Where does it go?
 *
 * Then the verdict: a ten-year valuation, a peak, and five scores out of a
 * thousand — which is also where you land on the leaderboard.
 *
 * ## The rule that shapes everything
 *
 * **Agreement settles a round instantly; deadlock is settled by the clock.**
 *
 * A game between two strangers cannot have a step that requires consensus,
 * because sooner or later somebody stops replying and the other person is
 * stuck in a half-finished startup with no way out. So every round has a
 * deadline, and every round has a defined answer at that deadline even if one
 * player has wandered off entirely. Nobody can hold the other hostage.
 *
 * Pure: no database, no clock, no model. The server owns those.
 */
import { pick, rng } from "../simulation/random";

/** The rounds, in order. `verdict` is the result screen, not a round you play. */
export const ROUNDS = ["idea", "customer", "model", "product", "spend", "verdict"] as const;
export type Round = (typeof ROUNDS)[number];

/** Rounds you actually play, as opposed to the result. */
export const PLAYABLE_ROUNDS = ROUNDS.filter((r) => r !== "verdict") as Exclude<Round, "verdict">[];

/**
 * How long each round gets.
 *
 * Twenty-six minutes of play if every round runs its clock out, which is the
 * worst case rather than the expected one — a round ends the moment both
 * players have settled it, and most do. The target was "20-30 minutes",
 * and the shape that matters is the distribution: the two rounds where people
 * actually create something (the product and the money) get the most time,
 * and the two card rounds get the least because picking a card is quick and
 * arguing about it is the fun part rather than the slow part.
 */
export const ROUND_SECONDS: Record<Exclude<Round, "verdict">, number> = {
  idea: 6 * 60,
  customer: 4 * 60,
  model: 4 * 60,
  product: 6 * 60,
  spend: 6 * 60,
};

/** What the screen calls each round, and the one line explaining it. */
export const ROUND_COPY: Record<Round, { title: string; blurb: string }> = {
  idea: {
    title: "The idea",
    blurb: "Bring one each. Pick one together.",
  },
  customer: {
    title: "The customer",
    blurb: "Who is this actually for? Pick from the deck, or invent someone.",
  },
  model: {
    title: "The money",
    blurb: "How does it make any? Argue it out, then commit.",
  },
  product: {
    title: "The product",
    blurb: "What does it do better than what already exists — and which of those actually matter?",
  },
  spend: {
    title: "The first million",
    blurb: "You've been lent a million dollars and a year. Spend it.",
  },
  verdict: {
    title: "Ten years from now",
    blurb: "What it's worth, what it could have been worth, and where you two rank.",
  },
};

/** The whole game, end to end, if every clock runs out. */
export const TOTAL_SECONDS = PLAYABLE_ROUNDS.reduce((sum, r) => sum + ROUND_SECONDS[r], 0);

// ─── How often you may play ──────────────────────────────────────────────────

/**
 * One game a day, per person.
 *
 * The valuation at the end is a model call over a long prompt, and it is given
 * away free — so without a ceiling the cost of this feature is set by whoever
 * is most bored. But the limit is not really about the bill. A game you can
 * replay immediately is a game you reroll: unhappy with 480, start again, keep
 * the bot partner you liked, try the same idea with a different budget. That
 * turns a half-hour of deciding things with somebody into a slot machine, and
 * the number at the end stops meaning anything — including on the leaderboard,
 * where it would be ranked against people who only got one go.
 *
 * A rolling day rather than a calendar one. Midnight is midnight *somewhere*,
 * and a server that resets at 00:00 UTC hands Australians their game at
 * lunchtime and Californians theirs at four in the afternoon. Twenty-four
 * hours from the last game is the same rule for everybody and can be stated
 * exactly — "you can play again at 6pm" — without knowing where anyone is.
 */
export const GAMES_PER_DAY = 1;
export const GAME_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * When the next game unlocks, given when the last one was started.
 *
 * Counted from the *start*, not the finish. A game that was abandoned in round
 * one has still used the day — otherwise "leave and start again" is a reroll
 * button with an extra step, which is the exact thing the limit exists to
 * prevent. The trade is that somebody whose browser died has lost their turn,
 * and that is why a game still in progress never counts against them: it is
 * theirs to go back to for as long as its clocks are running.
 */
export const gameUnlocksAt = (lastStartedAt: Date | string | null | undefined): Date | null => {
  if (!lastStartedAt) return null;
  const at = new Date(lastStartedAt).getTime();
  return Number.isFinite(at) ? new Date(at + GAME_COOLDOWN_MS) : null;
};

/**
 * How long until then, in words a person would use.
 *
 * Deliberately vague at the top and precise at the bottom. "In about 9 hours"
 * is what somebody wants at breakfast; "in 4 minutes" is what they want when
 * it is nearly time, and rounding that to "in about an hour" would be a lie
 * they would catch.
 */
export function playAgainIn(unlocksAt: Date | string | null | undefined, now: Date = new Date()): string | null {
  const at = unlocksAt ? new Date(unlocksAt).getTime() : NaN;
  if (!Number.isFinite(at)) return null;
  const ms = at - now.getTime();
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}

export const nextRound = (round: Round): Round | null => {
  const i = ROUNDS.indexOf(round);
  return i < 0 || i === ROUNDS.length - 1 ? null : ROUNDS[i + 1];
};

// ─── Settling a round ────────────────────────────────────────────────────────

/**
 * One player's submission for a round.
 *
 * `choice` is whatever that round settles on — an idea id, a card id, a list
 * of product claims, a budget. Rounds differ in what they collect, not in how
 * they end.
 */
export interface Submission<T> {
  userId: string;
  choice: T;
  /** Used to break a tie the same way twice. Earlier submissions win ties. */
  at: number;
}

export type SettleReason =
  /** Both players picked the same thing. */
  | "agreed"
  /**
   * A round that keeps both answers rather than choosing one, and both
   * players gave one.
   *
   * Distinct from "agreed" on purpose. The two merge rounds used to report
   * agreement whenever both had submitted, which was simply untrue — two
   * people who listed completely different advantages, or budgets a hundred
   * thousand dollars apart, had not agreed about anything. It also hid the one
   * thing the player most needs to be told: that what got committed is the
   * average of their two budgets rather than the one they typed.
   */
  | "merged"
  /** They disagreed and the clock ran out; a coin decided. */
  | "coin"
  /** Only one player submitted anything, so theirs stands. */
  | "unopposed"
  /** Nobody submitted anything at all. */
  | "nobody";

/**
 * The reasons, as a runtime list.
 *
 * The union type above is erased at compile time, so anything that has to
 * enumerate them — the copy each client shows, the test that checks the two
 * clients agree — was hardcoding its own copy of the list and going stale the
 * moment a reason was added. This is the one place that enumerates them.
 */
export const SETTLE_REASONS: SettleReason[] = ["agreed", "merged", "coin", "unopposed", "nobody"];

export interface Settlement<T> {
  choice: T | null;
  reason: SettleReason;
  /** Whose submission won, when one did. */
  wonBy: string | null;
}

/**
 * Settle a round where the two of them pick one of something.
 *
 * Agreement is the good path and it should feel instant: if both have picked
 * the same thing, the round is over the moment the second pick lands, without
 * waiting for a clock.
 *
 * Deadlock is the interesting one. The temptation is to make the earlier
 * submission win — it is deterministic, it needs no randomness, and it is
 * quietly awful: it means the fast clicker wins every disagreement in the
 * game, so the correct strategy is to pick instantly and never discuss
 * anything. That is the opposite of the product. A coin makes arguing the
 * only way to get your way, which is the entire point of playing this with
 * another person.
 *
 * The coin is seeded, so the same deadlock always resolves the same way and
 * the screen can honestly say why.
 */
export function settleChoice<T>(input: {
  submissions: Submission<T>[];
  /** Compares two choices for "the same thing". Defaults to strict equality. */
  same?: (a: T, b: T) => boolean;
  seed: string;
}): Settlement<T> {
  const { submissions, seed, same = (a: T, b: T) => a === b } = input;
  if (submissions.length === 0) return { choice: null, reason: "nobody", wonBy: null };
  if (submissions.length === 1) {
    return { choice: submissions[0].choice, reason: "unopposed", wonBy: submissions[0].userId };
  }

  // Oldest first, so a coin flip between the same two people is stable no
  // matter which order they happen to be read out of the database.
  const ordered = [...submissions].sort((a, b) => a.at - b.at || a.userId.localeCompare(b.userId));
  const [first, ...rest] = ordered;
  if (rest.every((s) => same(s.choice, first.choice))) {
    return { choice: first.choice, reason: "agreed", wonBy: null };
  }

  const won = pick(`${seed}:coin`, ordered);
  return { choice: won.choice, reason: "coin", wonBy: won.userId };
}

/**
 * Whether a round can end early.
 *
 * True once everybody has submitted *and* they agree. Two people who have both
 * picked but picked differently keep their clock — the remaining time is
 * exactly when the argument that makes this game worth playing happens, and
 * ending the round on their first disagreement would throw it away.
 */
export function roundCanSettleEarly<T>(input: {
  submissions: Submission<T>[];
  playerCount: number;
  same?: (a: T, b: T) => boolean;
}): boolean {
  const { submissions, playerCount, same = (a: T, b: T) => a === b } = input;
  if (playerCount <= 0 || submissions.length < playerCount) return false;
  const [first, ...rest] = submissions;
  return rest.every((s) => same(s.choice, first.choice));
}

/**
 * A seeded coin, exposed so the server can tell somebody what happened.
 *
 * "Ada's pick won the toss" is a sentence a player accepts. "Your pick was
 * discarded" is one they write in to complain about.
 */
export const coinWinner = (seed: string, userIds: string[]): string | null =>
  userIds.length === 0 ? null : pick(`${seed}:coin`, [...userIds].sort());

/** A stable shuffle, for dealing a round's cards without dealing them alike. */
export function dealOrder<T>(seed: string, items: readonly T[]): T[] {
  const next = rng(`deal:${seed}`);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
