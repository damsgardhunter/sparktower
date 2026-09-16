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
   * Filtering happens here rather than in the query because the pool is small
   * and the filters are about words in several columns — a project's title,
   * its one-liner, its stack, the roles it needs. When that stops being true,
   * the shape of this response is what a real index would fill.
   */
  app.get("/api/discover/search", isAuthenticated, async (req: any, res) => {
    try {
      const f = readFilters(req.query ?? {});
      const viewerId = req.user.id as string;
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 24), 48);

      const wantProjects = f.kind !== "people";
      const wantPeople = f.kind !== "projects";

      const projects = wantProjects
        ? (await storage.getProjects({ category: f.category ?? undefined, status: f.status ?? undefined, includePrivateOwnedBy: viewerId }))
          .filter((p) => {
            if (f.goal && p.goal !== f.goal) return false;
            if (f.shape === "solo" && !p.soloMode) return false;
            if (f.shape === "team" && p.soloMode) return false;
            if (f.needs && !(p.rolesNeeded ?? []).some((r) => r.toLowerCase().includes(f.needs!.toLowerCase()))) return false;
            if (!f.q) return true;
            return text(p.title, p.oneLiner, p.description, (p.techStack ?? []).join(" "), (p.rolesNeeded ?? []).join(" ")).includes(f.q.toLowerCase());
          })
        : [];

      const people = wantPeople
        ? (await storage.searchUsers(f.q, { limit: 200 }))
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
