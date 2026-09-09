/**
 * The analytics console's data. Owner only, every route.
 *
 * The live feed is Server-Sent Events polling the database on a short interval,
 * rather than an in-process event emitter pushing rows the moment they're
 * written. The emitter would be a little faster and would only work while there
 * is exactly one server process: two processes, and the console shows whichever
 * half of the traffic happened to land on the one it's connected to, silently.
 * Polling a table is correct however many processes there are, and two seconds
 * of latency is well inside what "live" means to someone watching.
 */
import type { Express, Response } from "express";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { activityEvents, users, userProfiles } from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { requireOwner } from "./platform-roles";
import {
  ACTIVITY_EVENTS, ONLINE_WINDOW_MINUTES, actionLabel, pageLabel,
} from "@shared/analytics";

/** How often the live stream checks for new rows. */
const POLL_MS = 2000;
/** Rows one poll may deliver, so a burst can't flood a browser tab. */
const POLL_LIMIT = 200;
/** Keeps proxies from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

const minutes = (n: number) => sql`now() - interval '${sql.raw(String(n))} minutes'`;
const days = (n: number) => sql`now() - interval '${sql.raw(String(n))} days'`;

/**
 * What counts as one person.
 *
 * The account where there is one, the browser otherwise. Counting raw visitor
 * ids overstates: the same person signed in on a laptop and a phone is two
 * browsers, and a first visit can mint more than one id before the cookie
 * settles. Falling back to the visitor id keeps signed-out readers countable,
 * which is most of the interesting traffic.
 */
const countPeople = sql<number>`count(DISTINCT coalesce(${activityEvents.userId}, ${activityEvents.visitorId}))::int`;

/**
 * One row, ready to read.
 *
 * The name is resolved here rather than stored, so the wording can be improved
 * without rewriting what already happened.
 */
function describe(row: any) {
  const isPage = row.name === ACTIVITY_EVENTS.pageView;
  return {
    id: row.id,
    seq: Number(row.seq),
    at: row.createdAt,
    kind: isPage ? "page" : row.name === ACTIVITY_EVENTS.sessionStart ? "session" : "action",
    label: isPage
      ? `Opened ${pageLabel(row.path)}`
      : row.name === ACTIVITY_EVENTS.sessionStart
        ? "Arrived"
        : actionLabel(row.method || "", row.pattern),
    path: row.path,
    method: row.method,
    status: row.status,
    durationMs: row.durationMs,
    visitorId: row.visitorId,
    sessionId: row.sessionId,
    userId: row.userId,
    who: row.displayName || row.firstName || null,
    email: row.email || null,
  };
}

/** Everything the feed needs about a person, joined once. */
const FEED_COLUMNS = {
  id: activityEvents.id,
  seq: activityEvents.seq,
  createdAt: activityEvents.createdAt,
  name: activityEvents.name,
  path: activityEvents.path,
  pattern: activityEvents.pattern,
  method: activityEvents.method,
  status: activityEvents.status,
  durationMs: activityEvents.durationMs,
  visitorId: activityEvents.visitorId,
  sessionId: activityEvents.sessionId,
  userId: activityEvents.userId,
  displayName: userProfiles.displayName,
  firstName: users.firstName,
  email: users.email,
} as const;

const feedQuery = () =>
  db.select(FEED_COLUMNS)
    .from(activityEvents)
    .leftJoin(users, eq(users.id, activityEvents.userId))
    .leftJoin(userProfiles, eq(userProfiles.userId, activityEvents.userId));

export function registerAnalyticsRoutes(app: Express) {
  /**
   * The live tail.
   *
   * Opens with the recent past so the console isn't blank until someone
   * happens to click something, then streams forward from there.
   */
  app.get("/api/admin/analytics/live", isAuthenticated, requireOwner, async (req: any, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    let cursor = 0;
    let closed = false;

    const send = (event: string, data: unknown) => {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const recent = await feedQuery().orderBy(desc(activityEvents.seq)).limit(60);
      const rows = recent.reverse();
      cursor = rows.length ? Number(rows[rows.length - 1].seq) : 0;
      if (cursor === 0) {
        // Empty table: start from the top so the first real event still arrives.
        const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${activityEvents.seq}), 0)::int` })
          .from(activityEvents);
        cursor = Number(max) || 0;
      }
      send("backfill", rows.map(describe));
    } catch (err) {
      console.error("[analytics] Live backfill failed:", err);
      send("backfill", []);
    }

    const tick = setInterval(async () => {
      if (closed) return;
      try {
        const rows = await feedQuery()
          .where(sql`${activityEvents.seq} > ${cursor}`)
          .orderBy(activityEvents.seq)
          .limit(POLL_LIMIT);
        if (rows.length) {
          cursor = Number(rows[rows.length - 1].seq);
          send("events", rows.map(describe));
        }
      } catch (err) {
        console.error("[analytics] Live poll failed:", err);
      }
    }, POLL_MS);

    const beat = setInterval(() => {
      if (!closed) res.write(": keep-alive\n\n");
    }, HEARTBEAT_MS);

    const stop = () => {
      closed = true;
      clearInterval(tick);
      clearInterval(beat);
    };
    req.on("close", stop);
    res.on("close", stop);
  });

  /** Who is on the site right now, and what they last did. */
  app.get("/api/admin/analytics/online", isAuthenticated, requireOwner, async (_req, res) => {
    try {
      const rows = await db.execute<any>(sql`
        SELECT DISTINCT ON (coalesce(e.user_id, e.visitor_id))
          e.visitor_id, e.user_id, e.session_id, e.path, e.pattern, e.method,
          e.name, e.created_at,
          coalesce(p.display_name, u.first_name) AS who,
          u.email
        FROM ${activityEvents} e
        LEFT JOIN ${users} u ON u.id = e.user_id
        LEFT JOIN ${userProfiles} p ON p.user_id = e.user_id
        WHERE e.created_at >= ${minutes(ONLINE_WINDOW_MINUTES)}
        ORDER BY coalesce(e.user_id, e.visitor_id), e.created_at DESC
      `);

      res.json((rows.rows ?? []).map((r: any) => ({
        visitorId: r.visitor_id,
        sessionId: r.session_id,
        userId: r.user_id,
        who: r.who || null,
        email: r.email || null,
        lastSeen: r.created_at,
        doing: r.name === ACTIVITY_EVENTS.pageView
          ? pageLabel(r.path)
          : actionLabel(r.method || "", r.pattern),
      })));
    } catch (error) {
      console.error("Analytics online error:", error);
      res.status(500).json({ message: "Couldn't read who's online" });
    }
  });

  /**
   * The numbers, over a window.
   *
   * Everything is computed from the stream itself rather than kept as running
   * totals, so a number can never disagree with the feed it sits above.
   */
  app.get("/api/admin/analytics/summary", isAuthenticated, requireOwner, async (req, res) => {
    try {
      const windowDays = Math.min(90, Math.max(1, Number(req.query.days) || 7));
      const since = days(windowDays);

      const [totals] = await db.select({
        events: sql<number>`count(*)::int`,
        visitors: countPeople,
        sessions: sql<number>`count(DISTINCT ${activityEvents.sessionId})::int`,
        accounts: sql<number>`count(DISTINCT ${activityEvents.userId})::int`,
        pageViews: sql<number>`count(*) FILTER (WHERE ${activityEvents.name} = ${ACTIVITY_EVENTS.pageView})::int`,
        actions: sql<number>`count(*) FILTER (WHERE ${activityEvents.name} = ${ACTIVITY_EVENTS.apiWrite})::int`,
        failures: sql<number>`count(*) FILTER (WHERE ${activityEvents.status} >= 400)::int`,
      }).from(activityEvents).where(gte(activityEvents.createdAt, since));

      const [now] = await db.select({
        online: countPeople,
      }).from(activityEvents).where(gte(activityEvents.createdAt, minutes(ONLINE_WINDOW_MINUTES)));

      const topPages = await db.select({
        pattern: activityEvents.pattern,
        n: sql<number>`count(*)::int`,
        people: countPeople,
      }).from(activityEvents)
        .where(and(gte(activityEvents.createdAt, since), eq(activityEvents.name, ACTIVITY_EVENTS.pageView)))
        .groupBy(activityEvents.pattern)
        .orderBy(desc(sql`count(*)`))
        .limit(10);

      const topActions = await db.select({
        pattern: activityEvents.pattern,
        method: activityEvents.method,
        n: sql<number>`count(*)::int`,
        people: countPeople,
      }).from(activityEvents)
        .where(and(gte(activityEvents.createdAt, since), eq(activityEvents.name, ACTIVITY_EVENTS.apiWrite)))
        .groupBy(activityEvents.pattern, activityEvents.method)
        .orderBy(desc(sql`count(*)`))
        .limit(12);

      /*
       * Failures are grouped separately rather than being a column on the
       * actions list: a route that is used a lot and fails a lot looks healthy
       * in a top-ten by volume, and that's the one worth finding.
       */
      const failing = await db.select({
        pattern: activityEvents.pattern,
        method: activityEvents.method,
        status: activityEvents.status,
        n: sql<number>`count(*)::int`,
      }).from(activityEvents)
        .where(and(gte(activityEvents.createdAt, since), sql`${activityEvents.status} >= 400`))
        .groupBy(activityEvents.pattern, activityEvents.method, activityEvents.status)
        .orderBy(desc(sql`count(*)`))
        .limit(10);

      /* Hour by hour, so a spike has a shape rather than just a total. */
      const byHour = await db.execute<any>(sql`
        SELECT date_trunc('hour', created_at) AS hour,
               count(*)::int AS events,
               count(DISTINCT coalesce(user_id, visitor_id))::int AS people
        FROM ${activityEvents}
        WHERE created_at >= ${since}
        GROUP BY 1 ORDER BY 1
      `);

      /*
       * Where the accounts came from. Read off the user rows, not the event
       * stream: attribution is stamped once at registration and is meant to
       * still be true a year later, while the stream is swept at 90 days.
       */
      const signupSources = await db.select({
        source: users.signupSource,
        medium: users.signupMedium,
        campaign: users.signupCampaign,
        n: sql<number>`count(*)::int`,
      }).from(users)
        .where(gte(users.createdAt, since))
        .groupBy(users.signupSource, users.signupMedium, users.signupCampaign)
        .orderBy(desc(sql`count(*)`))
        .limit(20);

      res.json({
        windowDays,
        onlineNow: now?.online ?? 0,
        signupSources: signupSources.map((r) => ({
          source: r.source ?? "unknown",
          medium: r.medium ?? null,
          campaign: r.campaign ?? null,
          signups: r.n,
        })),
        onlineWindowMinutes: ONLINE_WINDOW_MINUTES,
        totals: totals ?? null,
        topPages: topPages.map((p) => ({ ...p, label: pageLabel(p.pattern) })),
        topActions: topActions.map((a) => ({ ...a, label: actionLabel(a.method || "", a.pattern) })),
        failing: failing.map((f) => ({ ...f, label: actionLabel(f.method || "", f.pattern) })),
        byHour: (byHour.rows ?? []).map((r: any) => ({
          hour: r.hour, events: Number(r.events), people: Number(r.people),
        })),
      });
    } catch (error) {
      console.error("Analytics summary error:", error);
      res.status(500).json({ message: "Couldn't build the summary" });
    }
  });

  /**
   * Recent visits, newest first, each with the path someone took through them.
   *
   * A session is the unit that answers "what happened to this person" — a feed
   * of loose events shows a hundred things and explains none of them.
   */
  app.get("/api/admin/analytics/sessions", isAuthenticated, requireOwner, async (req, res) => {
    try {
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const rows = await db.execute<any>(sql`
        SELECT s.session_id, s.visitor_id, s.user_id, s.started, s.ended, s.events,
               coalesce(p.display_name, u.first_name) AS who, u.email
        FROM (
          SELECT session_id, visitor_id,
                 max(user_id) AS user_id,
                 min(created_at) AS started,
                 max(created_at) AS ended,
                 count(*)::int AS events
          FROM ${activityEvents}
          WHERE created_at >= ${days(7)}
          GROUP BY session_id, visitor_id
        ) s
        LEFT JOIN ${users} u ON u.id = s.user_id
        LEFT JOIN ${userProfiles} p ON p.user_id = s.user_id
        ORDER BY s.ended DESC
        LIMIT ${limit}
      `);

      res.json((rows.rows ?? []).map((r: any) => ({
        sessionId: r.session_id,
        visitorId: r.visitor_id,
        userId: r.user_id,
        who: r.who || null,
        email: r.email || null,
        startedAt: r.started,
        endedAt: r.ended,
        events: Number(r.events),
        /* Wall-clock length of the visit; a single-event visit is 0, correctly. */
        durationMs: new Date(r.ended).getTime() - new Date(r.started).getTime(),
      })));
    } catch (error) {
      console.error("Analytics sessions error:", error);
      res.status(500).json({ message: "Couldn't load sessions" });
    }
  });

  /** Everything that happened in one visit, in order. */
  app.get("/api/admin/analytics/sessions/:id", isAuthenticated, requireOwner, async (req, res) => {
    try {
      const rows = await feedQuery()
        .where(eq(activityEvents.sessionId, String(req.params.id)))
        .orderBy(activityEvents.seq)
        .limit(500);
      res.json(rows.map(describe));
    } catch (error) {
      console.error("Analytics session detail error:", error);
      res.status(500).json({ message: "Couldn't load that session" });
    }
  });

  /**
   * Confirms to the client whether this account may see any of the above.
   *
   * Open to any signed-in account and answers false rather than 404, because
   * the client needs to know whether to render the tab at all — and "there is
   * an owner console and you are not the owner" is not a secret worth keeping
   * from someone already signed in.
   */
  app.get("/api/admin/analytics/access", isAuthenticated, async (req: any, res) => {
    const { isOwner } = await import("./platform-roles");
    res.json({ owner: isOwner(req.user?.email) });
  });
}
