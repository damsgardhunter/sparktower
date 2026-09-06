/**
 * Nova's project briefing — the landing screen when an owner opens Manage.
 *
 * Deliberately NOT an AI call: completion and recommendations are derived from
 * real project state, so opening the dashboard is free and instant. Only the
 * *action* attached to each recommendation costs credits, and each one names
 * its price up front.
 */
import type { Express } from "express";
import { storage } from "./storage";
import { isAuthenticated } from "./replit_integrations/auth/replitAuth";
import { getUserEntitlements } from "./entitlements";
import { CREDIT_COSTS, roadmapRebuildCost } from "@shared/plans";
import { PROJECT_SECTIONS, sectionHasContent } from "@shared/project-sections";

/** Where the action button sends the user, and what it costs. */
export interface NovaRecommendation {
  id: string;
  /** The observation, phrased the way a person would say it. */
  title: string;
  /** Optional extra context under the title. */
  detail?: string;
  actionLabel: string;
  /** 0 means the action itself is free (navigation, editing). */
  credits: number;
  /** Manage tab to open, if the action is navigational. */
  tab?: string;
  /** API endpoint the client should POST to, if the action runs AI. */
  endpoint?: string;
  /** Higher surfaces first. */
  weight: number;
  severity: "critical" | "important" | "suggested";
}

const DAY_MS = 86_400_000;
const daysSince = (d: Date | string | null | undefined): number =>
  d ? Math.floor((Date.now() - new Date(d).getTime()) / DAY_MS) : Infinity;

/**
 * Weighted completion across the things that actually make a project real.
 * Brief fields are individually small; shipping artifacts count for more.
 */
function computeCompletion(input: {
  project: any;
  roadmapPhases: number;
  completedPhases: number;
  milestones: number;
  completedMilestones: number;
  tasks: number;
  doneTasks: number;
  members: number;
  personas: number;
  hasReadinessScore: boolean;
}): { percent: number; breakdown: { label: string; done: boolean; weight: number }[] } {
  const { project } = input;
  const briefKeys = ["oneLiner", "mission", "problemStatement", "targetUser", "valueProposition", "successMetrics"] as const;
  const briefDone = briefKeys.filter((k) => sectionHasContent(project, k as any)).length;

  const checks: { label: string; done: boolean; weight: number }[] = [
    { label: "Project brief filled in", done: briefDone >= 4, weight: 15 },
    { label: "Scope defined", done: sectionHasContent(project, "scope"), weight: 8 },
    { label: "Roadmap built", done: input.roadmapPhases > 0, weight: 12 },
    { label: "Roadmap progress", done: input.completedPhases > 0, weight: 10 },
    { label: "Milestones set", done: input.milestones > 0, weight: 8 },
    { label: "Milestones hit", done: input.completedMilestones > 0, weight: 8 },
    { label: "Tasks broken out", done: input.tasks >= 5, weight: 8 },
    { label: "Tasks shipping", done: input.doneTasks > 0, weight: 10 },
    { label: "Team forming", done: input.members > 1, weight: 6 },
    { label: "Customers understood", done: input.personas > 0, weight: 7 },
    { label: "Something to show", done: Boolean(project.repoUrl || project.liveUrl), weight: 5 },
    { label: "Investor readiness checked", done: input.hasReadinessScore, weight: 3 },
  ];

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0);
  // Partial credit for a half-filled brief so early progress is visible.
  const partialBrief = briefDone > 0 && briefDone < 4 ? Math.round((briefDone / 4) * 15) : 0;

  return {
    percent: Math.min(100, Math.round(((earned + partialBrief) / total) * 100)),
    breakdown: checks,
  };
}

export function registerNovaBriefingRoutes(app: Express) {
  app.get("/api/projects/:id/nova-briefing", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const projectId = req.params.id;

      const project = await storage.getProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const members = await storage.getProjectMembers(projectId).catch(() => []);
      const isMember = project.ownerId === userId || members.some((m) => m.userId === userId);
      if (!isMember) return res.status(403).json({ message: "Not a project member" });

      const [roadmap, milestones, tasks, personas, artifacts, pricingTiers, completions] = await Promise.all([
        storage.getProjectRoadmap(projectId).catch(() => undefined),
        storage.getProjectMilestones(projectId).catch(() => []),
        storage.getProjectKanbanTasks(projectId).catch(() => []),
        storage.getProjectPersonas(projectId).catch(() => []),
        storage.getInvestorArtifacts(projectId).catch(() => []),
        storage.getProjectPricingTiers(projectId).catch(() => []),
        storage.getProjectTaskCompletions(projectId, 500).catch(() => []),
      ]);

      const ent = await getUserEntitlements(userId);
      const doneTasks = tasks.filter((t: any) => t.status === "done");
      /*
       * Completion is measured against everything this project has ever
       * finished, not what's still sitting in the done column. Clearing a
       * tidy board used to reset "Tasks shipping" to false and drop the
       * completion score, which punished the builder for housekeeping.
       */
      const completedAllTime = Math.max(doneTasks.length, completions.length);
      const openTasks = tasks.filter((t: any) => t.status !== "done");
      const blockedTasks = tasks.filter((t: any) => t.blockedByTaskId && t.status !== "done");
      // "Stale" = sitting in progress untouched for over a week.
      const stalledTasks = openTasks.filter(
        (t: any) => t.status === "in-progress" && daysSince(t.createdAt) > 7
      );
      const readinessScore = artifacts.find((a) => a.kind === "readiness_score");

      const completion = computeCompletion({
        project,
        roadmapPhases: roadmap?.phases.length || 0,
        completedPhases: roadmap?.phases.filter((p) => p.status === "completed").length || 0,
        milestones: milestones.length,
        completedMilestones: milestones.filter((m) => m.status === "completed").length,
        tasks: tasks.length,
        doneTasks: completedAllTime,
        members: members.length,
        personas: personas.length,
        hasReadinessScore: !!readinessScore,
      });

      const recs: NovaRecommendation[] = [];

      // --- Brief gaps: cheapest, highest-leverage fix, and it's free ---
      const missingBrief = PROJECT_SECTIONS
        .filter((s) => ["oneLiner", "mission", "problemStatement", "targetUser"].includes(s.key))
        .filter((s) => !sectionHasContent(project, s.key));
      if (missingBrief.length > 0) {
        recs.push({
          id: "brief",
          title: `Your brief is missing ${missingBrief.map((s) => s.label.toLowerCase()).join(", ")}`,
          detail: "Nova uses the brief for every roadmap, persona, and pitch — filling it in makes everything else sharper.",
          actionLabel: "Fill in the brief",
          credits: 0,
          tab: "setup",
          weight: 95,
          severity: "critical",
        });
      }

      // --- Roadmap ---
      if (!roadmap && ent.aiRoadmap) {
        recs.push({
          id: "roadmap-missing",
          title: "You don't have a roadmap yet",
          detail: "Tell Nova where you want this to end up and it'll break the path into phases.",
          actionLabel: "Build my roadmap",
          credits: CREDIT_COSTS.roadmapGeneration,
          tab: "roadmap",
          weight: 90,
          severity: "critical",
        });
      } else if (roadmap) {
        const stale = daysSince(roadmap.lastUpdatedAt);
        if (stale >= 7 && ent.roadmapUpdates) {
          recs.push({
            id: "roadmap-stale",
            title: `You haven't updated your roadmap in ${stale} days`,
            detail: "Nova can re-plan the remaining phases against what you've actually shipped.",
            actionLabel: "Update roadmap",
            credits: CREDIT_COSTS.roadmapUpdate,
            tab: "roadmap",
            weight: 70 + Math.min(15, stale),
            severity: stale >= 21 ? "important" : "suggested",
          });
        }
        // A roadmap with nothing in flight usually means it drifted from reality.
        if (roadmap.phases.length > 0 && roadmap.phases.every((p) => p.status === "upcoming") && tasks.length > 5) {
          recs.push({
            id: "roadmap-drift",
            title: "Your roadmap says nothing has started, but you have tasks moving",
            detail: "A rebuild resequences phases, milestones, and priorities around where the project actually is.",
            actionLabel: "Rebuild roadmap",
            credits: roadmapRebuildCost({
              phases: roadmap.phases.length,
              milestones: milestones.length,
              tasks: tasks.length,
            }),
            tab: "roadmap",
            weight: 68,
            severity: "important",
          });
        }
        if (roadmap.phases.length > 0) {
          recs.push({
            id: "next-actions",
            title: "Not sure what to work on next?",
            detail: "Nova reads your roadmap, milestones, and open tasks and ranks the three highest-impact moves.",
            actionLabel: "Ask Nova what's next",
            credits: CREDIT_COSTS.nextActions,
            tab: "roadmap",
            endpoint: `/api/projects/${projectId}/roadmap/next-actions`,
            weight: 60,
            severity: "suggested",
          });
        }
      }

      // --- Blocked / stalled work ---
      if (blockedTasks.length > 0 || stalledTasks.length > 0) {
        const count = blockedTasks.length || stalledTasks.length;
        const kind = blockedTasks.length > 0 ? "blocked" : "sitting in progress";
        recs.push({
          id: "blocked-tasks",
          title: `${count} task${count === 1 ? " has" : "s have"} been ${kind} for over a week`,
          detail: blockedTasks.slice(0, 3).map((t: any) => t.title).join(" · ") || stalledTasks.slice(0, 3).map((t: any) => t.title).join(" · "),
          actionLabel: "Ask Nova for solutions",
          credits: CREDIT_COSTS.nextActions,
          tab: "roadmap",
          endpoint: `/api/projects/${projectId}/roadmap/next-actions`,
          weight: 82,
          severity: "important",
        });
      }

      // --- Team gaps ---
      const filledRoles = new Set(members.map((m) => (m.role || "").toLowerCase()));
      const missingRoles = (project.rolesNeeded || []).filter(
        (r) => !filledRoles.has(r.toLowerCase())
      );
      if (missingRoles.length > 0) {
        recs.push({
          id: "team-gap",
          title: `Your team is missing ${missingRoles.length === 1 ? `a ${missingRoles[0]}` : `${missingRoles.length} roles`}`,
          detail: missingRoles.slice(0, 4).join(" · "),
          actionLabel: "Find candidates",
          credits: CREDIT_COSTS.peopleRecommendation,
          tab: "team",
          endpoint: `/api/projects/${projectId}/recommend-people`,
          weight: 75,
          severity: "important",
        });
      }

      // --- Pricing ---
      if (pricingTiers.length === 0 && completion.percent > 25) {
        recs.push({
          id: "pricing",
          title: "Validate your pricing before continuing development",
          detail: "Nova checks your pricing against your target customer and what comparable products charge.",
          actionLabel: "Run pricing analysis",
          credits: CREDIT_COSTS.pricingAnalysis,
          tab: "strategy",
          endpoint: `/api/projects/${projectId}/pricing-analysis`,
          weight: 72,
          severity: "important",
        });
      }

      // --- Customers ---
      if (personas.length === 0) {
        recs.push({
          id: "personas",
          title: "You haven't defined who you're building for",
          detail: "Nova can draft a realistic customer persona from your brief.",
          actionLabel: "Generate a persona",
          credits: CREDIT_COSTS.personaGeneration,
          tab: "personas",
          endpoint: `/api/projects/${projectId}/personas/generate`,
          weight: 65,
          severity: "suggested",
        });
      }

      // --- Tasks ---
      if (tasks.length < 5 && ent.aiTaskGeneration !== "none") {
        recs.push({
          id: "tasks",
          title: "There's barely anything on your board",
          detail: "Nova can break the project into concrete tasks you can start on.",
          actionLabel: "Generate tasks",
          credits: CREDIT_COSTS.taskGeneration,
          tab: "kanban",
          endpoint: `/api/projects/${projectId}/kanban/ai-generate`,
          weight: 78,
          severity: "important",
        });
      }

      // --- Investor readiness ---
      if (!readinessScore && completion.percent > 40 && ent.aiRoadmap) {
        recs.push({
          id: "readiness",
          title: "See how you'd hold up in front of an investor",
          detail: "Scored honestly across six categories, with the blockers that would sink a real meeting.",
          actionLabel: "Score my readiness",
          credits: CREDIT_COSTS.investorReadinessScore,
          tab: "strategy",
          endpoint: `/api/projects/${projectId}/readiness-score`,
          weight: 50,
          severity: "suggested",
        });
      }

      // --- Health check (Pro) ---
      if (ent.projectHealthChecks && completion.percent > 30) {
        recs.push({
          id: "health",
          title: "Get an honest read on whether this is on track",
          actionLabel: "Run a health check",
          credits: CREDIT_COSTS.healthCheck,
          tab: "analytics",
          endpoint: `/api/projects/${projectId}/health-check`,
          weight: 45,
          severity: "suggested",
        });
      }

      recs.sort((a, b) => b.weight - a.weight);

      res.json({
        completion: completion.percent,
        breakdown: completion.breakdown,
        // Four is what fits the dashboard without becoming a to-do list.
        recommendations: recs.slice(0, 4),
        totalRecommendations: recs.length,
        stats: {
          phases: roadmap?.phases.length || 0,
          completedPhases: roadmap?.phases.filter((p) => p.status === "completed").length || 0,
          milestones: milestones.length,
          tasks: tasks.length,
          doneTasks: doneTasks.length,
          /** Includes work cleared off the board, so it never goes backwards. */
          completedAllTime,
          openTasks: openTasks.length,
          members: members.length,
          teamSize: project.teamSize,
          roadmapUpdatedDaysAgo: roadmap ? daysSince(roadmap.lastUpdatedAt) : null,
        },
        project: { id: project.id, title: project.title },
      });
    } catch (error) {
      console.error("Nova briefing error:", error);
      res.status(500).json({ message: "Failed to build your briefing" });
    }
  });
}
