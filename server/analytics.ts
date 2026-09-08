/**
 * Capturing behaviour.
 *
 * One middleware records every write the API takes; one endpoint takes the page
 * views the client is the only witness to. Between them the surface is covered
 * without a single `track()` call scattered through the route files — which
 * matters more than it sounds, because hand-placed calls are complete on the
 * day they're written and quietly wrong from the next route onwards.
 *
 * Everything here is fire-and-forget. Analytics failing must never fail the
 * request it was watching: losing a row is nothing, losing someone's check-in
 * because the stream hiccuped is the product.
 */
import type { Express, RequestHandler } from "express";
import { randomUUID } from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { activityEvents } from "@shared/schema";
import { readCookies, setCookie, isDocumentRequest } from "./http-cookies";
import {
  ACTIVITY_EVENTS, MAX_BATCH_EVENTS, RETENTION_DAYS, SESSION_IDLE_MINUTES,
  routePattern,
} from "@shared/analytics";

/** Cookie holding the visitor id. Not httpOnly: the client stamps events too. */
const VISITOR_COOKIE = "st_vid";
const SESSION_COOKIE = "st_sid";
const COOKIE_MAX_AGE_DAYS = 365;

/**
 * Writes the stream doesn't want to see.
 *
 * The console watching itself would fill the feed with the act of reading the
 * feed, and the ingest endpoint would record its own arrival.
 */
const IGNORED = [/^\/api\/track$/, /^\/api\/admin\/analytics/];

/**
 * Gives every request a visitor and a session, minting them if absent.
 *
 * The session cookie's own lifetime does the idle timeout: it's refreshed on
 * each request with a fresh 30 minutes, so it expires exactly when someone has
 * been quiet that long and the next request starts a new visit. No timestamp to
 * store and no sweep to run.
 */
export const attachVisitor: RequestHandler = (req: any, res, next) => {
  /*
   * The HTML document and API calls, and nothing else.
   *
   * The document matters because it arrives *alone*. Everything the app does
   * on load — the auth check, the profile, the surfaces, the first page view —
   * goes out in parallel, so on a first visit several requests arrive at once
   * each carrying no cookie, and each mints its own visitor id. The browser
   * keeps whichever reply lands last and the rest survive as rows: one person
   * showing up as four. Stamping the document first means every one of those
   * calls already has an id to send.
   *
   * Assets are excluded because this middleware sits above the static handler,
   * and a response carrying Set-Cookie is what most caches and CDNs treat as
   * uncacheable — an expensive way to learn nothing.
   */
  if (!req.path.startsWith("/api") && !isDocumentRequest(req)) return next();

  try {
    const jar = readCookies(req);

    let visitorId = jar[VISITOR_COOKIE];
    if (!visitorId || visitorId.length > 64) {
      visitorId = randomUUID();
      setCookie(res, VISITOR_COOKIE, visitorId, COOKIE_MAX_AGE_DAYS * 24 * 60 * 60);
    }

    let sessionId = jar[SESSION_COOKIE];
    const isNewSession = !sessionId || sessionId.length > 64;
    if (isNewSession) sessionId = randomUUID();
    setCookie(res, SESSION_COOKIE, sessionId!, SESSION_IDLE_MINUTES * 60);

    req.visitorId = visitorId;
    req.sessionId = sessionId;

    /*
     * "Arrived" is emitted here rather than by the client, because the client
     * can't know: the session cookie is the only thing that knows whether this
     * is a fresh visit or the twentieth page of an old one, and the server owns
     * it. Every visit therefore opens with one, so a trail starts at the
     * beginning instead of at whatever the person happened to click first.
     *
     * Not filtered by IGNORED, unlike the action capture below. A new visitor's
     * very first request is almost always the page view they send on load —
     * which is `/api/track`, which is ignored — so filtering here suppressed
     * "Arrived" in precisely the case it exists for. The session did start on
     * that request; that it's a request we don't want an *action* row for is a
     * separate question.
     */
    if (isNewSession) {
      void recordActivity({
        name: ACTIVITY_EVENTS.sessionStart,
        userId: req.user?.id ?? null,
        visitorId,
        sessionId: sessionId!,
        path: req.originalUrl || req.path,
        referrer: typeof req.headers.referer === "string" ? req.headers.referer : null,
        userAgent: req.headers["user-agent"],
      });
    }
  } catch {
    // A cookie problem must not cost someone the page.
    req.visitorId = req.visitorId || "unknown";
    req.sessionId = req.sessionId || "unknown";
  }
  next();
};

export interface ActivityInput {
  name: string;
  userId?: string | null;
  visitorId: string;
  sessionId: string;
  path: string;
  method?: string | null;
  status?: number | null;
  durationMs?: number | null;
  projectId?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  props?: Record<string, unknown>;
}

/** Writes one row. Never throws, never awaited on a request path. */
export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    await db.insert(activityEvents).values({
      name: input.name,
      userId: input.userId ?? null,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
      path: input.path.slice(0, 500),
      pattern: routePattern(input.path).slice(0, 500),
      method: input.method ?? null,
      status: input.status ?? null,
      durationMs: input.durationMs ?? null,
      projectId: input.projectId ?? null,
      referrer: input.referrer?.slice(0, 500) ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
      props: input.props ?? {},
    });
  } catch (err) {
    console.error("[analytics] Failed to record activity:", err);
  }
}

/** Pulls a project id out of a path, so activity can be attributed to one. */
function projectIdFrom(path: string): string | null {
  const m = path.match(/\/api\/projects\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

/**
 * Records every write.
 *
 * Reads are skipped — see the note in shared/analytics.ts. Recorded on `finish`
 * so the status and duration are real rather than predicted, and detached from
 * the response so nothing waits on a database insert.
 */
export const captureWrites: RequestHandler = (req: any, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (!req.path.startsWith("/api")) return next();
  if (IGNORED.some((re) => re.test(req.path))) return next();

  const started = Date.now();
  res.on("finish", () => {
    void recordActivity({
      name: ACTIVITY_EVENTS.apiWrite,
      // Read at finish, not at entry: sign-in and sign-out both change who the
      // request belongs to partway through.
      userId: req.user?.id ?? null,
      visitorId: req.visitorId || "unknown",
      sessionId: req.sessionId || "unknown",
      path: req.originalUrl || req.path,
      method: req.method,
      status: res.statusCode,
      durationMs: Date.now() - started,
      projectId: projectIdFrom(req.path),
      userAgent: req.headers["user-agent"],
    });
  });

  next();
};

export function registerAnalyticsIngest(app: Express) {
  /**
   * Page views from the browser.
   *
   * Open to everyone, signed in or not — a visitor reading the landing page and
   * leaving is exactly the behaviour worth seeing, and requiring an account
   * would hide it. The cost of that openness is capped: a batch is limited in
   * size, only known event names are accepted, and every row is stamped with
   * the server's own view of who is sending it rather than anything the body
   * claims.
   */
  app.post("/api/track", async (req: any, res) => {
    // Answer immediately. The client has nothing to do with the outcome, and
    // this endpoint is on the path of every page change.
    res.status(202).json({ ok: true });

    try {
      const batch = Array.isArray(req.body?.events) ? req.body.events : [];
      // Page views only. "Arrived" is the server's to emit — see attachVisitor.
      const allowed = new Set<string>([ACTIVITY_EVENTS.pageView]);

      for (const e of batch.slice(0, MAX_BATCH_EVENTS)) {
        const name = String(e?.name || "");
        if (!allowed.has(name)) continue;
        const path = String(e?.path || "/").slice(0, 500);

        await recordActivity({
          name,
          userId: req.user?.id ?? null,
          visitorId: req.visitorId || "unknown",
          sessionId: req.sessionId || "unknown",
          path,
          referrer: typeof e?.referrer === "string" ? e.referrer : null,
          userAgent: req.headers["user-agent"],
          props: {
            ...(typeof e?.title === "string" ? { title: e.title.slice(0, 200) } : {}),
            ...(Number.isFinite(e?.msOnPage) ? { msOnPage: Math.round(e.msOnPage) } : {}),
          },
        });
      }
    } catch (err) {
      console.error("[analytics] Track batch failed:", err);
    }
  });
}

/**
 * Sweeps rows past the retention window.
 *
 * The stream is the one table here that grows without a natural ceiling — every
 * page anyone opens is a row — so it gets an expiry rather than an assumption
 * that someone will notice.
 */
export function startAnalyticsJobs(): void {
  const sweep = async () => {
    try {
      const result = await db.delete(activityEvents).where(
        sql`${activityEvents.createdAt} < now() - interval '${sql.raw(String(RETENTION_DAYS))} days'`,
      );
      const n = (result as any)?.rowCount ?? 0;
      if (n > 0) console.log(`[analytics] Swept ${n} event(s) past ${RETENTION_DAYS} days.`);
    } catch (err) {
      console.error("[analytics] Retention sweep failed:", err);
    }
  };

  setTimeout(sweep, 120_000);
  setInterval(sweep, 24 * 60 * 60_000).unref();
}
