/**
 * One search across everything a builder might be looking for.
 *
 * Discover used to be three destinations — projects, matches, a leaderboard —
 * each with its own list and its own idea of filtering. A person arriving with
 * "who's building something with Postgres" or "who needs a designer" had to
 * guess which of the three would answer. This is the one endpoint behind the
 * single screen: projects and people in one response, filtered the same way,
 * with the counts so the UI can say what it found before anyone scrolls.
 *
 * Privacy is the storage layer's, not this file's: private projects are
 * excluded from listings unless the person asking owns them, suspended and
 * deleted accounts never appear.
 */
import type { Express } from "express";
import { storage } from "./storage";
import { publicProject } from "./project-visibility";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { PROJECT_GOAL_IDS, isProjectGoal } from "@shared/goals";
import { PROJECT_CATEGORIES, isProjectStatus, type ProjectStatus } from "@shared/categories";

/** What a search may narrow by. Everything is optional: no filters is "show me what's out there". */
export interface DiscoverFilters {
  q: string;
  /** Ship / systemize / raise — the path a project is on. */
  goal: string | null;
  category: string | null;
  /** "solo" hides projects that want collaborators; "team" shows only those that do. */
  shape: "solo" | "team" | null;
  /** A role a project says it needs, matched loosely against rolesNeeded. */
  needs: string | null;
  /** Where a project is in its life: planning, active, completed. */
  status: ProjectStatus | null;
  /** What to return at all: both, unless the person narrowed it. */
  kind: "all" | "projects" | "people";
}

export function readFilters(query: Record<string, unknown>): DiscoverFilters {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);
  const goal = str(query.goal);
  const shape = str(query.shape);
  const kind = str(query.kind);
  const status = str(query.status);
  return {
    q: (str(query.q) ?? "").slice(0, 80),
    goal: isProjectGoal(goal) ? goal : null,
    category: str(query.category),
    shape: shape === "solo" || shape === "team" ? shape : null,
    needs: str(query.needs),
    status: isProjectStatus(status) ? status : null,
    kind: kind === "projects" || kind === "people" ? kind : "all",
  };
}

const text = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ").toLowerCase();

export function registerDiscoverSearchRoutes(app: Express) {
  /**
   * Everything matching, in one answer: projects first, then people.
   *
   * Projects are filtered in the query (see below); people are still
   * filtered here, from a capped search.
   */
  app.get("/api/discover/search", isAuthenticated, async (req: any, res) => {
    try {
      const f = readFilters(req.query ?? {});
      const viewerId = req.user.id as string;
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 24), 48);

      const wantProjects = f.kind !== "people";
      const wantPeople = f.kind !== "projects";

      /*
       * The filters run in SQL now (storage.getProjects), under its listing
       * cap: this used to load every project with two queries each and filter
       * in memory, which was fine at fifty projects and a slow, unbounded read
       * for anyone who can sign in at five thousand. `counts` is therefore
       * "up to the cap", which is all the screen's "showing 24 of 61" needs.
       *
       * Rows the viewer doesn't own get the public projection: Discover is a
       * public surface, and a project's notes to Nova aren't part of its pitch.
       */
      const projects = wantProjects
        ? (await storage.getProjects({
            category: f.category ?? undefined, status: f.status ?? undefined, goal: f.goal ?? undefined,
            shape: f.shape ?? undefined, needs: f.needs ?? undefined, q: f.q || undefined,
            includePrivateOwnedBy: viewerId,
          })).map((p) => (p.ownerId === viewerId ? p : publicProject(p)))
        : [];

      const people = wantPeople
        // The viewer travels with the query so blocks are cut in SQL: Discover
        // is the other way somebody blocked walks back into view.
        ? (await storage.searchUsers(f.q, { limit: 200, viewerId }))
          .filter((u) => u.id !== viewerId && u.profile?.isOnboarded)
          .filter((u) => {
            if (!f.needs) return true;
            const looking = (u.profile as any)?.lookingFor;
            return text(u.profile?.headline, (u.profile?.skills ?? []).join(" "), looking?.role).includes(f.needs.toLowerCase());
          })
        : [];

      res.json({
        query: f,
        // The totals are before the cut, so the screen can say "showing 24 of 61".
        counts: { projects: projects.length, people: people.length },
        projects: projects.slice(0, limit),
        people: people.slice(0, limit),
        goals: PROJECT_GOAL_IDS,
        // The filter vocabularies travel with the results, so the screen never
        // holds its own copy of a list the server filters by.
        categories: PROJECT_CATEGORIES,
      });
    } catch (error) {
      console.error("Discover search error:", error);
      res.status(500).json({ message: "Couldn't run that search" });
    }
  });
}
