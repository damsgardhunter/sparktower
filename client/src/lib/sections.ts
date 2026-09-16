/**
 * The project manager's three sections — Ship an MVP, Systemize the business,
 * Raise funds — each its own path on the same project, worked side by side.
 *
 * One place for what the manager and its tabs need to agree on: the section
 * list, which section a board task belongs to (the same rule as the server's
 * `trackOfTask`), and live queries for the sections and a section's path. The
 * path query keeps the ["/api/projects", id, "path", …] prefix, so every
 * existing `invalidateQueries(["/api/projects", id, "path"])` refreshes it.
 */
import { useQuery } from "@tanstack/react-query";
import { PROJECT_GOALS, isProjectGoal, sectionOfTask, type ProjectGoal } from "@shared/goals";
import { Rocket, Workflow, HandCoins, type LucideIcon } from "lucide-react";

export interface SectionDef {
  goal: ProjectGoal;
  label: string;
  short: string;
  /** One line under the section's name. Short on purpose. */
  blurb: string;
  icon: LucideIcon;
}

const BLURB: Record<ProjectGoal, string> = {
  ship_mvp: "Build it and get it in front of people",
  systemize_business: "Make it run without you",
  raise_funding: "Get the money behind it",
};
const ICON: Record<ProjectGoal, LucideIcon> = { ship_mvp: Rocket, systemize_business: Workflow, raise_funding: HandCoins };

export const SECTIONS: SectionDef[] = PROJECT_GOALS.map((g) => ({ goal: g.id, label: g.label, short: g.short, blurb: BLURB[g.id], icon: ICON[g.id] }));
export const sectionDef = (goal: ProjectGoal) => SECTIONS.find((s) => s.goal === goal)!;

/** How often the manager re-reads the sections and the open path while it's on screen, so work done elsewhere (the board, an audit, the editor bridge, a teammate) shows up without a reload. */
export const LIVE_INTERVAL_MS = 15_000;

export interface SectionSummary {
  goal: ProjectGoal; label: string; short: string;
  started: boolean; primary: boolean;
  subcategory?: string; done?: number; total?: number; next?: string | null;
}

/** GET /api/projects/:id/tracks, kept live. */
export function useSections(projectId: string | undefined) {
  return useQuery<{ primary: ProjectGoal; tracks: SectionSummary[] }>({
    queryKey: ["/api/projects", projectId, "tracks"],
    enabled: !!projectId,
    refetchInterval: LIVE_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export const pathQueryKey = (projectId: string | undefined, goal: ProjectGoal | null | undefined) =>
  goal ? ["/api/projects", projectId, "path", "section", goal] : ["/api/projects", projectId, "path"];

/** GET /api/projects/:id/path?goal=… — one section's path, kept live. `goal` null means the primary path. */
export function usePath<T = any>(projectId: string | undefined, goal: ProjectGoal | null | undefined, opts: { enabled?: boolean; live?: boolean } = {}) {
  return useQuery<T>({
    queryKey: pathQueryKey(projectId, goal),
    enabled: !!projectId && opts.enabled !== false,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/path${goal ? `?goal=${goal}` : ""}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
      return res.json();
    },
    refetchInterval: opts.live === false ? false : LIVE_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

// One definition, shared with the server (notification links name the section a step is in).
export { sectionOfTask };

/** Whether a board task shows in a section: its own, or on no section. Tasks from a path the project left are hidden. */
export const taskInSection = (tags: string[] | null | undefined, goal: ProjectGoal, primary: ProjectGoal) =>
  !tags?.some((t) => t.startsWith("archived:")) && (sectionOfTask(tags, primary) ?? goal) === goal;

/** The tag a task created inside a section carries. */
export const sectionTag = (goal: ProjectGoal) => `track:${goal}`;

/** The section in the URL (`?section=raise_funding`), if it names one. */
export function sectionFromUrl(): ProjectGoal | null {
  if (typeof window === "undefined") return null;
  const s = new URLSearchParams(window.location.search).get("section");
  return isProjectGoal(s) ? s : null;
}

/**
 * Tags the path writes for itself — who acts, the milestone, the section,
 * how it was done — are bookkeeping, not labels. Cards and forms show only
 * the tags people added; saving keeps the rest untouched.
 */
const SYSTEM_TAG = /^(actor|tier|backbone|track|parent|loop|loop-type|kind|shared|expands|injected|artifact|carried|verified|archived|round|posted):/;
export const isSystemTag = (tag: string) => SYSTEM_TAG.test(tag);
export const visibleTags = (tags: string[] | null | undefined) => (tags ?? []).filter((t) => !isSystemTag(t));
export const systemTags = (tags: string[] | null | undefined) => (tags ?? []).filter(isSystemTag);
