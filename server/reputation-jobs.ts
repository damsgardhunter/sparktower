/**
 * Keeping the builder index up to date without anybody pressing anything.
 *
 * It used to be worked out only when a builder opened their profile and
 * pressed "Recalculate", which meant the number on somebody's profile was
 * however out of date they had left it — and the leaderboard and co-founder
 * matching read those same stale rows. A score nobody has refreshed is worse
 * than no score, because it looks current.
 *
 * Three passes, on the three clocks the parts actually move at:
 *
 *   - **On the hour**, the index for everyone whose work has moved since
 *     their last pass (`usersDue`). Deliberately on the hour rather than an
 *     hour after boot: "updated at the top of every hour" is a promise a
 *     person can check, and a deploy should not shift it.
 *   - **Daily**, the simulation score for anybody holding a seat.
 *   - **Weekly**, Nova's strategy read, a few builders at a time so a week's
 *     worth of calls is spread across the week rather than fired in a minute.
 *
 * Every pass is capped. A sweep that tried to do everybody in one go would,
 * on a bad morning, be a self-inflicted outage; a cap means the worst case is
 * that some scores are an hour older than they might have been.
 */
import { refreshReputation, usersDue, usersDueForNova, usersDueForSim } from "./reputation";

/** How many builders one pass will do. Enough for a busy hour, not enough to hurt. */
const INDEX_BATCH = 250;
const SIM_BATCH = 200;
/** Nova's read costs money per builder, so the weekly quota is spread hourly. */
const NOVA_BATCH = 25;

const HOUR_MS = 60 * 60 * 1000;

async function safely(name: string, job: () => Promise<void>): Promise<void> {
  try {
    await job();
  } catch (error) {
    console.error(`[reputation] ${name} failed:`, error);
  }
}

/** One pass of the hourly index. Exported so a test can run it without a clock. */
export async function refreshDueIndexes(limit = INDEX_BATCH): Promise<number> {
  const users = await usersDue(limit);
  let done = 0;
  for (const userId of users) {
    try {
      await refreshReputation(userId, { skipAi: true });
      done += 1;
    } catch (error) {
      // One broken account must not stop the pass for everybody behind it.
      console.error(`[reputation] ${userId} failed to refresh:`, error);
    }
  }
  if (done > 0) console.log(`[reputation] refreshed ${done} index(es)`);
  return done;
}

/** One pass of the daily simulation score. */
export async function refreshDueSimScores(limit = SIM_BATCH): Promise<number> {
  const users = await usersDueForSim(limit);
  let done = 0;
  for (const userId of users) {
    try {
      await refreshReputation(userId, { forceSim: true, skipAi: true });
      done += 1;
    } catch (error) {
      console.error(`[reputation] simulation score for ${userId} failed:`, error);
    }
  }
  if (done > 0) console.log(`[reputation] refreshed ${done} simulation score(s)`);
  return done;
}

/** One slice of the weekly Nova read. */
export async function refreshDueNovaReads(limit = NOVA_BATCH): Promise<number> {
  const users = await usersDueForNova(limit);
  let done = 0;
  for (const userId of users) {
    try {
      const result = await refreshReputation(userId, { forceAi: true });
      if (result.aiEvaluated) done += 1;
    } catch (error) {
      console.error(`[reputation] Nova read for ${userId} failed:`, error);
    }
  }
  if (done > 0) console.log(`[reputation] ${done} strategy read(s) from Nova`);
  return done;
}

/**
 * Start the three passes.
 *
 * The hourly one is aligned to the top of the hour: the first timer waits out
 * whatever is left of this hour, and the interval from then on is exactly an
 * hour. The other two ride on it — a day is 24 of these, a week is 168 — so
 * there is one clock to reason about rather than three drifting ones.
 */
export function startReputationJobs(): void {
  const untilNextHour = HOUR_MS - (Date.now() % HOUR_MS);

  setTimeout(() => {
    void safely("hourly index", async () => { await refreshDueIndexes(); });
    void safely("daily simulation scores", async () => { await refreshDueSimScores(); });
    void safely("weekly strategy reads", async () => { await refreshDueNovaReads(); });

    setInterval(() => {
      void safely("hourly index", async () => { await refreshDueIndexes(); });
      /*
       * The daily and weekly work is due-driven rather than counted: each row
       * carries when it was last done, so running the check every hour costs
       * one cheap query and picks the work up whatever the server was doing
       * when the day turned over. A restart cannot skip a day this way.
       */
      void safely("daily simulation scores", async () => { await refreshDueSimScores(); });
      void safely("weekly strategy reads", async () => { await refreshDueNovaReads(); });
    }, HOUR_MS).unref();
  }, untilNextHour).unref?.();

  console.log(`[reputation] index refreshes on the hour (first in ${Math.round(untilNextHour / 60_000)} min)`);
}
