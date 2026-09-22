/**
 * One place that decides whether a piece of content is readable by the public.
 *
 * Every takedown target grew the same three columns (`hidden_at`,
 * `hidden_by_id`, `hidden_reason`) and then every read that serves a stranger
 * grew its own hand-written `isNull(x.hiddenAt)` beside them. That is a policy
 * held in forty places, and a policy held in forty places is a policy with
 * thirty-nine chances to be forgotten: the failure it produces is silent — the
 * reviewer presses Remove, the queue says "actioned", the log is honest, and
 * the content is still on one list somebody didn't think of. A published
 * artifact page had no hidden column at all, so /a/:id served a page nobody on
 * the platform could take down. The hole is never in the read you are looking
 * at; it is in the one written next week.
 *
 * So the condition is written once, here, and imported. Two rules:
 *
 *   1. Hidden is gone. A reviewer took it down, so it is not served.
 *   2. The author's account is live. A suspension blocks writes and nothing
 *      else, so without this a spammer's posts, comments and pages went on
 *      being served by the site that had just banned them — and a closed
 *      account's words went on being published by a product its owner had
 *      left.
 *
 * Everything returns a drizzle `SQL`, so it composes into an existing
 * `and()`/`or()` without a join and without changing a query's row shape. The
 * author test is an `exists` subquery rather than a join for exactly that
 * reason: adding `.innerJoin(users, …)` to a `db.select()` with no explicit
 * projection silently rewrites every row into `{ feed_posts, users }`, which
 * is the kind of change that compiles in one caller and breaks the next.
 *
 * This file imports nothing but the schema — like server/block-sql.ts, and for
 * the same reason: it is used from inside storage, so anything it pulled in
 * would be a cycle waiting to evaluate in the wrong order.
 *
 * A read that must NOT apply this (the moderation queue, the admin content
 * routes, a team's own workspace) is listed by name in
 * test/unit/visibility-guards.test.ts with a written reason. That test walks
 * this source and fails when a read of a content table goes through neither.
 */
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { feedComments, feedPosts, pathArtifacts, projectComments, projects, users } from "@shared/schema";

/**
 * "Whoever wrote this still has an account in good standing" — not suspended,
 * not closed.
 *
 * Takes the column holding the author's id (`feedPosts.authorId`,
 * `projects.ownerId`, …) rather than a joined `users` table, so it drops into
 * a `where` that has no join to `users` at all. `not exists` on a primary key
 * costs an index probe.
 */
export function authorIsLive(authorId: any): SQL {
  return sql`exists (
    select 1 from ${users} vu
    where vu.id = ${authorId}
      and vu.suspended_at is null
      and vu.deleted_at is null
  )`;
}

/**
 * The strict public condition for each content table: taken down is gone, and
 * a suspended or closed author's work is gone with them.
 *
 * Use these for anything that lists content to strangers — the feed, Discover,
 * search, the sitemap, scouting, a profile's public side. No author exception:
 * a list is what other people see, and a person's own hidden post reappearing
 * on the public feed because they happen to be the viewer is the bug this
 * whole file exists to stop.
 */
export const publiclyVisible = {
  feedPost: (): SQL => and(isNull(feedPosts.hiddenAt), authorIsLive(feedPosts.authorId))!,
  feedComment: (): SQL => and(isNull(feedComments.hiddenAt), authorIsLive(feedComments.authorId))!,
  projectComment: (): SQL => and(isNull(projectComments.hiddenAt), authorIsLive(projectComments.authorId))!,
  project: (): SQL => and(isNull(projects.hiddenAt), authorIsLive(projects.ownerId))!,
  pathArtifact: (): SQL => and(isNull(pathArtifacts.hiddenAt), authorIsLive(pathArtifacts.authorId))!,
};

/**
 * The same rules for a read of one thing, where the person asking may be the
 * person who wrote it.
 *
 * A post or a reply stays readable to its own author after a takedown, with
 * the reason on it. That is deliberate and it is not a loophole: somebody has
 * to be told what was removed and why, or the first they know of it is that
 * their work quietly stopped existing — and an appeal against a decision
 * nobody described is not an appeal. It reaches exactly one person, the one
 * who already had the words.
 *
 * A suspension doesn't hide their writing from them either, for the same
 * reason: it is about what they can do to other people.
 *
 * Only for single-item reads. The lists use `publiclyVisible`, so a hidden
 * post never comes back onto the feed just because its author is scrolling.
 */
export function feedPostVisibleTo(viewerId?: string | null): SQL {
  return viewerId
    ? or(publiclyVisible.feedPost(), eq(feedPosts.authorId, viewerId))!
    : publiclyVisible.feedPost();
}

export function feedCommentVisibleTo(viewerId?: string | null): SQL {
  return viewerId
    ? or(publiclyVisible.feedComment(), eq(feedComments.authorId, viewerId))!
    : publiclyVisible.feedComment();
}

/**
 * Project comments, which are the one kind that can be shadow-hidden — and
 * which therefore work the other way round from a post.
 *
 * A *removed* project comment is gone for its author too; a *shadow*-hidden
 * one reads as posted to them and to nobody else. That is the entire
 * difference between the two, and it is why the author exception here is
 * narrower than the one above rather than the same rule repeated.
 */
export function projectCommentVisibleTo(viewerId?: string | null): SQL {
  if (!viewerId) return publiclyVisible.projectComment();
  return or(
    publiclyVisible.projectComment(),
    // Mine, and not taken down: a suspension doesn't hide my words from me.
    and(isNull(projectComments.hiddenAt), eq(projectComments.authorId, viewerId)),
    // Mine, shadow-hidden: it reads as posted, which is the point of a shadow-hide.
    and(eq(projectComments.hiddenMode, "shadow"), eq(projectComments.authorId, viewerId)),
  )!;
}

/**
 * A published artifact page, in full.
 *
 * `/a/:id` and `GET /api/public/artifacts/:id` are read by people with no
 * account, which makes them the furthest-reaching surface on the site and the
 * one where a missed takedown costs most. Four conditions, all of which the
 * sitemap repeats so a listed URL can never 404:
 *
 *   - the artifact itself is not taken down (`path_artifacts.hidden_at`),
 *   - its project is not taken down,
 *   - its author's account is live,
 *   - and the project owner's is too — an artifact is published in a project's
 *     name, so a suspended owner takes the project's pages down with them even
 *     when a co-founder wrote the step.
 *
 * The caller still checks `visibility = 'public'` and the project's privacy;
 * those are the builder's own choices, not moderation's.
 */
export const publicArtifactVisible = (): SQL => and(
  publiclyVisible.pathArtifact(),
  isNull(projects.hiddenAt),
  authorIsLive(projects.ownerId),
)!;

/**
 * The takedown half on its own: hidden is gone, and nothing is said about the
 * author's account.
 *
 * For reads that never leave the people already inside the work — a project
 * team's own feedback inbox, the summaries Nova assembles from a project's
 * updates, the board a company reads about itself. A takedown still applies
 * there, because a reviewer removing something means it is removed; a
 * *suspension* deliberately does not, because suspending one member of a team
 * must not delete that project's history from the other members' view of their
 * own workspace. They are being punished for nothing.
 *
 * If you are not certain a read is team-only, it isn't: use `publiclyVisible`.
 */
export const notTakenDown = {
  feedPost: (): SQL => isNull(feedPosts.hiddenAt),
  feedComment: (): SQL => isNull(feedComments.hiddenAt),
  projectComment: (): SQL => isNull(projectComments.hiddenAt),
  project: (): SQL => isNull(projects.hiddenAt),
  pathArtifact: (): SQL => isNull(pathArtifacts.hiddenAt),
};
