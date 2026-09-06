import type { Project } from "./schema";

/**
 * Sections the owner can show or hide on the public project page.
 *
 * This is the single source of truth shared by the public page
 * (client/src/components/project-overview.tsx), the Manage → Public Page
 * visibility toggles, and the AI media generator's project context — so
 * adding a section here wires it into all three.
 */
export type ProjectSectionKey =
  | "oneLiner"
  | "mission"
  | "description"
  | "problemStatement"
  | "targetUser"
  | "valueProposition"
  | "targetCustomerProfile"
  | "successMetrics"
  | "scope"
  | "techStack"
  | "rolesNeeded"
  | "team"
  | "stats"
  | "links";

export interface ProjectSectionDef {
  key: ProjectSectionKey;
  /** Heading shown on the public page. */
  label: string;
  /** Explains the section in the Manage → Public Page toggle list. */
  hint: string;
  /** Where the section renders on the public page. */
  group: "hero" | "brief" | "detail" | "sidebar";
  /** Whether it's visible when the owner hasn't chosen explicitly. */
  defaultVisible: boolean;
}

export const PROJECT_SECTIONS: ProjectSectionDef[] = [
  { key: "oneLiner", label: "One-Liner", hint: "The single-sentence pitch, shown large at the top", group: "hero", defaultVisible: true },
  { key: "mission", label: "Mission", hint: "Why this project exists and what it's working toward", group: "hero", defaultVisible: true },
  { key: "description", label: "About", hint: "The longer project description", group: "hero", defaultVisible: true },
  { key: "problemStatement", label: "The Problem", hint: "What problem the project solves", group: "brief", defaultVisible: true },
  { key: "targetUser", label: "Who It's For", hint: "The target user", group: "brief", defaultVisible: true },
  { key: "valueProposition", label: "Value Proposition", hint: "The unique value you provide", group: "brief", defaultVisible: true },
  { key: "targetCustomerProfile", label: "Target Customer", hint: "Demographics, behaviors, pain points", group: "brief", defaultVisible: true },
  { key: "successMetrics", label: "What Success Looks Like", hint: "How you define success", group: "brief", defaultVisible: true },
  { key: "scope", label: "Roadmap", hint: "Your MVP and nice-to-have scope items", group: "detail", defaultVisible: true },
  { key: "techStack", label: "Tech Stack", hint: "Technologies the project uses", group: "detail", defaultVisible: true },
  { key: "rolesNeeded", label: "Roles Needed", hint: "Roles you're recruiting for", group: "detail", defaultVisible: true },
  { key: "team", label: "Team Members", hint: "Who is on the team", group: "sidebar", defaultVisible: true },
  { key: "stats", label: "Project Stats", hint: "Views, team size, timeline, followers", group: "sidebar", defaultVisible: true },
  { key: "links", label: "Repository & Demo Links", hint: "Links to your repo and live demo", group: "sidebar", defaultVisible: true },
];

export const PROJECT_SECTIONS_BY_KEY: Record<ProjectSectionKey, ProjectSectionDef> =
  Object.fromEntries(PROJECT_SECTIONS.map((s) => [s.key, s])) as Record<ProjectSectionKey, ProjectSectionDef>;

type ProjectLike = Partial<Project> & Record<string, any>;

export interface ProjectScope {
  mvp?: string[];
  niceToHave?: string[];
}

export function getProjectScope(project: ProjectLike): ProjectScope {
  const scope = (project.scope as ProjectScope | null) || {};
  return { mvp: scope.mvp || [], niceToHave: scope.niceToHave || [] };
}

/**
 * Whether a section has anything worth rendering. Sections with no content are
 * never shown publicly, regardless of the owner's toggle — that's what makes
 * the page lay itself out automatically as the brief gets filled in.
 */
export function sectionHasContent(project: ProjectLike, key: ProjectSectionKey): boolean {
  switch (key) {
    case "scope": {
      const scope = getProjectScope(project);
      return (scope.mvp?.length || 0) + (scope.niceToHave?.length || 0) > 0;
    }
    case "techStack":
      return (project.techStack?.length || 0) > 0;
    // A Solo Builder project is never recruiting, so the section has nothing
    // to say even if a stale rolesNeeded list survived the toggle.
    case "rolesNeeded":
      return !project.soloMode && (project.rolesNeeded?.length || 0) > 0;
    case "links":
      return Boolean(project.repoUrl || project.liveUrl);
    // Always available — they're derived from the project record, not the brief.
    case "team":
    case "stats":
      return true;
    default:
      return Boolean((project[key] ?? "").toString().trim());
  }
}

function getOverrides(project: ProjectLike): Partial<Record<ProjectSectionKey, boolean>> {
  return (project.publicSections as Partial<Record<ProjectSectionKey, boolean>> | null) || {};
}

/** The owner's explicit choice for a section, or its default if they haven't set one. */
export function isSectionEnabled(project: ProjectLike, key: ProjectSectionKey): boolean {
  const override = getOverrides(project)[key];
  return override ?? PROJECT_SECTIONS_BY_KEY[key].defaultVisible;
}

/** What a visitor actually sees: enabled by the owner *and* has content. */
export function isSectionVisible(project: ProjectLike, key: ProjectSectionKey): boolean {
  return isSectionEnabled(project, key) && sectionHasContent(project, key);
}

export function getVisibleSections(project: ProjectLike, group?: ProjectSectionDef["group"]): ProjectSectionDef[] {
  return PROJECT_SECTIONS.filter(
    (s) => (!group || s.group === group) && isSectionVisible(project, s.key)
  );
}

/**
 * Brief fields flattened into label/value pairs for AI prompts. Uses every
 * field the owner has filled in, including ones hidden from the public page —
 * hiding a field from visitors shouldn't starve the generator of context.
 */
export function getProjectBriefContext(project: ProjectLike): { label: string; value: string }[] {
  const pairs: { label: string; value: string }[] = [];
  const push = (label: string, value: unknown) => {
    const text = (value ?? "").toString().trim();
    if (text) pairs.push({ label, value: text });
  };

  push("Project title", project.title);
  push("One-liner", project.oneLiner);
  push("Mission", project.mission);
  push("Description", project.description);
  push("Category", project.category);
  push("Problem it solves", project.problemStatement);
  push("Target user", project.targetUser);
  push("Value proposition", project.valueProposition);
  push("Target customer profile", project.targetCustomerProfile);
  push("Success metrics", project.successMetrics);

  const scope = getProjectScope(project);
  push("MVP scope", scope.mvp?.join(", "));
  push("Nice-to-have scope", scope.niceToHave?.join(", "));
  push("Tech stack", project.techStack?.join(", "));
  // Don't feed a solo project's stale role list to the AI as if it were hiring.
  if (project.soloMode) {
    push("Team", "Solo builder — not recruiting");
  } else {
    push("Roles being recruited", project.rolesNeeded?.join(", "));
  }

  return pairs;
}

export function formatProjectBriefForPrompt(project: ProjectLike): string {
  const pairs = getProjectBriefContext(project);
  if (pairs.length === 0) return "No project brief details available.";
  return pairs.map((p) => `${p.label}: ${p.value}`).join("\n");
}
