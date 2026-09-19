/**
 * What the lobby says, and how long it says is left.
 *
 * Pulled out of the screens because both the web and the phone show the same
 * room, and a phase that reads "waiting for players" in one place and "the
 * argument is on" in the other is two products. It is also the part worth
 * testing: a countdown that formats 61 seconds as "1m 1s" and 60 as "1m 0s" is
 * the kind of thing nobody notices until it is on everyone's screen.
 */
import type { Phase } from "./lobby";
import type { Role } from "./types";

/** "2:05", "0:09". Minutes and seconds, because a lobby phase is never hours. */
export function countdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * A wait measured in hours or days rather than minutes.
 *
 * `countdown` above is right for a lobby phase, where nothing lasts longer
 * than fifteen minutes, and wrong for a year, which lasts a day: it rendered
 * the desk's deadline as "2878:46", a number that is technically minutes and
 * seconds and means nothing at all to the person reading it. Anything past an
 * hour needs its units spelled out.
 */
export function longCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;

  const minutes = Math.floor(safe / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  // Under an hour it is a countdown people watch, so seconds still matter.
  if (hours < 1) return countdown(safe);
  if (days < 1) return `${hours}h ${minutes % 60}m`;
  return `${days}d ${hours % 24}h`;
}

export interface PhaseCopy {
  /** The heading: where the room is. */
  title: string;
  /** What the person reading it should do, or wait for. */
  body: string;
  /** What the clock running out will do — a deadline with no stated consequence is just pressure. */
  deadline: string;
}

export function phaseCopy(input: {
  phase: Phase;
  seated: number;
  lobbySize: number;
  yourRole: Role | null;
  isCeo: boolean;
  named: boolean;
}): PhaseCopy {
  const { phase, seated, lobbySize, yourRole, isCeo, named } = input;

  if (phase === "filling") {
    const missing = Math.max(0, lobbySize - seated);
    return {
      title: missing === 0 ? "Room full" : `Waiting for ${missing} more`,
      body: missing === 0
        ? "Everyone's here. Seats next."
        : "Five people run a company between them. If nobody else turns up in the next minute, the empty seats are taken by players we run, so you are never left waiting on strangers.",
      deadline: "A room that has been waiting a minute fills itself, and it starts either way when the clock runs out.",
    };
  }

  if (phase === "claiming") {
    return {
      title: yourRole ? "You have a seat" : "Take a seat",
      body: yourRole
        ? "You can still swap while the clock is running. Talk it out — the seats you leave empty get dealt out at random."
        : "One person per seat, first to claim it. Argue about it; that is the point of this bit.",
      deadline: "When the clock runs out, whatever is left is dealt out to whoever hasn't chosen.",
    };
  }

  if (phase === "naming") {
    return {
      title: isCeo ? "Name the company" : "The chief executive is naming the company",
      body: isCeo
        ? "Yours to decide, and yours to be held to. A name is all this asks for — what the company actually sells is the next ten years of arguing."
        : "Naming rights belong to the chief executive. Shout your suggestions at them — this is the last quiet moment you get.",
      deadline: isCeo
        ? "If the clock beats you, the company starts under a placeholder and you can rename it in year one."
        : "If they don't name it in time, the company starts under a placeholder.",
    };
  }

  if (phase === "running") {
    return {
      title: named ? "Year one has begun" : "Year one has begun, unnamed",
      body: "Fourteen days, fourteen years. Each of you decides your own part of the year, and the market resolves at the end of every day.",
      deadline: "",
    };
  }

  return {
    title: "This room closed",
    body: "Not enough people arrived in time. Join a market again and you'll land in a new room.",
    deadline: "",
  };
}

/** How urgent the clock looks. Under thirty seconds a countdown should feel different. */
export const urgency = (seconds: number): "calm" | "soon" | "now" =>
  seconds > 60 ? "calm" : seconds > 20 ? "soon" : "now";
