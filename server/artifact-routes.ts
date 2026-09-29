/**
 * Path artifacts: what a finished step produced, published.
 *
 * The growth loop's server side. A finished step becomes an artifact (its
 * answer, its files, its plan), a builder publishes it with a title and tags,
 * and it gets a public page at /a/:id — readable with no account, previewing
 * properly when the link is shared — with a feed post for the people already
 * here. Someone who signs up having landed on it is credited to it, and its
 * author hears about it: the loop's way back.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { publicArtifactVisible } from "./visibility";
import { publicBaseUrl } from "./public-url";
import { feedPosts, pathArtifacts, projects, users, userProfiles } from "@shared/schema";
import { artifactFromStep, artifactIdFromPath, artifactPath, validatePublish, type PageMeta } from "@shared/path-artifacts";
import { PROJECT_GOALS } from "@shared/goals";
import { latestWork, backboneIdOf, trackOfTask, trackState } from "./phase-trees";
import { authoredTextFor, resolveTree } from "@shared/phase-trees";
import { projectTeam } from "./feedback-loop-routes";
import { markStepsShared, pathProgress } from "./path-return";
import { notify } from "./notifications";
import { recordActivity } from "./analytics";
import { PATH_FUNNEL_EVENTS, sanitizePathFunnelProps } from "@shared/path-funnel";
import { validateAsks } from "@shared/feedback-loop";
import { feedDisplayName } from "./feed-routes";

const isPathTask = (tags: string[] | null) => (tags ?? []).some((t) => t.startsWith("backbone:") || t.startsWith("parent:") || t.startsWith("injected:"))
  && !(tags ?? []).some((t) => t.startsWith("archived:") || t === "kind:loop");

/**
 * The milestone a task was born from, with this project's own variant text —
 * which is what "still the authored text" has to be measured against. A task
 * on a second section is resolved against that section's tree, not the
 * project's primary one.
 */
async function authoredMilestone(projectId: string, tags: string[] | null, backboneId: string) {
  const [project] = await db.select({ goal: projects.goal }).from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const goal = trackOfTask(tags, project.goal as any);
  const state = await trackState(projectId, goal);
  if (!state) return null;
  return resolveTree(goal, state.subcategory, state.capitalRoute)
    .flatMap((p) => p.milestones)
    .find((m) => m.id === backboneId) ?? null;
}

/** Makes (or refreshes) the artifact for a finished step. A title and tags someone chose are kept. */
export async function generateArtifact(projectId: string, taskId: string, authorId: string) {
  const task = await storage.getKanbanTask(taskId);
  if (!task || task.projectId !== projectId || !isPathTask(task.tags)) throw Object.assign(new Error("That isn't a step on this project's path."), { status: 400, code: "not_on_path" });
  if (task.status !== "done") throw Object.assign(new Error("Finish the step first — its answer is the artifact."), { status: 400, code: "step_not_done" });
  const work = await latestWork(taskId);

  /*
   * The step's own answer, and not the path's.
   *
   * A backbone task is born holding the milestone's authored description —
   * what the step is asking for — and that text stays there until somebody
   * answers over it. Built straight from the task, a step ticked without a
   * word written produced a page of SparkTower's prose under the builder's
   * name, and every ship_mvp project would have published the same one. The
   * tree keeps `supersedes` precisely so a rewritten prompt is not mistaken
   * for an answer (authoredTextFor, shared/phase-trees).
   */
  const backboneId = backboneIdOf(task.tags);
  const milestone = backboneId ? await authoredMilestone(projectId, task.tags, backboneId) : null;
  const authored = authoredTextFor(milestone, task.description);
  const written = (task.description ?? "").trim();
  const answered = !!written && written !== authored.trim();

  const assembled = artifactFromStep(
    { title: task.title, answer: answered ? task.description : null },
    work ? { kind: work.kind, payload: work.payload } : null,
  );
  if (!assembled.body.trim() && !assembled.files.length) {
    throw Object.assign(new Error("This step has nothing written on it yet, so there's nothing to publish."), { status: 400, code: "artifact_empty" });
  }
  const [existing] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.taskId, taskId));
  if (existing) {
    /*
     * A page that is already live is not refreshed in place.
     *
     * This function runs whenever the publish dialog opens — the client calls
     * it to get a preview — so on a published artifact it re-read the step and
     * wrote the result straight over `summary` and `body`. The step is a
     * working surface: builders keep a customer's name, an unannounced price,
     * or a note to themselves in the answer while they think. All of it went
     * to /a/<id> the moment the dialog opened. No button was pressed, nothing
     * said it had happened, and the only way to find out was to look at the
     * public page.
     *
     * So a refresh of a public artifact lands in the draft columns and the
     * live text is left exactly as published. `/publish` is what moves it
     * across, which is also the point at which somebody has read it.
     */
    if (existing.visibility === "public") {
      const unchanged = existing.summary === assembled.summary
        && existing.body === assembled.body
        && JSON.stringify(existing.files ?? []) === JSON.stringify(assembled.files);
      if (unchanged) {
        // Nothing new to hold back, and an old draft that now matches what is
        // live is noise: clearing it stops the editor claiming a pending change.
        const [same] = await db.update(pathArtifacts).set({
          draftSummary: null, draftBody: null, draftFiles: null, draftAt: null,
        }).where(eq(pathArtifacts.id, existing.id)).returning();
        return { ...same, hasDraft: false };
      }
      const [held] = await db.update(pathArtifacts).set({
        draftSummary: assembled.summary, draftBody: assembled.body, draftFiles: assembled.files,
        draftAt: new Date(), updatedAt: new Date(),
      }).where(eq(pathArtifacts.id, existing.id)).returning();
      return { ...held, hasDraft: true };
    }
    const [updated] = await db.update(pathArtifacts).set({
      summary: assembled.summary, body: assembled.body, files: assembled.files, updatedAt: new Date(),
    }).where(eq(pathArtifacts.id, existing.id)).returning();
    return { ...updated, hasDraft: false };
  }
  const [created] = await db.insert(pathArtifacts).values({
    projectId, taskId, backboneId: backboneIdOf(task.tags), authorId,
    title: assembled.title, summary: assembled.summary, body: assembled.body, files: assembled.files,
  }).returning();
  return { ...created, hasDraft: false };
}

/*
 * Two small caches in front of the public page, both bounded and both in this
 * process only.
 *
 * `pathProgress` walks every task on the project to answer "3 of 11 steps
 * done". That is a full per-project scan, and it ran on every anonymous GET of
 * /a/<id> — so a link doing well on someone else's feed turned into one scan
 * per reader, on a query nobody is watching change second by second. Sixty
 * seconds stale is invisible to a reader and the difference between one scan
 * and a thousand. Only this is cached: the artifact row itself is read fresh
 * every time, because unpublishing a page or making its project private has to
 * take effect on the next request, not a minute later.
 *
 * The other remembers who has already been counted. A view was counted on
 * every GET, so the number said "reloads", not "readers", and its own author
 * could run it up by refreshing — which makes the one metric the growth loop
 * reports useless for deciding whether a page is working.
 */
const VIEW_DEBOUNCE_MS = 6 * 60 * 60 * 1000;
const PROGRESS_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 20_000;

type Progress = Awaited<ReturnType<typeof pathProgress>>;
const progressCache = new Map<string, { at: number; value: Progress }>();
const seenViews = new Map<string, number>();

/** Drops everything past its time, and the oldest entries if the map is still too big. */
function sweep<T>(map: Map<string, T>, expired: (v: T) => boolean) {
  for (const [k, v] of map) if (expired(v)) map.delete(k);
  while (map.size > MAX_CACHE_ENTRIES) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/** Called wherever a project's path visibly changes, so the cached count isn't a lie people act on. */
export function forgetArtifactProgress(projectId: string): void {
  progressCache.delete(projectId);
}

async function cachedProgress(projectId: string): Promise<Progress | null> {
  const now = Date.now();
  const hit = progressCache.get(projectId);
  if (hit && now - hit.at < PROGRESS_TTL_MS) return hit.value;
  const value = await pathProgress(projectId).catch(() => null);
  if (value) {
    sweep(progressCache, (e) => now - e.at > PROGRESS_TTL_MS);
    progressCache.set(projectId, { at: now, value });
  }
  return value;
}

/**
 * Whether this visitor's read of this artifact counts. First time yes, then
 * not again for six hours — long enough that refreshing, or coming back to
 * re-read your own page, doesn't move the number.
 */
function isFreshViewer(id: string, visitorId: string | undefined): boolean {
  const last = seenViews.get(`${id}|${visitorId || "unknown"}`);
  return last === undefined || Date.now() - last >= VIEW_DEBOUNCE_MS;
}

/**
 * Remembered only once the page was actually served. Marking on the way in
 * would spend a visitor's one countable read on a request that 404'd, so the
 * first real read after the page went up wouldn't count.
 */
function markViewed(id: string, visitorId: string | undefined): void {
  const now = Date.now();
  sweep(seenViews, (at) => now - at > VIEW_DEBOUNCE_MS);
  seenViews.set(`${id}|${visitorId || "unknown"}`, now);
}

/** The public view of an artifact, or null when it isn't public (or its project isn't). Counts a view when asked. */
export async function publicArtifact(id: string, opts: { countView?: boolean } = {}) {
  const [row] = await db.select({
    a: pathArtifacts,
    projectTitle: projects.title, projectOneLiner: projects.oneLiner, projectLogo: projects.logoUrl,
    projectPrivate: projects.isPrivate, goal: projects.goal, subcategory: projects.subcategory,
    firstName: users.firstName, lastName: users.lastName, email: users.email, displayName: userProfiles.displayName,
    avatarUrl: userProfiles.avatarUrl, profileImageUrl: users.profileImageUrl,
  }).from(pathArtifacts)
    .innerJoin(projects, eq(projects.id, pathArtifacts.projectId))
    .innerJoin(users, eq(users.id, pathArtifacts.authorId))
    .leftJoin(userProfiles, eq(userProfiles.userId, pathArtifacts.authorId))
    /*
     * The moderation policy, from the one place it is written
     * (server/visibility.ts): the page isn't taken down, its project isn't
     * taken down, and neither its author's account nor the project owner's is
     * suspended or closed. It is a SQL condition rather than a check on the
     * row afterwards so that this read and the sitemap's
     * (`publicArtifactPages`) cannot drift — a sitemap that lists a page which
     * 404s is the one thing a sitemap must never do.
     *
     * The builder's own two choices stay below, where they were: published,
     * and on a project that isn't private. Those aren't moderation, and
     * failing them isn't a takedown.
     */
    .where(and(eq(pathArtifacts.id, id), publicArtifactVisible()));
  if (!row || row.a.visibility !== "public" || row.projectPrivate) return null;
  if (row.a.publishedPostId) {
    const [post] = await db.select({ hiddenAt: feedPosts.hiddenAt }).from(feedPosts).where(eq(feedPosts.id, row.a.publishedPostId));
    // Taken down on the feed is taken down here too.
    if (post?.hiddenAt) return null;
  }
  if (opts.countView) await db.update(pathArtifacts).set({ views: sql`${pathArtifacts.views} + 1` }).where(eq(pathArtifacts.id, id));
  // Read-only: an anonymous page view must never sync someone's path.
  const progress = await cachedProgress(row.a.projectId);
  const goal = PROJECT_GOALS.find((g) => g.id === row.goal);
  return {
    id: row.a.id, title: row.a.title, summary: row.a.summary, body: row.a.body, files: row.a.files, tags: row.a.tags,
    publishedAt: row.a.publishedAt, views: row.a.views + (opts.countView ? 1 : 0), postId: row.a.publishedPostId,
    project: { id: row.a.projectId, title: row.projectTitle, oneLiner: row.projectOneLiner ?? null, logoUrl: row.projectLogo ?? null },
    path: {
      goal: row.goal, goalLabel: goal?.label ?? row.goal, subcategory: row.subcategory,
      progress: progress ? { done: progress.done, total: progress.total } : null,
      next: progress?.next ?? null,
    },
    author: { id: row.a.authorId, name: feedDisplayName(row, { displayName: row.displayName }), avatarUrl: row.avatarUrl || row.profileImageUrl || null },
  };
}

/**
 * Someone signed up, and the first page they ever landed on was an artifact:
 * credit it, and tell its author. Called once, where signups are stamped.
 */
export async function creditArtifactSignup(userId: string, landingPath: string | null | undefined): Promise<void> {
  try {
    const id = artifactIdFromPath(landingPath);
    if (!id) return;
    const [artifact] = await db.update(pathArtifacts).set({ signups: sql`${pathArtifacts.signups} + 1` })
      .where(and(eq(pathArtifacts.id, id), eq(pathArtifacts.visibility, "public"))).returning();
    if (!artifact) return;
    void recordActivity({
      name: PATH_FUNNEL_EVENTS.signup,
      userId, visitorId: "unknown", sessionId: "unknown",
      path: artifactPath(artifact.id), projectId: artifact.projectId,
      props: sanitizePathFunnelProps({ artifactId: artifact.id }),
    }).catch(() => {});
    if (artifact.authorId === userId) return;
    await notify({
      recipients: [artifact.authorId], actorId: userId, kind: "artifact_signup", targetId: `${artifact.id}:${userId}`,
      projectId: artifact.projectId, postId: null, excerpt: artifact.title,
    });
  } catch (err) {
    console.error("[artifacts] couldn't credit a signup (non-fatal):", err);
  }
}

/** Title and preview tags for /a/:id, read by the HTML catch-all. Never blocks the page. */
export async function artifactPageMeta(req: Request, res: Response, next: NextFunction) {
  try {
    const artifact = await publicArtifact(String(req.params.id));
    if (artifact) {
      /*
       * `publicBaseUrl`, not the request's own Host header. This URL goes into
       * the page's canonical and OpenGraph tags, so with nothing configured a
       * single request carrying a forged Host made us hand a crawler — or a
       * chat app unfurling the link — someone else's domain as the canonical
       * home of our content. Same function every email link and the sitemap
       * use, so the site's address is decided in one place.
       */
      const base = publicBaseUrl(req);
      res.locals.pageMeta = {
        title: `${artifact.title} — ${artifact.project.title} on SparkTower`,
        description: artifact.summary || `${artifact.path.goalLabel}: a step on ${artifact.project.title}'s path.`,
        url: `${base}${artifactPath(artifact.id)}`,
        // The page's own text, for anything that reads HTML without running it.
        article: {
          heading: artifact.title ?? artifact.project.title,
          summary: artifact.summary ?? "",
          body: (artifact.body ?? "").slice(0, 20_000),
          projectTitle: artifact.project.title,
          projectPath: `/projects/${artifact.project.id}`,
          publishedAt: artifact.publishedAt ? new Date(artifact.publishedAt).toISOString() : null,
        },
      } satisfies PageMeta;
    } else {
      /*
       * No public artifact at this id — taken down, never published, or a
       * typo in a link somebody pasted. The page still renders and says so,
       * but the *response* said 200, which is a lie told to everything that
       * reads status codes rather than pixels: a crawler indexes the empty
       * shell as a real page, a link checker reports the dead link as fine,
       * and an unfurler shows the site's generic preview for something that
       * isn't there. The status is set here and the shell is still served,
       * so a person following the link sees the page's own explanation.
       */
      res.locals.pageStatus = 404;
    }
  } catch { /* the page still loads; it just previews generically */ }
  next();
}

export function registerArtifactRoutes(app: Express) {
  /** Make (or refresh) the artifact for a finished step. Team only. */
  app.post("/api/projects/:id/path/tasks/:taskId/artifact", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const team = await projectTeam(req.params.id);
      if (!team) return res.status(404).json({ message: "Project not found" });
      if (!team.has(req.user.id)) return res.status(403).json({ message: "Not a project member" });
      res.json(await generateArtifact(req.params.id, req.params.taskId, req.user.id));
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code });
      console.error("Artifact generate error:", error);
      res.status(500).json({ message: "Couldn't make that artifact" });
    }
  });

  /** A project's artifacts, for its team. */
  app.get("/api/projects/:id/artifacts", isAuthenticated, async (req: any, res) => {
    try {
      const team = await projectTeam(req.params.id);
      if (!team?.has(req.user.id)) return res.status(403).json({ message: "Not a project member" });
      res.json(await db.select().from(pathArtifacts).where(eq(pathArtifacts.projectId, req.params.id)).orderBy(desc(pathArtifacts.updatedAt)));
    } catch (error) {
      console.error("Artifacts list error:", error);
      res.status(500).json({ message: "Couldn't load artifacts" });
    }
  });

  /**
   * Publishing: a title and tags, a public page, and a feed post. A private
   * project's artifacts stay private — publishing one would say what the project is.
   */
  app.post("/api/artifacts/:id/publish", isAuthenticated, rateLimit("feedPost"), async (req: any, res) => {
    try {
      const [artifact] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.id, req.params.id));
      if (!artifact) return res.status(404).json({ message: "Artifact not found" });
      const team = await projectTeam(artifact.projectId);
      if (!team?.has(req.user.id)) return res.status(403).json({ message: "Only the project's team can publish its artifacts." });
      const [project] = await db.select({ isPrivate: projects.isPrivate, title: projects.title }).from(projects).where(eq(projects.id, artifact.projectId));
      if (project?.isPrivate) return res.status(400).json({ message: "This project is private. Make it public to publish its artifacts.", code: "project_private" });
      const checked = validatePublish(req.body ?? {});
      if ("error" in checked) return res.status(400).json({ message: checked.error, code: "invalid_input", field: checked.field });
      const asked = validateAsks(req.body?.asks);
      if ("error" in asked) return res.status(400).json({ message: asked.error, code: "invalid_input", field: "asks" });

      /*
       * A held-back refresh is promoted here and nowhere else.
       *
       * This is the one moment somebody has looked at the text and pressed a
       * button, which is exactly the property that regenerating an artifact
       * didn't have.
       */
      const promoted = artifact.draftAt
        ? { summary: artifact.draftSummary ?? artifact.summary, body: artifact.draftBody ?? artifact.body, files: artifact.draftFiles ?? artifact.files }
        : null;
      const liveSummary = promoted?.summary ?? artifact.summary;

      let postId = artifact.publishedPostId;
      if (!postId) {
        const post = await storage.createFeedPost({
          authorId: req.user.id, projectId: artifact.projectId, postType: "project_update",
          content: `${checked.title}\n\n${liveSummary}`.trim(),
          mediaUrls: [], mentions: [], asks: asked.asks, isSystemGenerated: false,
          entityType: "path_artifact", entityId: artifact.id,
        } as any);
        postId = post.id;
        await markStepsShared(post.id, [artifact.taskId]);
      }
      const [published] = await db.update(pathArtifacts).set({
        title: checked.title, tags: checked.tags, visibility: "public", publishedPostId: postId,
        publishedAt: artifact.publishedAt ?? new Date(), updatedAt: new Date(),
        ...(promoted ? { ...promoted, draftSummary: null, draftBody: null, draftFiles: null, draftAt: null } : {}),
      }).where(eq(pathArtifacts.id, artifact.id)).returning();
      forgetArtifactProgress(artifact.projectId);
      void recordActivity({
        name: PATH_FUNNEL_EVENTS.published,
        userId: req.user.id, visitorId: (req as any).visitorId || "unknown", sessionId: (req as any).sessionId || "unknown",
        path: artifactPath(published.id), projectId: published.projectId,
        props: sanitizePathFunnelProps({ artifactId: published.id }),
      }).catch(() => {});
      res.json({ artifact: published, postId, url: artifactPath(published.id), promotedDraft: !!promoted });
    } catch (error) {
      console.error("Artifact publish error:", error);
      res.status(500).json({ message: "Couldn't publish that" });
    }
  });

  /**
   * Taking it back: the page and the preview go.
   *
   * The feed post announcing the page is the other half, and it used to be
   * left standing with no mention of it — a post whose whole content is
   * "here's what we made" linking to a page that now 404s, sitting at the top
   * of the project's feed. Whoever took the page down almost never wanted the
   * post to stay, and the only way to find out it had was to scroll the feed.
   *
   * `removePost` does it in the same handler; the id comes back either way so
   * the client can offer it and say what was left behind.
   */
  app.post("/api/artifacts/:id/unpublish", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [artifact] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.id, req.params.id));
      if (!artifact) return res.status(404).json({ message: "Artifact not found" });
      const team = await projectTeam(artifact.projectId);
      if (!team?.has(req.user.id)) return res.status(403).json({ message: "Only the project's team can do that." });

      const postId = artifact.publishedPostId;
      let post: "deleted" | "kept" | "hidden" | "left" | "not_yours" = "left";
      if (postId && req.body?.removePost === true) {
        /*
         * Through the ordinary delete, so a post other people have replied
         * under becomes a headstone instead of taking their comments with it —
         * the same rule the feed applies to anyone deleting their own post.
         * Only the post's author can; a teammate taking the page down gets
         * told the post isn't theirs rather than silently nothing happening.
         */
        const outcome = await storage.deleteFeedPost(postId, req.user.id);
        post = outcome === false ? "not_yours" : outcome;
      }

      const [updated] = await db.update(pathArtifacts).set({
        visibility: "private", updatedAt: new Date(),
        ...(post === "deleted" ? { publishedPostId: null } : {}),
      }).where(eq(pathArtifacts.id, artifact.id)).returning();
      forgetArtifactProgress(artifact.projectId);
      res.json({ artifact: updated, postId, post });
    } catch (error) {
      console.error("Artifact unpublish error:", error);
      res.status(500).json({ message: "Couldn't do that" });
    }
  });

  /** The public page's data. No account needed — that's the point. */
  app.get("/api/public/artifacts/:id", async (req: any, res) => {
    try {
      const id = String(req.params.id);
      const fresh = isFreshViewer(id, req.visitorId);
      const artifact = await publicArtifact(id, { countView: fresh });
      if (!artifact) return res.status(404).json({ message: "This artifact isn't published." });
      if (fresh) markViewed(id, req.visitorId);
      /*
       * The top of the funnel, named. The view counter on the row says how
       * many times the page was read; this says which visit read it, so the
       * step from reading to acting can be counted in people rather than in
       * page loads (shared/path-funnel.ts).
       */
      void recordActivity({
        name: PATH_FUNNEL_EVENTS.artifactView,
        userId: (req as any).user?.id ?? null,
        visitorId: (req as any).visitorId || "unknown",
        sessionId: (req as any).sessionId || "unknown",
        path: artifactPath(artifact.id),
        projectId: artifact.project?.id ?? null,
        referrer: typeof req.headers.referer === "string" ? req.headers.referer : null,
        userAgent: req.headers["user-agent"],
        props: sanitizePathFunnelProps({ artifactId: artifact.id, goal: artifact.path?.goal, subcategory: artifact.path?.subcategory }),
      }).catch(() => {});
      res.json(artifact);
    } catch (error) {
      console.error("Public artifact error:", error);
      res.status(500).json({ message: "Couldn't load that" });
    }
  });

  /** Preview tags for the page itself; the HTML catch-all puts them in the head. */
  app.get("/a/:id", artifactPageMeta);
}

/** Used by the task board: is this task's artifact already published? */
export async function artifactForTask(taskId: string) {
  const [row] = await db.select({ id: pathArtifacts.id, visibility: pathArtifacts.visibility, title: pathArtifacts.title })
    .from(pathArtifacts).where(eq(pathArtifacts.taskId, taskId));
  return row ?? null;
}
