/**
 * Working out one builder's index, and keeping it worked out.
 *
 * Three clocks, because the three things this reads change at three speeds:
 *
 *   - **The index, hourly.** Milestones, tasks, feedback and reach are cheap
 *     to count and change whenever somebody does something, so the whole
 *     thing is rebuilt on the hour for anybody whose work has moved.
 *   - **The simulation, daily.** A season resolves one year a day, so asking
 *     more often than that is asking the same question.
 *   - **Nova's strategy read, weekly.** It costs money per builder and a week
 *     is about how fast a plan really changes. It is also the one part that
 *     can fail — no key, a timeout, a wordy answer — so it is stored when it
 *     succeeds and simply left alone when it doesn't, rather than dragging
 *     the pillar down to nothing on a bad afternoon.
 *
 * The scores it stores are the same four columns as before, so everything
 * reading them — the profile, the leaderboard, co-founder matching — carries
 * on working. What changed is what goes into them (`shared/reputation.ts` for
 * the arithmetic, `server/reputation-inputs.ts` for the facts).
 */
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { userReputationScores } from "@shared/schema";
import { REFRESH, reputationFrom, type ReputationFacts } from "@shared/reputation";
import { contestWins, contributionFacts, executionFacts, marketFacts, simFacts } from "./reputation-inputs";
import { strategyRead } from "./reputation-ai";

export interface RefreshOptions {
  /** Work the simulation out again even if yesterday's is still fresh. */
  forceSim?: boolean;
  /** Ask Nova again even if this week's read is still fresh. */
  forceAi?: boolean;
  /** Skip Nova entirely — the hourly pass does, because it is not Nova's hour. */
  skipAi?: boolean;
  now?: Date;
}

const due = (at: Date | null | undefined, every: number, now: Date) =>
  !at || now.getTime() - at.getTime() >= every;

/**
 * Rebuild one builder's index.
 *
 * Returns the stored row, plus whether Nova was asked this time — the route
 * used to charge a credit for that, and the job now wants to know for the log.
 */
export async function refreshReputation(userId: string, options: RefreshOptions = {}) {
  const now = options.now ?? new Date();
  const [existing] = await db.select().from(userReputationScores).where(eq(userReputationScores.userId, userId));

  /*
   * The simulation, if yesterday's answer has expired. Kept on the row rather
   * than recomputed hourly: the query walks every season the builder has
   * played, and a season moves once a day.
   */
  let simScore = existing?.simScore ?? null;
  let simScoredAt = existing?.simScoredAt ?? null;
  const wantSim = options.forceSim || due(simScoredAt, REFRESH.simMs, now);
  const sim = wantSim ? await simFacts(userId) : { seasons: [] };
  if (wantSim) {
    const { simScore: scoreOf } = await import("@shared/reputation");
    simScore = scoreOf(sim);
    simScoredAt = now;
  }

  /*
   * Nova, if this week's read has expired and the caller wants one. A failed
   * read leaves the previous score and its date alone, so the pillar holds
   * last week's reading rather than collapsing.
   */
  let aiScore = existing?.aiScore ?? null;
  let aiSummary = existing?.aiSummary ?? null;
  let aiScoredAt = existing?.aiScoredAt ?? null;
  let askedNova = false;
  if (!options.skipAi && (options.forceAi || due(aiScoredAt, REFRESH.aiMs, now))) {
    const read = await strategyRead(userId);
    askedNova = read !== null;
    if (read) {
      aiScore = read.score;
      aiSummary = read.summary;
      aiScoredAt = now;
    }
  }

  const [execution, contribution, market, wins] = await Promise.all([
    executionFacts(userId),
    contributionFacts(userId),
    marketFacts(userId),
    contestWins(userId),
  ]);

  const facts: ReputationFacts = {
    execution,
    contribution,
    market,
    /*
     * The seasons themselves are only loaded on the day the simulation is
     * due; on every other pass the pillar is rebuilt from the score that day
     * produced, which is what `simScore` on the row is for.
     */
    strategy: { sim, aiScore, contestWins: wins },
  };

  const result = reputationFrom(facts);
  /* On an hour that didn't reload the seasons, the stored simulation score stands in. */
  const strategy = wantSim ? result.strategy : restoreStrategy(result, simScore, aiScore, wins);

  const row = {
    userId,
    executionScore: result.execution,
    contributionScore: result.contribution,
    marketSignalScore: result.market,
    strategicThinkingScore: strategy,
    builderIndex: Math.round(
      result.execution * 0.3 + result.contribution * 0.25 + result.market * 0.25 + strategy * 0.2,
    ),
    details: {
      ...result.details,
      strategy: { ...(result.details.strategy as object), simScore, aiScore, aiSummary, aiScoredAt, simScoredAt },
    },
    simScore,
    simScoredAt,
    aiScore,
    aiSummary,
    aiScoredAt,
    lastCalculatedAt: now,
  };

  const [saved] = await db
    .insert(userReputationScores)
    .values(row)
    .onConflictDoUpdate({ target: userReputationScores.userId, set: { ...row } })
    .returning();

  return { ...saved, aiEvaluated: askedNova };
}

/**
 * The strategy pillar on an hour that did not reload the seasons.
 *
 * `reputationFrom` was handed an empty season list, so its strategy figure is
 * missing the simulation half; this rebuilds the same weighted average from
 * the stored score instead. Same weights, same renormalisation when a part is
 * missing — see `strategyScore` in shared/reputation.ts.
 */
function restoreStrategy(result: ReturnType<typeof reputationFrom>, simScore: number | null, aiScore: number | null, wins: number): number {
  const parts: { value: number; weight: number }[] = [];
  if (simScore !== null) parts.push({ value: simScore, weight: 45 });
  if (aiScore !== null) parts.push({ value: Math.max(0, Math.min(100, aiScore)), weight: 45 });
  const winScore = 100 * (wins / (wins + 2));
  parts.push({ value: winScore, weight: parts.length === 0 ? 100 : 10 });
  const total = parts.reduce((sum, p) => sum + p.weight, 0);
  return Math.max(0, Math.min(100, Math.round(parts.reduce((sum, p) => sum + p.value * p.weight, 0) / total)));
}

/**
 * The name the rest of the server already calls.
 *
 * Kept so the route, and anything else that asks for a person's score to be
 * brought up to date, does not need to know about the clocks. It never asks
 * Nova: the weekly job does that, and a page load is not a week.
 */
export async function calculateUserReputation(userId: string, _storage?: unknown) {
  return refreshReputation(userId, { skipAi: true });
}

/** The stored row, or nothing. Reads never compute — that is the job's business now. */
export async function storedReputation(userId: string) {
  const [row] = await db.select().from(userReputationScores).where(eq(userReputationScores.userId, userId));
  return row ?? null;
}

/** Builders whose weekly Nova read has expired, oldest first. */
export async function usersDueForNova(limit: number, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - REFRESH.aiMs);
  const result: any = await db.execute(sql`
    select r.user_id as id
    from user_reputation_scores r
    join users u on u.id = r.user_id
    where u.deleted_at is null and u.is_bot = false and u.suspended_at is null
      and (r.ai_scored_at is null or r.ai_scored_at < ${cutoff})
      and exists (select 1 from projects p where p.owner_id = r.user_id)
    order by r.ai_scored_at asc nulls first
    limit ${limit}
  `);
  return ((result.rows ?? result) as { id: string }[]).map((r) => r.id);
}

/** Builders whose daily simulation score has expired and who have actually played. */
export async function usersDueForSim(limit: number, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - REFRESH.simMs);
  const result: any = await db.execute(sql`
    select distinct s.user_id as id
    from sim_seats s
    join users u on u.id = s.user_id
    left join user_reputation_scores r on r.user_id = s.user_id
    where u.deleted_at is null and u.is_bot = false
      and (r.sim_scored_at is null or r.sim_scored_at < ${cutoff})
    limit ${limit}
  `);
  return ((result.rows ?? result) as { id: string }[]).map((r) => r.id);
}

export { usersDue } from "./reputation-inputs";
