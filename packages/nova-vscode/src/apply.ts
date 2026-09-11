/**
 * Previewing a packet, and writing it into the workspace.
 *
 * The rule this file exists to enforce: **nothing is written that hasn't been
 * shown first.** A model that writes complete files straight into someone's
 * repository is a model they will stop trusting the first time it clobbers
 * something, and they will be right to. So every file is classified against
 * what's on disk, every one can be opened as a diff before anything happens,
 * and the person chooses which ones land.
 *
 * The write itself is a single `WorkspaceEdit`. That matters: it's one undo
 * step for the whole packet, it goes through the editor rather than around it,
 * and a file that's open and dirty is handled by VS Code instead of by us
 * overwriting someone's unsaved work.
 */
import * as vscode from "vscode";
import { rewriteRisk, safeRelativePath, type BuildPayload, type RewriteRisk, type RunGroup, type WorkFile } from "@sparktower/nova-core";
import type { ProposedContentProvider } from "./proposed";

export type FileState = "new" | "changed" | "identical";

export interface ClassifiedFile {
  file: WorkFile;
  /** Null when the path escapes the workspace, which is refused rather than sanitised. */
  target: vscode.Uri | null;
  state: FileState;
  reason?: string;
  /** For a file that exists: what writing this version over it would delete. */
  risk?: RewriteRisk;
}

/**
 * Where a packet's file would land, if anywhere.
 *
 * The refusal itself is `safeRelativePath` in nova-core, where it can be tested
 * without a running editor — it's the guarantee this extension makes about not
 * writing outside the workspace, and a guarantee nothing exercises is a hope.
 * What's left here is joining it to the workspace root and checking the result,
 * because `joinPath` normalises and a check on the input alone is a check on
 * the wrong string.
 */
export function resolveTarget(root: vscode.Uri, path: string): vscode.Uri | null {
  const relative = safeRelativePath(path);
  if (!relative) return null;

  const target = vscode.Uri.joinPath(root, relative);
  if (!target.path.startsWith(root.path.replace(/\/$/, "") + "/")) return null;
  return target;
}

export async function classify(root: vscode.Uri, files: WorkFile[]): Promise<ClassifiedFile[]> {
  const out: ClassifiedFile[] = [];
  for (const file of files) {
    const target = resolveTarget(root, file.path);
    if (!target) {
      out.push({ file, target: null, state: "new", reason: "path points outside the workspace" });
      continue;
    }
    let existing: string | null = null;
    try {
      existing = Buffer.from(await vscode.workspace.fs.readFile(target)).toString("utf8");
    } catch {
      existing = null;
    }
    if (existing === null) out.push({ file, target, state: "new" });
    else if (existing === file.content) out.push({ file, target, state: "identical" });
    // A packet's file is whole, and written without the current version in
    // front of the model — so for a file that exists, what it would delete is
    // the question, not just whether it differs.
    else out.push({ file, target, state: "changed", risk: rewriteRisk(existing, file.content) });
  }
  return out;
}

/** Plain words for a destructive rewrite — in the picker, and in the confirmation. */
export function describeRisk(risk: RewriteRisk): string {
  if (risk.lostExports.length) {
    const shown = risk.lostExports.slice(0, 4).join(", ");
    const more = risk.lostExports.length > 4 ? `, +${risk.lostExports.length - 4} more` : "";
    return `deletes ${risk.lostExports.length} export${risk.lostExports.length === 1 ? "" : "s"}: ${shown}${more}`;
  }
  return `removes ${risk.removedLines} of ${risk.totalLines} lines`;
}

/**
 * Whether a file starts ticked.
 *
 * Anything that would change, inside the workspace — except a rewrite that
 * throws code away. That one has to be ticked by a person who has seen the
 * warning, because the default is what gets applied when someone is in a
 * hurry, and a hurried apply of a gutted module is a server that won't boot.
 */
export function defaultPicked(entry: ClassifiedFile): boolean {
  return entry.state !== "identical" && !!entry.target && !entry.risk?.destructive;
}

/** Opens the diff for one file: what's there on the left, what Nova proposes on the right. */
export async function showDiff(entry: ClassifiedFile, proposed: ProposedContentProvider): Promise<void> {
  const right = proposed.set(entry.file.path, entry.file.content);
  // A file that doesn't exist yet diffs against an empty document of the same
  // name, so the whole thing reads as an addition rather than as an error.
  const left = entry.state === "new" || !entry.target
    ? proposed.set(`${entry.file.path}.nova-empty`, "")
    : entry.target;
  const label = entry.state === "new" ? "new file" : "changes";
  await vscode.commands.executeCommand("vscode.diff", left, right, `${entry.file.path} (${label})`, { preview: true });
}

const ICON: Record<FileState, string> = { new: "$(diff-added)", changed: "$(diff-modified)", identical: "$(check)" };

/**
 * The picker. Multi-select, everything that would change pre-ticked, and a
 * button per row that opens the diff without closing the list — so reviewing
 * four files doesn't mean starting the flow over four times.
 */
export async function pickFiles(entries: ClassifiedFile[]): Promise<ClassifiedFile[] | null> {
  const diffButton: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("diff"),
    tooltip: "Preview this diff",
  };

  type Item = vscode.QuickPickItem & { entry: ClassifiedFile };
  const items: Item[] = entries.map((entry) => ({
    label: `${entry.risk?.destructive ? "$(warning)" : ICON[entry.state]} ${entry.file.path}`,
    description: entry.reason ?? (entry.risk?.destructive ? `rewrite ${describeRisk(entry.risk)}` : entry.state),
    detail: entry.risk?.destructive
      ? "Nova rewrote this whole file without seeing your current version. Open the diff before ticking it."
      : entry.file.purpose,
    entry,
    buttons: entry.target ? [diffButton] : [],
    picked: defaultPicked(entry),
  }));

  return new Promise((resolve) => {
    const pick = vscode.window.createQuickPick<Item>();
    pick.title = "Apply Nova's packet";
    pick.placeholder = "Tick what to write. Use the diff button to look first — nothing is written until you confirm.";
    pick.canSelectMany = true;
    pick.items = items;
    pick.selectedItems = items.filter((i) => i.picked);
    pick.ignoreFocusOut = true;

    let done = false;
    pick.onDidTriggerItemButton(async (event) => {
      // Deliberately doesn't close: the point is to look at several.
      await vscode.commands.executeCommand("nova.diffEntry", event.item.entry);
    });
    pick.onDidAccept(() => {
      done = true;
      resolve(pick.selectedItems.map((i) => i.entry).filter((e) => e.target));
      pick.hide();
    });
    pick.onDidHide(() => {
      if (!done) resolve(null);
      pick.dispose();
    });
    pick.show();
  });
}

/**
 * Writes the chosen files as one edit.
 *
 * `createFile` with `overwrite: true` covers both cases — a file that appeared
 * between classification and confirmation is overwritten rather than throwing,
 * which is what the person asked for when they ticked it. One edit means one
 * undo for the whole packet.
 */
export async function applyFiles(entries: ClassifiedFile[]): Promise<{ written: string[]; failed: string[] }> {
  const edit = new vscode.WorkspaceEdit();
  const written: string[] = [];

  for (const entry of entries) {
    if (!entry.target) continue;
    edit.createFile(entry.target, {
      overwrite: true,
      contents: Buffer.from(entry.file.content, "utf8"),
    });
    written.push(entry.file.path);
  }

  const ok = await vscode.workspace.applyEdit(edit);
  return ok ? { written, failed: [] } : { written: [], failed: written };
}

/**
 * Run steps go into a terminal without being run.
 *
 * `sendText(cmd, false)` types the command and stops. An extension that
 * executes shell commands a model wrote, on someone's machine, without them
 * pressing anything, is a different product with a different risk profile.
 */
export function stageRunSteps(payload: BuildPayload, cwd: vscode.Uri): void {
  if (!payload.runSteps.length) return;
  const terminal = vscode.window.createTerminal({ name: "Nova", cwd });
  terminal.show();
  /*
   * Only the first command is typed. Typing the rest would mean sending
   * newlines, and a newline in a terminal is a keypress — the queue would run
   * itself. The remaining steps are in the packet view, in order.
   */
  terminal.sendText(payload.runSteps[0], false);
}

/**
 * One block into a terminal: typed, not run.
 *
 * Joined with `&&`, so a single Enter runs the whole block in order and stops
 * at the first failure — what "run it all at once" should mean. Still no
 * newline: a model wrote these commands, so the keypress stays the person's.
 * Every block gets a fresh terminal in its own folder; a new-terminal block is
 * named for what it is, because the first one is busy with a server.
 */
export function stageRunGroup(group: RunGroup, root: vscode.Uri): void {
  if (!group.commands.length) return;
  const folder = group.cwd ? safeRelativePath(group.cwd) : null;
  const cwd = folder ? vscode.Uri.joinPath(root, folder) : root;
  const terminal = vscode.window.createTerminal({ name: group.where === "new-terminal" ? "Nova · 2" : "Nova", cwd });
  terminal.show();
  terminal.sendText(group.commands.join(" && "), false);
}
