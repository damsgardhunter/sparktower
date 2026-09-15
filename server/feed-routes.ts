/**
 * Founder feed.
 *
 * A social timeline of what people are building: typed posts, reactions,
 * comments, @mentions, and media. Also exposes `publishSystemPost`, which
 * other routes call when something noteworthy happens (a project goes live, a
 * milestone lands, a roadmap gets built) so the feed fills itself.
 */
import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { users, userProfiles, projects, projectMembers, feedReactions, feedComments, feedCommentReactions } from "@shared/schema";
import { eq, and, or, ilike, ne, desc } from "drizzle-orm";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { EXPLORE_EVENTS } from "@shared/explore-events";
import { recordExploreAction } from "./explore-actions";
import { markStepsShared, shareableSteps } from "./path-return";
import { validateAsks } from "@shared/feedback-loop";
import { closableComments, markClosed, markClosureAnswered, projectTeam } from "./feedback-loop-routes";
import { notify, unnotify, notifyFollowersOfPost, notifyComment } from "./notifications";

/** Comments on a post, each saying whether its author is on the post's project — only outsiders' count as feedback. */
async function commentsWithTeam(post: { id: string; projectId: string | null }, viewerId?: string) {
  const comments = await storage.getFeedComments(post.id, viewerId);
  const team = post.projectId ? await projectTeam(post.projectId) : null;
  return comments.map((c) => ({ ...c, byTeam: !!team?.has(c.authorId) }));
}
import {
  POST_TYPES, POST_TYPES_BY_KEY, REACTIONS, MAX_POST_LENGTH,
  MAX_COMMENT_LENGTH, MAX_POST_MEDIA,
} from "@shared/feed";
import {
  FEED_POST_TYPES, FEED_REACTIONS,
  type FeedMention, type FeedPostType,
} from "@shared/schema";

/**
 * The display name for a user, built one way everywhere.
 *
 * The mention typeahead and the stored mention list MUST agree — the client
 * inserts this exact string into the post text, and the renderer highlights by
 * matching the stored name against that text. A mismatch (e.g. "Ben" stored
 * against "@Ben Builder" written) silently kills the highlight.
 */
export function feedDisplayName(
  user: { firstName?: string | null; lastName?: string | null; email?: string | null },
  profile?: { displayName?: string | null } | null
): string {
  return (
    profile?.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email ||
    "Someone"
  );
}

/** Keeps a stored mention list to real users with consistent names. */
async function resolveMentions(raw: unknown): Promise<FeedMention[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const ids = Array.from(
    new Set(raw.map((m: any) => String(m?.userId || "")).filter(Boolean))
  ).slice(0, 20);
  if (ids.length === 0) return [];

  const found = await Promise.all(ids.map(async (id) => {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) return null;
    const profile = await storage.getUserProfile(id);
    return { userId: id, name: feedDisplayName(user, profile) } as FeedMention;
  }));
  return found.filter((m): m is FeedMention => m !== null);
}

/**
 * Creates a post on behalf of the system for a project event.
 *
 * Fails soft: a feed write must never break the action that triggered it, so
 * every caller can fire this without a try/catch of its own.
 */
export async function publishSystemPost(input: {
  authorId: string;
  projectId: string;
  postType: FeedPostType;
  content: string;
  entityType?: string;
  entityId?: string;
}): Promise<void> {
  try {
    const post = await storage.createFeedPost({
      authorId: input.authorId,
      projectId: input.projectId,
      postType: input.postType,
      content: input.content,
      mediaUrls: [],
      mentions: [],
      isSystemGenerated: true,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
    });
    // A milestone landing or a launch is exactly the progress a follower came for.
    void notifyFollowersOfPost(post);
  } catch (err) {
    console.error("Failed to publish system feed post (non-fatal):", err);
  }
}

export function registerFeedRoutes(app: Express) {
  /** Composer config: post types, prompts, reactions, limits. */
  app.get("/api/feed/config", (_req, res) => {
    res.json({
      postTypes: POST_TYPES,
      reactions: REACTIONS,
      limits: { post: MAX_POST_LENGTH, comment: MAX_COMMENT_LENGTH, media: MAX_POST_MEDIA },
    });
  });

  /**
   * The feed. Readable without signing in, but reactions and private-project
   * posts need a session.
   */
  app.get("/api/feed", async (req: any, res) => {
    try {
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      // The Following feed is personal, so it needs someone to be personal to.
      const following = req.query.scope === "following";
      if (following && !req.user) return res.status(401).json({ message: "Sign in to see who you follow." });
      const posts = await storage.getFeedPosts({
        viewerId: req.user?.id,
        followedBy: following ? req.user.id : undefined,
        limit,
        before: (req.query.before as string) || undefined,
        authorId: (req.query.authorId as string) || undefined,
        projectId: (req.query.projectId as string) || undefined,
        postType: FEED_POST_TYPES.includes(req.query.postType as any)
          ? (req.query.postType as string)
          : undefined,
      });
      res.json({
        posts,
        // Cursor for the next page; null when we've reached the end.
        nextCursor: posts.length === limit ? posts[posts.length - 1].createdAt : null,
        // So an empty Following feed can say which kind of empty: nobody followed, or nobody posting.
        ...(following ? { followingCount: await storage.getFollowingCount(req.user.id) } : {}),
      });
    } catch (error) {
      console.error("Feed error:", error);
      res.status(500).json({ message: "Failed to load the feed" });
    }
  });

  app.post("/api/feed", isAuthenticated, rateLimit("feedPost"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { postType, content, projectId, mediaUrls, mentions, asks: rawAsks, closesCommentIds, pathTaskId, pathStepIds } = req.body as {
        postType?: string; content?: string; projectId?: string;
        mediaUrls?: string[]; mentions?: unknown;
        /** Specific questions for readers (a project's progress post). */
        asks?: unknown;
        /** Feedback this update acted on, credited on the post and told to whoever gave it. */
        closesCommentIds?: unknown;
        /** A finished step on the project's path this post shares, so feedback on it is feedback on that step. */
        pathTaskId?: unknown;
        /** The week's finished steps this post shares — the weekly progress update. */
        pathStepIds?: unknown;
      };

      if (!FEED_POST_TYPES.includes(postType as any)) {
        return res.status(400).json({ message: `postType must be one of: ${FEED_POST_TYPES.join(", ")}` });
      }
      if (!content?.trim()) return res.status(400).json({ message: "Write something first." });
      if (content.length > MAX_POST_LENGTH) {
        return res.status(400).json({ message: `Posts are limited to ${MAX_POST_LENGTH} characters.` });
      }

      // Posting on behalf of a project requires membership.
      if (projectId) {
        const project = await storage.getProject(projectId);
        if (!project) return res.status(404).json({ message: "Project not found" });
        const members = await storage.getProjectMembers(projectId).catch(() => []);
        const isMember = project.ownerId === userId || members.some((m) => m.userId === userId);
        if (!isMember) return res.status(403).json({ message: "You can only post for projects you're on." });
      }

      // Asks and credited feedback belong to a project's progress post.
      const asked = validateAsks(rawAsks);
      if ("error" in asked) return res.status(400).json({ message: asked.error, code: "invalid_input", field: "asks" });
      if (!projectId && (asked.asks.length || (Array.isArray(closesCommentIds) && closesCommentIds.length))) {
        return res.status(400).json({ message: "Asks and credited feedback go on a post for one of your projects.", code: "invalid_input", field: "projectId" });
      }
      const closes = projectId ? await closableComments(projectId, closesCommentIds) : { ids: [] as string[] };
      if ("error" in closes) return res.status(400).json({ message: closes.error, code: "invalid_input", field: "closesCommentIds" });
      let pathStep: string | null = null;
      if (pathTaskId != null && pathTaskId !== "") {
        const task = projectId ? await storage.getKanbanTask(String(pathTaskId)) : undefined;
        const onPath = task && task.projectId === projectId && (task.tags ?? []).some((t) => t.startsWith("backbone:") || t.startsWith("parent:") || t.startsWith("injected:"));
        if (!onPath) return res.status(400).json({ message: "That isn't a step on this project's path.", code: "invalid_input", field: "pathTaskId" });
        if (task.status !== "done") return res.status(400).json({ message: "Share a step once it's done.", code: "invalid_input", field: "pathTaskId" });
        pathStep = task.id;
      }
      let weekSteps: string[] = [];
      if (pathStepIds != null) {
        if (!projectId) return res.status(400).json({ message: "A weekly update goes on one of your projects.", code: "invalid_input", field: "projectId" });
        const checked = await shareableSteps(projectId, pathStepIds);
        if ("error" in checked) return res.status(400).json({ message: checked.error, code: "invalid_input", field: "pathStepIds" });
        weekSteps = checked.ids;
      }

      const post = await storage.createFeedPost({
        authorId: userId,
        projectId: projectId || null,
        postType: postType as FeedPostType,
        content: content.trim(),
        mediaUrls: Array.isArray(mediaUrls) ? mediaUrls.slice(0, MAX_POST_MEDIA) : [],
        mentions: await resolveMentions(mentions),
        asks: asked.asks,
        isSystemGenerated: false,
        ...(pathStep ? { entityType: "path_step", entityId: pathStep } : weekSteps.length ? { entityType: "path_week", entityId: projectId } : {}),
      });
      // Shared steps leave the weekly update: offered until they're posted, never twice.
      if (pathStep || weekSteps.length) await markStepsShared(post.id, pathStep ? [pathStep] : weekSteps);
      await markClosed(post, closes.ids);
      // The Explore loop's way back: people following this builder or project hear there's progress.
      void notifyFollowersOfPost(post);
      void notify({ recipients: ((post.mentions as FeedMention[]) ?? []).map((m) => m.userId), actorId: userId, kind: "mention", targetId: post.id, postId: post.id, projectId: post.projectId, excerpt: post.content });

      res.json(await storage.getFeedPost(post.id, userId));
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ message: "Failed to publish your post" });
    }
  });

  app.delete("/api/feed/:id", isAuthenticated, async (req: any, res) => {
    try {
      const deleted = await storage.deleteFeedPost(req.params.id, req.user.id);
      if (!deleted) return res.status(404).json({ message: "Post not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete post error:", error);
      res.status(500).json({ message: "Failed to delete the post" });
    }
  });

  /**
   * Sets or toggles a reaction. Sending the reaction you already have clears
   * it, so the same endpoint handles like, change, and un-like.
   */
  app.post("/api/feed/:id/react", isAuthenticated, rateLimit("react"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { reaction } = req.body as { reaction?: string };
      if (reaction != null && !FEED_REACTIONS.includes(reaction as any)) {
        return res.status(400).json({ message: `reaction must be one of: ${FEED_REACTIONS.join(", ")}` });
      }

      const post = await storage.getFeedPost(req.params.id, userId);
      // A private project's post doesn't exist for anyone outside its team — not to read, react to or comment on.
      if (!post || (post.project?.isPrivate && !post.viewerIsTeam)) return res.status(404).json({ message: "Post not found" });

      // Same reaction again means "take it back".
      const next = post.viewerReaction === reaction ? null : (reaction ?? null);
      const result = await storage.setFeedReaction(req.params.id, userId, next);
      if (next) void notify({ recipients: [post.authorId], actorId: userId, kind: "post_reaction", targetId: post.id, postId: post.id, projectId: post.projectId });
      else void unnotify({ actorId: userId, kind: "post_reaction", targetId: post.id });
      res.json(result);
    } catch (error) {
      console.error("React error:", error);
      res.status(500).json({ message: "Failed to react" });
    }
  });

  /** One post, for its own page. Same visibility as the feed: private projects' posts only to their team. */
  app.get("/api/feed/:id", async (req: any, res, next) => {
    // Named sub-routes registered after this one (my-projects, mention-search, config) aren't post ids.
    if (["config", "my-projects", "mention-search", "comments"].includes(req.params.id)) return next();
    try {
      const post = await storage.getFeedPost(req.params.id, req.user?.id);
      if (!post) return res.status(404).json({ message: "Post not found" });
      if (post.project?.isPrivate && !post.viewerIsTeam) return res.status(404).json({ message: "Post not found" });
      res.json(post);
    } catch (error) {
      console.error("Post error:", error);
      res.status(500).json({ message: "Failed to load the post" });
    }
  });

  /** Who reacted to a post, and how: the interactions on its own page. */
  app.get("/api/feed/:id/reactions", async (req: any, res) => {
    try {
      const post = await storage.getFeedPost(req.params.id, req.user?.id);
      if (!post || (post.project?.isPrivate && !post.viewerIsTeam)) return res.status(404).json({ message: "Post not found" });
      const rows = await db
        .select({ userId: feedReactions.userId, reaction: feedReactions.reaction, createdAt: feedReactions.createdAt, firstName: users.firstName, lastName: users.lastName, email: users.email, displayName: userProfiles.displayName, headline: userProfiles.headline, avatarUrl: userProfiles.avatarUrl, profileImageUrl: users.profileImageUrl })
        .from(feedReactions)
        .innerJoin(users, eq(users.id, feedReactions.userId))
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(eq(feedReactions.postId, post.id))
        .orderBy(desc(feedReactions.createdAt))
        .limit(200);
      res.json(rows.map((r) => ({
        userId: r.userId, reaction: r.reaction, createdAt: r.createdAt,
        name: feedDisplayName(r, { displayName: r.displayName }),
        headline: r.headline || null, avatarUrl: r.avatarUrl || r.profileImageUrl || null,
      })));
    } catch (error) {
      console.error("Reactions error:", error);
      res.status(500).json({ message: "Failed to load reactions" });
    }
  });

  app.get("/api/feed/:id/comments", async (req: any, res) => {
    try {
      const post = await storage.getFeedPost(req.params.id, req.user?.id);
      if (!post || (post.project?.isPrivate && !post.viewerIsTeam)) return res.status(404).json({ message: "Post not found" });
      res.json(await commentsWithTeam(post, req.user?.id));
    } catch (error) {
      console.error("Comments error:", error);
      res.status(500).json({ message: "Failed to load comments" });
    }
  });

  app.post("/api/feed/:id/comments", isAuthenticated, rateLimit("comment"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { content, mentions, parentCommentId } = req.body as {
        content?: string; mentions?: unknown; parentCommentId?: string;
      };
      if (!content?.trim()) return res.status(400).json({ message: "Write something first." });
      if (content.length > MAX_COMMENT_LENGTH) {
        return res.status(400).json({ message: `Comments are limited to ${MAX_COMMENT_LENGTH} characters.` });
      }

      const post = await storage.getFeedPost(req.params.id, userId);
      if (!post || (post.project?.isPrivate && !post.viewerIsTeam)) return res.status(404).json({ message: "Post not found" });

      // A reply hangs off a comment on this same post that's still there to reply to.
      if (parentCommentId) {
        const [parent] = await db.select({ postId: feedComments.postId, hiddenAt: feedComments.hiddenAt, deletedAt: feedComments.deletedAt })
          .from(feedComments).where(eq(feedComments.id, String(parentCommentId)));
        if (!parent || parent.postId !== req.params.id) return res.status(400).json({ message: "That comment isn't on this post.", code: "invalid_input", field: "parentCommentId" });
        if (parent.hiddenAt || parent.deletedAt) return res.status(400).json({ message: "That comment is gone, so it can't be replied to.", code: "invalid_input", field: "parentCommentId" });
      }

      const created = await storage.createFeedComment({
        postId: req.params.id,
        authorId: userId,
        content: content.trim(),
        mentions: await resolveMentions(mentions),
        parentCommentId: parentCommentId || null,
      });
      /*
       * The Explore loop's message/comment step: answering someone else's
       * progress in public. Your own post, or your own project's, is talking
       * to yourself — not exploring.
       */
      const team = post.projectId ? await projectTeam(post.projectId) : null;
      if (post.authorId !== userId && !team?.has(userId)) {
        recordExploreAction(req, EXPLORE_EVENTS.comment, post.projectId
          ? { matchType: "project", targetId: post.projectId }
          : { matchType: "builder", targetId: post.authorId });
      }
      // Answering the update that used your feedback: the loop has come round again.
      void markClosureAnswered(userId, post.id).catch(() => {});
      void notifyComment({
        commentId: created.id, postId: post.id, postAuthorId: post.authorId, projectId: post.projectId,
        actorId: userId, content: created.content, parentCommentId: created.parentCommentId,
        mentionIds: ((created.mentions as FeedMention[]) ?? []).map((m) => m.userId),
      });

      res.json(await commentsWithTeam(post, req.user?.id));
    } catch (error) {
      console.error("Create comment error:", error);
      res.status(500).json({ message: "Failed to post your comment" });
    }
  });

  /** Reacting to a comment: the same set and the same toggle as a post. */
  app.post("/api/feed/comments/:commentId/react", isAuthenticated, rateLimit("react"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { reaction } = req.body as { reaction?: string };
      if (reaction != null && !FEED_REACTIONS.includes(reaction as any)) {
        return res.status(400).json({ message: `reaction must be one of: ${FEED_REACTIONS.join(", ")}` });
      }
      const [comment] = await db.select().from(feedComments).where(eq(feedComments.id, req.params.commentId));
      if (!comment || comment.hiddenAt || comment.deletedAt) return res.status(404).json({ message: "Comment not found" });
      // Only on a post the reactor can see.
      const post = await storage.getFeedPost(comment.postId, userId);
      if (!post || (post.project?.isPrivate && !post.viewerIsTeam)) return res.status(404).json({ message: "Comment not found" });

      const [current] = await db.select({ reaction: feedCommentReactions.reaction }).from(feedCommentReactions)
        .where(and(eq(feedCommentReactions.commentId, comment.id), eq(feedCommentReactions.userId, userId)));
      const next = current?.reaction === reaction ? null : (reaction ?? null);
      const result = await storage.setFeedCommentReaction(comment.id, userId, next);
      if (next) void notify({ recipients: [comment.authorId], actorId: userId, kind: "comment_reaction", targetId: comment.id, postId: comment.postId, projectId: post.projectId, excerpt: comment.content });
      else void unnotify({ actorId: userId, kind: "comment_reaction", targetId: comment.id });
      res.json(result);
    } catch (error) {
      console.error("Comment react error:", error);
      res.status(500).json({ message: "Failed to react" });
    }
  });

  app.delete("/api/feed/comments/:commentId", isAuthenticated, async (req: any, res) => {
    try {
      const deleted = await storage.deleteFeedComment(req.params.commentId, req.user.id);
      if (!deleted) return res.status(404).json({ message: "Comment not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete comment error:", error);
      res.status(500).json({ message: "Failed to delete the comment" });
    }
  });

  /**
   * Typeahead for @mentions. Deliberately separate from /api/users/search so
   * it can stay small and fast — id, name, headline, avatar and nothing else.
   */
  app.get("/api/feed/mention-search", isAuthenticated, async (req: any, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (q.length < 1) return res.json([]);
      const pattern = `%${q}%`;

      const rows = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
          displayName: userProfiles.displayName,
          username: userProfiles.username,
          headline: userProfiles.headline,
          avatarUrl: userProfiles.avatarUrl,
        })
        .from(users)
        .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(and(
          ne(users.id, req.user.id),
          or(
            ilike(users.firstName, pattern),
            ilike(users.lastName, pattern),
            ilike(userProfiles.displayName, pattern),
            ilike(userProfiles.username, pattern),
          )
        ))
        .limit(8);

      res.json(rows.map((r) => ({
        userId: r.id,
        // Same construction as resolveMentions, so the inserted text and the
        // stored mention name always match.
        name: feedDisplayName(r, { displayName: r.displayName }),
        handle: r.username || null,
        headline: r.headline || null,
        avatarUrl: r.avatarUrl || r.profileImageUrl || null,
      })));
    } catch (error) {
      console.error("Mention search error:", error);
      res.status(500).json({ message: "Failed to search people" });
    }
  });

  /** Projects the caller may post on behalf of. */
  app.get("/api/feed/my-projects", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const owned = await storage.getUserProjects(userId).catch(() => []);
      const memberRows = await db
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.userId, userId));

      const byId = new Map(owned.map((p) => [p.id, p]));
      for (const row of memberRows) {
        if (byId.has(row.projectId)) continue;
        const [project] = await db.select().from(projects).where(eq(projects.id, row.projectId));
        if (project) byId.set(project.id, project);
      }

      res.json([...byId.values()].map((p) => ({ id: p.id, title: p.title, isPrivate: p.isPrivate })));
    } catch (error) {
      console.error("Feed my-projects error:", error);
      res.status(500).json({ message: "Failed to load your projects" });
    }
  });
}

/**
 * Project discussion — comments on milestones, roadmap phases, and the project
 * itself. This is the "building in public" layer: anyone who can see the
 * project can weigh in, not just the team.
 */
export function registerProjectDiscussionRoutes(app: Express) {
  /*
   * What a comment can hang off. Check-ins were retired: comments already
   * filed against one stay in the table, but nothing new can target one.
   */
  const TARGETS = ["milestone", "project", "roadmap_phase"] as const;

  /** Can this viewer see the project at all? Private ones are members-only. */
  async function canView(projectId: string, viewerId?: string): Promise<boolean> {
    const project = await storage.getProject(projectId);
    if (!project) return false;
    if (!project.isPrivate) return true;
    if (!viewerId) return false;
    if (project.ownerId === viewerId) return true;
    const members = await storage.getProjectMembers(projectId).catch(() => []);
    return members.some((m) => m.userId === viewerId);
  }

  app.get("/api/projects/:id/comments", async (req: any, res) => {
    try {
      if (!(await canView(req.params.id, req.user?.id))) {
        return res.status(404).json({ message: "Project not found" });
      }
      const { targetType, targetId } = req.query as { targetType?: string; targetId?: string };
      const target =
        targetType && targetId && TARGETS.includes(targetType as any)
          ? { targetType, targetId }
          : undefined;
      res.json(await storage.getProjectComments(req.params.id, target, req.user?.id));
    } catch (error) {
      console.error("Project comments error:", error);
      res.status(500).json({ message: "Failed to load the discussion" });
    }
  });

  /** Comment counts per target, so tabs and milestones can show a badge. */
  app.get("/api/projects/:id/comment-counts", async (req: any, res) => {
    try {
      if (!(await canView(req.params.id, req.user?.id))) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(await storage.getProjectCommentCounts(req.params.id));
    } catch (error) {
      console.error("Comment counts error:", error);
      res.status(500).json({ message: "Failed to load comment counts" });
    }
  });

  app.post("/api/projects/:id/comments", isAuthenticated, rateLimit("comment"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      if (!(await canView(req.params.id, userId))) {
        return res.status(404).json({ message: "Project not found" });
      }

      const { targetType, targetId, content, mentions, parentCommentId } = req.body as {
        targetType?: string; targetId?: string; content?: string;
        mentions?: unknown; parentCommentId?: string;
      };

      if (!TARGETS.includes(targetType as any)) {
        return res.status(400).json({ message: `targetType must be one of: ${TARGETS.join(", ")}` });
      }
      if (!targetId) return res.status(400).json({ message: "targetId is required" });
      if (!content?.trim()) return res.status(400).json({ message: "Write something first." });
      if (content.length > MAX_COMMENT_LENGTH) {
        return res.status(400).json({ message: `Comments are limited to ${MAX_COMMENT_LENGTH} characters.` });
      }

      // A milestone comment must actually belong to this project.
      if (targetType === "milestone") {
        const milestone = await storage.getMilestone(targetId);
        if (!milestone || milestone.projectId !== req.params.id) {
          return res.status(404).json({ message: "Milestone not found on this project" });
        }
      }

      await storage.createProjectComment({
        projectId: req.params.id,
        authorId: userId,
        targetType: targetType as any,
        targetId,
        content: content.trim(),
        mentions: await resolveMentions(mentions),
        parentCommentId: parentCommentId || null,
      });

      res.json(await storage.getProjectComments(req.params.id, { targetType: targetType!, targetId }, userId));
    } catch (error) {
      console.error("Create project comment error:", error);
      res.status(500).json({ message: "Failed to post your comment" });
    }
  });

  app.delete("/api/project-comments/:commentId", isAuthenticated, async (req: any, res) => {
    try {
      const deleted = await storage.deleteProjectComment(req.params.commentId, req.user.id);
      if (!deleted) return res.status(404).json({ message: "Comment not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("Delete project comment error:", error);
      res.status(500).json({ message: "Failed to delete the comment" });
    }
  });

  app.post("/api/project-comments/:commentId/react", isAuthenticated, rateLimit("react"), async (req: any, res) => {
    try {
      res.json(await storage.toggleCommentReaction(req.params.commentId, req.user.id));
    } catch (error) {
      console.error("Comment reaction error:", error);
      res.status(500).json({ message: "Failed to react" });
    }
  });

  /** Who's following this project — a Kickstarter-style backer list. */
  app.get("/api/projects/:id/followers", async (req: any, res) => {
    try {
      if (!(await canView(req.params.id, req.user?.id))) {
        return res.status(404).json({ message: "Project not found" });
      }
      res.json(await storage.getProjectFollowers(req.params.id));
    } catch (error) {
      console.error("Followers error:", error);
      res.status(500).json({ message: "Failed to load followers" });
    }
  });
}

/** Copy for system-generated posts, kept together so the voice stays consistent. */
export const SYSTEM_POST_COPY = {
  projectCreated: (title: string, oneLiner?: string | null) =>
    oneLiner?.trim()
      ? `Started building **${title}** — ${oneLiner.trim()}`
      : `Started building **${title}**. Early days, but it's real now.`,
  roadmapBuilt: (title: string, goal: string, phases: number) =>
    `Mapped out the path for **${title}**: ${phases} phases to get to "${goal}".`,
  milestoneCompleted: (title: string, milestone: string) =>
    `Hit a milestone on **${title}**: ${milestone} ✅`,
  projectLaunched: (title: string) =>
    `**${title}** is live 🚀`,
};

/** Post type used for each system event. */
export const SYSTEM_POST_TYPES = {
  projectCreated: "project_update",
  roadmapBuilt: "project_update",
  milestoneCompleted: "milestone",
  projectLaunched: "launch",
} as const satisfies Record<string, FeedPostType>;
