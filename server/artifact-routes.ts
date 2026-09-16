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
import { feedPosts, pathArtifacts, projects, users, userProfiles } from "@shared/schema";
import { artifactFromStep, artifactIdFromPath, artifactPath, validatePublish, type PageMeta } from "@shared/path-artifacts";
import { PROJECT_GOALS } from "@shared/goals";
import { latestWork, backboneIdOf } from "./phase-trees";
import { projectTeam } from "./feedback-loop-routes";
import { markStepsShared, pathProgress } from "./path-return";
import { notify } from "./notifications";
import { validateAsks } from "@shared/feedback-loop";
import { feedDisplayName } from "./feed-routes";

const isPathTask = (tags: string[] | null) => (tags ?? []).some((t) => t.startsWith("backbone:") || t.startsWith("parent:") || t.startsWith("injected:"))
  && !(tags ?? []).some((t) => t.startsWith("archived:") || t === "kind:loop");

/** Makes (or refreshes) the artifact for a finished step. A title and tags someone chose are kept. */
export async function generateArtifact(projectId: string, taskId: string, authorId: string) {
  const task = await storage.getKanbanTask(taskId);
  if (!task || task.projectId !== projectId || !isPathTask(task.tags)) throw Object.assign(new Error("That isn't a step on this project's path."), { status: 400, code: "not_on_path" });
  if (task.status !== "done") throw Object.assign(new Error("Finish the step first — its answer is the artifact."), { status: 400, code: "step_not_done" });
  const work = await latestWork(taskId);
  const assembled = artifactFromStep({ title: task.title, answer: task.description }, work ? { kind: work.kind, payload: work.payload } : null);
  if (!assembled.body.trim() && !assembled.files.length) {
    throw Object.assign(new Error("This step has nothing written on it yet, so there's nothing to publish."), { status: 400, code: "artifact_empty" });
  }
  const [existing] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.taskId, taskId));
  if (existing) {
    const [updated] = await db.update(pathArtifacts).set({
      summary: assembled.summary, body: assembled.body, files: assembled.files, updatedAt: new Date(),
    }).where(eq(pathArtifacts.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(pathArtifacts).values({
    projectId, taskId, backboneId: backboneIdOf(task.tags), authorId,
    title: assembled.title, summary: assembled.summary, body: assembled.body, files: assembled.files,
  }).returning();
  return created;
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
    .where(eq(pathArtifacts.id, id));
  if (!row || row.a.visibility !== "public" || row.projectPrivate) return null;
  if (row.a.publishedPostId) {
    const [post] = await db.select({ hiddenAt: feedPosts.hiddenAt }).from(feedPosts).where(eq(feedPosts.id, row.a.publishedPostId));
    // Taken down on the feed is taken down here too.
    if (post?.hiddenAt) return null;
  }
  if (opts.countView) await db.update(pathArtifacts).set({ views: sql`${pathArtifacts.views} + 1` }).where(eq(pathArtifacts.id, id));
  // Read-only: an anonymous page view must never sync someone's path.
  const progress = await pathProgress(row.a.projectId).catch(() => null);
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
    if (!artifact || artifact.authorId === userId) return;
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
      const base = process.env.SERVER_BASE_URL || `${req.protocol}://${req.get("host")}`;
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

      let postId = artifact.publishedPostId;
      if (!postId) {
        const post = await storage.createFeedPost({
          authorId: req.user.id, projectId: artifact.projectId, postType: "project_update",
          content: `${checked.title}\n\n${artifact.summary}`.trim(),
          mediaUrls: [], mentions: [], asks: asked.asks, isSystemGenerated: false,
          entityType: "path_artifact", entityId: artifact.id,
        } as any);
        postId = post.id;
        await markStepsShared(post.id, [artifact.taskId]);
      }
      const [published] = await db.update(pathArtifacts).set({
        title: checked.title, tags: checked.tags, visibility: "public", publishedPostId: postId,
        publishedAt: artifact.publishedAt ?? new Date(), updatedAt: new Date(),
      }).where(eq(pathArtifacts.id, artifact.id)).returning();
      res.json({ artifact: published, postId, url: artifactPath(published.id) });
    } catch (error) {
      console.error("Artifact publish error:", error);
      res.status(500).json({ message: "Couldn't publish that" });
    }
  });

  /** Taking it back: the page and the preview go; the feed post is the author's to delete. */
  app.post("/api/artifacts/:id/unpublish", isAuthenticated, rateLimit("post"), async (req: any, res) => {
    try {
      const [artifact] = await db.select().from(pathArtifacts).where(eq(pathArtifacts.id, req.params.id));
      if (!artifact) return res.status(404).json({ message: "Artifact not found" });
      const team = await projectTeam(artifact.projectId);
      if (!team?.has(req.user.id)) return res.status(403).json({ message: "Only the project's team can do that." });
      const [updated] = await db.update(pathArtifacts).set({ visibility: "private", updatedAt: new Date() }).where(eq(pathArtifacts.id, artifact.id)).returning();
      res.json({ artifact: updated });
    } catch (error) {
      console.error("Artifact unpublish error:", error);
      res.status(500).json({ message: "Couldn't do that" });
    }
  });

  /** The public page's data. No account needed — that's the point. */
  app.get("/api/public/artifacts/:id", async (req, res) => {
    try {
      const artifact = await publicArtifact(String(req.params.id), { countView: true });
      if (!artifact) return res.status(404).json({ message: "This artifact isn't published." });
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
