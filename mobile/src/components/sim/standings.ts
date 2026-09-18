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
 *
 * **The table is ordered by what the founders own, not by customers.** Volume
 * used to be the only way to climb, which quietly made every team play the
 * same game and told the smallest, most profitable company in the market that
 * it was losing. `founderValue` is what the business is worth times the share
 * the five of them still hold — so a team can lose ground by growing, if it
 * sold a third of itself to do it, and that trade is the point.
 */

/** Mirrors Distress in shared/simulation/recovery.ts, via the desk's copy of it. */
import type { Distress } from "./desk";
import type { SeasonStatus } from "./lobby";

/** One row of the league table. Incumbents and teams together, on purpose. */
export interface StandingRow {
  id: string;
  name: string;
  kind: "player" | "incumbent";
  /**
   * What the founders' share of the business is worth, and the order of the
   * table.
   *
   * Mirrors the `worth()` sum in GET /api/sim/ventures/:id/standings: a bit
   * over a year of sales, plus what the company owns, less what it owes, times
   * the share the founders still hold. Ranking by customers made volume the
   * only strategy worth playing and told a small, highly profitable team it
   * was losing every day of the season.
   */
  founderValue: number;
  /** 0-1, the half of that number a team can lose without losing a customer. */
  founderShare: number;
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
  /**
   * What the founders owned at the end of that year, and what the rank beside
   * it was decided by.
   *
   * Null on years written before the scoreboard changed — a real state, and
   * the reason the chart can still fall back to share.
   */
  founderValue?: number | null;
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
    // The tiebreak follows what the server ranked by, so a table with two rows
    // at the same rank still reads in the order the scoreboard means.
    if ((b.founderValue ?? 0) !== (a.founderValue ?? 0)) return (b.founderValue ?? 0) - (a.founderValue ?? 0);
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

/**
 * The company immediately ahead, in the terms the table is actually ordered by.
 *
 * `gapAhead` answers "how many more customers", which is still a true and
 * useful sentence — it is just no longer the question the ranking asks. This
 * one answers the ranking's question, and the two disagreeing is the most
 * informative thing this screen can say: being a hundred thousand customers
 * behind and four million of value ahead is a strategy working.
 */
export function valueGapAhead(rows: StandingRow[] | undefined): { name: string; value: number; line: string } | null {
  const all = sortRows(rows);
  const index = all.findIndex((r) => r.isYou);
  if (index <= 0) return null;
  const ahead = all[index - 1];
  const gap = Math.max(0, (ahead.founderValue ?? 0) - (all[index].founderValue ?? 0));
  return {
    name: ahead.name,
    value: gap,
    line: gap === 0
      ? `Level with ${ahead.name} on what the founders own, and behind on the tiebreak.`
      : `${gap.toLocaleString()} of founder-owned value behind ${ahead.name}.`,
  };
}

/** What the whole business is worth, before the founders' share of it. */
export const wholeValue = (row: StandingRow): number =>
  row.founderShare > 0 ? Math.round((row.founderValue ?? 0) / row.founderShare) : (row.founderValue ?? 0);

/** What the part the founders no longer own is worth. The price of every raise, in one number. */
export const soldAway = (row: StandingRow): number =>
  Math.max(0, wholeValue(row) - (row.founderValue ?? 0));

/**
 * One row's ownership, said as the trade it is.
 *
 * Full ownership gets no sentence at all — "the founders own all of it" is the
 * unremarkable case and a line saying so on every undiluted row would train
 * people to skip the ones where it matters.
 */
export function ownershipRead(row: StandingRow): string | null {
  if (!Number.isFinite(row.founderShare) || row.founderShare >= 0.999) return null;
  const pct = row.founderShare * 100;
  const shown = pct < 1 ? pct.toFixed(1) : String(Math.round(pct));
  return `Founders hold ${shown}% of a ${wholeValue(row).toLocaleString()} business.`;
}

/**
 * The sentence that explains the whole scoreboard, when the market has earned it.
 *
 * Whenever the largest company by customers is not the one at the top, the
 * table is making the argument for itself — and naming the two companies is
 * worth more than any amount of explaining what `founderValue` means. Null
 * when they are the same company, because then there is nothing to explain and
 * an evergreen caption would just be noise.
 */
export function biggestNotBest(rows: StandingRow[] | undefined): string | null {
  const all = sortRows(rows);
  if (all.length < 2) return null;
  const biggest = all.reduce((best, row) => (row.customers > best.customers ? row : best), all[0]);
  const top = all[0];
  if (biggest.id === top.id || biggest.customers <= 0) return null;
  return `${biggest.name} has the most customers and ${top.name} is top of the table: ${top.name} owns more of what it built. Owning less of a bigger company is worth less than owning all of a smaller one.`;
}

/** One bar of the season's trajectory. */
export interface TrajectoryPoint extends HistoryPoint {
  /** 0–1, for the height of the bar. Scaled to the best year, not to the market. */
  height: number;
  /** The best year so far, drawn full height so the shape has a top. */
  peak: boolean;
  profitable: boolean;
  /**
   * What the bars are drawn from, so the caption can say so.
   *
   * "value" whenever every year carries a founder value, which makes the shape
   * agree with the rank printed under it. "share" is the fallback for a season
   * with years from before the scoreboard changed — and a chart that silently
   * mixed the two would be the one lie this screen cannot afford.
   */
  basis: "value" | "share";
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

  /*
   * Drawn in the terms the season is actually scored in, when every year can
   * be. The rank under each bar is decided by founder-owned value, and a chart
   * shaped by share beside it would show a year rising while the place beneath
   * it fell, with nothing on the screen explaining the contradiction. One year
   * missing the figure — a report written before the change — drops the whole
   * chart back to share rather than drawing half a season in each unit.
   */
  const hasValue = points.length > 0
    && points.every((p) => p.founderValue != null && Number.isFinite(p.founderValue));
  const basis: "value" | "share" = hasValue ? "value" : "share";

  const values = points.map((p) => (hasValue
    ? Math.max(0, p.founderValue as number)
    : Number.isFinite(p.share) ? Math.max(0, p.share) : 0));
  const best = values.reduce((max, v) => Math.max(max, v), 0);

  return points.map((point, i) => {
    const value = values[i];
    const fraction = best > 0 ? value / best : 0;
    return {
      ...point,
      height: Math.max(0.06, Math.min(1, fraction)),
      peak: best > 0 && value === best,
      profitable: Number.isFinite(point.profit) && point.profit > 0,
      basis,
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
