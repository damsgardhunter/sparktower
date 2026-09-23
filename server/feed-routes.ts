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
import { publiclyVisible } from "./visibility";
import { users, userProfiles, projects, projectMembers, feedPosts, feedReactions, feedComments, feedCommentReactions, userFollows, projectFollows, connections, companies, companyMembers } from "@shared/schema";
import { eq, and, or, ilike, ne, desc, inArray, isNull, lt } from "drizzle-orm";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { EXPLORE_EVENTS } from "@shared/explore-events";
import { recordExploreAction } from "./explore-actions";
import { markStepsShared, shareableSteps } from "./path-return";
import { validateAsks } from "@shared/feedback-loop";
import { closableComments, markClosed, markClosureAnswered, projectTeam } from "./feedback-loop-routes";
import { notify, unnotify, notifyFollowersOfPost, notifyComment } from "./notifications";
import { notifyScouts } from "./scouting-alerts";
import { rankFeed, viewerTerms, emptyAffinity, type ViewerAffinity } from "@shared/feed-ranking";
import { companyCan, logCompany } from "./company-access";
import { hasPower, type CompanyRole } from "@shared/companies";

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
  /*
   * Never the email address. This string is published — on posts, comments,
   * reactions, notifications, and the artifact pages a stranger can open — and
   * an account with no display name and no first name (which registration
   * allows) would have had its address printed under its own words. "Someone"
   * is a worse name and a better outcome.
   */
  return (
    profile?.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
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

/** The company a post was made in the name of, as a card shows it. */
export type PostCompany = { id: string; name: string; slug: string };

/**
 * Adds `company` to each post: who the feed should show as the poster when a
 * post was made in a company's name, or null for a person's own post.
 *
 * Done here, once per page, rather than per post: most pages have no company
 * posts at all, and the ones that do usually repeat the same company.
 */
export async function withCompanies<T extends { companyId?: string | null }>(posts: T[]): Promise<(T & { company: PostCompany | null })[]> {
  const ids = Array.from(new Set(posts.map((p) => p.companyId).filter((id): id is string => !!id)));
  const rows = ids.length
    ? await db.select({ id: companies.id, name: companies.name, slug: companies.slug }).from(companies).where(inArray(companies.id, ids))
    : [];
  const byId = new Map(rows.map((c) => [c.id, c]));
  return posts.map((p) => ({ ...p, company: (p.companyId && byId.get(p.companyId)) || null }));
}

async function withCompany<T extends { companyId?: string | null }>(post: T): Promise<T & { company: PostCompany | null }> {
  return (await withCompanies([post]))[0];
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
    void notifyScouts(input.projectId, { key: `post:${post.id}`, text: input.content });
  } catch (err) {
    console.error("Failed to publish system feed post (non-fatal):", err);
  }
}

/**
 * Writes a post from a request: the one path every hand-written post takes,
 * whether the person posts as themselves or in a company's name.
 *
 * One path on purpose. The rate limit, the duplicate check and the email gate
 * sit in front of both routes, and everything after them — what a post may
 * say, which project it may be on, who hears about it — lives here, so a
 * company post can't quietly be held to a lower standard than a person's.
 * The caller has already decided the person may speak for `asCompany`.
 */
async function publishPost(req: any, res: any, asCompany?: { id: string }) {
  const userId = req.user.id;
  const { content, projectId, mediaUrls, mentions, asks: rawAsks, closesCommentIds, pathTaskId, pathStepIds, imageUrl } = req.body as {
    postType?: string; content?: string; projectId?: string;
    mediaUrls?: string[]; mentions?: unknown;
    /** One picture, the shorter way a company post can carry it; folded into `mediaUrls`. */
    imageUrl?: unknown;
    /** Specific questions for readers (a project's progress post). */
    asks?: unknown;
    /** Feedback this update acted on, credited on the post and told to whoever gave it. */
    closesCommentIds?: unknown;
    /** A finished step on the project's path this post shares, so feedback on it is feedback on that step. */
    pathTaskId?: unknown;
    /** The week's finished steps this post shares — the weekly progress update. */
    pathStepIds?: unknown;
  };
  // A company announcing something is an update unless it says otherwise; a person picks a type in the composer.
  const postType: string | undefined = req.body?.postType ?? (asCompany ? "project_update" : undefined);

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
    companyId: asCompany?.id ?? null,
    postType: postType as FeedPostType,
    content: content.trim(),
    mediaUrls: [...(Array.isArray(mediaUrls) ? mediaUrls : []), ...(typeof imageUrl === "string" && imageUrl ? [imageUrl] : [])].slice(0, MAX_POST_MEDIA),
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
  if (post.projectId) void notifyScouts(post.projectId, { key: `post:${post.id}`, text: post.content });
  void notify({ recipients: ((post.mentions as FeedMention[]) ?? []).map((m) => m.userId), actorId: userId, kind: "mention", targetId: post.id, postId: post.id, projectId: post.projectId, excerpt: post.content });

  if (asCompany) await logCompany(asCompany.id, userId, "post_published", userId, { postId: post.id });

  const created = await storage.getFeedPost(post.id, userId);
  res.json(created ? await withCompany(created) : created);
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
   * What a viewer's feed is ranked against: what they build, what they know,
   * and who they already pay attention to.
   *
   * One round of queries per feed load, all in parallel. Cheap enough to do
   * per request and simple enough to stay correct — a follow made a second ago
   * counts on the very next page.
   */
  async function viewerAffinity(userId: string | undefined): Promise<ViewerAffinity> {
    if (!userId) return emptyAffinity();
    try {
      const [profile, owned, memberships, follows, projFollows, conns] = await Promise.all([
        storage.getUserProfile(userId),
        db.select({ id: projects.id, category: projects.category }).from(projects).where(eq(projects.ownerId, userId)),
        db.select({ projectId: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, userId)),
        db.select({ followeeId: userFollows.followeeId }).from(userFollows).where(eq(userFollows.followerId, userId)),
        db.select({ projectId: projectFollows.projectId }).from(projectFollows).where(eq(projectFollows.userId, userId)),
        db.select({ requesterId: connections.requesterId, receiverId: connections.receiverId })
          .from(connections)
          .where(and(
            or(eq(connections.requesterId, userId), eq(connections.receiverId, userId)),
            eq(connections.status, "accepted"),
          )),
      ]);

      const memberProjectIds = memberships.map((m) => m.projectId);
      // Categories of the projects they're on as well as the ones they own —
      // being the designer on someone else's fintech still makes fintech yours.
      const memberCategories = memberProjectIds.length
        ? await Promise.all(memberProjectIds.map(async (id) => (await storage.getProject(id))?.category ?? null))
        : [];

      return {
        terms: viewerTerms(profile, [
          ...owned.map((p) => p.category),
          ...memberCategories.filter((c): c is string => !!c),
        ]),
        categories: new Set(
          [...owned.map((p) => p.category), ...memberCategories]
            .filter((c): c is string => !!c)
            .map((c) => c.toLowerCase().trim())
        ),
        followedAuthorIds: new Set(follows.map((f) => f.followeeId)),
        followedProjectIds: new Set(projFollows.map((f) => f.projectId)),
        connectedUserIds: new Set(conns.map((c) => (c.requesterId === userId ? c.receiverId : c.requesterId))),
        ownProjectIds: new Set([...owned.map((p) => p.id), ...memberProjectIds]),
      };
    } catch (err) {
      // Ranking is an improvement on the feed, not a precondition for having
      // one: a failure here costs relevance, never the posts.
      console.error("Feed affinity lookup failed, falling back to chronological:", err);
      return emptyAffinity();
    }
  }

  /**
   * The feed. Readable without signing in, but reactions and private-project
   * posts need a session.
   *
   * The default feed is ranked, not strictly chronological: each page is still
   * the same window of posts the cursor describes, ordered inside that window
   * by how much it has to do with you (shared/feed-ranking.ts). A project's own
   * feed, a single author's, and the Following feed stay in time order — those
   * are timelines you asked for by name, and reordering them would be wrong.
   *
   * The cursor is taken from the oldest post in the window BEFORE ranking.
   * Reading it off the end of the ranked list would hand back the least
   * relevant post's timestamp instead of the oldest one, and pagination would
   * skip everything in between.
   */
  app.get("/api/feed", async (req: any, res) => {
    try {
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      // The Following feed is personal, so it needs someone to be personal to.
      const following = req.query.scope === "following";
      if (following && !req.user) return res.status(401).json({ message: "Sign in to see who you follow." });
      const authorId = (req.query.authorId as string) || undefined;
      const projectId = (req.query.projectId as string) || undefined;
      const posts = await storage.getFeedPosts({
        viewerId: req.user?.id,
        followedBy: following ? req.user.id : undefined,
        limit,
        before: (req.query.before as string) || undefined,
        authorId,
        projectId,
        postType: FEED_POST_TYPES.includes(req.query.postType as any)
          ? (req.query.postType as string)
          : undefined,
      });

      // Read before ranking, off the chronologically last post.
      const nextCursor = posts.length === limit ? posts[posts.length - 1].createdAt : null;

      const ranked = following || authorId || projectId || !req.user?.id
        ? posts
        : rankFeed(posts, await viewerAffinity(req.user.id));

      res.json({
        // A post made in a company's name carries `company`, so the card shows the company as the poster.
        posts: await withCompanies(ranked),
        // Cursor for the next page; null when we've reached the end.
        nextCursor,
        // Says how the page is ordered, so the feed can label it.
        ranked: ranked !== posts,
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
      await publishPost(req, res);
    } catch (error) {
      console.error("Create post error:", error);
      res.status(500).json({ message: "Failed to publish your post" });
    }
  });

  app.delete("/api/feed/:id", isAuthenticated, async (req: any, res) => {
    try {
      // Read first: once the row is gone there's no telling it was made in a company's name.
      const [row] = await db.select({ companyId: feedPosts.companyId }).from(feedPosts).where(eq(feedPosts.id, req.params.id));
      const deleted = await storage.deleteFeedPost(req.params.id, req.user.id);
      if (!deleted) return res.status(404).json({ message: "Post not found" });
      // A company can see everything said in its name coming and going, whoever took it down.
      if (row?.companyId) await logCompany(row.companyId, req.user.id, "post_removed", req.user.id, { postId: req.params.id, by: "author" });
      // "kept": other people had replied, so their thread is still there without your post in it.
      res.json({ success: true, thread: deleted });
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
      // The thread is still readable, but its post is gone: nothing new is added to it.
      if (post.deletedAt) return res.status(410).json({ message: "The author deleted this post.", code: "post_deleted" });

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
    if (["config", "my-projects", "my-companies", "mention-search", "comments"].includes(req.params.id)) return next();
    try {
      const post = await storage.getFeedPost(req.params.id, req.user?.id);
      if (!post) return res.status(404).json({ message: "Post not found" });
      if (post.project?.isPrivate && !post.viewerIsTeam) return res.status(404).json({ message: "Post not found" });
      res.json(await withCompany(post));
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
      // The replies already written stay readable; nothing new joins a post its author deleted.
      if (post.deletedAt) return res.status(410).json({ message: "The author deleted this post.", code: "post_deleted" });

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
          // Bots carry ordinary names so a simulation lobby reads like a room.
          // That is precisely why they must not come back from a people search.
          eq(users.isBot, false),
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

  // ─── Posting as a company ─────────────────────────────────────────────────
  //
  // A company speaks on the feed through its people: the post is written by a
  // person (`authorId`, who answers for it to moderation) and shown as the
  // company. Only someone the company gave "post as the company" may do it —
  // leaders hold that power by their role.

  /** Publishes a post in the company's name. Same checks, limits and notifications as a person's post. */
  app.post("/api/companies/:id/posts", isAuthenticated, rateLimit("feedPost"), async (req: any, res) => {
    try {
      const found = await companyCan(res, String(req.params.id), req.user.id, "post_as_company");
      if (!found) return;
      await publishPost(req, res, { id: found.company.id });
    } catch (error) {
      console.error("Company post error:", error);
      res.status(500).json({ message: "Failed to publish the post" });
    }
  });

  /**
   * What the company has said, newest first, for anyone in it — each post with
   * the person who wrote it. Also tells the page whether this viewer may post
   * or take posts down, so the tab doesn't need a second request to decide.
   */
  app.get("/api/companies/:id/posts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const found = await companyCan(res, String(req.params.id), userId, "view");
      if (!found) return;
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const before = req.query.before ? new Date(String(req.query.before)) : null;
      const rows = await db.select({ id: feedPosts.id, createdAt: feedPosts.createdAt }).from(feedPosts)
        .where(and(
          eq(feedPosts.companyId, found.company.id),
          isNull(feedPosts.deletedAt),
          publiclyVisible.feedPost(),
          ...(before && !isNaN(before.getTime()) ? [lt(feedPosts.createdAt, before)] : []),
        ))
        .orderBy(desc(feedPosts.createdAt))
        .limit(limit);
      const hydrated = await Promise.all(rows.map((r) => storage.getFeedPost(r.id, userId)));
      // A post on a private project stays with that project's team, even inside the company.
      const visible = hydrated.filter((p): p is NonNullable<typeof p> => !!p && !(p.project?.isPrivate && !p.viewerIsTeam));
      const canPost = hasPower(found.member, "post_as_company");
      res.json({
        posts: await withCompanies(visible),
        nextCursor: rows.length === limit ? rows[rows.length - 1].createdAt : null,
        canPost,
        // The same power lets someone take down what others posted in the company's name; anyone may remove their own.
        canRemoveOthers: canPost,
      });
    } catch (error) {
      console.error("Company posts error:", error);
      res.status(500).json({ message: "Couldn't load the company's posts." });
    }
  });

  /**
   * Takes down a post made in the company's name.
   *
   * Its author can, as they can anywhere; so can anyone holding "post as the
   * company", because what goes out under the company's name is the company's
   * to withdraw — a person who has left, or posted in error, shouldn't be the
   * only one able to. Removal works as the author's own delete does: replies
   * from other people keep the thread.
   */
  app.delete("/api/companies/:id/posts/:postId", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    try {
      const userId = req.user.id;
      const found = await companyCan(res, String(req.params.id), userId, "view");
      if (!found) return;
      const [post] = await db.select({ id: feedPosts.id, authorId: feedPosts.authorId }).from(feedPosts)
        .where(and(eq(feedPosts.id, String(req.params.postId)), eq(feedPosts.companyId, found.company.id), isNull(feedPosts.deletedAt)));
      if (!post) return res.status(404).json({ message: "Post not found" });
      if (post.authorId !== userId && !hasPower(found.member, "post_as_company")) {
        return res.status(403).json({ message: 'That needs the "Post as the company" power in this company. Ask one of its leaders.', code: "missing_power", power: "post_as_company" });
      }
      const deleted = await storage.deleteFeedPost(post.id, post.authorId);
      if (!deleted) return res.status(404).json({ message: "Post not found" });
      await logCompany(found.company.id, userId, "post_removed", post.authorId, { postId: post.id, by: post.authorId === userId ? "author" : "company" });
      res.json({ success: true, thread: deleted });
    } catch (error) {
      console.error("Company post removal error:", error);
      res.status(500).json({ message: "Couldn't remove that post." });
    }
  });

  /** Companies the caller may post in the name of — what the composer's "Post as" offers. */
  app.get("/api/feed/my-companies", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db
        .select({ id: companies.id, name: companies.name, slug: companies.slug, role: companyMembers.role, permissions: companyMembers.permissions })
        .from(companyMembers)
        .innerJoin(companies, eq(companies.id, companyMembers.companyId))
        .where(eq(companyMembers.userId, req.user.id))
        .orderBy(companies.name);
      res.json(rows
        .filter((r) => hasPower({ role: r.role as CompanyRole, permissions: r.permissions }, "post_as_company"))
        .map((r) => ({ id: r.id, name: r.name, slug: r.slug })));
    } catch (error) {
      console.error("Feed my-companies error:", error);
      res.status(500).json({ message: "Failed to load your companies" });
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
      // Reacting is a write against someone's project: the same view rule the thread itself uses.
      const projectId = await storage.projectOfComment(req.params.commentId);
      if (!projectId || !(await canView(projectId, req.user.id))) return res.status(404).json({ message: "Comment not found" });
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
