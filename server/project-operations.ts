/**
 * The set of edits Nova is allowed to make to a project on the user's behalf.
 *
 * Two callers share this: the "let Nova fix it" button on a health-check
 * finding, and the action blocks Nova emits in project chat. Both need the
 * same guarantees — Nova can only touch entities that belong to the project it
 * was invoked on, only through whitelisted fields, and every change comes back
 * described in plain language so the UI can show what actually happened rather
 * than claiming success.
 */
import { storage } from "./storage";

/** One edit Nova wants to make. Shapes mirror the JSON Nova is told to emit. */
export type ProjectOperation =
  | { op: "update_project"; fields: Record<string, string> }
  | { op: "update_scope"; mvp?: string[]; niceToHave?: string[] }
  | { op: "create_task"; title: string; description?: string; priority?: string; status?: string; estimateHours?: number; tags?: string[]; milestoneId?: string | null; dueDate?: string | null; subtasks?: { title: string; done?: boolean }[] }
  | { op: "update_task"; id: string; title?: string; description?: string; priority?: string; status?: string; order?: number; blockedByTaskId?: string | null; estimateHours?: number; tags?: string[]; milestoneId?: string | null; dueDate?: string | null; subtasks?: { title: string; done?: boolean }[] }
  | { op: "create_milestone"; title: string; description?: string; targetDate?: string | null }
  | { op: "update_milestone"; id: string; title?: string; description?: string; status?: string; targetDate?: string | null }
  | { op: "update_phase"; id: string; title?: string; description?: string; estimatedDuration?: string; outcomes?: string[]; status?: string };

export interface AppliedChange {
  /** Machine-readable, for the client to route an invalidation. */
  entity: "project" | "scope" | "task" | "milestone" | "phase";
  action: "created" | "updated";
  /** A sentence the user can read: "Renamed milestone to …". */
  description: string;
  entityId?: string;
}

/** The op vocabulary, verbatim, for embedding in a prompt. */
export const OPERATION_SCHEMA_INSTRUCTIONS = `Each operation is one object. Valid operations:

{ "op": "update_project", "fields": { "oneLiner"|"mission"|"valueProposition"|"targetCustomerProfile"|"problemStatement"|"targetUser"|"successMetrics": "new text" } }
{ "op": "update_scope", "mvp": ["short feature name"], "niceToHave": ["short feature name"] }   // a list you send REPLACES that bucket; omit a bucket to leave it alone
{ "op": "create_task", "title": "", "description": "", "priority": "low"|"medium"|"high", "estimateHours": 3, "tags": ["short label"], "milestoneId": "the milestone this is work toward, or null", "dueDate": "YYYY-MM-DD", "subtasks": [{ "title": "" }] }
{ "op": "update_task", "id": "existing task id", "title": "", "description": "", "priority": "", "status": "todo"|"in-progress"|"review"|"done", "order": 0, "blockedByTaskId": "id of a task this one waits on, or null", "estimateHours": 3, "tags": [], "milestoneId": "", "subtasks": [{ "title": "", "done": false }] }
   // "order" sorts the board ascending — send it for every task you are re-sequencing, and always put a prerequisite before the task that needs it
{ "op": "create_milestone", "title": "", "description": "", "targetDate": "YYYY-MM-DD" }
{ "op": "update_milestone", "id": "existing milestone id", "title": "", "description": "", "status": "planned"|"in-progress"|"completed", "targetDate": "YYYY-MM-DD" }
{ "op": "update_phase", "id": "existing roadmap phase id", "title": "", "description": "", "estimatedDuration": "e.g. 2 weeks", "outcomes": ["deliverable"], "status": "upcoming"|"in-progress"|"completed" }

Only include the fields you are changing. Only ever use ids that appear in the project state you were given.`;

const BRIEF_FIELDS = [
  "oneLiner", "mission", "valueProposition", "targetCustomerProfile",
  "problemStatement", "targetUser", "successMetrics",
] as const;

const TASK_STATUSES = ["todo", "in-progress", "review", "done"];
const TASK_PRIORITIES = ["low", "medium", "high"];
const MILESTONE_STATUSES = ["planned", "in-progress", "completed"];
const PHASE_STATUSES = ["upcoming", "in-progress", "completed"];

const text = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

/** Hours have to be a sane whole number; anything else is dropped. */
const hours = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n <= 2000 ? n : null;
};

const tagList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((t) => text(t, 40)).filter(Boolean).slice(0, 8) : [];

const subtaskList = (v: unknown): { title: string; done: boolean }[] =>
  Array.isArray(v)
    ? v.map((s: any) => ({ title: text(s?.title ?? s, 200), done: s?.done === true }))
       .filter((s) => s.title)
       .slice(0, 20)
    : [];

/** A date Nova wrote, or null if it wrote nonsense. */
function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Renders the project's current state, optionally with entity ids attached.
 *
 * Nova can only edit what it can name, so ids have to be in the prompt for any
 * caller that emits operations — the whole reason the old health check could
 * recommend "reword this roadmap item" and then have no way to do it.
 *
 * Callers that only write prose must pass `includeIds: false`. Given a list of
 * `id=<uuid>` lines, the model starts citing them in its output: a document
 * came back with task lines reading "Inventory loop-critical routes (0e7f,
 * 2-3h)", where `0e7f` is the front of a task's uuid. Nothing downstream can
 * tell that apart from intentional prose, so the fix is not to show ids to a
 * caller that has no use for them.
 */
export async function buildOperableProjectState(
  projectId: string,
  opts: { includeIds?: boolean } = {},
): Promise<string> {
  const withIds = opts.includeIds !== false;
  const [project, tasks, milestones, roadmap, completions] = await Promise.all([
    storage.getProject(projectId),
    storage.getProjectKanbanTasks(projectId).catch(() => []),
    storage.getProjectMilestones(projectId).catch(() => []),
    storage.getProjectRoadmap(projectId).catch(() => undefined),
    storage.getProjectTaskCompletions(projectId, 30).catch(() => []),
  ]);
  if (!project) return "PROJECT NOT FOUND";

  const scope = (project.scope as { mvp?: string[]; niceToHave?: string[] } | null) || {};

  return [
    `PROJECT: ${project.title}`,
    `BRIEF FIELDS\n${BRIEF_FIELDS.map((f) => `- ${f}: ${(project as any)[f] || "(empty)"}`).join("\n")}`,
    `SCOPE\nMVP (${scope.mvp?.length || 0}): ${scope.mvp?.join(", ") || "(empty)"}\nNice to have (${scope.niceToHave?.length || 0}): ${scope.niceToHave?.join(", ") || "(empty)"}`,
    `TASKS ON THE BOARD (${tasks.length})\n${tasks.length
      ? tasks.map((t: any) => [
          withIds ? `- id=${t.id} [${t.status}/${t.priority}] ${t.title}` : `- [${t.status}/${t.priority}] ${t.title}`,
          t.estimateHours ? ` ~${t.estimateHours}h` : "",
          withIds && t.milestoneId ? ` milestone=${t.milestoneId}` : "",
          withIds && t.blockedByTaskId ? ` blockedBy=${t.blockedByTaskId}` : "",
          ((t.tags as string[]) || []).length ? ` tags=${(t.tags as string[]).join(",")}` : "",
        ].join("")).join("\n")
      : "(none)"}`,
    // Finished work the builder has already cleared off the board. Without
    // this, an empty done column reads as "nothing has ever shipped".
    `ALREADY COMPLETED ON THIS PROJECT (${completions.length}, includes cleared cards)\n${completions.length
      ? completions.map((c) => `- ${c.title} (${new Date(c.completedAt).toISOString().slice(0, 10)})`).join("\n")
      : "(nothing recorded yet)"}`,
    `MILESTONES (${milestones.length})\n${milestones.length
      ? milestones.map((m) => `${withIds ? `- id=${m.id} ` : "- "}[${m.status}] ${m.title}${m.targetDate ? ` (target ${new Date(m.targetDate).toISOString().slice(0, 10)})` : ""}`).join("\n")
      : "(none)"}`,
    roadmap
      ? `ROADMAP PHASES (${roadmap.phases.length})\nGoal: ${roadmap.goal}\n${roadmap.phases.map((p) => `${withIds ? `- id=${p.id} ` : "- "}[${p.status}] ${p.title}${p.estimatedDuration ? ` (${p.estimatedDuration})` : ""}\n    ${p.description || ""}\n    outcomes: ${((p.outcomes as string[]) || []).join("; ") || "none"}`).join("\n")}`
      : "ROADMAP PHASES\n(no roadmap yet — you cannot create phases, only suggest the builder generates one)",
  ].join("\n\n");
}

/**
 * Runs Nova's operations against the project.
 *
 * Bad operations are skipped, not fatal: a run that half-applies and reports
 * exactly what landed is more useful than one that rolls back because the
 * model hallucinated a single id.
 */
export async function applyProjectOperations(
  projectId: string,
  userId: string,
  operations: unknown,
  opts: {
    canEditMilestones?: boolean;
    canEditRoadmap?: boolean;
    /**
     * Ceiling on operations applied in one run. The default suits a chat turn
     * or a single health-check fix; a full milestone plan is legitimately
     * dozens of operations and passes a higher one.
     */
    maxOperations?: number;
  } = {},
): Promise<{ changes: AppliedChange[]; skipped: string[] }> {
  const changes: AppliedChange[] = [];
  const skipped: string[] = [];

  if (!Array.isArray(operations)) return { changes, skipped: ["Nova didn't return any operations."] };

  /*
   * Anything past the cap is reported, not dropped quietly. A silent truncation
   * meant a 49-operation plan applied 20 of its steps and still told the user
   * it had worked — a half-written plan is worse than a refused one, because
   * nothing shows which half is missing.
   */
  const limit = Math.max(1, Math.min(opts.maxOperations ?? 20, 200));
  const queued = operations.slice(0, limit);
  if (operations.length > limit) {
    skipped.push(`${operations.length - limit} operation(s) past the ${limit}-operation limit for one run were not applied.`);
  }

  // Scoping: an id Nova didn't get from this project's state is an id it
  // invented, and must not resolve to another project's row.
  const [ownTasks, ownMilestones, roadmap] = await Promise.all([
    storage.getProjectKanbanTasks(projectId).catch(() => []),
    storage.getProjectMilestones(projectId).catch(() => []),
    storage.getProjectRoadmap(projectId).catch(() => undefined),
  ]);
  const taskIds = new Set(ownTasks.map((t: any) => t.id));
  // Created tasks append; without a running counter a batch would all share
  // one position and the board couldn't order them.
  let nextOrder = ownTasks.length
    ? Math.max(...ownTasks.map((t: any) => t.order ?? 0)) + 1
    : 0;
  const milestoneIds = new Set(ownMilestones.map((m) => m.id));
  const phaseIds = new Set((roadmap?.phases || []).map((p) => p.id));

  for (const raw of queued) {
    const operation = raw as any;
    try {
      switch (operation?.op) {
        case "update_project": {
          const fields: Record<string, string> = {};
          for (const field of BRIEF_FIELDS) {
            const value = operation.fields?.[field];
            if (typeof value === "string" && value.trim()) fields[field] = value.trim().slice(0, 2000);
          }
          if (!Object.keys(fields).length) { skipped.push("An update_project with no recognised fields."); break; }
          await storage.updateProject(projectId, fields as any);
          changes.push({
            entity: "project", action: "updated",
            description: `Rewrote ${Object.keys(fields).length === 1 ? "the" : ""} ${Object.keys(fields).join(", ")} in the project brief`,
          });
          break;
        }

        case "update_scope": {
          const current = (await storage.getProject(projectId))?.scope as { mvp?: string[]; niceToHave?: string[] } | null;
          const next = { mvp: current?.mvp || [], niceToHave: current?.niceToHave || [] };
          const parts: string[] = [];
          if (Array.isArray(operation.mvp)) {
            next.mvp = operation.mvp.map((s: unknown) => text(s, 80)).filter(Boolean).slice(0, 20);
            parts.push(`MVP now ${next.mvp.length} items (was ${current?.mvp?.length || 0})`);
          }
          if (Array.isArray(operation.niceToHave)) {
            next.niceToHave = operation.niceToHave.map((s: unknown) => text(s, 80)).filter(Boolean).slice(0, 20);
            parts.push(`nice-to-have now ${next.niceToHave.length} items`);
          }
          if (!parts.length) { skipped.push("An update_scope with no lists."); break; }
          await storage.updateProject(projectId, { scope: next } as any);
          changes.push({ entity: "scope", action: "updated", description: `Reset the scope: ${parts.join(", ")}` });
          break;
        }

        case "create_task": {
          const title = text(operation.title, 200);
          if (!title) { skipped.push("A task with no title."); break; }
          const estimate = hours(operation.estimateHours);
          const created = await storage.createKanbanTask({
            projectId,
            title,
            description: text(operation.description, 2000),
            status: TASK_STATUSES.includes(operation.status) ? operation.status : "todo",
            priority: TASK_PRIORITIES.includes(operation.priority) ? operation.priority : "medium",
            assigneeId: null,
            dueDate: parseDate(operation.dueDate),
            estimateHours: estimate,
            tags: tagList(operation.tags),
            subtasks: subtaskList(operation.subtasks),
            // A milestone that isn't on this project would orphan the link.
            milestoneId: milestoneIds.has(operation.milestoneId) ? operation.milestoneId : null,
            order: nextOrder++,
          } as any);
          changes.push({
            entity: "task", action: "created",
            description: `Added task "${title}"${estimate ? ` (~${estimate}h)` : ""}`,
            entityId: created.id,
          });
          break;
        }

        case "update_task": {
          if (!taskIds.has(operation.id)) { skipped.push(`A task id that isn't on this project (${operation.id}).`); break; }
          const patch: Record<string, unknown> = {};
          if (operation.title !== undefined && text(operation.title, 200)) patch.title = text(operation.title, 200);
          if (operation.description !== undefined) patch.description = text(operation.description, 1000);
          if (TASK_PRIORITIES.includes(operation.priority)) patch.priority = operation.priority;
          if (TASK_STATUSES.includes(operation.status)) patch.status = operation.status;
          if (Number.isFinite(Number(operation.order))) patch.order = Number(operation.order);
          if (operation.estimateHours !== undefined) patch.estimateHours = hours(operation.estimateHours);
          if (operation.tags !== undefined) patch.tags = tagList(operation.tags);
          if (operation.subtasks !== undefined) patch.subtasks = subtaskList(operation.subtasks);
          if (operation.dueDate !== undefined) patch.dueDate = parseDate(operation.dueDate);
          if (operation.milestoneId !== undefined) {
            patch.milestoneId = milestoneIds.has(operation.milestoneId) ? operation.milestoneId : null;
          }
          if (operation.blockedByTaskId !== undefined) {
            // A task can't block itself, and a blocker outside this project
            // would be permanently unresolvable.
            const blocker = operation.blockedByTaskId;
            if (!blocker) patch.blockedByTaskId = null;
            else if (blocker !== operation.id && taskIds.has(blocker)) patch.blockedByTaskId = blocker;
            else skipped.push("A blocker that isn't a task on this project.");
          }
          if (!Object.keys(patch).length) { skipped.push("An update_task with nothing to change."); break; }
          const updated = await storage.updateKanbanTask(operation.id, patch as any);
          changes.push({ entity: "task", action: "updated", description: `Updated task "${updated.title}"`, entityId: updated.id });
          break;
        }

        case "create_milestone": {
          if (opts.canEditMilestones === false) { skipped.push("Milestone changes need the Builder plan."); break; }
          const title = text(operation.title, 200);
          if (!title) { skipped.push("A milestone with no title."); break; }
          const created = await storage.createMilestone({
            projectId,
            title,
            description: text(operation.description, 1000) || null,
            status: "planned",
            targetDate: parseDate(operation.targetDate),
            order: ownMilestones.length + changes.length,
          } as any);
          changes.push({ entity: "milestone", action: "created", description: `Added milestone "${title}"`, entityId: created.id });
          break;
        }

        case "update_milestone": {
          if (opts.canEditMilestones === false) { skipped.push("Milestone changes need the Builder plan."); break; }
          if (!milestoneIds.has(operation.id)) { skipped.push(`A milestone id that isn't on this project (${operation.id}).`); break; }
          const patch: Record<string, unknown> = {};
          if (operation.title !== undefined && text(operation.title, 200)) patch.title = text(operation.title, 200);
          if (operation.description !== undefined) patch.description = text(operation.description, 2000) || null;
          if (MILESTONE_STATUSES.includes(operation.status)) patch.status = operation.status;
          if (operation.targetDate !== undefined) patch.targetDate = parseDate(operation.targetDate);
          if (!Object.keys(patch).length) { skipped.push("An update_milestone with nothing to change."); break; }
          const updated = await storage.updateMilestone(operation.id, patch as any);
          changes.push({ entity: "milestone", action: "updated", description: `Updated milestone "${updated.title}"`, entityId: updated.id });
          break;
        }

        case "update_phase": {
          if (opts.canEditRoadmap === false) { skipped.push("Roadmap changes need the Builder plan."); break; }
          if (!phaseIds.has(operation.id)) { skipped.push(`A roadmap phase id that isn't on this project (${operation.id}).`); break; }
          const patch: Record<string, unknown> = {};
          if (operation.title !== undefined && text(operation.title, 200)) patch.title = text(operation.title, 200);
          if (operation.description !== undefined) patch.description = text(operation.description, 2000) || null;
          if (operation.estimatedDuration !== undefined) patch.estimatedDuration = text(operation.estimatedDuration, 80) || null;
          if (Array.isArray(operation.outcomes)) {
            patch.outcomes = operation.outcomes.map((o: unknown) => text(o, 300)).filter(Boolean).slice(0, 12);
          }
          if (PHASE_STATUSES.includes(operation.status)) patch.status = operation.status;
          if (!Object.keys(patch).length) { skipped.push("An update_phase with nothing to change."); break; }
          const updated = await storage.updateRoadmapPhase(operation.id, patch as any);
          changes.push({ entity: "phase", action: "updated", description: `Reworked roadmap phase "${updated.title}"`, entityId: updated.id });
          break;
        }

        default:
          skipped.push(`An unknown operation: ${String(operation?.op).slice(0, 40)}.`);
      }
    } catch (err) {
      console.error("Nova operation failed:", operation?.op, err);
      skipped.push(`A ${String(operation?.op)} operation errored.`);
    }
  }

  if (changes.length) {
    await storage.logActivity({
      projectId, userId,
      action: "let Nova apply changes",
      entityType: "project", entityId: projectId,
      metadata: { changes: changes.map((c) => c.description) },
    }).catch(() => { /* the log is not worth failing the edit over */ });
  }

  return { changes, skipped };
}
