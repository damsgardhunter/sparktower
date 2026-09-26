/**
 * The path, as something a founder can send someone.
 *
 * Everything Nova writes on a path lands in one place: the `description` of a
 * task on a board. That is the right home for it while the work is being done
 * — the step is where you answer it and where you change your mind — and it is
 * a terrible home for it afterwards. A builder who paid for the whole business
 * to be built had, at the end, twenty-five task descriptions: the five loops,
 * the data model, the pricing, the SOPs, the cash-flow plan. The bank manager
 * wants a document. The landlord wants a document. The co-founder reading it
 * on a train wants a document. Nobody wants a Kanban board.
 *
 * So this assembles what is written on a path into one thing, in the order the
 * path put it, and hands it over as a PDF (through the renderer the document
 * builder already uses) or as Markdown, which pastes into anything.
 *
 * ## What it is not
 *
 * It is not a model call, and it costs nothing. Nothing here writes, rewrites
 * or summarises: every word in the export is a word already on the path,
 * written by Nova and kept or changed by the builder. Charging for a second
 * copy of something somebody already has would be charging for the container.
 *
 * ## Why it skips things
 *
 * A milestone whose description is still the authored brief has not been
 * answered — it is the instructions, not the work — so it is left out rather
 * than padding the document with its own table of contents. `authoredTextFor`
 * is the same check the rest of the path uses to tell an answer from a prompt.
 */
import { db } from "./db";
import { projects, projectKanbanTasks } from "@shared/schema";
import { eq } from "drizzle-orm";
import { resolveTree, authoredTextFor, type ResolvedMilestone } from "@shared/phase-trees";
import { PROJECT_GOALS, normaliseGoal, type ProjectGoal } from "@shared/goals";
import { trackState, backboneIdOf, parentOf } from "./phase-trees";
import type { DocumentPage, DocumentBlock, DocumentSettings } from "@shared/documents";

/** One answered step, with the phase it belongs to. */
interface Written {
  phaseId: string;
  phaseTitle: string;
  title: string;
  body: string;
  order: number;
}

export interface PathExport {
  title: string;
  projectTitle: string;
  goalLabel: string;
  /** How many answered steps went in — zero means there is nothing to send yet. */
  steps: number;
  phases: { title: string; steps: { title: string; body: string }[] }[];
}

/**
 * What is written on this section of the path, in path order.
 *
 * Reads the tree rather than `pathStatus` because this wants the authored text
 * of each milestone (to tell an answer from a brief) and its phase, and none
 * of the live progress, pace or loop machinery that a dashboard needs.
 */
export async function collectPathWriting(projectId: string, goal: ProjectGoal): Promise<PathExport | null> {
  const [project] = await db.select({ title: projects.title, goal: projects.goal })
    .from(projects).where(eq(projects.id, projectId));
  if (!project) return null;
  const state = await trackState(projectId, goal);
  if (!state) return null;

  const tree = resolveTree(goal, state.subcategory, state.capitalRoute);
  const milestones = new Map<string, ResolvedMilestone>();
  const phaseOf = new Map<string, { id: string; title: string; index: number }>();
  tree.forEach((phase, index) => {
    for (const m of phase.milestones) {
      milestones.set(m.id, m);
      phaseOf.set(m.id, { id: phase.id, title: phase.title, index });
    }
  });

  const rows = await db.select().from(projectKanbanTasks).where(eq(projectKanbanTasks.projectId, projectId));
  const written: Written[] = [];
  for (const task of rows) {
    const id = backboneIdOf(task.tags) ?? parentOf(task.tags);
    const phase = id ? phaseOf.get(id) : null;
    if (!phase) continue;
    const body = (task.description ?? "").trim();
    if (!body) continue;
    // Still the brief it was authored with: instructions, not an answer.
    const authored = authoredTextFor(milestones.get(id!) ?? null, task.description).trim();
    if (authored && body === authored) continue;
    written.push({
      phaseId: phase.id,
      phaseTitle: phase.title,
      title: task.title,
      body,
      // Phase first, then the order the board keeps within it.
      order: phase.index * 10_000 + (task.order ?? 0),
    });
  }
  written.sort((a, b) => a.order - b.order);

  const phases: PathExport["phases"] = [];
  for (const step of written) {
    const last = phases[phases.length - 1];
    if (last && last.title === step.phaseTitle) last.steps.push({ title: step.title, body: step.body });
    else phases.push({ title: step.phaseTitle, steps: [{ title: step.title, body: step.body }] });
  }

  const goalLabel = PROJECT_GOALS.find((g) => g.id === goal)?.label ?? goal;
  return { title: project.title, projectTitle: project.title, goalLabel, steps: written.length, phases };
}

/** The goal to export, from a query string, falling back to the project's own. */
export async function exportGoal(projectId: string, asked: unknown): Promise<ProjectGoal | null> {
  const wanted = normaliseGoal(asked);
  if (wanted) return wanted;
  const [project] = await db.select({ goal: projects.goal }).from(projects).where(eq(projects.id, projectId));
  return normaliseGoal(project?.goal);
}

const block = (content: string, row: number, kind: DocumentBlock["kind"] = "text"): DocumentBlock => ({
  id: `b${row}`, kind, headline: "", intent: "", content, col: 0, row, colSpan: 1, rowSpan: 1,
});

/**
 * The export as document pages, for the PDF renderer.
 *
 * One page per phase, one block per step: a heading with the step's name and
 * the answer under it. Single column, because this is prose somebody will read
 * end to end, not a layout anybody arranged.
 */
export function exportPages(written: PathExport): { pages: DocumentPage[]; settings: DocumentSettings } {
  const pages: DocumentPage[] = written.phases.map((phase, i) => ({
    id: `p${i}`,
    title: phase.title,
    purpose: "",
    columns: 1,
    blocks: phase.steps.flatMap((step, j) => [
      block(step.title, j * 2, "heading"),
      block(step.body, j * 2 + 1),
    ]),
  }));
  return {
    pages,
    settings: {
      header: written.projectTitle,
      footer: `${written.goalLabel} · made on SparkTower`,
      showPageNumbers: true,
      titlePage: true,
      subtitle: written.goalLabel,
      accentColor: "#10b981",
    },
  };
}

/** The same thing as Markdown, which pastes into anything that takes text. */
export function exportMarkdown(written: PathExport): string {
  const out: string[] = [`# ${written.projectTitle}`, "", `_${written.goalLabel}_`, ""];
  for (const phase of written.phases) {
    out.push(`## ${phase.title}`, "");
    for (const step of phase.steps) out.push(`### ${step.title}`, "", step.body, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * A file name someone can find again, in characters a header can carry.
 *
 * `Content-Disposition` is a latin-1 header: the em dash in "Quill & Co —
 * Systemize a business" made Node refuse to set it, and the download answered
 * 500. Same shape as `safeFileName` in server/document-routes.ts — lowercase,
 * hyphens, word characters only — so downloads from either place look alike.
 */
export function exportFileName(written: PathExport, extension: string): string {
  const name = `${written.projectTitle} ${written.goalLabel}`
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${name || "path"}.${extension}`;
}
