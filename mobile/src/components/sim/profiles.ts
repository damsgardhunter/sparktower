/**
 * The two profiles the phone could not open.
 *
 * `GET /api/sim/ventures/:id/seats/:userId` and
 * `.../companies/:companyId` have been serving the web for a while. The phone had
 * neither, which left two gaps a player would actually feel: no way to see
 * whether the colleague you are waiting on has been turning up all season, and no
 * way to read a rival before deciding what to do about them.
 *
 * Types only, and deliberately: the screens are routes under `app/sim/` so they
 * are URL-addressable — the in-app browser fallback could not reach a modal, and
 * a link in a notification has to land somewhere.
 */
import type { DeskRole } from "./desk";

export interface SeatView {
  userId: string;
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  isBot: boolean;
  isYou: boolean;
  role: DeskRole | null;
  title: string | null;
  /** What this chair decides, in the words the lobby uses. */
  levers: string[];
  filed: boolean;
  decision: Record<string, unknown> | null;
  filedAt: string | null;
  /** How often they have filed, and how often they have not. */
  turnout: { filed: number; of: number; missedRunning: number };
  challenges: { year: number; title: string | null; brief: string | null; met: boolean | null }[];
  niche: { id: string; name: string; voice: Record<string, string> } | null;
}

export interface RivalCompanyView {
  id: string;
  name: string;
  kind: "player" | "incumbent" | string;
  product: string | null;
  roster: { role: string; title: string | null; name: string | null; isBot?: boolean }[];
  persona: { tagline?: string; boss?: string; character?: string; known?: string; knock?: string } | null;
  posture: string | null;
  posturedAs: string | null;
  voice: Record<string, string>;
  standing: Record<string, number | null>;
  /** Segments both companies are selling into, and who is ahead on price. */
  contested: { id?: string; name?: string; edge?: "them" | "you" }[];
  history: { year: number; share: number; shareChange: number; customers: number; note: string | null }[];
  /** Plain readings of the numbers above — the server does the arithmetic. */
  reads: string[];
}

/**
 * How reliable a seat has been, in one line.
 *
 * `missedRunning` is the run of periods they have missed *now*, which is a
 * different thing from how many they have missed in total: somebody who missed
 * three early and has filed every period since is not the problem that somebody
 * who has missed the last three is.
 */
export function turnoutRead(t: SeatView["turnout"] | undefined): string {
  if (!t || t.of <= 0) return "Nothing to go on yet.";
  if (t.missedRunning >= 2) {
    return `Filed ${t.filed} of ${t.of}, and has missed the last ${t.missedRunning}.`;
  }
  if (t.filed >= t.of) return `Has filed every period so far — ${t.filed} of ${t.of}.`;
  return `Filed ${t.filed} of ${t.of}.`;
}
