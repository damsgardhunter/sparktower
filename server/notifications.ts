/**
 * The hook that closes the Explore loop.
 *
 * Discover → follow or connect → read their progress → comment or message →
 * and then *come back*. Nothing brought anyone back: a follow notified nobody,
 * a reply to your comment waited for you to reopen the post, and "new since you
 * looked" lived in one browser's local storage. This records what happened to
 * someone, server-side, so every device shows the same bell and the same
 * "N new from people you follow".
 *
 * In-app only, like the rest of SparkTower's pings. Recording fails soft: a
 * notification is never worth failing the post, comment or follow that caused
 * it, so every emitter can call this without a try/catch of its own.
 */
import type { Express } from "express";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import {
  notifications, projectFollows, projectMembers, projects, userFollows, users, userProfiles, feedComments, projectKanbanTasks,
  type NotificationKind,
} from "@shared/schema";
import { notificationHref, notificationText, PATH_FOCUS } from "@shared/notifications";
import { goalOfBackboneId, isProjectGoal, sectionOfTask, type ProjectGoal } from "@shared/goals";

/** Past this many recipients a single post is a broadcast, and a broadcast is the feed's job. */
const MAX_FANOUT = 1000;

const clip = (text: string | null | undefined, n = 140) => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t ? (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t) : null;
};

/**
 * Records one thing that happened, for each recipient. The actor never
 * notifies themselves. The same actor doing the same thing to the same target
 * again (reacting twice, re-following) refreshes the row to unread rather than
 * stacking another.
 */
export async function notify(input: {
  recipients: (string | null | undefined)[];
  actorId: string;
  kind: NotificationKind;
  targetId: string;
  postId?: string | null;
  projectId?: string | null;
  excerpt?: string | null;
  /** For what the system tells someone about their own work ("your next step is ready"). */
  allowSelf?: boolean;
  /** Record it once and never resurface it — a nudge, not an event that can recur. */
  once?: boolean;
}): Promise<void> {
  try {
    const recipients = [...new Set(input.recipients.filter((r): r is string => !!r && (input.allowSelf || r !== input.actorId)))].slice(0, MAX_FANOUT);
    if (!recipients.length) return;
    const excerpt = clip(input.excerpt);
    const insert = db.insert(notifications).values(recipients.map((recipientId) => ({
      recipientId, actorId: input.actorId, kind: input.kind, targetId: input.targetId,
      postId: input.postId ?? null, projectId: input.projectId ?? null, excerpt,
    })));
    if (input.once) await insert.onConflictDoNothing();
    else await insert.onConflictDoUpdate({
      target: [notifications.recipientId, notifications.actorId, notifications.kind, notifications.targetId],
      set: { readAt: null, createdAt: sql`now()`, excerpt },
    });
  } catch (err) {
    console.error("[notifications] couldn't record (non-fatal):", err);
  }
}

/** Takes back a notification nobody has read yet: an un-react, an unfollow. */
export async function unnotify(input: { actorId: string; kind: NotificationKind; targetId: string }): Promise<void> {
  try {
    await db.delete(notifications).where(and(
      eq(notifications.actorId, input.actorId), eq(notifications.kind, input.kind),
      eq(notifications.targetId, input.targetId), isNull(notifications.readAt),
    ));
  } catch (err) {
    console.error("[notifications] couldn't retract (non-fatal):", err);
  }
}

/**
 * A new post, to everyone who follows its author or its project. A private
 * project's post reaches only its team — following can't see through privacy.
 */
export async function notifyFollowersOfPost(post: { id: string; authorId: string; projectId: string | null; content: string }): Promise<void> {
  try {
    let recipients: string[] = [];
    const project = post.projectId ? (await db.select({ isPrivate: projects.isPrivate, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, post.projectId)))[0] : null;
    const byAuthor = await db.select({ id: userFollows.followerId }).from(userFollows).where(eq(userFollows.followeeId, post.authorId));
    const byProject = post.projectId ? await db.select({ id: projectFollows.userId }).from(projectFollows).where(eq(projectFollows.projectId, post.projectId)) : [];
    recipients = [...byAuthor, ...byProject].map((r) => r.id);
    if (project?.isPrivate) {
      const team = new Set([project.ownerId, ...(await db.select({ id: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, post.projectId!))).map((m) => m.id)]);
      recipients = recipients.filter((r) => team.has(r));
    }
    await notify({ recipients, actorId: post.authorId, kind: "followed_post", targetId: post.id, postId: post.id, projectId: post.projectId, excerpt: post.content });
  } catch (err) {
    console.error("[notifications] follower fan-out failed (non-fatal):", err);
  }
}

/**
 * A comment on a post: the post's author hears about it, the author of the
 * comment it replies to hears about the reply, and anyone @mentioned hears
 * they were. Each person gets the most specific one, once.
 */
export async function notifyComment(input: {
  commentId: string; postId: string; postAuthorId: string; projectId: string | null;
  actorId: string; content: string; parentCommentId?: string | null; mentionIds?: string[];
}): Promise<void> {
  const told = new Set<string>([input.actorId]);
  const send = async (recipient: string | null | undefined, kind: NotificationKind) => {
    if (!recipient || told.has(recipient)) return;
    told.add(recipient);
    await notify({ recipients: [recipient], actorId: input.actorId, kind, targetId: input.commentId, postId: input.postId, projectId: input.projectId, excerpt: input.content });
  };
  if (input.parentCommentId) {
    const [parent] = await db.select({ authorId: feedComments.authorId }).from(feedComments).where(eq(feedComments.id, input.parentCommentId)).catch(() => []);
    await send(parent?.authorId, "reply");
  }
  for (const m of input.mentionIds ?? []) await send(m, "mention");
  await send(input.postAuthorId, "comment");
}

/**
 * Where a path notification should land: the section its step is on, and what
 * to focus. Worked out when the bell is read rather than stored, so older
 * notifications link properly too.
 *
 *  - path_step_done: its target is the finished board task — the section from
 *    its tags; focus the section's next step, which is what the team does now.
 *  - next_step: its target is `projectId:milestoneId` — the section from the
 *    milestone's prefix; focus that milestone, so the dashboard can say when
 *    it's been done since.
 *  - weekly_update: the project's, not a section's; focus the weekly update.
 */
async function pathTargets(rows: { id: string; kind: string; targetId: string; projectId: string | null }[]): Promise<Map<string, { section: ProjectGoal | null; focus: string }>> {
  const out = new Map<string, { section: ProjectGoal | null; focus: string }>();
  const doneTaskIds = [...new Set(rows.filter((r) => r.kind === "path_step_done").map((r) => r.targetId))];
  const tasks = doneTaskIds.length
    ? await db.select({ id: projectKanbanTasks.id, tags: projectKanbanTasks.tags, primary: projects.goal })
      .from(projectKanbanTasks).innerJoin(projects, eq(projects.id, projectKanbanTasks.projectId))
      .where(inArray(projectKanbanTasks.id, doneTaskIds)).catch(() => [])
    : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const r of rows) {
    if (r.kind === "path_step_done") {
      const task = byId.get(r.targetId);
      const primary = isProjectGoal(task?.primary) ? task!.primary : null;
      out.set(r.id, { section: task && primary ? sectionOfTask(task.tags, primary) ?? primary : null, focus: PATH_FOCUS.next });
    } else if (r.kind === "next_step") {
      const milestoneId = r.targetId.slice(r.targetId.indexOf(":") + 1);
      out.set(r.id, { section: goalOfBackboneId(milestoneId), focus: milestoneId || PATH_FOCUS.next });
    } else if (r.kind === "weekly_update") {
      out.set(r.id, { section: null, focus: PATH_FOCUS.weekly });
    }
  }
  return out;
}

export function registerNotificationRoutes(app: Express) {
  /**
   * The bell: newest first, each with who did it and where it goes. Anything
   * whose post has since gone — deleted, taken down, or on a project that went
   * private — is left out rather than linking to a dead page.
   */
  app.get("/api/notifications", isAuthenticated, async (req: any, res) => {
    try {
      const me = req.user.id as string;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
      const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
      const rows = await db.select({
        n: notifications,
        firstName: users.firstName, lastName: users.lastName, email: users.email, profileImageUrl: users.profileImageUrl,
        displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl,
        projectTitle: projects.title,
      }).from(notifications)
        .innerJoin(users, eq(users.id, notifications.actorId))
        .leftJoin(userProfiles, eq(userProfiles.userId, notifications.actorId))
        .leftJoin(projects, eq(projects.id, notifications.projectId))
        .where(and(eq(notifications.recipientId, me), before && !isNaN(before.getTime()) ? lt(notifications.createdAt, before) : undefined))
        .orderBy(desc(notifications.createdAt))
        .limit(limit);

      const paths = await pathTargets(rows.map((r) => r.n));
      const items = [];
      for (const r of rows) {
        if (r.n.postId) {
          const post = await storage.getFeedPost(r.n.postId, me);
          if (!post || post.hiddenAt || (post.project?.isPrivate && !post.viewerIsTeam)) continue;
        }
        const actorName = r.displayName || [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "Someone";
        const shaped = { kind: r.n.kind, actorId: r.n.actorId, postId: r.n.postId, projectId: r.n.projectId, targetId: r.n.targetId, actorName, projectTitle: r.projectTitle ?? null, ...paths.get(r.n.id) };
        items.push({
          id: r.n.id, kind: r.n.kind, createdAt: r.n.createdAt, read: !!r.n.readAt,
          actor: { id: r.n.actorId, name: actorName, avatarUrl: r.avatarUrl || r.profileImageUrl || null },
          project: r.n.projectId ? { id: r.n.projectId, title: r.projectTitle ?? null } : null,
          excerpt: r.n.excerpt,
          text: notificationText(shaped),
          href: notificationHref(shaped),
        });
      }
      res.json({ items, nextCursor: rows.length === limit ? rows[rows.length - 1].n.createdAt : null });
    } catch (error) {
      console.error("Notifications error:", error);
      res.status(500).json({ message: "Couldn't load notifications" });
    }
  });

  /** Counts for the bell and the home feed's "new from people you follow". */
  app.get("/api/notifications/unread-count", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db.select({ kind: notifications.kind, n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.recipientId, req.user.id), isNull(notifications.readAt)))
        .groupBy(notifications.kind);
      const count = rows.reduce((sum, r) => sum + r.n, 0);
      res.json({ count, followedPosts: rows.find((r) => r.kind === "followed_post")?.n ?? 0 });
    } catch (error) {
      console.error("Notification count error:", error);
      res.status(500).json({ message: "Couldn't count notifications" });
    }
  });

  /** Marks read: some by id, one kind (opening the Following feed reads its posts), everything about one post (opening it), or everything. */
  app.post("/api/notifications/read", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const me = req.user.id as string;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 100) : null;
      const kind = typeof req.body?.kind === "string" ? req.body.kind : null;
      const postId = typeof req.body?.postId === "string" ? req.body.postId : null;
      if (!ids?.length && !kind && !postId && req.body?.all !== true) {
        return res.status(400).json({ message: "Say which: ids, a kind, or all.", code: "invalid_input" });
      }
      await db.update(notifications).set({ readAt: sql`now()` }).where(and(
        eq(notifications.recipientId, me), isNull(notifications.readAt),
        ids?.length ? inArray(notifications.id, ids) : undefined,
        kind ? eq(notifications.kind, kind as NotificationKind) : undefined,
        postId ? eq(notifications.postId, postId) : undefined,
      ));
      res.json({ ok: true });
    } catch (error) {
      console.error("Notification read error:", error);
      res.status(500).json({ message: "Couldn't mark those read" });
    }
  });
}
