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
import { users, userProfiles, projects, projectMembers, projectCheckIns } from "@shared/schema";
import { eq, and, or, ilike, ne } from "drizzle-orm";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { recordLoopEvent } from "./loop-metrics";
import { rateLimit } from "./moderation";
import { LOOP_EVENTS } from "@shared/loop-events";
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
    await storage.createFeedPost({
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
      const { postType, content, projectId, mediaUrls, mentions } = req.body as {
        postType?: string; content?: string; projectId?: string;
        mediaUrls?: string[]; mentions?: unknown;
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

      const post = await storage.createFeedPost({
        authorId: userId,
        projectId: projectId || null,
        postType: postType as FeedPostType,
        content: content.trim(),
        mediaUrls: Array.isArray(mediaUrls) ? mediaUrls.slice(0, MAX_POST_MEDIA) : [],
        mentions: await resolveMentions(mentions),
        isSystemGenerated: false,
      });

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
      if (!post) return res.status(404).json({ message: "Post not found" });

      // Same reaction again means "take it back".
      const next = post.viewerReaction === reaction ? null : (reaction ?? null);
      const result = await storage.setFeedReaction(req.params.id, userId, next);
      res.json(result);
    } catch (error) {
      console.error("React error:", error);
      res.status(500).json({ message: "Failed to react" });
    }
  });

  app.get("/api/feed/:id/comments", async (req: any, res) => {
    try {
      const post = await storage.getFeedPost(req.params.id, req.user?.id);
      if (!post) return res.status(404).json({ message: "Post not found" });
      res.json(await storage.getFeedComments(req.params.id));
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
      if (!post) return res.status(404).json({ message: "Post not found" });

      await storage.createFeedComment({
        postId: req.params.id,
        authorId: userId,
        content: content.trim(),
        mentions: await resolveMentions(mentions),
        parentCommentId: parentCommentId || null,
      });

      res.json(await storage.getFeedComments(req.params.id));
    } catch (error) {
      console.error("Create comment error:", error);
      res.status(500).json({ message: "Failed to post your comment" });
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
   * What a comment can hang off. `check_in` is what closes step 5 of the
   * weekly loop — "received feedback when >=1 comment" — and it's the only
   * target an outsider is expected to use, since a check-in permalink is
   * shared with people who aren't on the project.
   */
  const TARGETS = ["milestone", "project", "roadmap_phase", "check_in"] as const;

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

      // Same for a check-in — otherwise a comment could be filed against one
      // project while pointing at another project's check-in.
      if (targetType === "check_in") {
        const [checkIn] = await db.select({ projectId: projectCheckIns.projectId })
          .from(projectCheckIns).where(eq(projectCheckIns.id, targetId));
        if (!checkIn || checkIn.projectId !== req.params.id) {
          return res.status(404).json({ message: "Check-in not found on this project" });
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

      if (targetType === "check_in") {
        // Step 5 of the weekly loop. Recorded here rather than inferred from
        // the comments table so the 24-hour SLA has a real timestamp.
        void recordLoopEvent({
          name: LOOP_EVENTS.commentCreated,
          userId, projectId: req.params.id, checkInId: targetId,
        });
      }

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
