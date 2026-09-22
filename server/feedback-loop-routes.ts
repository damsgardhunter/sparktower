/**
 * The build loop, closed: a project's progress post gets feedback, the team
 * sees it arrive, turns a comment into a task, and a later update credits it —
 * and the people who gave that feedback are told, in the app.
 *
 * No email and no push: SparkTower's pings stay in-app. What brings each side
 * back is a count where they already look — the team's new-feedback count on
 * the project, and the commenter's "your feedback was used" card on the feed.
 *
 * The rules live in shared/feedback-loop.ts; this reads and writes them.
 */
import type { Express } from "express";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { notTakenDown } from "./visibility";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { feedComments, feedPosts, projectMembers, projects, projectKanbanTasks, users, userProfiles } from "@shared/schema";
import { feedbackStateOf, isFeedback, isNewFeedback, taskTitleFromComment, MAX_CLOSES, type FeedbackState } from "@shared/feedback-loop";
import { feedDisplayName } from "./feed-routes";
import { notify } from "./notifications";

/** Everyone on the project: its owner and its members. */
export async function projectTeam(projectId: string): Promise<Set<string> | null> {
  const [project] = await db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const members = await db.select({ userId: projectMembers.userId }).from(projectMembers).where(eq(projectMembers.projectId, projectId));
  return new Set([project.ownerId, ...members.map((m) => m.userId)]);
}

const nameOf = async (userId: string) => {
  const [row] = await db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email, displayName: userProfiles.displayName, avatarUrl: userProfiles.avatarUrl, profileImageUrl: users.profileImageUrl })
    .from(users).leftJoin(userProfiles, eq(userProfiles.userId, users.id)).where(eq(users.id, userId));
  return row ? { name: feedDisplayName(row, { displayName: row.displayName }), avatarUrl: row.avatarUrl || row.profileImageUrl || null } : { name: "Someone", avatarUrl: null };
};

const excerpt = (text: string, n = 140) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export interface FeedbackItem {
  commentId: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string; avatarUrl: string | null };
  post: { id: string; excerpt: string; asks: string[]; createdAt: Date };
  state: FeedbackState;
  isNew: boolean;
  task: { id: string; title: string; status: string } | null;
  closedByPostId: string | null;
}

/** Every piece of outside feedback on the project's posts, newest first, with its state. */
export async function projectFeedback(projectId: string) {
  const team = await projectTeam(projectId);
  if (!team) return null;
  const posts = await db.select().from(feedPosts).where(and(eq(feedPosts.projectId, projectId), notTakenDown.feedPost()));
  if (!posts.length) return { items: [] as FeedbackItem[], counts: countsOf([]) };
  const postById = new Map(posts.map((p) => [p.id, p]));
  // Taken-down comments aren't feedback anyone can act on, and the takedown
  // test belongs in the query rather than in a `.filter` a refactor can drop.
  const comments = (await db.select().from(feedComments)
    .where(and(inArray(feedComments.postId, posts.map((p) => p.id)), notTakenDown.feedComment()))
    .orderBy(desc(feedComments.createdAt)))
    .filter((c) => isFeedback(c, team) && !c.deletedAt);
  const taskIds = comments.map((c) => c.appliedTaskId).filter(Boolean) as string[];
  const tasks = taskIds.length ? await db.select({ id: projectKanbanTasks.id, title: projectKanbanTasks.title, status: projectKanbanTasks.status }).from(projectKanbanTasks).where(inArray(projectKanbanTasks.id, taskIds)) : [];
  const names = new Map<string, Awaited<ReturnType<typeof nameOf>>>();
  const items: FeedbackItem[] = [];
  for (const c of comments) {
    if (!names.has(c.authorId)) names.set(c.authorId, await nameOf(c.authorId));
    const post = postById.get(c.postId)!;
    const task = tasks.find((t) => t.id === c.appliedTaskId);
    items.push({
      commentId: c.id, content: c.content, createdAt: c.createdAt,
      author: { id: c.authorId, ...names.get(c.authorId)! },
      post: { id: post.id, excerpt: excerpt(post.content), asks: (post.asks as string[]) ?? [], createdAt: post.createdAt },
      state: feedbackStateOf(c),
      isNew: isNewFeedback(c, post),
      task: task ? { id: task.id, title: task.title, status: task.status } : null,
      closedByPostId: c.closedByPostId,
    });
  }
  return { items, counts: countsOf(items) };
}

function countsOf(items: FeedbackItem[]) {
  return {
    new: items.filter((i) => i.isNew).length,
    open: items.filter((i) => i.state === "open").length,
    applied: items.filter((i) => i.state === "applied").length,
    /** Applied, and the task behind it is done: ready to be credited in the next update. */
    readyToClose: items.filter((i) => i.state === "applied" && i.task?.status === "done").length,
    closed: items.filter((i) => i.state === "closed").length,
  };
}

/**
 * An update crediting feedback: each comment must be on this project's posts,
 * already applied and not yet closed. Returns the ones accepted, or a refusal.
 */
export async function closableComments(projectId: string, raw: unknown): Promise<{ ids: string[] } | { error: string }> {
  if (raw == null) return { ids: [] };
  if (!Array.isArray(raw)) return { error: "closesCommentIds must be a list." };
  const ids = [...new Set(raw.map(String).filter(Boolean))];
  if (!ids.length) return { ids: [] };
  if (ids.length > MAX_CLOSES) return { error: `An update can credit up to ${MAX_CLOSES} pieces of feedback.` };
  const rows = await db.select({ id: feedComments.id, appliedAt: feedComments.appliedAt, closedByPostId: feedComments.closedByPostId, projectId: feedPosts.projectId })
    .from(feedComments).innerJoin(feedPosts, eq(feedPosts.id, feedComments.postId)).where(inArray(feedComments.id, ids));
  if (rows.length !== ids.length || rows.some((r) => r.projectId !== projectId)) return { error: "That feedback isn't on this project's posts." };
  if (rows.some((r) => !r.appliedAt)) return { error: "Only feedback you've turned into work can be credited as acted on." };
  if (rows.some((r) => r.closedByPostId)) return { error: "Some of that feedback was already credited in an earlier update." };
  return { ids };
}

/**
 * Credits feedback to the update that acted on it, and tells each person who
 * gave it — the step that closes the build loop and starts it again: the
 * update they're sent to asks its own questions.
 */
export async function markClosed(update: { id: string; authorId: string; projectId: string | null }, commentIds: string[]) {
  if (!commentIds.length) return;
  const credited = await db.update(feedComments).set({ closedByPostId: update.id })
    .where(and(inArray(feedComments.id, commentIds), isNull(feedComments.closedByPostId)))
    .returning({ id: feedComments.id, authorId: feedComments.authorId, content: feedComments.content });
  for (const c of credited) {
    void notify({ recipients: [c.authorId], actorId: update.authorId, kind: "feedback_used", targetId: update.id, postId: update.id, projectId: update.projectId, excerpt: c.content });
  }
}

/**
 * Answering the update that used your feedback is the loop starting again, so
 * it also puts away the "your feedback was used" card for that update.
 */
export async function markClosureAnswered(userId: string, updatePostId: string) {
  await db.update(feedComments).set({ closureSeenAt: sql`now()` })
    .where(and(eq(feedComments.authorId, userId), eq(feedComments.closedByPostId, updatePostId), isNull(feedComments.closureSeenAt)));
}

/** The feedback a post credited, for its card: who gave it. */
export async function creditsFor(postId: string) {
  const rows = await db.select({ id: feedComments.id, authorId: feedComments.authorId }).from(feedComments).where(eq(feedComments.closedByPostId, postId));
  const out = [];
  for (const r of rows) out.push({ commentId: r.id, authorId: r.authorId, name: (await nameOf(r.authorId)).name });
  return out;
}

export function registerFeedbackLoopRoutes(app: Express) {
  /** The team's feedback inbox for a project. Members only. */
  app.get("/api/projects/:id/feedback", isAuthenticated, async (req: any, res) => {
    try {
      const team = await projectTeam(req.params.id);
      if (!team) return res.status(404).json({ message: "Project not found" });
      if (!team.has(req.user.id)) return res.status(403).json({ message: "Not a project member" });
      res.json(await projectFeedback(req.params.id));
    } catch (error) {
      console.error("Feedback inbox error:", error);
      res.status(500).json({ message: "Couldn't load the feedback" });
    }
  });

  /** The team has read it: everything on the project's posts so far is no longer new. */
  app.post("/api/projects/:id/feedback/seen", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const team = await projectTeam(req.params.id);
      if (!team) return res.status(404).json({ message: "Project not found" });
      if (!team.has(req.user.id)) return res.status(403).json({ message: "Not a project member" });
      await db.update(feedPosts).set({ feedbackSeenAt: sql`now()` }).where(eq(feedPosts.projectId, req.params.id));
      res.json({ ok: true });
    } catch (error) {
      console.error("Feedback seen error:", error);
      res.status(500).json({ message: "Couldn't mark that read" });
    }
  });

  /**
   * Turning a piece of feedback into work: a task on the project's board that
   * names who asked and links back. Doing it twice returns the same task.
   */
  app.post("/api/feed/comments/:commentId/apply", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [row] = await db.select({ comment: feedComments, projectId: feedPosts.projectId })
        .from(feedComments).innerJoin(feedPosts, eq(feedPosts.id, feedComments.postId)).where(eq(feedComments.id, req.params.commentId));
      if (!row?.projectId) return res.status(404).json({ message: "That comment isn't on a project's post." });
      const team = await projectTeam(row.projectId);
      if (!team?.has(req.user.id)) return res.status(403).json({ message: "Only the project's team can act on its feedback." });
      if (!isFeedback(row.comment, team)) return res.status(400).json({ message: "That's your team talking — feedback comes from outside it.", code: "not_feedback" });
      if (row.comment.hiddenAt || row.comment.deletedAt) return res.status(404).json({ message: "That comment is gone." });

      if (row.comment.appliedTaskId) {
        const existing = await storage.getKanbanTask(row.comment.appliedTaskId);
        if (existing) return res.json({ task: existing, created: false });
      }
      const author = await nameOf(row.comment.authorId);
      const title = String(req.body?.title ?? "").trim().slice(0, 200) || taskTitleFromComment(row.comment.content, author.name);
      const task = await storage.createKanbanTask({
        projectId: row.projectId, title,
        description: `${author.name} said, on an update:\n\n> ${row.comment.content.replace(/\n/g, "\n> ")}\n\nWhen it's done, credit it in your next update so they hear it was used.`,
        status: "todo", priority: "medium", order: 0,
        tags: ["source:feedback", `feedback:${row.comment.id}`],
      } as any);
      await db.update(feedComments).set({ appliedAt: sql`now()`, appliedById: req.user.id, appliedTaskId: task.id }).where(eq(feedComments.id, row.comment.id));
      await storage.logActivity({
        projectId: row.projectId, userId: req.user.id, action: `turned feedback from ${author.name} into a task`,
        entityType: "task", entityId: task.id,
      }).catch(() => {});
      res.json({ task, created: true });
    } catch (error) {
      console.error("Apply feedback error:", error);
      res.status(500).json({ message: "Couldn't turn that into a task" });
    }
  });

  /** Feedback I gave that a project has since credited, which I haven't seen yet. */
  app.get("/api/me/feedback-used", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db.select({ comment: feedComments, projectId: feedPosts.projectId })
        .from(feedComments).innerJoin(feedPosts, eq(feedPosts.id, feedComments.postId))
        .where(and(eq(feedComments.authorId, req.user.id), isNotNull(feedComments.closedByPostId), isNull(feedComments.closureSeenAt)))
        .orderBy(desc(feedComments.createdAt)).limit(20);
      const out = [];
      for (const r of rows) {
        const [update] = await db.select().from(feedPosts).where(and(eq(feedPosts.id, r.comment.closedByPostId!), notTakenDown.feedPost()));
        const [project] = r.projectId ? await db.select({ id: projects.id, title: projects.title, isPrivate: projects.isPrivate }).from(projects).where(eq(projects.id, r.projectId)) : [];
        // An update that's gone, or a project that went private, has nothing left to show.
        if (!update || !project || project.isPrivate) continue;
        out.push({
          commentId: r.comment.id, comment: excerpt(r.comment.content),
          project: { id: project.id, title: project.title },
          update: { id: update.id, excerpt: excerpt(update.content, 200), createdAt: update.createdAt, asks: (update.asks as string[]) ?? [] },
        });
      }
      res.json({ items: out });
    } catch (error) {
      console.error("Feedback used error:", error);
      res.status(500).json({ message: "Couldn't load that" });
    }
  });

  app.post("/api/me/feedback-used/seen", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const ids = Array.isArray(req.body?.commentIds) ? req.body.commentIds.map(String).slice(0, 50) : [];
      if (ids.length) {
        await db.update(feedComments).set({ closureSeenAt: sql`now()` })
          .where(and(inArray(feedComments.id, ids), eq(feedComments.authorId, req.user.id), isNotNull(feedComments.closedByPostId)));
      }
      res.json({ ok: true });
    } catch (error) {
      console.error("Feedback used seen error:", error);
      res.status(500).json({ message: "Couldn't mark that read" });
    }
  });
}
