/**
 * The admin safety loop's server half: one read that loads a daily review,
 * the impact of each moderation action, and recording that a review was done.
 *
 *   review → act (reports queue, suspensions, surface switches) → impact →
 *   the next review, which starts from what changed since this one.
 *
 * Everything is counted from tables that already exist — `content_reports`,
 * `moderation_log`, `activity_events` (writes, and the limit refusals
 * `recordRefusal` keeps) and `rate_limit_hits` — so there's no second copy of
 * the truth to drift. Every window is computed inside the database, relative
 * to `now()` or to the action's own `created_at`: the timestamps here carry no
 * zone, and a JavaScript Date sent across would shift by the server's offset.
 */
import type { Express } from "express";
import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { activityEvents, contentReports, moderationLog, rateLimitHits } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireReviewer } from "./platform-roles";
import { logModeration, rateLimit } from "./moderation";
import { surfaceMap } from "./surfaces";
import { ACTIVITY_EVENTS } from "@shared/analytics";
import { SURFACES, SURFACE_API_PREFIXES } from "@shared/surfaces";
import { RATE_LIMITS } from "@shared/moderation";
import {
  CONTENT_WRITE_PATTERNS, IMPACT_MIN_HOURS, IMPACT_WINDOW_HOURS, MAX_REVIEW_WINDOW_HOURS,
  REVIEW_DUE_HOURS, SAFETY_CHECKLIST_IDS, SAFETY_EVENTS, SAFETY_REVIEW_ACTION,
  compareWindows, isSpike, safetyAlerts, type WindowComparison,
} from "@shared/safety";

const rowsOf = <T>(result: { rows?: T[] } | T[]): T[] => (Array.isArray(result) ? result : result.rows ?? []);

/** A half-open window as SQL bounds: [from, to). */
interface Window { from: SQL; to: SQL }

const between = (col: SQL, w: Window) => sql`${col} >= ${w.from} AND ${col} < ${w.to}`;

/** The pattern list as a SQL array literal of prefixes, for `LIKE ANY`. */
const prefixesLike = (prefixes: readonly string[]) =>
  sql`(${sql.join(prefixes.map((p) => sql`pattern = ${p} OR pattern LIKE ${`${p}/%`}`), sql` OR `)})`;

const contentWrites = sql`name = ${ACTIVITY_EVENTS.apiWrite} AND method = 'POST' AND status < 400 AND pattern IN (${sql.join(CONTENT_WRITE_PATTERNS.map((p) => sql`${p}`), sql`, `)})`;

async function count(query: SQL): Promise<number> {
  const [row] = rowsOf<{ n: number }>(await db.execute(query));
  return Number(row?.n ?? 0);
}

/** Refusals in a window, summed from the bucketed rows, optionally narrowed. */
const refusals = (w: Window, narrow?: SQL) => count(sql`
  SELECT coalesce(sum(coalesce((props->>'count')::int, 1)), 0)::int AS n FROM ${activityEvents}
  WHERE name = ${SAFETY_EVENTS.limitRefused} AND ${between(sql`created_at`, w)} ${narrow ? sql`AND ${narrow}` : sql``}`);

const refusalsByAction = async (w: Window) => new Map(rowsOf<{ action: string; n: number }>(await db.execute(sql`
  SELECT props->>'action' AS action, coalesce(sum(coalesce((props->>'count')::int, 1)), 0)::int AS n
  FROM ${activityEvents}
  WHERE name = ${SAFETY_EVENTS.limitRefused} AND ${between(sql`created_at`, w)}
  GROUP BY 1`)).map((r) => [r.action, Number(r.n)]));

const reportsIn = (w: Window, narrow?: SQL) => count(sql`
  SELECT count(*)::int AS n FROM ${contentReports} WHERE ${between(sql`created_at`, w)} ${narrow ? sql`AND ${narrow}` : sql``}`);

const writesIn = (w: Window, narrow: SQL) => count(sql`
  SELECT count(*)::int AS n FROM ${activityEvents} WHERE ${between(sql`created_at`, w)} AND ${narrow}`);

// ------------------------------------------------------------------ impact

export interface ImpactMetric extends WindowComparison {
  key: string;
  label: string;
  /** Whether a fall in this number is what the action was for. */
  goodWhen: "down" | "up" | "either";
}

export interface ActionImpact {
  logId: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetUserId: string | null;
  reasonCode: string | null;
  actorName: string | null;
  createdAt: string;
  hoursSince: number;
  /** "early" under an hour in; "watching" inside the window; "settled" after it. */
  status: "early" | "watching" | "settled";
  metrics: ImpactMetric[];
  /** The one line worth reading: the scoped metric that moved most. */
  headline: string | null;
}

/**
 * What an action did, 24 hours either side of it.
 *
 * Scoped to what it acted on: an account's reports, posting and refusals for
 * a removal or a ban; a surface's writes and refusals for a switch. The
 * site-wide report and refusal counts ride along for context — an action can
 * move its target and still coincide with a bad day everywhere else.
 */
export async function actionImpact(logId: string): Promise<ActionImpact | null> {
  const [entry] = rowsOf<any>(await db.execute(sql`
    SELECT l.id, l.action, l.target_type, l.target_id, l.target_user_id, l.reason_code, l.details,
           to_char(l.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
           extract(epoch from (now() - l.created_at)) / 3600.0 AS hours_since,
           coalesce(p.display_name, u.first_name) AS actor_name
    FROM ${moderationLog} l
    LEFT JOIN users u ON u.id = l.actor_id
    LEFT JOIN user_profiles p ON p.user_id = l.actor_id
    WHERE l.id = ${logId}`));
  if (!entry) return null;

  const at = sql`(SELECT created_at FROM ${moderationLog} WHERE id = ${logId})`;
  const hours = sql.raw(`interval '${IMPACT_WINDOW_HOURS} hours'`);
  const before: Window = { from: sql`${at} - ${hours}`, to: at };
  const after: Window = { from: at, to: sql`LEAST(now(), ${at} + ${hours})` };
  const hoursSince = Number(entry.hours_since);

  const specs: { key: string; label: string; goodWhen: ImpactMetric["goodWhen"]; run: (w: Window) => Promise<number> }[] = [];

  if (entry.target_user_id) {
    const uid = String(entry.target_user_id);
    specs.push(
      { key: "reports_against_user", label: "Reports against this account", goodWhen: "down", run: (w) => reportsIn(w, sql`target_owner_id = ${uid}`) },
      { key: "user_content", label: "Posts, comments and messages by this account", goodWhen: "down", run: (w) => writesIn(w, sql`user_id = ${uid} AND ${contentWrites}`) },
      { key: "user_refusals", label: "Rate-limit refusals for this account", goodWhen: "down", run: (w) => refusals(w, sql`user_id = ${uid}`) },
    );
  }

  if (entry.target_type === "surface" && entry.target_id) {
    const prefixes = SURFACE_API_PREFIXES[String(entry.target_id)] ?? [];
    const label = SURFACES.find((s) => s.id === entry.target_id)?.label ?? String(entry.target_id);
    const enabled = (entry.details as { enabled?: boolean } | null)?.enabled;
    if (prefixes.length) {
      specs.push(
        { key: "surface_writes", label: `Writes on ${label}`, goodWhen: enabled === false ? "down" : "either", run: (w) => writesIn(w, sql`name = ${ACTIVITY_EVENTS.apiWrite} AND ${prefixesLike(prefixes)}`) },
        { key: "surface_refusals", label: `Refusals on ${label}`, goodWhen: "either", run: (w) => refusals(w, prefixesLike(prefixes)) },
      );
    }
  }

  const scoped = specs.length;
  specs.push(
    { key: "site_reports", label: "New reports, site-wide", goodWhen: "down", run: (w) => reportsIn(w) },
    { key: "site_refusals", label: "Rate-limit refusals, site-wide", goodWhen: "down", run: (w) => refusals(w) },
    { key: "site_content", label: "Posts, comments and messages, site-wide", goodWhen: "either", run: (w) => writesIn(w, contentWrites) },
  );

  const metrics: ImpactMetric[] = await Promise.all(specs.map(async (spec) => ({
    key: spec.key, label: spec.label, goodWhen: spec.goodWhen,
    ...compareWindows(await spec.run(before), await spec.run(after), hoursSince),
  })));

  const status = hoursSince < IMPACT_MIN_HOURS ? "early" : hoursSince < IMPACT_WINDOW_HOURS ? "watching" : "settled";
  const candidates = (scoped ? metrics.slice(0, scoped) : metrics).filter((m) => m.direction !== "flat");
  const moved = candidates.sort((a, b) => Math.abs(b.afterPace - b.before) - Math.abs(a.afterPace - a.before))[0];
  const headline = status === "early"
    ? "Too soon to read — check back in an hour."
    : moved
      ? `${moved.label}: ${moved.before} → ${moved.afterPace} per ${IMPACT_WINDOW_HOURS}h`
      : "Nothing it touched has moved.";

  return {
    logId: entry.id, action: entry.action, targetType: entry.target_type, targetId: entry.target_id,
    targetUserId: entry.target_user_id, reasonCode: entry.reason_code, actorName: entry.actor_name ?? null,
    createdAt: entry.created_at, hoursSince: Math.round(hoursSince * 10) / 10, status, metrics, headline,
  };
}

// ------------------------------------------------------------------ review

/** `withImpact: false` skips the per-action impact queries — for the sidebar's poll. */
export async function safetyReview({ withImpact = true }: { withImpact?: boolean } = {}) {
  const [last] = rowsOf<any>(await db.execute(sql`
    SELECT l.id, l.details, extract(epoch from (now() - l.created_at)) / 3600.0 AS hours_ago,
           to_char(l.created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS created_at,
           coalesce(p.display_name, u.first_name) AS actor_name
    FROM ${moderationLog} l
    LEFT JOIN users u ON u.id = l.actor_id
    LEFT JOIN user_profiles p ON p.user_id = l.actor_id
    WHERE l.action = ${SAFETY_REVIEW_ACTION}
    ORDER BY l.created_at DESC LIMIT 1`));
  const hoursSinceReview = last ? Number(last.hours_ago) : null;

  // Since the last review, at least a day and at most a week; compared with the same span before it.
  const windowHours = Math.round(Math.min(MAX_REVIEW_WINDOW_HOURS, Math.max(REVIEW_DUE_HOURS, hoursSinceReview ?? REVIEW_DUE_HOURS)));
  const span = sql.raw(`interval '${windowHours} hours'`);
  const current: Window = { from: sql`now() - ${span}`, to: sql`now() + interval '1 second'` };
  const previous: Window = { from: sql`now() - ${span} - ${span}`, to: sql`now() - ${span}` };

  const [openRow] = rowsOf<any>(await db.execute(sql`
    SELECT count(*)::int AS open, extract(epoch from (now() - min(created_at))) / 3600.0 AS oldest_hours
    FROM ${contentReports} WHERE status = 'open'`));
  const byReason = rowsOf<{ reason: string; n: number }>(await db.execute(sql`
    SELECT reason, count(*)::int AS n FROM ${contentReports} WHERE status = 'open' GROUP BY reason ORDER BY n DESC LIMIT 5`));
  const [newReports, newReportsBefore] = await Promise.all([reportsIn(current), reportsIn(previous)]);

  const [refusedNow, refusedBefore] = await Promise.all([refusalsByAction(current), refusalsByAction(previous)]);
  const hits = new Map(rowsOf<{ action: string; n: number }>(await db.execute(sql`
    SELECT action, count(*)::int AS n FROM ${rateLimitHits} WHERE created_at >= now() - interval '24 hours' GROUP BY action`))
    .map((r) => [r.action, Number(r.n)]));
  const limitActions = Array.from(new Set([...refusedNow.keys(), ...refusedBefore.keys()]));
  const limits = limitActions.map((action) => {
    const refused = refusedNow.get(action) ?? 0;
    const before = refusedBefore.get(action) ?? 0;
    const rule = (RATE_LIMITS as Record<string, { max: number; windowMinutes: number }>)[action];
    return {
      action, refused, refusedBefore: before, spike: isSpike(refused, before),
      allowedLast24h: hits.get(action) ?? null,
      rule: rule ? `${rule.max} per ${rule.windowMinutes} min` : null,
    };
  }).sort((a, b) => Number(b.spike) - Number(a.spike) || b.refused - a.refused);

  const [contentNow, contentBefore] = await Promise.all([writesIn(current, contentWrites), writesIn(previous, contentWrites)]);

  const flags = surfaceMap();
  const surfacesOff = SURFACES.filter((s) => flags[s.id] === false).map((s) => ({ id: s.id, label: s.label }));

  const recent = rowsOf<{ id: string }>(await db.execute(sql`
    SELECT id FROM ${moderationLog}
    WHERE action <> ${SAFETY_REVIEW_ACTION} AND created_at >= now() - interval '7 days'
    ORDER BY created_at DESC LIMIT 20`));
  const actions = withImpact
    ? (await Promise.all(recent.map((r) => actionImpact(r.id)))).filter((a): a is ActionImpact => !!a)
    : [];

  const alerts = safetyAlerts({
    openReports: Number(openRow?.open ?? 0),
    oldestOpenHours: openRow?.oldest_hours == null ? null : Number(openRow.oldest_hours),
    newReports, newReportsBefore,
    limits: limits.map((l) => ({ action: l.action, refused: l.refused, refusedBefore: l.refusedBefore })),
    hoursSinceReview,
    surfacesOff: surfacesOff.map((s) => s.label),
  });

  return {
    windowHours,
    lastReview: last ? {
      id: last.id, at: last.created_at, by: last.actor_name ?? null,
      hoursAgo: Math.round(Number(last.hours_ago) * 10) / 10,
      note: (last.details as any)?.note ?? null,
    } : null,
    reviewDue: hoursSinceReview == null || hoursSinceReview >= REVIEW_DUE_HOURS,
    alerts,
    reports: {
      open: Number(openRow?.open ?? 0),
      oldestOpenHours: openRow?.oldest_hours == null ? null : Math.round(Number(openRow.oldest_hours) * 10) / 10,
      newInWindow: newReports, newBefore: newReportsBefore,
      byReason: byReason.map((r) => ({ reason: r.reason, count: Number(r.n) })),
    },
    limits,
    content: { inWindow: contentNow, before: contentBefore },
    surfacesOff,
    actions,
  };
}

export function registerSafetyRoutes(app: Express) {
  /** The daily review, loaded together. Reviewer only. */
  app.get("/api/admin/safety/review", isAuthenticated, requireReviewer, async (_req, res) => {
    try {
      res.json(await safetyReview());
    } catch (error) {
      console.error("Safety review error:", error);
      res.status(500).json({ message: "Couldn't load the review" });
    }
  });

  /** What one moderation action did. Linked from the reports queue. */
  app.get("/api/admin/safety/impact/:logId", isAuthenticated, requireReviewer, async (req, res) => {
    try {
      const impact = await actionImpact(String(req.params.logId));
      if (!impact) return res.status(404).json({ message: "No such action" });
      res.json(impact);
    } catch (error) {
      console.error("Action impact error:", error);
      res.status(500).json({ message: "Couldn't measure that action" });
    }
  });

  /** For the sidebar: whether a review is due, and how many alerts are waiting. */
  app.get("/api/admin/safety/status", isAuthenticated, requireReviewer, async (_req, res) => {
    try {
      const review = await safetyReview({ withImpact: false });
      res.json({
        reviewDue: review.reviewDue,
        alerts: review.alerts.filter((a) => a.level !== "info").length,
      });
    } catch {
      res.json({ reviewDue: false, alerts: 0 });
    }
  });

  /**
   * Records a completed review. Every checklist item must be confirmed, and
   * the record goes to the append-only moderation log with what the review
   * saw, so the next one starts from here and a skipped day is visible.
   */
  app.post("/api/admin/safety/review", isAuthenticated, requireReviewer, rateLimit("review"), async (req: any, res) => {
    try {
      const checked = Array.isArray(req.body?.checked) ? req.body.checked.map(String) : [];
      const missing = SAFETY_CHECKLIST_IDS.filter((id) => !checked.includes(id));
      if (missing.length) {
        return res.status(400).json({ message: "Confirm every item before completing the review.", code: "invalid_input", missing });
      }
      const note = String(req.body?.note ?? "").trim().slice(0, 1000) || null;
      const review = await safetyReview();
      await logModeration({
        action: SAFETY_REVIEW_ACTION, actorId: req.user.id, targetType: "safety_review",
        reason: note,
        details: {
          note, checked: SAFETY_CHECKLIST_IDS,
          saw: {
            openReports: review.reports.open,
            alerts: review.alerts.map((a) => a.id),
            spikes: review.limits.filter((l) => l.spike).map((l) => l.action),
            actionsReviewed: review.actions.map((a) => a.logId),
          },
        },
      });
      res.json({ ok: true });
    } catch (error) {
      console.error("Complete review error:", error);
      res.status(500).json({ message: "Couldn't record the review" });
    }
  });
}
