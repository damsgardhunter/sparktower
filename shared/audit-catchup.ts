/**
 * Catching a project up with its code.
 *
 * Builders work ahead: they ship features they never wrote down, change
 * direction without touching the brief, and finish tasks without moving the
 * card. An audit is where the plan meets the code, so it proposes the edits
 * that bring the whole project up to date — brief, scope, loops, path, tasks —
 * and this module keeps that proposal short and true:
 *
 * - it knows what changed since the last audit (file fingerprints), so the
 *   audit talks about what's new rather than re-deriving the whole repo;
 * - one task per piece of shipped work, never one per file, and nothing the
 *   board already has;
 * - no edit that changes nothing, and nothing the builder already declined;
 * - each edit filed under a section, so the safe ones (recording finished
 *   work) can apply on their own and the rest wait for a click.
 *
 * Pure, so every rule here is tested without a model or a database.
 */

// --- What changed in the code ---------------------------------------------

/** A short, stable fingerprint of a file's content (FNV-1a, 32-bit, hex). */
export function fingerprint(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** path → fingerprint, for every file the audit read. Stored with the audit so the next one can diff against it. */
export function fileIndexOf(files: { path: string; content?: string | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) if (typeof f.content === "string") out[f.path] = fingerprint(f.content);
  return out;
}

export interface FileChanges { added: string[]; modified: string[]; removed: string[] }

export function diffFileIndex(prev: Record<string, string> | null | undefined, next: Record<string, string>): FileChanges | null {
  if (!prev) return null;
  const added: string[] = [], modified: string[] = [], removed: string[] = [];
  for (const [path, hash] of Object.entries(next)) {
    if (!(path in prev)) added.push(path);
    else if (prev[path] !== hash) modified.push(path);
  }
  for (const path of Object.keys(prev)) if (!(path in next)) removed.push(path);
  return { added: added.sort(), modified: modified.sort(), removed: removed.sort() };
}

/**
 * Paths grouped by folder, busiest first: "client/src/pages (6): feed.tsx, post-detail.tsx…".
 * A hundred changed files as a hundred lines buries the shape of the work.
 */
export function summarizePaths(paths: string[], maxGroups = 12, perGroup = 6): string[] {
  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const parts = p.split("/");
    const dir = parts.length > 1 ? parts.slice(0, Math.min(3, parts.length - 1)).join("/") : "(root)";
    groups.set(dir, [...(groups.get(dir) ?? []), parts[parts.length - 1]]);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const lines = sorted.slice(0, maxGroups).map(([dir, names]) =>
    `${dir} (${names.length}): ${names.slice(0, perGroup).join(", ")}${names.length > perGroup ? ", …" : ""}`);
  if (sorted.length > maxGroups) lines.push(`…and ${sorted.length - maxGroups} more folders`);
  return lines;
}

export function renderFileChanges(c: FileChanges | null, since: string | null): string {
  if (!c) return "WHAT CHANGED SINCE THE LAST AUDIT\nThis is the first audit with a file record — treat everything as new, and record the work that's clearly finished.";
  const total = c.added.length + c.modified.length + c.removed.length;
  if (!total) return `WHAT CHANGED SINCE THE LAST AUDIT${since ? ` (${since})` : ""}\nNo file changed. Propose nothing unless the plan contradicts the code.`;
  return [
    `WHAT CHANGED SINCE THE LAST AUDIT${since ? ` (${since})` : ""} — ${c.added.length} added, ${c.modified.length} modified, ${c.removed.length} removed`,
    c.added.length ? `Added:\n${summarizePaths(c.added).map((l) => `- ${l}`).join("\n")}` : null,
    c.modified.length ? `Modified:\n${summarizePaths(c.modified).map((l) => `- ${l}`).join("\n")}` : null,
    c.removed.length ? `Removed:\n${summarizePaths(c.removed).map((l) => `- ${l}`).join("\n")}` : null,
  ].filter(Boolean).join("\n");
}

// --- Sections ----------------------------------------------------------------

export const CATCHUP_SECTIONS = [
  { id: "shipped", label: "Work you shipped", hint: "Recorded as finished tasks" },
  { id: "closed", label: "Tasks that are done", hint: "Moved to done" },
  { id: "path", label: "Path milestones reached", hint: "Checked off on your path" },
  { id: "brief", label: "Brief, scope and stack", hint: "Updated to match where the project is going" },
  { id: "loops", label: "Loops", hint: "Written or rewritten from what the code does" },
  { id: "tasks", label: "What's next", hint: "New and changed tasks" },
  { id: "plan", label: "Milestones and roadmap", hint: "Updated to match the work" },
] as const;
export type CatchUpSection = typeof CATCHUP_SECTIONS[number]["id"];

/** Sections that only record what already happened, with evidence: safe to apply without asking. */
export const SAFE_SECTIONS: readonly CatchUpSection[] = ["shipped", "closed", "path"];

export const AUDIT_AUTO_APPLY = ["all", "safe", "off"] as const;
export type AuditAutoApply = typeof AUDIT_AUTO_APPLY[number];
export const AUDIT_AUTO_APPLY_LABEL: Record<AuditAutoApply, string> = {
  all: "Update everything automatically",
  safe: "Record finished work automatically, ask about the rest",
  off: "Ask me before changing anything",
};

export function sectionOf(op: any): CatchUpSection {
  switch (op?.op) {
    case "create_task": return op.status === "done" ? "shipped" : "tasks";
    case "update_task": return op.status === "done" && Object.keys(op).every((k) => ["op", "id", "status", "description", "_section", "_status", "_label"].includes(k)) ? "closed" : "tasks";
    case "complete_path_milestone": return "path";
    case "update_project": case "update_scope": return "brief";
    // Build steps that are all already built are progress on the path, not a change of direction.
    case "add_loop_steps": return Array.isArray(op.steps) && op.steps.length > 0 && op.steps.every((st: any) => st?.done === true) ? "path" : "loops";
    case "create_loop": case "update_loop": case "retire_loop": return "loops";
    default: return "plan";
  }
}

// --- Keeping it brief --------------------------------------------------------

/** How many of each an audit may propose. Past these, it's describing files, not work. */
export const CATCHUP_CAPS: Record<CatchUpSection, number> = { shipped: 12, closed: 40, path: 12, brief: 3, loops: 8, tasks: 10, plan: 10 };
export const CATCHUP_MAX = 80;

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "on", "in", "for", "with", "add", "build", "implement", "create", "set", "up", "make", "new"]);
/** Words, lightly stemmed so "limiting" and "limit", "threads" and "thread" are one word. */
const stem = (w: string) => w.length > 5 ? w.replace(/(ing|ed)$/, "").replace(/s$/, "") : w.replace(/s$/, "");
const tokens = (s: string) => new Set(norm(s).split(" ").filter((w) => !STOP.has(w)).map(stem).filter((w) => w.length > 2 && !STOP.has(w)));
/** Two task titles name the same work when most of the shorter one's words are in the longer. */
export function sameWork(a: string, b: string): boolean {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = tokens(a), tb = tokens(b);
  if (ta.size < 2 || tb.size < 2) return false;
  let shared = 0; for (const w of ta) if (tb.has(w)) shared++;
  return shared / Math.min(ta.size, tb.size) >= 0.75;
}

export interface CatchUpContext {
  project: Record<string, unknown>;
  tasks: { id: string; title: string; status: string; tags?: string[] | null }[];
  loops: { id: string; title: string; description: string; type: string; steps?: { title: string }[] }[];
  /** Loops the builder removed as "not a loop". */
  rejectedLoops?: string[];
  /** Path milestone ids already done. */
  pathDone: Set<string>;
  /** One-line descriptions of edits the builder declined last time. */
  declined: string[];
}

export interface TidiedCatchUp {
  operations: any[];
  /** What was left out and why — each with the edit and, for a duplicate, the card it matched — so it can be checked. */
  dropped: { reason: string; count: number; items: string[] }[];
}

/** One line a person can read for an edit, used for the review list and for remembering what was declined. */
export function describeOp(op: any, ctx?: Pick<CatchUpContext, "tasks" | "loops">): string {
  // Labelled when the audit tidied it, with the names it could see then.
  if (!ctx && typeof op?._label === "string") return op._label;
  const task = (id: string) => ctx?.tasks.find((t) => t.id === id)?.title ?? "a task";
  const loop = (id: string) => ctx?.loops.find((l) => l.id === id)?.title ?? "a loop";
  switch (op?.op) {
    case "create_task": return op.status === "done" ? `Record shipped: ${op.title}` : `Add task: ${op.title}`;
    case "update_task": return op.status === "done" ? `Mark done: ${task(op.id)}` : `Update task: ${op.title ?? task(op.id)}`;
    case "complete_path_milestone": return `Check off path milestone ${op.backboneId}`;
    case "update_project": return `Update ${Object.keys(op.fields ?? {}).join(", ")}`;
    case "update_scope": return "Update the scope";
    case "create_loop": return `Write the ${op.type ?? "product"} loop: ${op.title}`;
    case "update_loop": return `Rewrite loop: ${op.title ?? loop(op.id)}`;
    case "add_loop_steps": return `Add ${Array.isArray(op.steps) ? op.steps.length : 0} build step${op.steps?.length === 1 ? "" : "s"} to ${loop(op.loopId)}`;
    case "retire_loop": return `Retire loop: ${loop(op.id)}`;
    case "create_milestone": return `Add milestone: ${op.title}`;
    case "update_milestone": return `Update milestone${op.title ? `: ${op.title}` : ""}`;
    case "update_phase": return `Update roadmap phase${op.title ? `: ${op.title}` : ""}`;
    default: return String(op?.op ?? "change");
  }
}

/**
 * The audit's proposed edits, reduced to what's new and worth doing. Drops
 * duplicates of what the board has, edits that change nothing, things the
 * builder declined before, and anything past each section's cap — and says
 * how many of each it dropped, so nothing disappears silently.
 */
export function tidyCatchUp(raw: unknown, ctx: CatchUpContext): TidiedCatchUp {
  const ops = Array.isArray(raw) ? raw.filter((o) => o && typeof o === "object" && typeof (o as any).op === "string") : [];
  const dropped = new Map<string, { count: number; items: string[] }>();
  let current = "";
  const drop = (reason: string, detail?: string) => {
    const entry = dropped.get(reason) ?? { count: 0, items: [] };
    entry.count++;
    if (entry.items.length < 25) entry.items.push(detail ? `${current} (${detail})` : current);
    dropped.set(reason, entry);
  };
  const taskById = new Map(ctx.tasks.map((t) => [t.id, t]));
  const loopById = new Map(ctx.loops.map((l) => [l.id, l]));
  const declined = ctx.declined.map(norm);
  const kept: any[] = [];
  const perSection = new Map<CatchUpSection, number>();
  const titlesThisRun: string[] = [];
  const closing = new Set<string>();

  for (const op of ops) {
    const line = describeOp(op, ctx);
    current = line;
    if (declined.some((d) => d && sameWork(d, norm(line)))) { drop("declined last time"); continue; }

    if (op.op === "create_task") {
      const title = String(op.title ?? "").trim();
      if (!title) { drop("no title"); continue; }
      const twin = ctx.tasks.find((t) => sameWork(t.title, title));
      if (twin) {
        // Already on the board. If the audit says it's finished and the card isn't, that's a close, not a new task.
        if (op.status === "done" && twin.status !== "done" && !closing.has(twin.id)) {
          const close = { op: "update_task", id: twin.id, status: "done", ...(op.description ? { description: op.description } : {}) };
          if ((perSection.get("closed") ?? 0) < CATCHUP_CAPS.closed) {
            kept.push({ ...close, _section: "closed", _label: `Mark done: ${twin.title}` }); closing.add(twin.id);
            perSection.set("closed", (perSection.get("closed") ?? 0) + 1);
          }
        } else drop("already on the board", `matches "${twin.title}"${twin.status === "done" ? ", done" : ""}`);
        continue;
      }
      if (titlesThisRun.some((t) => sameWork(t, title))) { drop("proposed twice"); continue; }
      titlesThisRun.push(title);
    }
    if (op.op === "update_task") {
      const current = taskById.get(op.id);
      if (!current) { drop("a task that isn't on the board"); continue; }
      const changesSomething = Object.entries(op).some(([k, v]) => !["op", "id"].includes(k) && !(k === "status" && v === current.status) && !(k === "title" && v === current.title));
      if (!changesSomething) { drop("changes nothing"); continue; }
      if (op.status === "done" && closing.has(op.id)) { drop("proposed twice"); continue; }
      if (op.status === "done") closing.add(op.id);
    }
    if (op.op === "complete_path_milestone") {
      if (!op.backboneId || ctx.pathDone.has(String(op.backboneId))) { drop("already done on the path"); continue; }
    }
    if (op.op === "update_project") {
      const fields = Object.fromEntries(Object.entries(op.fields ?? {}).filter(([k, v]) => {
        const current = ctx.project[k];
        return Array.isArray(v)
          ? JSON.stringify([...(v as unknown[])].map(norm).sort()) !== JSON.stringify([...((current as unknown[]) ?? [])].map(norm).sort())
          : norm(v) !== norm(current);
      }));
      if (!Object.keys(fields).length) { drop("changes nothing"); continue; }
      op.fields = fields;
    }
    if (op.op === "create_loop" && (ctx.rejectedLoops ?? []).some((r) => sameWork(r, String(op.title ?? "")))) { drop("removed by you before"); continue; }
    // A kind that's already written can't take a second loop (only product repeats): that's a rewrite of the one there.
    if (op.op === "create_loop" && op.type !== "product") {
      const existing = ctx.loops.find((l) => l.type === op.type && l.description.trim());
      if (existing) {
        if (norm(existing.title) === norm(op.title) && norm(existing.description) === norm(op.steps)) { drop("changes nothing"); continue; }
        const rewrite = { op: "update_loop", id: existing.id, title: op.title, steps: op.closes ? `${op.steps}\n\nCloses when: ${op.closes}` : op.steps };
        const n = perSection.get("loops") ?? 0;
        if (n < CATCHUP_CAPS.loops) {
          perSection.set("loops", n + 1);
          kept.push({ ...rewrite, _section: "loops", _label: `Rewrite the ${op.type} loop: "${existing.title}" → "${op.title}"` });
        } else drop("over the loops limit");
        continue;
      }
    }
    if (op.op === "retire_loop" && !loopById.has(op.id)) { drop("a loop that isn't on the project"); continue; }
    if (op.op === "add_loop_steps") {
      const current = loopById.get(op.loopId);
      if (!current) { drop("a loop that isn't on the project"); continue; }
      const fresh = (Array.isArray(op.steps) ? op.steps : []).filter((st: any) => st?.title && !(current.steps ?? []).some((e) => sameWork(e.title, st.title)));
      if (!fresh.length) { drop("steps already there"); continue; }
      op.steps = fresh;
    }
    if (op.op === "update_loop") {
      const current = loopById.get(op.id);
      if (!current) { drop("a loop that isn't on the project"); continue; }
      const same = (op.title == null || norm(op.title) === norm(current.title))
        && (op.steps == null || norm(op.steps) === norm(current.description))
        && (op.type == null || op.type === current.type);
      if (same) { drop("changes nothing"); continue; }
    }

    // Filed again after tidying: dropping steps that already exist can change where the rest belong.
    const filed = sectionOf(op);
    const n = perSection.get(filed) ?? 0;
    if (n >= CATCHUP_CAPS[filed]) { drop(`over the ${filed} limit`); continue; }
    if (kept.length >= CATCHUP_MAX) { drop("over the total limit"); continue; }
    perSection.set(filed, n + 1);
    kept.push({ ...op, _section: filed, _label: describeOp(op, ctx) });
  }
  return { operations: kept, dropped: [...dropped.entries()].map(([reason, e]) => ({ reason, count: e.count, items: e.items })) };
}

/** "Recorded 3 pieces of shipped work, closed 5 tasks, updated the brief." — the brief version, for the top of the audit. */
export function summarizeCatchUp(ops: { _section?: string }[]): string {
  const count = (s: CatchUpSection) => ops.filter((o) => o._section === s).length;
  const parts = [
    count("shipped") && `${count("shipped")} piece${count("shipped") === 1 ? "" : "s"} of shipped work to record`,
    count("closed") && `${count("closed")} task${count("closed") === 1 ? "" : "s"} to close`,
    count("path") && `${count("path")} path milestone${count("path") === 1 ? "" : "s"} reached`,
    count("brief") && "brief updates",
    count("loops") && `${count("loops")} loop change${count("loops") === 1 ? "" : "s"}`,
    count("tasks") && `${count("tasks")} task change${count("tasks") === 1 ? "" : "s"}`,
    count("plan") && `${count("plan")} milestone or roadmap change${count("plan") === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];
  return parts.length ? parts.join(", ") : "Your project already matches the code.";
}
