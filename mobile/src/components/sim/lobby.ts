/**
 * The lobby's logic that doesn't need a screen.
 *
 * Metro can't resolve the web app's `@shared` alias, so the shapes the API
 * sends are restated here rather than imported — the same arrangement as
 * src/components/feedModel.ts and src/projectSections.ts. Anything the server
 * can send instead of us hard-coding it, it does: role titles and levers come
 * down with GET /api/sim/niches rather than being copied out of
 * shared/simulation/types.ts, because a lever list that drifts is worse than
 * one extra request.
 *
 * The countdown lives here for one reason: the server owns the clock and the
 * phone only draws it, and the arithmetic that keeps those two honest is
 * exactly the kind of thing that is wrong in a way nobody notices until a
 * phase ends nine seconds early on somebody's screen.
 */
import { colors } from "../../theme";

export type SimPhase = "filling" | "claiming" | "naming" | "running" | "retired";

/**
 * A season's own status, which is a different thing from a room's phase.
 *
 * Mirrors `simSeasons.status` in shared/schema.ts. The phase says what the
 * five of them are doing right now; the status says whether the season is
 * still a thing that can change. Two screens need the second question —
 * offers and standings both carry it — so it lives here, with the rest of the
 * season's vocabulary, rather than in whichever of them asked first.
 */
export type SeasonStatus = "forming" | "running" | "finished" | "abandoned";

/**
 * Whether anything can still happen.
 *
 * A finished season is a final answer and an abandoned one is a season nobody
 * is playing; both mean the same thing to a screen with buttons on it, which
 * is that the buttons are lying. Written as a positive check against the two
 * closed states rather than `!== "running"`, so a status this build has not
 * heard of leaves the screen live rather than silently dead.
 */
export const seasonOver = (status: SeasonStatus | string | null | undefined): boolean =>
  status === "finished" || status === "abandoned";

export interface SimSegment {
  id: string;
  name: string;
  description: string;
  size: number;
  /** 0–1. The one to read twice: how hard this segment is to take off an incumbent. */
  loyalty: number;
}

export interface SimIncumbent {
  name: string;
  /** Share of the whole market at year zero, 0–1. */
  share: number;
  posture: "fortress" | "brawler" | "coaster" | "innovator";
}

export interface SimNiche {
  id: string;
  name: string;
  premise: string;
  segments: SimSegment[];
  incumbents: SimIncumbent[];
}

export interface SimRole {
  id: string;
  title: string;
  /** What the seat actually controls, in the words a player would use. */
  levers: string[];
}

export interface NichesResponse {
  niches: SimNiche[];
  roles: SimRole[];
  lobbySize: number;
}

export interface SimSeat {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string | null;
  /** True when the clock dealt this seat out rather than the player choosing it. */
  assigned: boolean;
  /**
   * A seat the product is playing, not a person.
   *
   * Shown on every surface that lists one. A bot carries an ordinary name so
   * the room reads like a room, which is exactly why leaving the label off
   * would be the product telling somebody something untrue about who they are
   * playing with.
   */
  isBot?: boolean;
  isYou: boolean;
}

export interface VentureView {
  id: string;
  phase: SimPhase;
  /** Seconds left in this phase, as the server counted them at the moment it answered. */
  secondsLeft: number;
  name: string | null;
  product: string | null;
  niche: { id: string; name?: string } | null;
  lobbySize: number;
  openRoles: string[];
  seats: SimSeat[];
  you: { role: string | null; isCeo: boolean };
}

// --- The clock -----------------------------------------------------------

/**
 * A reading of the server's clock, and when we took it.
 *
 * The phone never decides when a phase ends — it only interpolates between
 * readings, so a device with a wandering clock or a minute of background time
 * comes back to the server's answer on the next poll rather than to its own.
 */
export interface ClockAnchor {
  secondsLeft: number;
  /** Date.now() at the moment the response landed. */
  atMs: number;
}

/**
 * How long is left, `nowMs` after the anchor was taken.
 *
 * Elapsed time is clamped at zero so the displayed countdown can never run
 * *backwards* past its anchor — a device whose clock steps back mid-phase
 * would otherwise show the timer gaining seconds, which reads as a bug even
 * when the room is fine.
 */
export function remainingSeconds(anchor: ClockAnchor, nowMs: number): number {
  if (!Number.isFinite(anchor.secondsLeft)) return anchor.secondsLeft;
  const elapsed = Math.max(0, (nowMs - anchor.atMs) / 1000);
  return Math.max(0, anchor.secondsLeft - elapsed);
}

/** "2:05". Phases are minutes long, so there is never an hours component to lose. */
export function formatCountdown(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Under a minute the clock is a deadline rather than a fact, and should look like one. */
export const clockIsUrgent = (seconds: number): boolean => Number.isFinite(seconds) && seconds <= 60;

// --- What the room should say --------------------------------------------

export interface RoomCopy {
  /** The one line at the top of the room. */
  title: string;
  /** Why the clock is running and what happens when it stops. */
  body: string;
  /** What the countdown is counting down *to*. */
  deadline: string;
}

/**
 * The room in one sentence, for whoever is looking at it.
 *
 * Five people see five different versions of the same phase — the CEO is
 * being asked for a name while everyone else is waiting on them; the person
 * still without a seat is being warned, the person with one isn't. One
 * function so those versions can't drift apart, and so the wording is
 * testable without a renderer.
 */
export function phaseCopy(input: {
  phase: SimPhase;
  /** How many people are in the room right now. */
  here: number;
  lobbySize: number;
  /** The title of the seat you hold, if you hold one. */
  yourRoleTitle: string | null;
  isCeo: boolean;
  /** Who is naming the company, for everyone who isn't. */
  ceoName: string | null;
  companyName: string | null;
}): RoomCopy {
  const { phase, here, lobbySize, yourRoleTitle, isCeo, ceoName, companyName } = input;

  if (phase === "filling") {
    const missing = Math.max(0, lobbySize - here);
    return {
      title: missing === 0 ? "The room is full" : `Waiting for ${missing} more`,
      body:
        missing === 0
          ? "Everyone's here. Seats open in a moment."
          : `${here} of ${lobbySize} seats filled. Three is enough to start — if the clock runs out below that, the room is retired rather than left half-played.`,
      deadline: "until the room starts without the stragglers",
    };
  }

  if (phase === "claiming") {
    return {
      title: yourRoleTitle ? `You're the ${yourRoleTitle}` : "Pick a seat",
      body: yourRoleTitle
        ? "Swap while the clock runs — release yours and someone else can take it. Seats nobody claims get dealt out when time's up."
        : "Argue for the one you want. Whatever's still open when the clock stops gets dealt out for you, in join order, and you'll be told it was.",
      deadline: "before the remaining seats are dealt out",
    };
  }

  if (phase === "naming") {
    return {
      title: isCeo ? "Name the company" : `${ceoName ?? "Your chief executive"} is naming the company`,
      body: isCeo
        ? "Yours alone — a naming right four people can overrule isn't one. Say what it's called and what it sells. You can still change it in year one."
        : "Shout your suggestions. Only the chief executive can submit. If the clock beats them the company starts with a placeholder name, which they can fix in year one.",
      deadline: "before the company is named for you",
    };
  }

  if (phase === "running") {
    return {
      title: companyName ? `${companyName} is trading` : "Year one has begun",
      body: "The seats are settled and the first year is live. A day is a year; a season is fourteen of them.",
      deadline: "",
    };
  }

  return {
    title: "This room was retired",
    body: "Not enough people joined before the clock ran out. Nothing was lost — pick a market and start another.",
    deadline: "",
  };
}

/** How a seat reads in the list: chosen, dealt, or still undecided. */
export function seatStatus(seat: SimSeat, roleTitle: string | null): {
  label: string;
  /** Said out loud because being dealt a seat feels different from choosing one. */
  note: string | null;
  settled: boolean;
} {
  if (!seat.role) return { label: "Still choosing", note: null, settled: false };
  return {
    label: roleTitle ?? seat.role.toUpperCase(),
    note: seat.assigned ? "Dealt by the clock, not chosen" : null,
    settled: true,
  };
}

// --- Reading a market ----------------------------------------------------

/**
 * What a segment's loyalty means for a team that wants its customers.
 *
 * Loyalty is the number that decides whether a market is winnable, and "0.86"
 * tells a player nothing. Thresholds mirror how the resolver treats them:
 * below about 0.4 a segment is already halfway out of the door, above 0.8 it
 * takes years of consistency to move.
 */
export function loyaltyRead(loyalty: number): { label: string; hint: string; color: string } {
  if (loyalty >= 0.8) return { label: "Locked in", hint: "Years of consistency, or nothing.", color: colors.danger };
  if (loyalty >= 0.6) return { label: "Sticky", hint: "Winnable, slowly, by being better for a long time.", color: colors.warning };
  if (loyalty >= 0.4) return { label: "Persuadable", hint: "Moves for a real reason, and moves back just as easily.", color: colors.info };
  return { label: "On the rope", hint: "Already half out of the door. Your first customers.", color: colors.success };
}

/**
 * How each incumbent defends itself, in a line.
 *
 * Mirrors the postures in shared/simulation/incumbents.ts. The API sends the
 * posture id and not this copy, so it lives here — see the note at the top of
 * the file about what mobile can and can't import.
 */
export const POSTURE_COPY: Record<SimIncumbent["posture"], { label: string; hint: string }> = {
  fortress: { label: "Fortress", hint: "Would rather lose the fringe than cheapen itself." },
  brawler: { label: "Brawler", hint: "Follows you down in price and burns its own margin doing it." },
  coaster: { label: "Coaster", hint: "Coasting on a brand it stopped earning. The soft one." },
  innovator: { label: "Innovator", hint: "Keeps moving the product. Hard to out-build." },
};

/** What the incumbents hold between them, as a whole percentage. */
export const incumbentHold = (incumbents: SimIncumbent[]): number =>
  Math.round(incumbents.reduce((sum, i) => sum + i.share, 0) * 100);

/** "420k", "1.2m" — customer counts a person can compare at a glance. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 || Number.isInteger(m) ? Math.round(m) : m.toFixed(1)}m`;
  }
  if (n >= 1_000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

// --- The companies you are already running -------------------------------

/**
 * A venture you hold a seat in, as GET /api/sim/ventures lists it.
 *
 * Mirrors the payload built in server/simulation-routes.ts — the same
 * arrangement as everything else in this file, because Metro can't resolve
 * `@shared`. `secondsLeft` is null for a phase with no deadline (a running
 * season's year is ticked by the season, not the room).
 */
export interface LiveVenture {
  id: string;
  phase: SimPhase;
  name: string | null;
  /** The seat id — "ceo", "cfo" — not its title; titles come with /api/sim/niches. */
  role: string | null;
  niche: { id: string; name?: string } | null;
  secondsLeft: number | null;
}

/**
 * Where tapping a venture should land.
 *
 * The room and the desk are different screens, and sending somebody to the
 * wrong one is worse than not offering the link at all: the room for a
 * company that is already trading is a dead lobby, and the desk for a company
 * still picking seats has no year to show. `running` is the only phase with a
 * desk behind it.
 */
export const ventureRoute = (venture: Pick<LiveVenture, "id" | "phase">): string =>
  venture.phase === "running" ? `/sim/desk/${venture.id}` : `/sim/${venture.id}`;

/**
 * The ventures worth offering a way back into.
 *
 * The server already leaves retired rooms out, and this filters them again:
 * a retired room is a room that ended before it started, and a "resume"
 * pointing at one is an invitation to a screen that can only say no. Cheap
 * insurance against a build of the server that stops filtering.
 */
export const liveVentures = (ventures: LiveVenture[] | undefined): LiveVenture[] =>
  (ventures ?? []).filter((v) => v.phase !== "retired");

/** The company's name, or the stand-in for one that hasn't been named yet. */
export const ventureTitle = (venture: Pick<LiveVenture, "name">): string =>
  venture.name?.trim() || "Your company";

/**
 * The line under the name: where the company trades, and what you hold there.
 *
 * `roleTitle` comes from /api/sim/niches when it has loaded; the seat id in
 * capitals is the fallback, because a row that says "Bookkeeping software"
 * and nothing else is a row that doesn't tell you it's yours.
 */
export function ventureSubtitle(
  venture: Pick<LiveVenture, "role" | "niche">,
  roleTitle?: string | null,
): string {
  const market = venture.niche?.name ?? venture.niche?.id ?? "A market";
  if (!venture.role) return `${market} · seat not settled yet`;
  return `${market} · you're the ${roleTitle ?? venture.role.toUpperCase()}`;
}

/** What tapping the row does, said out loud, because the two land differently. */
export const ventureAction = (venture: Pick<LiveVenture, "phase">): string =>
  venture.phase === "running" ? "Open your desk" : "Back to the room";
