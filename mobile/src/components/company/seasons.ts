/**
 * What a company's training season is, for the phone.
 *
 * The payload shapes of `server/company-season-routes.ts`, plus the few numbers
 * that file exports and the phone has to state before somebody fills a form in.
 * `test/unit/company-seasons-on-the-phone.test.ts` holds the numbers against
 * the server's.
 *
 * The cadence vocabulary is not restated here — `components/sim/period.ts`
 * already has it, held to `shared/simulation/cadence.ts` by its own test, and a
 * second copy of "quarter" would be one copy too many.
 */
import type { Cadence } from "../sim/period";

/** server/company-season-routes.ts. A seat to play ours, or one Nova builds. */
export const SEAT_PRICE_CENTS = { play: 300, nova: 600, quarterly: 600, monthly: 600 } as const;
export type SeatKind = keyof typeof SEAT_PRICE_CENTS;
export const SEAT_KINDS = Object.keys(SEAT_PRICE_CENTS) as SeatKind[];

export const PERIOD_MINUTES_MIN = 10;
export const PERIOD_MINUTES_MAX = 1440;
export const BOT_TEAMS_MAX = 50;

/** A table of five, or a table each — the server's `mode`. */
export const SEASON_MODES = ["team", "solo"] as const;
export type SeasonMode = (typeof SEASON_MODES)[number];

export interface SeasonRow {
  id: string;
  name: string;
  status: string;
  niche: { id: string | null; name: string | null };
  year: number;
  totalYears: number;
  totalPeriods: number;
  periodMinutes: number | null;
  cadence: Cadence | null;
  nextTickAt: string | null;
  rooms: number;
  roomsReady: number;
  players: number;
  bots: number;
  origin: string | null;
  seatKind: SeatKind;
  inviteCode: string | null;
  joinUrl: string | null;
  myVentureId: string | null;
  createdAt: string;
}

export interface SeatsView {
  people: number;
  currency: string;
  seats: { kind: SeatKind; paid: number; pricePerSeat: number; shortBy: number }[];
}

export interface Chair {
  userId: string;
  name: string;
  isBot: boolean;
  role: string | null;
  roleTitle: string | null;
  filed: boolean;
  decision: unknown | null;
}

export interface WatchTable {
  ventureId: string;
  name: string | null;
  product: string | null;
  phase: string;
  empty: number;
  filed: number;
  of: number;
  waitingOn: string[];
  chairs: Chair[];
}

export interface ReportPlayer {
  userId: string;
  name: string;
  avatarUrl: string | null;
  roleTitle: string | null;
  ventureId: string;
  teamName: string | null;
  yearsFiled: number;
  yearsPlayed: number;
  rank: number | null;
  companiesInMarket: number | null;
  marketShare: number | null;
  founderValue: number | null;
  profit: number | null;
  read: string;
}

export interface StaffReport {
  season: { id: string; name: string; status: string; year: number; totalYears: number; yearsResolved: number; niche: { id: string | null; name: string | null } };
  players: ReportPlayer[];
  notPlaying: { userId: string; name: string }[];
}

/** Whether a season can still be started — the button's own condition. */
export const canStart = (s: SeasonRow) => s.status === "lobby" || s.status === "draft";

/**
 * Which of the three states a row is in, as a word and a tone.
 *
 * The server's `status` is the truth; this only decides how to show it, and is
 * here rather than inline so the list and the sheet agree.
 */
export function seasonTone(status: string): "good" | "warn" | "neutral" {
  if (status === "running") return "good";
  if (status === "lobby" || status === "draft") return "warn";
  return "neutral";
}
