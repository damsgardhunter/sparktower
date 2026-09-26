/**
 * The rules of the room, before anyone writes to a database.
 *
 * Five strangers join, argue over who runs what, agree a name, and start. It
 * takes four minutes and it decides how the next fortnight goes, which is why
 * it is worth being careful about.
 *
 * ## Why there is a clock on everything
 *
 * The failure a lobby has is not people arguing — arguing is the point — it is
 * one person who opened the tab and walked away, holding four others hostage
 * while they wait for a seat that will never be claimed. So every phase has a
 * deadline and a rule for what happens when it passes, and no phase can be
 * blocked by someone who isn't there.
 *
 * ## Why unclaimed seats are assigned rather than left empty
 *
 * A team of three with two empty seats is a team missing two of its five sets
 * of decisions every year — a worse game for the three who showed up, through
 * no fault of theirs. When the clock runs out the remaining seats are dealt
 * out, in a fixed order, to whoever is still in the room. Nobody is left
 * without a job, and the season starts.
 */
import { ROLES, type Role } from "./types";

export const LOBBY_SIZE = 5;

/** How long each phase waits before it resolves itself. */
export const PHASE_SECONDS = {
  /** Waiting for five people. Generous: a half-full room is worth waiting for. */
  filling: 15 * 60,
  /** Claiming seats. Short on purpose — this is meant to be an argument, not a negotiation. */
  claiming: 3 * 60,
  /** The CEO naming the company and choosing a product, with the table shouting. */
  naming: 2 * 60,
} as const;

export type Phase = "filling" | "claiming" | "naming" | "running" | "retired";

export interface SeatView {
  userId: string;
  role: Role | null;
  assigned: boolean;
  /**
   * A seat the product is playing, not a person.
   *
   * It changes when the room stops waiting. A bot never claims a seat — the
   * whole point is that it takes whatever the people didn't want — so a room
   * with a bot in it would otherwise sit out the full claiming clock and then
   * the full naming clock, five minutes of a human watching nothing happen for
   * choices nobody is going to make.
   */
  isBot?: boolean;
}

/**
 * Who gets the seats nobody claimed.
 *
 * Deterministic: the same room always resolves the same way, so a dispute has
 * an answer and a test can check it. Seats are dealt in the order below, which
 * puts the seats with the most to do first — the people who didn't choose end
 * up somewhere that matters rather than somewhere left over.
 *
 * The order people are dealt in is the order they joined. Turning up early is
 * the only fair tiebreak available, and it is one a player can understand.
 */
export const ASSIGNMENT_ORDER: Role[] = ["ceo", "coo", "cmo", "cfo", "cto"];

export function assignRemaining(seats: SeatView[]): SeatView[] {
  const taken = new Set(seats.map((s) => s.role).filter(Boolean) as Role[]);
  const free = ASSIGNMENT_ORDER.filter((r) => !taken.has(r));
  let next = 0;

  return seats.map((seat) => {
    if (seat.role) return seat;
    const role = free[next++] ?? null;
    return role ? { ...seat, role, assigned: true } : seat;
  });
}

/** Is this room ready to stop claiming? Everyone present holds a seat. */
export const allSeated = (seats: SeatView[]): boolean =>
  seats.length > 0 && seats.every((s) => !!s.role);

/** The seats still going. */
export const openRoles = (seats: SeatView[]): Role[] => {
  const taken = new Set(seats.map((s) => s.role).filter(Boolean) as Role[]);
  return ROLES.filter((r) => !taken.has(r));
};

export type ClaimRefusal = "not_in_room" | "role_taken" | "wrong_phase" | "unknown_role";

/**
 * Whether a claim can be attempted at all.
 *
 * Deliberately not the last word: two people can pass this check in the same
 * millisecond and only one can win. The database's unique index settles that,
 * and this exists to give the other four a reason rather than an error — the
 * difference between "Dana got there first" and "something went wrong".
 */
export function canClaim(
  seats: SeatView[],
  userId: string,
  role: string,
  phase: Phase,
): { ok: true } | { ok: false; reason: ClaimRefusal } {
  if (phase !== "claiming") return { ok: false, reason: "wrong_phase" };
  if (!ROLES.includes(role as Role)) return { ok: false, reason: "unknown_role" };
  if (!seats.some((s) => s.userId === userId)) return { ok: false, reason: "not_in_room" };
  if (seats.some((s) => s.role === role && s.userId !== userId)) return { ok: false, reason: "role_taken" };
  return { ok: true };
}

/**
 * What the room should do next, given where it is and what the clock says.
 *
 * One function so the answer is the same whether it is asked by someone
 * opening the screen, by someone claiming a seat, or by the job that sweeps
 * abandoned lobbies. Three callers with three ideas of when a phase ends is
 * how a lobby ends up in two states at once.
 */
export function nextPhase(input: {
  phase: Phase;
  seats: SeatView[];
  /** Seconds remaining; negative once the deadline has passed. */
  secondsLeft: number;
  named: boolean;
  /** How many people this season seats at a table. Five unless the season says otherwise. */
  seatCount?: number;
}): { phase: Phase; assign: boolean; reason: string } | null {
  const { phase, seats, secondsLeft, named } = input;
  const seatCount = input.seatCount ?? LOBBY_SIZE;
  const expired = secondsLeft <= 0;
  /*
   * A table for one is a founder on their own, and every clock below exists to
   * give other people time to arrive. There is nobody else coming, so none of
   * them should run: a solo season that waits sixty seconds for bots, three
   * minutes for seats nobody else can claim and two more for a name is five
   * minutes of a person watching a screen for no reason at all.
   */
  const solo = seatCount <= 1;

  if (phase === "filling") {
    if (seats.length >= seatCount) return { phase: "claiming", assign: false, reason: "The room filled up." };
    // Three is enough to play. Below that there isn't a company, and the
    // people waiting are better served by being told so than by waiting on.
    // A solo season is exempt: one is the whole table, handled above.
    if (expired && seats.length >= 3) return { phase: "claiming", assign: false, reason: "Time's up, and there are enough of you to start." };
    if (expired) return { phase: "retired", assign: false, reason: "Not enough people joined in time." };
    return null;
  }

  if (phase === "claiming") {
    /*
     * Nobody to argue with about who sits where. The one seat takes every
     * lever, so there is nothing to claim and no reason to hold the room.
     */
    if (solo) return { phase: "naming", assign: true, reason: "You're the whole company, so every desk is yours." };
    if (allSeated(seats)) return { phase: "naming", assign: false, reason: "Every seat is taken." };
    /*
     * Everybody who was going to choose has chosen. The rest of the room is
     * bots, which will never claim anything, so waiting out the clock only
     * costs the people who are actually here.
     */
    if (seats.some((s) => !s.role) && seats.every((s) => s.role || s.isBot)) {
      return { phase: "naming", assign: true, reason: "Everyone's chosen. The rest of the seats were dealt out." };
    }
    if (expired) return { phase: "naming", assign: true, reason: "Time's up — the seats nobody claimed were dealt out." };
    return null;
  }

  if (phase === "naming") {
    if (named) return { phase: "running", assign: false, reason: "The company has a name. Year one begins." };
    /*
     * A solo season is named after the project it was built from before
     * anybody sees this screen, so there is nothing to wait for. Holding a
     * founder for two minutes to confirm the name of their own business is
     * the clearest case of a clock that exists only because five people used
     * to need one.
     */
    if (solo) return { phase: "running", assign: false, reason: "It's your company and it already has your name on it." };
    // A bot in the chief executive's seat is never going to name anything.
    // Start on a placeholder now rather than two minutes from now; whoever is
    // actually here can still rename it in year one.
    if (seats.some((s) => s.role === "ceo" && s.isBot)) {
      return { phase: "running", assign: false, reason: "Nobody here is naming it. Year one begins, and the name can still change." };
    }
    // A CEO who wandered off cannot hold the season. The venture starts with a
    // placeholder name, which the CEO can still change in year one.
    if (expired) return { phase: "running", assign: false, reason: "Time's up — the company starts unnamed, and the chief executive can still fix that." };
    return null;
  }

  return null;
}

/** A name for a company nobody named, so a venture is never a blank row in a league table. */
export function placeholderName(seed: string): string {
  const first = ["Northwind", "Halcyon", "Ardent", "Vantage", "Kestrel", "Lumen", "Meridian", "Tessera"];
  const second = ["Works", "Labs", "Collective", "Union", "Group", "Company"];
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${first[hash % first.length]} ${second[(hash >> 5) % second.length]}`;
}
