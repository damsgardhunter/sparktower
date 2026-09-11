/**
 * Run steps as blocks you can copy and run.
 *
 * A build packet ends with what to run. It used to be a numbered list of
 * sentences with the code quoted inside them — "In the web app, open DevTools
 * Console and run: `import(...)`" — which is hard to act on: you copy a
 * sentence, trim it, lose a backtick, and paste six of them one at a time.
 *
 * So the steps become groups: everything that runs in the same place in one
 * block, with one copy button, and a break wherever you have to stop — a dev
 * server you leave running, a switch to the browser console, a second terminal
 * tab. New packets are written this way by the model. Older packets, and a
 * model that falls back to the old shape, are grouped from their text here —
 * a heuristic, tested against the real packet that prompted it.
 *
 * Everything a client shows — the label, the break, the exact text the Copy
 * button puts on the clipboard — is computed here, on the server, so the web
 * app and the editor can't disagree about what "run it all" means. The
 * model's own copy text, if it sends any, is never used: what reaches someone's
 * clipboard is the commands, assembled by us.
 */
import type { BuildPayload, WorkPayload } from "./work";

export type RunPlace = "terminal" | "new-terminal" | "browser-console" | "browser" | "manual";

export interface RunGroup {
  where: RunPlace;
  /** The folder the commands run from, relative to the repository root. Absent means the root. */
  cwd?: string;
  /** One line above the block, in plain words. For a manual step, the instruction itself. */
  label: string;
  /** Runnable lines, verbatim. Empty for something to do or look at rather than run. */
  commands: string[];
  /** What to adjust or know that isn't a command. */
  note?: string;
  /** The block ends with something that keeps running (a dev server); what follows happens elsewhere. */
  longRunning?: boolean;
  /** The break before this block: why you have to stop, and where to go. */
  before?: string;
  /** What the Copy button puts on the clipboard: the block, ready to paste and run as a whole. */
  copy: string;
}

const PLACES = new Set<RunPlace>(["terminal", "new-terminal", "browser-console", "browser", "manual"]);

const DEFAULT_LABEL: Record<RunPlace, string> = {
  terminal: "In a terminal",
  "new-terminal": "In a new terminal tab",
  "browser-console": "In the browser's DevTools console",
  browser: "In the browser",
  manual: "Then",
};

const SHELL = /^(?:npm|npx|pnpm|yarn|bun|bunx|node|tsx|deno|git|cd|curl|wget|python3?|pip3?|uv|poetry|docker|docker-compose|make|export|psql|drizzle-kit|vercel|netlify|flyctl|fly|heroku|brew|rm|mkdir|cp|mv|ls|cat|echo|chmod|touch|source|sudo|kill|lsof|jq|go|cargo|dotnet|mvn|gradle)(?=\s|$)|^\.{1,2}\//;

/** Commands that don't return: once one runs, the terminal is busy and the next command needs another. */
const LONG_RUNNING = /(?:^|&&\s*|;\s*)(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|watch|preview)(?![\w-])|npx\s+(?:vite(?!\s+build)|next\s+dev|tsx\s+watch|nodemon)|vite(?:\s+(?!build)\S+)*\s*$|next\s+dev|tsx\s+watch|nodemon|docker(?:-|\s+)compose\s+up(?![^|&;]*\s-d\b))/;

export const isLongRunning = (command: string): boolean => LONG_RUNNING.test(command.trim());
const looksLikeShell = (text: string): boolean => SHELL.test(text.trim());

/** A console snippet that is one expression, so it can be awaited in turn. */
const EXPRESSION = /^(?:await\s+|import\(|fetch\(|\(|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\()/;
const DECLARATION = /^(?:const|let|var|function|class|if|for|while|return|import\s|export\s)/;

const quoteIfNeeded = (path: string) => (/^[\w./-]+$/.test(path) ? path : `"${path.replace(/"/g, '\\"')}"`);
const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const sentence = (text: string) => {
  const trimmed = capitalize(text.trim());
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

function safeCwd(raw: unknown): string | undefined {
  const path = String(raw ?? "").replace(/\\/g, "/").trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (!path || path === ".") return undefined;
  if (path.startsWith("/") || path.startsWith("~") || /^[a-zA-Z]:/.test(path) || path.split("/").includes("..")) return undefined;
  return path.slice(0, 200);
}

/**
 * The clipboard text for a block.
 *
 * Terminal blocks are the commands, one per line, after a `cd` when they run
 * from a folder. Console blocks of several expressions are wrapped so each is
 * awaited: pasted as bare lines, the promises would all start at once, and in
 * a step like "fire these events in order" the order is the whole point.
 */
function copyOf(group: Pick<RunGroup, "where" | "cwd" | "commands">): string {
  if (!group.commands.length) return "";
  if (group.where === "browser-console") {
    const lines = group.commands.map((command) => command.trim().replace(/;+$/, ""));
    const awaitable = lines.length > 1 && lines.every((line) => EXPRESSION.test(line) && !DECLARATION.test(line));
    if (awaitable) return `(async () => {\n${lines.map((line) => `  await ${line.replace(/^await\s+/, "")};`).join("\n")}\n})();`;
    return group.commands.join("\n");
  }
  return (group.cwd ? [`cd ${quoteIfNeeded(group.cwd)}`, ...group.commands] : group.commands).join("\n");
}

function breakBetween(previous: Pick<RunGroup, "where" | "longRunning">, next: Pick<RunGroup, "where">): string | undefined {
  if (next.where === "new-terminal" && previous.where !== "new-terminal") return "Open a new terminal tab — leave the first one running.";
  if (previous.longRunning) {
    if (next.where === "browser-console") return "Leave that running. Then, in the browser, open the app's DevTools console.";
    if (next.where === "browser") return "Leave that running. Then, in the browser:";
    return "Leave that running.";
  }
  if (next.where === "browser-console" && previous.where !== "browser-console") return "In the browser, open the app's DevTools console.";
  if (next.where === "browser" && previous.where !== "browser") return "Then, in the browser:";
  return undefined;
}

type Draft = Omit<RunGroup, "copy" | "before">;

/**
 * The pass every group goes through, from the model or from old text.
 *
 * A terminal block after a server is a new tab — the first terminal is busy.
 * Long-running is detected rather than trusted, labels default by place, and
 * the break and the clipboard text are computed last, from the final shape.
 */
function finish(drafts: Draft[]): RunGroup[] {
  const out: RunGroup[] = [];
  let serverRunning = false;
  for (const draft of drafts) {
    const where: RunPlace = draft.where === "terminal" && serverRunning ? "new-terminal" : draft.where;
    const inTerminal = where === "terminal" || where === "new-terminal";
    const longRunning = !!draft.longRunning || (inTerminal && draft.commands.some(isLongRunning));
    const group = { ...draft, where, longRunning: longRunning || undefined, label: draft.label || DEFAULT_LABEL[where] };
    const previous = out[out.length - 1];
    out.push({ ...group, before: previous ? breakBetween(previous, group) : undefined, copy: copyOf(group) });
    if (longRunning) serverRunning = true;
  }
  return out;
}

/** Groups written by the model, held to the shape. */
export function sanitizeRunGroups(raw: unknown): RunGroup[] {
  if (!Array.isArray(raw)) return [];
  const drafts: Draft[] = [];
  for (const item of raw.slice(0, 12)) {
    const g = (item ?? {}) as Record<string, unknown>;
    const commands = (Array.isArray(g.commands) ? g.commands : [])
      .map((c) => String(c ?? "").trim().replace(/^`+|`+$/g, "").trim())
      .filter(Boolean).slice(0, 20).map((c) => c.slice(0, 2000));
    let label = String(g.label ?? "").trim().slice(0, 160);
    let note = g.note ? String(g.note).trim().slice(0, 300) || undefined : undefined;
    const claimed = PLACES.has(g.where as RunPlace) ? (g.where as RunPlace) : "terminal";
    const where: RunPlace = commands.length ? claimed : "manual";
    // A manual step with only a note: the note is the instruction.
    if (where === "manual" && !label && note) { label = note; note = undefined; }
    if (!commands.length && !label) continue;
    drafts.push({ where, cwd: safeCwd(g.cwd), label, commands, note, longRunning: g.longRunning === true || undefined });
  }
  return finish(drafts);
}

// --- older packets: grouping from text -------------------------------------

interface Piece { where: RunPlace; command?: string; label?: string; note?: string; alternative?: boolean }

const FILLER = /^(?:and\s+)?(?:then|next|now|finally|after that|afterwards)\b[\s,:-]*/i;
const CONSOLE = /dev\s?tools|console/i;
const BROWSER = /\bbrowser\b|\bweb app\b|localhost|https?:\/\//i;

/** Prose that leads into code, reduced to a label and whatever notes it carried. */
function tidy(prose: string): { label?: string; note?: string } {
  const notes: string[] = [];
  let text = prose.trim().replace(/[:\s]+$/, "");
  text = text.replace(/\(([^)]*)\)/g, (_match, inner: string) => { if (inner.trim()) notes.push(inner.trim()); return ""; })
    .replace(/\s{2,}/g, " ").trim();
  text = text.replace(FILLER, "").replace(/^run\s+sequentially\b[\s,:-]*/i, "").trim();
  text = text.replace(/(?:,?\s+and)?\s+run$/i, "").replace(/^run$/i, "").trim();
  return { label: text ? capitalize(text) : undefined, note: notes.length ? notes.join("; ") : undefined };
}

/** "Do this; or run: `cmd`" — the part before the "or" is its own instruction. */
function splitAlternative(prose: string): [string | null, string | null] {
  const match = /^(.*?\S);\s*or\b\s*(.*)$/is.exec(prose.trim());
  return match ? [match[1].trim(), match[2].trim()] : [null, null];
}

function parseStep(step: string, previous: RunPlace | null): Piece[] {
  const text = step.trim();
  if (!text) return [];
  const code = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);

  if (!code.length) {
    if (!looksLikeShell(text)) return [{ where: "manual", label: sentence(text) }];
    // "npm run dev (keep it running)" — the parenthetical is prose, and a shell would choke on it.
    const trailing = /^(.*?)\s+\(([^()]*\s[^()]*)\)\s*$/.exec(text);
    return [trailing ? { where: "terminal", command: trailing[1], note: trailing[2] } : { where: "terminal", command: text }];
  }

  const lead = text.slice(0, text.indexOf("`"));
  const tail = text.slice(text.lastIndexOf("`") + 1).trim().replace(/^[\s.,;:-]+/, "").replace(/[.\s]+$/, "");
  const pieces: Piece[] = [];

  const [instruction, alternative] = splitAlternative(lead);
  if (instruction) pieces.push({ where: "manual", label: sentence(instruction) });
  const intro = alternative ?? lead;

  const where: RunPlace = CONSOLE.test(intro) ? "browser-console"
    : code.every(looksLikeShell) ? "terminal"
    : BROWSER.test(intro) || previous === "browser-console" ? "browser-console"
    : "terminal";

  const tidied = tidy(intro);
  const label = alternative && tidied.label ? `Or ${tidied.label[0].toLowerCase()}${tidied.label.slice(1)}` : tidied.label;
  const tailNote = tail.replace(/^\((.*)\)$/, "$1").trim();
  const note = [tidied.note, tailNote].filter(Boolean).join("; ") || undefined;

  code.forEach((command, index) => pieces.push({
    where, command,
    label: index === 0 ? label : undefined,
    note: index === 0 ? note : undefined,
    alternative: index === 0 && !!alternative,
  }));
  return pieces;
}

/** Old-style run steps — a list of sentences — grouped into blocks. */
export function groupRunSteps(steps: string[]): RunGroup[] {
  const pieces: Piece[] = [];
  for (const step of steps) pieces.push(...parseStep(String(step ?? ""), pieces[pieces.length - 1]?.where ?? null));

  const drafts: Draft[] = [];
  for (const piece of pieces) {
    if (piece.where === "manual" || !piece.command) {
      drafts.push({ where: "manual", label: piece.label ?? "", commands: [] });
      continue;
    }
    const last = drafts[drafts.length - 1];
    const joins = last && last.where === piece.where && last.commands.length > 0 && !last.longRunning && !piece.alternative;
    const group: Draft = joins ? last : { where: piece.where, label: piece.label ?? "", commands: [] };
    if (!joins) drafts.push(group);
    group.commands.push(piece.command);
    if (piece.note && !(group.note ?? "").includes(piece.note)) group.note = group.note ? `${group.note}; ${piece.note}` : piece.note;
    if ((piece.where === "terminal" || piece.where === "new-terminal") && isLongRunning(piece.command)) group.longRunning = true;
  }
  return finish(drafts);
}

/** Groups back to a flat list, for anything that still reads `runSteps` — an agent over MCP, an older client. */
export function flattenRunGroups(groups: RunGroup[]): string[] {
  const steps: string[] = [];
  for (const group of groups) {
    if (!group.commands.length) { steps.push(group.label); continue; }
    if (group.cwd) steps.push(`cd ${quoteIfNeeded(group.cwd)}`);
    for (const command of group.commands) steps.push(group.where === "browser-console" ? `In the browser console: ${command}` : command);
  }
  return steps.slice(0, 40);
}

/**
 * A packet with its blocks, however old it is.
 *
 * Applied where stored packets leave the server — so a packet written before
 * this existed gets blocks when it's read, without rewriting what's stored.
 */
export function withRunGroups<T extends WorkPayload>(payload: T): T {
  if (!payload || payload.kind !== "build") return payload;
  const build = payload as BuildPayload;
  const runGroups = Array.isArray(build.runGroups) && build.runGroups.length
    ? sanitizeRunGroups(build.runGroups)
    : groupRunSteps(Array.isArray(build.runSteps) ? build.runSteps : []);
  return { ...build, runGroups } as T;
}
