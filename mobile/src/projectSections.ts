/**
 * Public-page sections the project owner can show or hide.
 *
 * Restated from `shared/project-sections.ts` — Metro doesn't resolve the
 * `@shared/*` alias and that module imports Drizzle types. Keep the keys,
 * labels, hints, and defaults in sync when the web version changes.
 */
export type ProjectSectionKey =
  | "oneLiner" | "mission" | "description" | "problemStatement" | "targetUser"
  | "valueProposition" | "targetCustomerProfile" | "successMetrics" | "scope"
  | "techStack" | "rolesNeeded" | "team" | "stats" | "links";

export interface ProjectSectionDef {
  key: ProjectSectionKey;
  label: string;
  hint: string;
  group: "hero" | "brief" | "detail" | "sidebar";
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

export const SECTION_GROUPS: { group: ProjectSectionDef["group"]; title: string; blurb: string }[] = [
  { group: "hero", title: "Top of the page", blurb: "The first thing a visitor reads" },
  { group: "brief", title: "Project brief", blurb: "Your thinking on the problem and the customer" },
  { group: "detail", title: "Detail", blurb: "Scope, stack, and who you're hiring" },
  { group: "sidebar", title: "Sidebar", blurb: "Team, stats, and links" },
];

type ProjectLike = Record<string, any>;

/**
 * Whether a section has anything worth rendering. Empty sections never show
 * publicly regardless of the toggle, so the UI marks them as such rather than
 * letting the owner think a toggle did nothing.
 */
export function sectionHasContent(project: ProjectLike, key: ProjectSectionKey): boolean {
  switch (key) {
    case "scope": {
      const scope = project.scope || {};
      return ((scope.mvp?.length || 0) + (scope.niceToHave?.length || 0)) > 0;
    }
    case "techStack":
      return (project.techStack?.length || 0) > 0;
    // Solo Builder projects never recruit, so this section has nothing to say
    // even if a stale rolesNeeded list survived the toggle.
    case "rolesNeeded":
      return !project.soloMode && (project.rolesNeeded?.length || 0) > 0;
    case "links":
      return Boolean(project.repoUrl || project.liveUrl);
    case "team":
    case "stats":
      return true;
    default:
      return Boolean((project[key] ?? "").toString().trim());
  }
}

const byKey = Object.fromEntries(PROJECT_SECTIONS.map((s) => [s.key, s])) as Record<ProjectSectionKey, ProjectSectionDef>;

/** The owner's explicit choice, or the section's default if they haven't set one. */
export function isSectionEnabled(project: ProjectLike, key: ProjectSectionKey): boolean {
  const overrides = project.publicSections || {};
  return overrides[key] ?? byKey[key].defaultVisible;
}
