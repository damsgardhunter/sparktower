/**
 * A person's track record, from the games they have actually played.
 *
 * This is what a company reads when it is deciding whether to approach
 * somebody, so the rule is strict: every number and every sentence here is
 * counted from rows in the database. Nothing is estimated, extrapolated or
 * flattered. A person with one season has a record of one season, and it says
 * so; a person with none has an empty record rather than a made-up one.
 *
 * Pure: the server gathers the plays (see server/talent-routes.ts) and this
 * turns them into the record, so the arithmetic can be tested without a
 * database and reads the same wherever it is shown.
 *
 * Private training seasons a company runs for its own people are left out
 * before anything reaches this file. What somebody did in their employer's
 * workshop is between them and that employer.
 */
import { ROLES, ROLE_TITLES, type Role } from "./simulation/types";

/** One seat in one public season, as the loader found it. */
export interface SeatPlay {
  seasonId: string;
  seasonName: string;
  nicheName: string | null;
  /** Only finished seasons count as a finish; a running one is still a standing. */
  seasonStatus: "forming" | "running" | "finished" | "abandoned";
  /** ceo | cmo | cfo | cto | coo, or null if they never took a seat. */
  role: string | null;
  /** Years the engine resolved for this company. */
  yearsPlayed: number;
  /** Of those years, how many this person filed a decision for. */
  yearsFiled: number;
  /** Where the company stood after its last resolved year, 1 is best. */
  rank: number | null;
  /** How many companies were in that market that year, incumbents included. */
  fieldSize: number | null;
  objectives: { met: number; partial: number; missed: number };
}

/** One startup game with a real verdict. Fallback verdicts never reach here. */
export interface GamePlay {
  overall: number;
}

export interface SeatCount {
  role: Role;
  title: string;
  count: number;
}

export interface Finish {
  rank: number;
  of: number;
  role: Role | null;
  seasonName: string;
}

export interface TrackRecordSummary {
  /** Seasons in which at least one year was resolved with them in it. */
  seasonsPlayed: number;
  seats: SeatCount[];
  yearsPlayed: number;
  yearsFiled: number;
  /** yearsFiled ÷ yearsPlayed, 0–1. Null when there is nothing to divide. */
  turnout: number | null;
  objectives: { met: number; partial: number; missed: number; total: number; metRate: number | null };
  /** Finished seasons only. */
  finishes: number;
  bestFinish: Finish | null;
  /** 0–100: 100 is first every time, 0 last every time. Null without a finish. */
  averagePercentile: number | null;
  startupGames: { scored: number; average: number | null; best: number | null };
  strengths: string[];
  /** For ordering a search, not for showing: see `strengthScore`. */
  score: number;
  /** True when there is nothing at all on record. */
  empty: boolean;
}

export interface SeasonLine {
  seasonName: string;
  nicheName: string | null;
  status: SeatPlay["seasonStatus"];
  role: Role | null;
  roleTitle: string | null;
  yearsPlayed: number;
  yearsFiled: number;
  rank: number | null;
  of: number | null;
  objectives: { met: number; partial: number; missed: number };
}

export interface TrackRecord extends TrackRecordSummary {
  /** Season by season, most recent first as the loader ordered them. */
  seasons: SeasonLine[];
}

/** What a person can say they would take on — the talent profile's suggestions. */
export const TALENT_ROLES = [
  "general management", "operations", "finance", "marketing", "sales", "product", "technology",
] as const;

/**
 * The simulation seat that is closest to each talent role.
 *
 * Used so that a company searching for "finance" also finds somebody who has
 * sat as CFO and did not think to tick the box — a seat held is evidence, and
 * it would be odd for the search to ignore it.
 */
export const ROLE_FOR_SEAT: Record<Role, string> = {
  ceo: "general management",
  cfo: "finance",
  cmo: "marketing",
  cto: "technology",
  coo: "operations",
};

const isRole = (r: string | null): r is Role => !!r && (ROLES as readonly string[]).includes(r);

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** Where a finish sits in its field, 0–1, 1 being first. A field of one says nothing, so it is left out. */
function percentileOf(rank: number, of: number): number | null {
  if (of < 2 || rank < 1 || rank > of) return null;
  return (of - rank) / (of - 1);
}

/**
 * One number to order a search by.
 *
 * It rewards the things a company would weigh: how well they finished, how
 * reliably they turned up, how often they did what they set out to do, and a
 * little for simply having played more. Each part is scaled by how much
 * evidence is behind it, so one lucky season does not outrank five solid
 * ones. It is never shown — a single score for a person invites exactly the
 * wrong kind of reading — only used to decide who appears first.
 */
export function strengthScore(r: Omit<TrackRecordSummary, "score" | "strengths" | "empty">): number {
  const confidence = (n: number, full: number) => Math.min(1, n / full);
  const finish = (r.averagePercentile ?? 0) * confidence(r.finishes, 3);
  const turnout = (r.turnout ?? 0) * 100 * confidence(r.yearsPlayed, 10);
  const objectives = (r.objectives.metRate ?? 0) * 100 * confidence(r.objectives.total, 10);
  const games = ((r.startupGames.average ?? 0) / 10) * confidence(r.startupGames.scored, 3);
  const experience = Math.min(r.seasonsPlayed, 5) * 4;
  return Math.round(finish * 0.35 + turnout * 0.25 + objectives * 0.2 + games * 0.1 + experience * 0.5);
}

/**
 * A few plain sentences about what the record shows.
 *
 * Each one is a threshold over counted data, and each says the count, so a
 * reader can check it against the numbers beside it. Nothing about character,
 * nothing inferred: "files every year" is a statement about rows, not about
 * whether somebody is diligent.
 */
export function strengthsOf(plays: SeatPlay[], r: Omit<TrackRecordSummary, "score" | "strengths" | "empty">): string[] {
  const out: string[] = [];

  if (r.yearsPlayed >= 3 && r.yearsFiled === r.yearsPlayed) {
    out.push(`Files every year (${r.yearsFiled} of ${r.yearsPlayed})`);
  } else if (r.yearsPlayed >= 5 && r.turnout !== null && r.turnout >= 0.9) {
    out.push(`Rarely misses a year (${r.yearsFiled} of ${r.yearsPlayed} filed)`);
  }

  // Wins first, because a win is the stronger statement and would otherwise be said twice.
  const finished = plays.filter((p) => p.seasonStatus === "finished" && p.rank !== null && p.fieldSize !== null);
  const wins = finished.filter((p) => p.rank === 1);
  if (wins.length > 0) out.push(`Won ${wins.length === 1 ? "a season" : `${wins.length} seasons`}`);

  // Top three only means something in a field bigger than three.
  const podiumByRole = new Map<Role, number>();
  for (const p of finished) {
    if (!isRole(p.role) || p.rank! > 3 || p.fieldSize! < 5 || p.rank === 1) continue;
    podiumByRole.set(p.role, (podiumByRole.get(p.role) ?? 0) + 1);
  }
  for (const [role, count] of [...podiumByRole.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`Finished top 3 ${times(count)} as ${ROLE_TITLES[role]}`);
  }

  if (r.objectives.total >= 5 && r.objectives.metRate !== null && r.objectives.metRate >= 0.6) {
    out.push(`Met ${r.objectives.met} of ${r.objectives.total} yearly objectives`);
  }

  if (r.seats.length >= 3) out.push(`Has held ${r.seats.length} different seats`);

  if (r.startupGames.best !== null && r.startupGames.best >= 700) {
    out.push(`Scored ${r.startupGames.best} out of 1000 in the startup game`);
  }

  return out.slice(0, 5);
}

/** The record, from the plays. */
export function buildTrackRecord(plays: SeatPlay[], games: GamePlay[]): TrackRecord {
  // A seat in a season where no year ever resolved is a lobby, not a season.
  const played = plays.filter((p) => p.yearsPlayed > 0);

  const seatCounts = new Map<Role, number>();
  for (const p of played) if (isRole(p.role)) seatCounts.set(p.role, (seatCounts.get(p.role) ?? 0) + 1);
  const seats: SeatCount[] = ROLES.filter((r) => seatCounts.has(r)).map((r) => ({ role: r, title: ROLE_TITLES[r], count: seatCounts.get(r)! }));

  const yearsPlayed = played.reduce((s, p) => s + p.yearsPlayed, 0);
  // Never more filed than played: a decision for a year that has not resolved yet is not turnout.
  const yearsFiled = played.reduce((s, p) => s + Math.min(p.yearsFiled, p.yearsPlayed), 0);

  const met = played.reduce((s, p) => s + p.objectives.met, 0);
  const partial = played.reduce((s, p) => s + p.objectives.partial, 0);
  const missed = played.reduce((s, p) => s + p.objectives.missed, 0);
  const total = met + partial + missed;

  const finishes: Finish[] = played
    .filter((p) => p.seasonStatus === "finished" && p.rank !== null && p.fieldSize !== null && p.rank >= 1)
    .map((p) => ({ rank: p.rank!, of: p.fieldSize!, role: isRole(p.role) ? p.role : null, seasonName: p.seasonName }));
  // Best is the highest place; between two firsts, the bigger field.
  const bestFinish = [...finishes].sort((a, b) => a.rank - b.rank || b.of - a.of)[0] ?? null;
  const percentiles = finishes.map((f) => percentileOf(f.rank, f.of)).filter((x): x is number => x !== null);

  const scores = games.map((g) => g.overall);

  const base = {
    seasonsPlayed: new Set(played.map((p) => p.seasonId)).size,
    seats,
    yearsPlayed,
    yearsFiled,
    turnout: yearsPlayed > 0 ? yearsFiled / yearsPlayed : null,
    objectives: { met, partial, missed, total, metRate: total > 0 ? met / total : null },
    finishes: finishes.length,
    bestFinish,
    averagePercentile: percentiles.length ? Math.round((percentiles.reduce((s, x) => s + x, 0) / percentiles.length) * 100) : null,
    startupGames: {
      scored: scores.length,
      average: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
      best: scores.length ? Math.max(...scores) : null,
    },
  };

  return {
    ...base,
    strengths: strengthsOf(played, base),
    score: strengthScore(base),
    empty: played.length === 0 && scores.length === 0,
    seasons: played.map((p) => ({
      seasonName: p.seasonName,
      nicheName: p.nicheName,
      status: p.seasonStatus,
      role: isRole(p.role) ? p.role : null,
      roleTitle: isRole(p.role) ? ROLE_TITLES[p.role] : null,
      yearsPlayed: p.yearsPlayed,
      yearsFiled: Math.min(p.yearsFiled, p.yearsPlayed),
      rank: p.rank,
      of: p.fieldSize,
      objectives: p.objectives,
    })),
  };
}

/** The summary, for a list: everything but the season-by-season lines. */
export function summaryOf(record: TrackRecord): TrackRecordSummary {
  const { seasons: _seasons, ...summary } = record;
  return summary;
}
