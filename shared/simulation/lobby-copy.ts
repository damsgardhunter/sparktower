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
        : "Five people run a company between them. You can start with three if nobody else arrives.",
      deadline: "If there are at least three of you when the clock runs out, you start anyway.",
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
        ? "Yours to decide, and yours to be held to. Say what you sell while you're here."
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
