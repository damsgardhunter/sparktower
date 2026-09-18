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
 * Every view also writes an activity event, so the count can always be checked
 * against the record it came from — which is how the numbers above were found.
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
}

/** Who this is, for counting purposes: the account if signed in, otherwise the browser. */
const viewerKey = (who: ViewerContext): string | null => who.userId ?? who.visitorId ?? null;

export type ViewOutcome = "counted" | "own" | "repeat" | "crawler" | "unknown-viewer";

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
   * The event is written either way, with the verdict on it. A view that didn't
   * count is still something that happened, and keeping it is what makes the
   * counter checkable afterwards.
   */
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
