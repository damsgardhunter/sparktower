/**
 * Recording the weekly loop, and computing the numbers Phase 4 is gated on.
 *
 * Two halves: `recordLoopEvent`, called from the places where the loop
 * actually happens, and `loopMetrics`, which turns that stream into the six
 * figures the spec names.
 *
 * Every metric here states its own definition in a comment, because a
 * retention number without a definition is a number nobody can act on — and
 * "D7" means something different for a weekly loop than it does for an app you
 * open daily.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { loopEvents, projectCheckIns, users } from "@shared/schema";
import { LOOP_EVENTS, LOOP_TARGETS, type LoopEventName } from "@shared/loop-events";

/**
 * How long someone gets to post their first update before they count as not
 * having activated. Three days covers a weekend, which is when a lot of people
 * actually sit down with something new.
 */
const ACTIVATION_HOURS = 72;

export interface LoopEventInput {
  name: LoopEventName;
  userId?: string | null;
  projectId?: string | null;
  checkInId?: string | null;
  sessionId?: string | null;
  props?: Record<string, unknown>;
}

/**
 * Writes one event.
 *
 * Never throws and never awaited on a critical path — losing a metric is
 * survivable, failing someone's check-in because analytics hiccuped is not.
 */
export async function recordLoopEvent(input: LoopEventInput): Promise<void> {
  try {
    await db.insert(loopEvents).values({
      name: input.name,
      userId: input.userId ?? null,
      projectId: input.projectId ?? null,
      checkInId: input.checkInId ?? null,
      sessionId: input.sessionId ?? null,
      props: input.props ?? {},
    });
  } catch (err) {
    console.error(`[loop-metrics] Failed to record ${input.name}:`, err);
  }
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const pct = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : (numerator / denominator) * 100;

/**
 * The Phase 4 gate, computed from the stream.
 *
 * `days` bounds the window for the funnel and share/comment counts. Retention
 * deliberately ignores it — a D30 figure computed over the last 7 days would
 * be meaningless.
 */
export async function loopMetrics(days = 30) {
  /*
   * Expressed as SQL, not a JS Date: `created_at` columns are `timestamp
   * without time zone` written by `defaultNow()`, so they hold the database's
   * local wall-clock, while a JS Date serialises as UTC. Mixing the two shifts
   * every window by the timezone offset.
   */
  const since = sql`now() - interval '${sql.raw(String(days))} days'`;

  // --- Funnel ----------------------------------------------------------
  const counts = await db.select({
    name: loopEvents.name,
    n: sql<number>`count(*)::int`,
  }).from(loopEvents)
    .where(gte(loopEvents.createdAt, since))
    .groupBy(loopEvents.name);

  const count = (name: string) => counts.find((c) => c.name === name)?.n ?? 0;
  const started = count(LOOP_EVENTS.checkInStarted);
  const submitted = count(LOOP_EVENTS.checkInSubmitted);

  // --- Time to post ----------------------------------------------------
  //
  // Median gap between a composer opening and the check-in it produced,
  // matched on sessionId. Sessions that never submitted are excluded by the
  // join rather than counted as infinite — an abandoned draft is a
  // completion-rate problem, not a speed one, and the funnel above shows it.
  const paired = await db.execute<{ elapsed_ms: number }>(sql`
    SELECT EXTRACT(EPOCH FROM (sub.created_at - st.created_at)) * 1000 AS elapsed_ms
    FROM ${loopEvents} st
    JOIN ${loopEvents} sub
      ON sub.session_id = st.session_id
     AND sub.name = ${LOOP_EVENTS.checkInSubmitted}
    WHERE st.name = ${LOOP_EVENTS.checkInStarted}
      AND st.session_id IS NOT NULL
      AND st.created_at >= ${since}
      AND sub.created_at >= st.created_at
  `);
  const elapsed = (paired.rows ?? [])
    .map((r) => Number(r.elapsed_ms))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const timeToPostP50 = median(elapsed);

  // --- Feedback within 24h ---------------------------------------------
  //
  // Of check-ins that asked for feedback, how many got their first comment
  // inside 24 hours. Only check-ins old enough to have had the full 24 hours
  // are counted, or every one posted this morning would drag the number down.
  const cutoff = sql`now() - interval '${sql.raw(String(LOOP_TARGETS.commentWithinHours))} hours'`;
  const feedback = await db.execute<{ eligible: number; answered: number }>(sql`
    SELECT
      count(*)::int AS eligible,
      count(*) FILTER (WHERE c.first_comment_at IS NOT NULL
        AND c.first_comment_at <= ci.created_at + interval '${sql.raw(String(LOOP_TARGETS.commentWithinHours))} hours')::int AS answered
    FROM ${projectCheckIns} ci
    LEFT JOIN (
      SELECT check_in_id, min(created_at) AS first_comment_at
      FROM ${loopEvents}
      WHERE name = ${LOOP_EVENTS.commentCreated} AND check_in_id IS NOT NULL
      GROUP BY check_in_id
    ) c ON c.check_in_id = ci.id
    WHERE ci.needs_feedback = true
      AND ci.created_at <= ${cutoff}
      AND ci.created_at >= ${since}
  `);
  const fb = feedback.rows?.[0];
  const eligibleForSla = Number(fb?.eligible ?? 0);
  const answeredInSla = Number(fb?.answered ?? 0);

  // --- Retention -------------------------------------------------------
  //
  // The loop is weekly, so "came back" means posted a second check-in — not
  // opened the app. D7 asks whether week two happened at all; D30 whether the
  // habit survived a month. Only cohorts old enough to have had the window are
  // counted.
  const retention = await db.execute<{ window: string; cohort: number; returned: number }>(sql`
    WITH firsts AS (
      SELECT user_id, min(created_at) AS first_at
      FROM ${projectCheckIns}
      GROUP BY user_id
    )
    SELECT '7' AS window,
      count(*) FILTER (WHERE f.first_at <= now() - interval '7 days')::int AS cohort,
      count(*) FILTER (WHERE f.first_at <= now() - interval '7 days' AND EXISTS (
        SELECT 1 FROM ${projectCheckIns} c2
        WHERE c2.user_id = f.user_id AND c2.created_at > f.first_at
          AND c2.created_at <= f.first_at + interval '7 days'))::int AS returned
    FROM firsts f
    UNION ALL
    SELECT '30' AS window,
      count(*) FILTER (WHERE f.first_at <= now() - interval '30 days')::int AS cohort,
      count(*) FILTER (WHERE f.first_at <= now() - interval '30 days' AND EXISTS (
        SELECT 1 FROM ${projectCheckIns} c2
        WHERE c2.user_id = f.user_id AND c2.created_at > f.first_at
          AND c2.created_at <= f.first_at + interval '30 days'))::int AS returned
    FROM firsts f
  `);
  const row = (w: string) => (retention.rows ?? []).find((r) => String(r.window) === w);
  const d7 = row("7");
  const d30 = row("30");

  /*
   * Everything that counts as "this person did something", from every table
   * that durably records one.
   *
   * The behaviour stream is the purpose-built signal, but it only holds what
   * has happened since it was switched on. Unioning it with the content tables
   * means these numbers are answerable today from the history that already
   * exists, and get sharper as the stream fills, rather than reading zero for a
   * week and looking broken.
   */
  const ACTIVITY = sql`
    SELECT user_id AS uid, created_at AS at FROM activity_events WHERE user_id IS NOT NULL
    UNION ALL SELECT user_id, created_at FROM project_check_ins
    UNION ALL SELECT author_id, created_at FROM project_comments
    UNION ALL SELECT author_id, created_at FROM feed_posts
    UNION ALL SELECT author_id, created_at FROM feed_comments
  `;

  // --- Activation ------------------------------------------------------
  //
  // Of the people who have had the full 72 hours, how many posted an update
  // inside it. Accounts younger than the window are excluded from the
  // denominator, not counted as failures — someone who signed up an hour ago
  // hasn't failed to activate, they just haven't had the chance, and counting
  // them drags the number down every time signups go well.
  const activationRows = await db.execute<{ eligible: number; activated: number }>(sql`
    SELECT
      count(*) FILTER (WHERE u.created_at <= now() - interval '${sql.raw(String(ACTIVATION_HOURS))} hours')::int AS eligible,
      count(*) FILTER (
        WHERE u.created_at <= now() - interval '${sql.raw(String(ACTIVATION_HOURS))} hours'
          AND EXISTS (
            SELECT 1 FROM ${projectCheckIns} c
            WHERE c.user_id = u.id
              AND c.created_at <= u.created_at + interval '${sql.raw(String(ACTIVATION_HOURS))} hours')
      )::int AS activated
    FROM ${users} u
  `);
  const act = activationRows.rows?.[0];
  const activationEligible = Number(act?.eligible ?? 0);
  const activated = Number(act?.activated ?? 0);

  // --- D7, anchored on signup ------------------------------------------
  //
  // Distinct from the retention block above, which anchors on someone's first
  // check-in and asks whether a second followed. This asks the acquisition
  // question instead: of the people who joined, how many were still here a
  // week later. Both are worth having; neither substitutes for the other.
  const d7Rows = await db.execute<{ cohort: number; retained: number }>(sql`
    WITH activity AS (${ACTIVITY})
    SELECT
      count(*) FILTER (WHERE u.created_at <= now() - interval '7 days')::int AS cohort,
      count(*) FILTER (
        WHERE u.created_at <= now() - interval '7 days'
          AND EXISTS (
            SELECT 1 FROM activity a
            WHERE a.uid = u.id AND a.at >= u.created_at + interval '7 days')
      )::int AS retained
    FROM ${users} u
  `);
  const d7s = d7Rows.rows?.[0];
  const d7Cohort = Number(d7s?.cohort ?? 0);
  const d7Retained = Number(d7s?.retained ?? 0);

  // --- WAU --------------------------------------------------------------
  const wauRows = await db.execute<{ people: number; updaters: number }>(sql`
    WITH activity AS (${ACTIVITY})
    SELECT
      (SELECT count(DISTINCT uid)::int FROM activity WHERE at >= now() - interval '7 days') AS people,
      (SELECT count(DISTINCT user_id)::int FROM ${projectCheckIns}
        WHERE created_at >= now() - interval '7 days') AS updaters
  `);
  const wau = wauRows.rows?.[0];

  // --- Comment within 24h, over every update ----------------------------
  //
  // The feedbackSla block above counts only the check-ins that asked for
  // feedback, because that's the promise the queue makes. This counts all of
  // them, which is the harder and more honest number: an update nobody replied
  // to is a dead end whether or not its author thought to tick the box.
  const answeredRows = await db.execute<{ updates: number; answered: number }>(sql`
    SELECT
      count(*)::int AS updates,
      count(*) FILTER (WHERE c.first_comment_at IS NOT NULL
        AND c.first_comment_at <= ci.created_at + interval '${sql.raw(String(LOOP_TARGETS.commentWithinHours))} hours')::int AS answered
    FROM ${projectCheckIns} ci
    LEFT JOIN (
      SELECT check_in_id, min(created_at) AS first_comment_at
      FROM ${loopEvents}
      WHERE name = ${LOOP_EVENTS.commentCreated} AND check_in_id IS NOT NULL
      GROUP BY check_in_id
    ) c ON c.check_in_id = ci.id
    WHERE ci.created_at <= ${cutoff}
  `);
  const ans = answeredRows.rows?.[0];
  const allUpdates = Number(ans?.updates ?? 0);
  const allAnswered = Number(ans?.answered ?? 0);

  return {
    windowDays: days,
    funnel: {
      started,
      submitted,
      /** Drafts opened that never became a check-in show up as the gap here. */
      completionPercent: pct(submitted, started),
      shares: count(LOOP_EVENTS.shareInitiated),
      comments: count(LOOP_EVENTS.commentCreated),
      views: count(LOOP_EVENTS.checkInViewed),
    },
    timeToPost: {
      p50Ms: timeToPostP50,
      targetMs: LOOP_TARGETS.timeToPostP50Ms,
      atTarget: timeToPostP50 != null && timeToPostP50 <= LOOP_TARGETS.timeToPostP50Ms,
      samples: elapsed.length,
    },
    feedbackSla: {
      hours: LOOP_TARGETS.commentWithinHours,
      eligible: eligibleForSla,
      answered: answeredInSla,
      percent: pct(answeredInSla, eligibleForSla),
    },
    retention: {
      d7: { cohort: Number(d7?.cohort ?? 0), returned: Number(d7?.returned ?? 0), percent: pct(Number(d7?.returned ?? 0), Number(d7?.cohort ?? 0)) },
      d30: { cohort: Number(d30?.cohort ?? 0), returned: Number(d30?.returned ?? 0), percent: pct(Number(d30?.returned ?? 0), Number(d30?.cohort ?? 0)) },
    },
    /** Signed up, then posted an update inside 72 hours. */
    activation: {
      windowHours: ACTIVATION_HOURS,
      eligible: activationEligible,
      activated,
      percent: pct(activated, activationEligible),
    },
    /** Signed up, and was still doing something a week later. */
    d7Signup: {
      cohort: d7Cohort,
      retained: d7Retained,
      percent: pct(d7Retained, d7Cohort),
    },
    /** Distinct people who did anything in the last 7 days. */
    wau: {
      windowDays: 7,
      people: Number(wau?.people ?? 0),
      updaters: Number(wau?.updaters ?? 0),
    },
    /** Every update, not just the ones that asked — see the note above. */
    commentWithin24h: {
      hours: LOOP_TARGETS.commentWithinHours,
      updates: allUpdates,
      answered: allAnswered,
      percent: pct(allAnswered, allUpdates),
    },
  };
}
