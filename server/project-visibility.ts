/**
 * What of a project an outsider may see.
 *
 * A project row carries two kinds of columns. Most of it is the pitch — the
 * title, the brief, the roles, the media — and the public page exists to show
 * it. A handful are the team's working state: what the builder told Nova to
 * keep in mind (`novaNotes`, which is often exactly the candid thing a founder
 * wouldn't put on the public page), the loops they threw out, how much an
 * audit may change without asking, the branch they're on, the landing page
 * draft, and the uploaded business plan. Every project route used to hand the
 * whole row to whoever asked, signed in or not, so a stranger could read a
 * founder's private notes to their assistant off the listing endpoint.
 *
 * `dataSource` never leaves the server at all (shared/strip-sealed.ts strips
 * it from every response); this is the next ring out: things the team sees
 * and nobody else does.
 */
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { projectMembers, type Project } from "@shared/schema";

/** Columns only the owner and members are sent. */
export const TEAM_ONLY_PROJECT_FIELDS = [
  "novaNotes", "rejectedLoops", "auditAutoApply", "activeBranch", "landingPageConfig", "businessPlanUrl",
] as const satisfies readonly (keyof Project)[];

export type TeamOnlyProjectField = (typeof TEAM_ONLY_PROJECT_FIELDS)[number];
type TeamOnlyField = TeamOnlyProjectField;

/**
 * The project as the public sees it: the row minus the team's working state.
 * Generic so an enriched row (with `owner`, `profile`) keeps its extras.
 */
export function publicProject<T extends Partial<Pick<Project, TeamOnlyField>>>(project: T): Omit<T, TeamOnlyField> {
  const out: Record<string, unknown> = { ...project };
  for (const field of TEAM_ONLY_PROJECT_FIELDS) delete out[field];
  return out as Omit<T, TeamOnlyField>;
}

/**
 * Whether this person is on the project's team: its owner, or a member row.
 * Takes the project's owner id rather than re-reading the project, since every
 * caller has already loaded it to decide whether it exists.
 */
export async function isOnTeam(viewerId: string | null | undefined, project: { id: string; ownerId: string }): Promise<boolean> {
  if (!viewerId) return false;
  if (project.ownerId === viewerId) return true;
  const [row] = await db.select({ id: projectMembers.id }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, viewerId)))
    .limit(1);
  return !!row;
}
