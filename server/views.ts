/**
 * Counting who looked at something, in a way that means what it says.
 *
 * `projects.views` was incremented on every `GET /api/projects/:id`, with no
 * exceptions. The route is what the owner's own dashboard reads, and the client
 * refetches it, so the number counted the owner refreshing their own page. In
 * this database, when that was found:
 *
 *     project                 views   people who ever opened it   not the owner
 *     SparkTower                450                           2               1
 *     Harbor Studio              81                           1               0
 *     Crewline                   47                           1               0
 *
 * Eighty-one is a real number and it is not a number of viewers. It was shown
 * to visitors as social proof and fed the views leaderboard, which means the
 * leaderboard ranked whoever kept their own tab open.
 *
 * A view is counted here only when all three are true:
 *
 *   - somebody other than the owner or a member is looking. Your own visit to
 *     your own thing is not an audience.
 *   - that viewer has not been counted for this thing today. A refresh, a
 *     back-button, and a client refetch are one visit.
 *   - the request looks like a person rather than a crawler.
 *
 * A view by a person also writes an activity event, counted or not, so the
 * count can always be checked against the record it came from — which is how
 * the numbers above were found. What it deliberately does not record is the
 * automated half: crawlers, requests with no visitor at all, and anything
 * arriving faster than a person can read. See the note above `recordActivity`
 * below, and `VIEWS_PER_ADDRESS_PER_WINDOW`.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import { activityEvents } from "@shared/schema";
import { recordActivity } from "./analytics";

/**
 * One visit per viewer per thing per day.
 *
 * Passed to `make_interval` as a parameter rather than pasted into the SQL:
 * this repository refuses `sql.raw` outright (test/unit/sql-parameterized.test.ts)
 * so that nobody has to judge, case by case, whether a particular piece of
 * string-building happens to be safe today.
 */
const WINDOW_HOURS = 24;

/** The obvious ones. A determined crawler lies, but an honest one says so and shouldn't inflate anything. */
const CRAWLER = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|curl|wget|python-requests|headless/i;

export interface ViewerContext {
  /** The signed-in account, when there is one. */
  userId?: string | null;
  /** The browser, for people with no account — set by the analytics cookie. */
  visitorId?: string | null;
  sessionId?: string | null;
  userAgent?: string | null;
  path?: string | null;
  referrer?: string | null;
  /** The request's address, for the per-address cap on recording. */
  address?: string | null;
}

/** Who this is, for counting purposes: the account if signed in, otherwise the browser. */
const viewerKey = (who: ViewerContext): string | null => who.userId ?? who.visitorId ?? null;

export type ViewOutcome = "counted" | "own" | "repeat" | "crawler" | "unknown-viewer" | "flooding";

/**
 * How many views one address may have *recorded* in a window.
 *
 * Recording a view is a write and an indexed read, on an endpoint anybody can
 * call with no account and no rate limit — it is a GET, so the write floor
 * (server/moderation.ts) never sees it. Nothing stopped one machine walking
 * every project id in a loop, or sending the same id with a fresh visitor
 * cookie each time: each request wrote an activity row and ran the
 * twenty-four-hour lookup, and the table it was writing to is the one the
 * lookup scans.
 *
 * Kept in memory on purpose. A limiter that writes a row to count a write
 * doubles the cost of the thing it is protecting against, and the counting
 * here does not have to be exact — it has to stop a loop. Per instance is
 * enough for that: a script that gets N times the limit across N instances is
 * still bounded, where before it was not bounded at all.
 */
const VIEWS_PER_ADDRESS_PER_WINDOW = 120;
const VIEW_WINDOW_MS = 10 * 60_000;
/** Bounded, so the limiter itself can't be turned into the memory leak. */
const MAX_TRACKED_ADDRESSES = 20_000;

const viewsByAddress = new Map<string, { windowStart: number; n: number }>();

/** True when this address still has room to have a view recorded for it. */
function addressHasRoom(address: string | null | undefined): boolean {
  if (!address) return true;
  const now = Date.now();
  const seen = viewsByAddress.get(address);
  if (!seen || now - seen.windowStart >= VIEW_WINDOW_MS) {
    /*
     * Sweep on insert rather than on a timer: the map only grows when new
     * addresses arrive, so that is the moment it is worth looking at. Dropping
     * everything expired keeps this O(1) amortised.
     */
    if (!seen && viewsByAddress.size >= MAX_TRACKED_ADDRESSES) {
      for (const [k, v] of viewsByAddress) if (now - v.windowStart >= VIEW_WINDOW_MS) viewsByAddress.delete(k);
      // Still full: every address is inside its window, so stop recording new
      // ones rather than growing without limit. Views are a nice-to-have number.
      if (viewsByAddress.size >= MAX_TRACKED_ADDRESSES) return false;
    }
    viewsByAddress.set(address, { windowStart: now, n: 1 });
    return true;
  }
  if (seen.n >= VIEWS_PER_ADDRESS_PER_WINDOW) return false;
  seen.n += 1;
  return true;
}

/** For tests, which must not inherit a window from the test before. */
export function resetViewLimiter(): void {
  viewsByAddress.clear();
}

/**
 * Records that somebody looked at a project or a profile, and says whether it
 * counted. The caller decides what to do with the answer; nothing here throws.
 */
export async function recordView(opts: {
  kind: "project" | "profile";
  /** The project or the profile's account. */
  targetId: string;
  /** Whose thing it is — the project's owner, or the profile's own account. */
  ownerId: string | null;
  /** Everyone who counts as "this is mine": the owner and any members. */
  insiders?: string[];
  viewer: ViewerContext;
}): Promise<ViewOutcome> {
  const { kind, targetId, ownerId, insiders = [], viewer } = opts;
  const key = viewerKey(viewer);

  const outcome = await (async (): Promise<ViewOutcome> => {
    if (!key) return "unknown-viewer";
    if (CRAWLER.test(viewer.userAgent ?? "")) return "crawler";
    if (viewer.userId && (viewer.userId === ownerId || insiders.includes(viewer.userId))) return "own";
    // Before the repeat check, not after: the check is the expensive half, and
    // an address sending views in a loop must not get to run it every time.
    if (!addressHasRoom(viewer.address)) return "flooding";

    try {
      const [seen] = await db
        .select({ id: activityEvents.id })
        .from(activityEvents)
        .where(sql`
          ${activityEvents.name} = ${`${kind}.view`}
          and ${activityEvents.props}->>'targetId' = ${targetId}
          and coalesce(${activityEvents.userId}, ${activityEvents.visitorId}) = ${key}
          and ${activityEvents.createdAt} > now() - make_interval(hours => ${WINDOW_HOURS})
        `)
        .limit(1);
      if (seen) return "repeat";
    } catch (err) {
      /*
       * If the check itself fails, don't count. An uncountable view is a number
       * that stays honest; a view counted because a query errored is the bug
       * this file exists to fix.
       */
      console.error("[views] couldn't tell whether this was a repeat:", (err as Error)?.message ?? err);
      return "repeat";
    }
    return "counted";
  })();

  /*
   * A view that didn't count is still written — but only when writing it says
   * something. "Somebody who isn't on the team looked at this and we didn't
   * count it because it's their second look today" is the record that makes
   * the counter checkable, and that is what `own` and `repeat` are.
   *
   * `crawler`, `unknown-viewer` and `flooding` are not. They are, between them,
   * every automated hit on a public page: a crawler sweep, a request with no
   * cookie at all, a script in a loop. Writing a row for each meant an
   * unauthenticated GET — the only kind of request no rate limit can refuse —
   * could grow the busiest table in the database as fast as it could send, and
   * each of those rows then made the repeat lookup above slower for everybody
   * else. None of them can ever become a counted view, so none of them is
   * evidence about a number; they are just the cost of having a public page.
   */
  if (outcome === "crawler" || outcome === "unknown-viewer" || outcome === "flooding") return outcome;

  void recordActivity({
    name: `${kind}.view`,
    userId: viewer.userId ?? null,
    visitorId: viewer.visitorId ?? "unknown",
    sessionId: viewer.sessionId ?? "unknown",
    path: viewer.path ?? `/${kind}s/${targetId}`,
    projectId: kind === "project" ? targetId : null,
    referrer: viewer.referrer ?? null,
    userAgent: viewer.userAgent ?? null,
    props: { targetId, kind, outcome },
  });

  return outcome;
}

/** How many distinct people have looked at this, from the record rather than a counter. */
export async function countViews(kind: "project" | "profile", targetId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(distinct coalesce(${activityEvents.userId}, ${activityEvents.visitorId}))::int` })
    .from(activityEvents)
    .where(sql`
      ${activityEvents.name} = ${`${kind}.view`}
      and ${activityEvents.props}->>'targetId' = ${targetId}
      and ${activityEvents.props}->>'outcome' = 'counted'
    `);
  return row?.n ?? 0;
}
