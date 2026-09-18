/**
 * Where everyone stands, and how this season has gone.
 *
 * Mirrors the response of GET /api/sim/ventures/:id/standings in
 * server/simulation-market-routes.ts, restated here rather than imported for
 * the reason desk.ts gives at length — Metro cannot resolve the web app's
 * `@shared` alias — with the source named above anything copied.
 *
 * ## Two rules the arithmetic in here is written around
 *
 * **The incumbents are in the table.** They hold most of the market, and a
 * league table that quietly listed only the five player teams would tell
 * everybody they were doing far better than they are. Fourth of nine is the
 * honest position, and the honest position is the only one worth showing on a
 * screen whose entire job is answering "was that a good year?".
 *
 * **A rank is not a score.** One place is a handful of customers on a market
 * this crowded, so nothing here dramatises movement: the trajectory is drawn
 * from share, which is the thing that actually moved, and the rank is stated
 * beside it rather than made the headline.
 */

/** Mirrors Distress in shared/simulation/recovery.ts, via the desk's copy of it. */
import type { Distress } from "./desk";
import type { SeasonStatus } from "./lobby";

/** One row of the league table. Incumbents and teams together, on purpose. */
export interface StandingRow {
  id: string;
  name: string;
  kind: "player" | "incumbent";
  customers: number;
  /** A 0–1 fraction of every customer in the market. */
  share: number;
  revenue: number;
  reputation: number;
  price: number;
  isYou: boolean;
  /** Only ever set for teams; the incumbents' books are nobody's business. */
  distress: Distress | null;
  rank: number;
}

/** One year of your own company's story. */
export interface HistoryPoint {
  year: number;
  /** A 0–1 fraction, as `marketShare` on the report. */
  share: number;
  customers: number;
  profit: number;
  rank: number;
}

export interface StandingsView {
  year: number;
  totalYears: number;
  /** The season's own status. A finished one is a final table. */
  status: SeasonStatus | string;
  rows: StandingRow[];
  /** Your company, year by year. Empty before the first year resolves. */
  history: HistoryPoint[];
}

/**
 * A share, at the precision the number deserves.
 *
 * One decimal place everywhere except the very bottom of the table, where a
 * team with a tenth of a per cent and a team with a fiftieth both round to
 * "0.1%" and look identical. "<0.1%" is the honest reading of a position that
 * small, and a flat zero is reserved for actually zero — which, in a season
 * where somebody has just sold their business, is a real row and not an error.
 */
export function shareRead(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return "0%";
  const pct = share * 100;
  if (pct < 0.1) return "<0.1%";
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  return `${pct.toFixed(1)}%`;
}

/**
 * The table in the order it is read.
 *
 * The server already sorts and ranks; this sorts again by the rank it sent,
 * because a screen that renders rows in whatever order they arrived in is one
 * response shape away from a league table that lies. Ties fall back to
 * customers, and then to the name, so two identical rows never swap places
 * between polls.
 */
export function sortRows(rows: StandingRow[] | undefined): StandingRow[] {
  return [...(rows ?? [])].sort((a, b) => {
    const ra = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
    const rb = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    if (b.customers !== a.customers) return b.customers - a.customers;
    return a.name.localeCompare(b.name);
  });
}

/** Your own row, which every other reading on the screen is relative to. */
export const yourRow = (rows: StandingRow[] | undefined): StandingRow | null =>
  (rows ?? []).find((r) => r.isYou) ?? null;

/** 1 → "1st". Ordinals rather than "#4", which reads as an identifier. */
export function ordinal(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const i = Math.round(n);
  const mod100 = Math.abs(i) % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${i}th`;
  switch (Math.abs(i) % 10) {
    case 1: return `${i}st`;
    case 2: return `${i}nd`;
    case 3: return `${i}rd`;
    default: return `${i}th`;
  }
}

/**
 * "4th of 9, and 2nd of the 5 teams."
 *
 * Both numbers, always. The first is the true position in the market and the
 * second is the one the five of them actually care about, and giving only one
 * of them is how a screen either flatters a team or buries them — depending on
 * which one you picked.
 */
export function standingLine(rows: StandingRow[] | undefined): string | null {
  const all = sortRows(rows);
  const you = yourRow(all);
  if (!you) return null;

  const teams = all.filter((r) => r.kind === "player");
  const amongTeams = teams.findIndex((r) => r.isYou) + 1;

  const overall = `${ordinal(you.rank)} of ${all.length} in the market`;
  if (teams.length <= 1 || amongTeams === 0) return `${overall}.`;
  return `${overall}, ${ordinal(amongTeams)} of the ${teams.length} teams.`;
}

/**
 * The company immediately ahead, and how far ahead they are.
 *
 * The single most actionable sentence on a league table: a gap of four
 * thousand customers is a year's work and a gap of four hundred thousand is a
 * different strategy, and the rank alone says neither.
 */
export function gapAhead(rows: StandingRow[] | undefined): { name: string; customers: number; line: string } | null {
  const all = sortRows(rows);
  const index = all.findIndex((r) => r.isYou);
  if (index <= 0) return null;
  const ahead = all[index - 1];
  const gap = Math.max(0, ahead.customers - all[index].customers);
  return {
    name: ahead.name,
    customers: gap,
    line: gap === 0
      ? `Level with ${ahead.name}, who are ahead on the tiebreak.`
      : `${gap.toLocaleString()} customers behind ${ahead.name}.`,
  };
}

/** One bar of the season's trajectory. */
export interface TrajectoryPoint extends HistoryPoint {
  /** 0–1, for the height of the bar. Scaled to the best year, not to the market. */
  height: number;
  /** The best year so far, drawn full height so the shape has a top. */
  peak: boolean;
  profitable: boolean;
}

/**
 * The season as a shape.
 *
 * Scaled to the company's own best year rather than to 100% of the market,
 * which is the choice that makes this readable at all: a team holding four per
 * cent of a market against nine rivals would otherwise get four flat lines and
 * no story. The absolute figures are printed beside the bars, so the scaling
 * exaggerates nothing that isn't labelled.
 *
 * A floor of 6% keeps a zero year visible as a year rather than as a gap —
 * somebody who sold the business has a genuine zero in the middle of their
 * season and it should read as "the year I cashed out", not as missing data.
 */
export function trajectory(history: HistoryPoint[] | undefined): TrajectoryPoint[] {
  const points = [...(history ?? [])].sort((a, b) => a.year - b.year);
  const shares = points.map((p) => (Number.isFinite(p.share) ? Math.max(0, p.share) : 0));
  const best = shares.reduce((max, s) => Math.max(max, s), 0);

  return points.map((point, i) => {
    const share = shares[i];
    const fraction = best > 0 ? share / best : 0;
    return {
      ...point,
      height: Math.max(0.06, Math.min(1, fraction)),
      peak: best > 0 && share === best,
      profitable: Number.isFinite(point.profit) && point.profit > 0,
    };
  });
}

/**
 * Whether the last year was a good one, in the two terms that disagree.
 *
 * Share and rank move independently — a team can gain customers and still slip
 * a place because somebody else gained more — and the interesting years are
 * exactly the ones where they disagree. So both are reported, and neither is
 * collapsed into a verdict.
 */
export function movementRead(history: HistoryPoint[] | undefined): string | null {
  const points = [...(history ?? [])].sort((a, b) => a.year - b.year);
  if (points.length === 0) return null;
  if (points.length === 1) {
    return `First year on the board: ${shareRead(points[0].share)} of the market, ${ordinal(points[0].rank)}.`;
  }

  const last = points[points.length - 1];
  const before = points[points.length - 2];
  const pp = (last.share - before.share) * 100;
  const places = before.rank - last.rank;

  const shareBit = Math.abs(pp) < 0.05
    ? "Share held about level"
    : `Share ${pp > 0 ? "up" : "down"} ${Math.abs(pp).toFixed(1)} points`;
  const rankBit = places === 0
    ? `and you held ${ordinal(last.rank)}`
    : places > 0
      ? `and you climbed ${places === 1 ? "a place" : `${places} places`} to ${ordinal(last.rank)}`
      : `and you slipped ${places === -1 ? "a place" : `${Math.abs(places)} places`} to ${ordinal(last.rank)}`;

  return `${shareBit} ${rankBit}.`;
}

/** A company with no customers has sold the business — the one row that needs saying. */
export const soldUp = (row: StandingRow): boolean => row.kind === "player" && row.customers === 0;

/** What reputation means, since it decides what a company can borrow. */
export function reputationRead(reputation: number): string {
  if (!Number.isFinite(reputation)) return "—";
  if (reputation >= 75) return "Trusted";
  if (reputation >= 55) return "Solid";
  if (reputation >= 40) return "Mixed";
  if (reputation >= 25) return "Shaky";
  return "Poor";
}
