/**
 * A contest whose winner the product works out for itself.
 *
 * The ordinary kind is judged: entrants file a link and a person reads them.
 * This is the other kind — `contests.scoredBy` names a game, and the standings
 * are each entrant's best result from it. The first one is Ten Years From Now,
 * ranked on the ten-year valuation.
 *
 * ## Why this is a query and not a column
 *
 * The obvious build is a `best_score` on `contest_participants`, written when a
 * verdict lands. Three things go wrong with it, and all three are avoided by
 * computing the table when somebody reads it:
 *
 *  - **Entering late.** The rule is that any game inside the contest's dates
 *    counts, whenever the player entered. A stored best score needs a backfill at
 *    the moment somebody joins, and that backfill is a second implementation of
 *    this same query which can disagree with it.
 *  - **A verdict that changes.** A verdict can be rewritten — the model is asked
 *    again after a failure. A denormalised maximum taken from the old one stays
 *    wrong and nothing points at it.
 *  - **The contest's dates changing.** An admin moving the end date has to move
 *    every stored score with it, or the standings quietly describe a window that
 *    no longer exists.
 *
 * The cost is bounded by the number of entrants, not by the number of games: the
 * query starts from this contest's participants and reaches their games through
 * `startup_games_player1_idx` and `startup_games_player2_idx`.
 *
 * ## Two players, one verdict
 *
 * Ten Years From Now is played in pairs and the verdict belongs to the game, so
 * both players own that score. Two entrants who played each other therefore
 * share a number and share a rank, which is correct and not a bug — they built
 * the same company.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "./db";
import {
  contestParticipants, contests, startupGameVerdicts, startupGames, userProfiles, users,
} from "@shared/schema";

export interface Standing {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Their best ten-year valuation in the window, in whole dollars. Null if they have not played. */
  best: number | null;
  /** The game that produced it, so a standing can be opened. */
  gameId: string | null;
  /** The company they built, for a row that reads like something rather than a number. */
  company: string | null;
  /** How many games of theirs landed a verdict inside the contest's dates. */
  played: number;
  /** 1-based, ties shared. Null for somebody who has not played. */
  rank: number | null;
}

export interface ContestStandings {
  scoredBy: "ten_years_from_now";
  /** The window a game has to land inside, which is the contest's own. */
  from: Date;
  to: Date;
  /** Whether that window is open right now; closed means these are final. */
  open: boolean;
  standings: Standing[];
  /** How many entrants have played at all, against how many entered. */
  played: number;
  entrants: number;
}

/**
 * The table, in order, for one contest.
 *
 * Returns null when the contest is not scored by a game, which is how the
 * routes tell the two kinds apart without each one re-reading the column.
 */
export async function standingsFor(contestId: string, now = new Date()): Promise<ContestStandings | null> {
  const [contest] = await db.select().from(contests).where(eq(contests.id, contestId));
  if (!contest || contest.scoredBy !== "ten_years_from_now") return null;

  const entrants = await db
    .select({
      userId: contestParticipants.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      profileImageUrl: users.profileImageUrl,
      displayName: userProfiles.displayName,
      avatarUrl: userProfiles.avatarUrl,
    })
    .from(contestParticipants)
    .innerJoin(users, eq(users.id, contestParticipants.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, contestParticipants.userId))
    .where(eq(contestParticipants.contestId, contestId));

  const best = new Map<string, { best: number; gameId: string; company: string | null }>();
  const played = new Map<string, number>();

  if (entrants.length) {
    const ids = entrants.map((e) => e.userId);
    /*
     * Both seats, as two passes rather than one `or`.
     *
     * A single `where player1 = any($1) or player2 = any($1)` cannot use either
     * player index, so it degrades to a scan of every game ever played. Two
     * passes each use their own index, and the merge below is a map update.
     */
    for (const seat of [startupGames.player1Id, startupGames.player2Id] as const) {
      const rows = await db
        .select({
          userId: seat,
          gameId: startupGameVerdicts.gameId,
          tenYear: startupGameVerdicts.tenYear,
          company: sql<string | null>`${startupGames.idea}->>'name'`,
        })
        .from(startupGameVerdicts)
        .innerJoin(startupGames, eq(startupGames.id, startupGameVerdicts.gameId))
        .where(and(
          inArray(seat, ids),
          /*
           * A verdict the model did not write is a placeholder. The game's own
           * boards leave those out for the reason this contest has to as well:
           * a fallback score that ranks is a lie told to everyone above and
           * below it — and here it would be a lie worth a hundred dollars.
           */
          eq(startupGameVerdicts.fromModel, true),
          gte(startupGameVerdicts.createdAt, contest.startDate),
          lte(startupGameVerdicts.createdAt, contest.endDate),
        ));

      for (const row of rows) {
        played.set(row.userId, (played.get(row.userId) ?? 0) + 1);
        const current = best.get(row.userId);
        if (!current || row.tenYear > current.best) {
          best.set(row.userId, { best: row.tenYear, gameId: row.gameId, company: row.company });
        }
      }
    }
  }

  const rows: Standing[] = entrants.map((e) => {
    const mine = best.get(e.userId);
    return {
      userId: e.userId,
      name: e.displayName || [e.firstName, e.lastName].filter(Boolean).join(" ") || "Someone",
      avatarUrl: e.avatarUrl || e.profileImageUrl || null,
      best: mine?.best ?? null,
      gameId: mine?.gameId ?? null,
      company: mine?.company ?? null,
      played: played.get(e.userId) ?? 0,
      rank: null,
    };
  });

  /*
   * Highest first, and everybody who has not played is last in name order
   * rather than scattered among the zeroes — not having played is a different
   * thing from having built something worth nothing.
   */
  rows.sort((a, b) => {
    if (a.best == null && b.best == null) return a.name.localeCompare(b.name);
    if (a.best == null) return 1;
    if (b.best == null) return -1;
    return b.best - a.best;
  });

  /*
   * Shared ranks, and the next rank skips — the same rule the game's own boards
   * use, and the one people expect: two firsts are followed by a third.
   */
  let rank = 0;
  let seen = 0;
  let previous: number | null = null;
  for (const row of rows) {
    if (row.best == null) continue;
    seen++;
    if (previous === null || row.best !== previous) rank = seen;
    row.rank = rank;
    previous = row.best;
  }

  return {
    scoredBy: "ten_years_from_now",
    from: contest.startDate,
    to: contest.endDate,
    open: now >= contest.startDate && now <= contest.endDate && contest.status === "active",
    standings: rows,
    played: rows.filter((r) => r.best != null).length,
    entrants: rows.length,
  };
}
