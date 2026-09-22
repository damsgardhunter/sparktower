/**
 * Startup scouting: the projects a company keeps an eye on, and the
 * industries it watches for new ones.
 *
 * Everything a company can see here is already public — a public project's
 * page is readable by anyone. What scouting adds is attention: a list, a
 * note, and a notification when something moves (server/scouting-alerts.ts).
 * So a private project can never be followed, never appears as a suggestion,
 * and drops out of the list if it goes private after being followed.
 */
import type { Express } from "express";
import { and, desc, eq, inArray, isNull, max, notInArray, sql } from "drizzle-orm";
import { db } from "./db";
import { publiclyVisible } from "./visibility";
import {
  projects, companyFollows, companyWatches, users, userProfiles, projectActivityLog, feedPosts, projectKanbanTasks,
} from "@shared/schema";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { rateLimit } from "./moderation";
import { companyCan } from "./company-access";
import { feedDisplayName } from "./feed-routes";
import { pathProgress } from "./path-return";
import { INDUSTRIES } from "@shared/companies";

const NOTE_MAX = 280;

const snippet = (text: string | null | undefined, n = 180) => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

type ProjectRow = {
  id: string; title: string; category: string; goal: string; status: string; oneLiner: string | null;
  description: string; createdAt: Date; ownerId: string; logoUrl: string | null;
  firstName: string | null; lastName: string | null; displayName: string | null;
};

const projectFields = {
  id: projects.id, title: projects.title, category: projects.category, goal: projects.goal, status: projects.status,
  oneLiner: projects.oneLiner, description: projects.description, createdAt: projects.createdAt, ownerId: projects.ownerId,
  logoUrl: projects.logoUrl,
  firstName: users.firstName, lastName: users.lastName, displayName: userProfiles.displayName,
};

/**
 * The latest sign of life for each project: the activity log, a visible post,
 * a finished task — whichever is newest — falling back to when it was made.
 */
async function lastActivity(ids: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!ids.length) return out;
  const bump = (id: string, at: Date | string | null) => {
    if (!at) return;
    const d = new Date(at);
    if (!out.has(id) || out.get(id)! < d) out.set(id, d);
  };
  const logs = await db.select({ id: projectActivityLog.projectId, at: max(projectActivityLog.createdAt) })
    .from(projectActivityLog).where(inArray(projectActivityLog.projectId, ids)).groupBy(projectActivityLog.projectId);
  const posts = await db.select({ id: feedPosts.projectId, at: max(feedPosts.createdAt) })
    .from(feedPosts).where(and(inArray(feedPosts.projectId, ids), publiclyVisible.feedPost())).groupBy(feedPosts.projectId);
  const tasks = await db.select({ id: projectKanbanTasks.projectId, at: max(projectKanbanTasks.completedAt) })
    .from(projectKanbanTasks).where(inArray(projectKanbanTasks.projectId, ids)).groupBy(projectKanbanTasks.projectId);
  for (const r of [...logs, ...posts, ...tasks]) if (r.id) bump(r.id, r.at);
  return out;
}

function summary(p: ProjectRow, lastActivityAt: Date | undefined) {
  return {
    id: p.id, title: p.title, category: p.category, goal: p.goal, status: p.status, logoUrl: p.logoUrl,
    description: snippet(p.oneLiner || p.description),
    ownerName: feedDisplayName({ firstName: p.firstName, lastName: p.lastName }, { displayName: p.displayName }),
    lastActivityAt: lastActivityAt && lastActivityAt > p.createdAt ? lastActivityAt : p.createdAt,
  };
}

export function registerScoutingRoutes(app: Express): void {
  /** What the company watches, what it follows, and what it might want to. */
  app.get("/api/companies/:id/scouting", isAuthenticated, async (req: any, res) => {
    const found = await companyCan(res, req.params.id, req.user.id, "view");
    if (!found) return;
    const { company } = found;

    const watches = (await db.select({ industry: companyWatches.industry }).from(companyWatches)
      .where(eq(companyWatches.companyId, company.id))).map((w) => w.industry).sort();

    const followed = await db
      .select({ ...projectFields, note: companyFollows.note, followedAt: companyFollows.createdAt })
      .from(companyFollows)
      .innerJoin(projects, eq(projects.id, companyFollows.projectId))
      .innerJoin(users, eq(users.id, projects.ownerId))
      .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
      .where(and(eq(companyFollows.companyId, company.id), eq(projects.isPrivate, false)))
      .orderBy(desc(companyFollows.createdAt));

    const activity = await lastActivity(followed.map((f) => f.id));
    const follows = await Promise.all(followed.map(async (f) => {
      const progress = await pathProgress(f.id).catch(() => null);
      return {
        ...summary(f, activity.get(f.id)),
        note: f.note, followedAt: f.followedAt,
        milestonesDone: progress?.done ?? 0, milestonesTotal: progress?.total ?? null,
      };
    }));
    follows.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

    /*
     * Newest public projects in the watched industries that the company does
     * not already follow — and not its own, which it hardly needs to scout.
     */
    const exclude = [...followed.map((f) => f.id), ...(company.projectId ? [company.projectId] : [])];
    const suggested = watches.length
      ? await db.select(projectFields).from(projects)
          .innerJoin(users, eq(users.id, projects.ownerId))
          .leftJoin(userProfiles, eq(userProfiles.userId, projects.ownerId))
          .where(and(
            inArray(projects.category, watches), eq(projects.isPrivate, false),
            /*
             * Scouting suggests projects to a company by name and description,
             * which is a public listing by another route: it tested the
             * owner's suspension but never `projects.hiddenAt`, so a project a
             * reviewer had taken down went on being recommended to companies
             * as somebody worth backing.
             */
            publiclyVisible.project(),
            exclude.length ? notInArray(projects.id, exclude) : undefined,
          ))
          .orderBy(desc(projects.createdAt))
          .limit(12)
      : [];
    const suggestedActivity = await lastActivity(suggested.map((s) => s.id));

    res.json({
      watches,
      follows,
      suggestions: suggested.map((s) => summary(s, suggestedActivity.get(s.id))),
    });
  });

  /** The industries to watch, as a whole set: what is sent is what is watched. */
  app.put("/api/companies/:id/watches", isAuthenticated, rateLimit("workspace"), async (req: any, res) => {
    const found = await companyCan(res, req.params.id, req.user.id, "scouting");
    if (!found) return;
    const raw = req.body?.industries;
    if (!Array.isArray(raw)) return res.status(400).json({ message: "industries is a list.", field: "industries" });
    const industries = [...new Set(raw.map(String))];
    const unknown = industries.filter((i) => !(INDUSTRIES as readonly string[]).includes(i));
    if (unknown.length) return res.status(400).json({ message: `Not an industry here: ${unknown.slice(0, 3).join(", ")}.`, field: "industries" });

    await db.transaction(async (tx) => {
      await tx.delete(companyWatches).where(eq(companyWatches.companyId, found.company.id));
      if (industries.length) {
        const now = new Date();
        await tx.insert(companyWatches).values(industries.map((industry) => ({ companyId: found.company.id, industry, createdAt: now })));
      }
    });
    res.json({ watches: industries.sort() });
  });

  /** Follow a public project, with an optional note on why. Following again updates the note. */
  app.post("/api/companies/:id/follows/:projectId", isAuthenticated, rateLimit("follow"), async (req: any, res) => {
    const found = await companyCan(res, req.params.id, req.user.id, "scouting");
    if (!found) return;
    const [project] = await db.select({ id: projects.id, isPrivate: projects.isPrivate }).from(projects).where(eq(projects.id, req.params.projectId));
    // A private project reads as missing, the same as it does to anyone outside it.
    if (!project || project.isPrivate) return res.status(404).json({ message: "No such project." });
    const note = typeof req.body?.note === "string" && req.body.note.trim() ? req.body.note.trim().slice(0, NOTE_MAX) : null;

    const [follow] = await db.insert(companyFollows).values({
      companyId: found.company.id, projectId: project.id, note, createdBy: req.user.id, createdAt: new Date(),
    }).onConflictDoUpdate({
      target: [companyFollows.companyId, companyFollows.projectId],
      set: { note: sql`coalesce(excluded.note, ${companyFollows.note})` },
    }).returning();
    res.json({ follow });
  });

  app.delete("/api/companies/:id/follows/:projectId", isAuthenticated, rateLimit("follow"), async (req: any, res) => {
    const found = await companyCan(res, req.params.id, req.user.id, "scouting");
    if (!found) return;
    await db.delete(companyFollows).where(and(eq(companyFollows.companyId, found.company.id), eq(companyFollows.projectId, req.params.projectId)));
    res.json({ ok: true });
  });
}
