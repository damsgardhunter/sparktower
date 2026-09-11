/**
 * The product's loops, as their own view — under the next step, above the path.
 *
 * They were a group inside the path tree, and before that an inline block that
 * vanished once the core-loop milestone was done. Neither fit what they are.
 * The path is a sequence of milestones you pass through; the loops are the
 * product those milestones build, and they stay the thing you're building
 * long after the milestone that named them is ticked.
 *
 * So: a view of their own, and each step inside one is something Nova can
 * build. Clicking a step opens it (free); the sparkle button builds it
 * (credits). The packet shows in the Next step panel, which already knows how
 * to preview and apply one — a second copy of that UI here would drift.
 */
import * as vscode from "vscode";
import { LOOP_STATE_LABEL, loopStateOf } from "@sparktower/nova-core";
import type { Loop, LoopStep, LoopsResult, LoopState } from "@sparktower/nova-core";

export type LoopsNode = LoopNode | StepNode | MessageNode;
/** Exported for the loop commands, which receive these from a context menu. */
export interface LoopNode { kind: "loop"; loop: Loop }
export interface StepNode { kind: "step"; step: LoopStep; loopTitle: string }
interface MessageNode { kind: "message"; text: string; command?: string }

const LOOP_ICON: Record<LoopState, string> = {
  unwritten: "circle-outline",
  written: "note",
  planned: "list-ordered",
  building: "tools",
  built: "pass-filled",
};

export class LoopsTreeProvider implements vscode.TreeDataProvider<LoopsNode> {
  private readonly changed = new vscode.EventEmitter<LoopsNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private result: LoopsResult | null = null;

  setLoops(result: LoopsResult | null): void {
    this.result = result;
    this.changed.fire(undefined);
  }

  /** A step and the loop it sits in, for a step opened by id rather than from the tree. */
  findStep(taskId: string): StepNode | null {
    for (const loop of this.result?.loops ?? []) {
      const step = (loop.steps ?? []).find((s) => s.taskId === taskId);
      if (step) return { kind: "step", step, loopTitle: loop.title };
    }
    return null;
  }

  getTreeItem(node: LoopsNode): vscode.TreeItem {
    if (node.kind === "message") {
      const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      if (node.command) item.command = { command: node.command, title: node.text };
      return item;
    }

    if (node.kind === "loop") {
      const state = loopStateOf(node.loop);
      const steps = node.loop.steps ?? [];
      // Open where there's building to do, closed once it's built — the view
      // leads with the work that's left.
      const collapsible = !steps.length
        ? vscode.TreeItemCollapsibleState.None
        : state === "built" ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded;
      const item = new vscode.TreeItem(node.loop.title, collapsible);
      item.description = `${LOOP_STATE_LABEL[state]}${node.loop.total ? ` · ${node.loop.done ?? 0}/${node.loop.total}` : ""}`;
      item.iconPath = new vscode.ThemeIcon(LOOP_ICON[state]);
      item.tooltip = node.loop.description || node.loop.title;
      // The suffix lets the menu offer "Break into steps" only where there's nothing broken down yet.
      item.contextValue = steps.length ? "novaLoop.expanded" : "novaLoop.unexpanded";
      return item;
    }

    const done = node.step.status === "done";
    const item = new vscode.TreeItem(node.step.title, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(done ? "pass-filled" : "circle-outline");
    item.description = done ? "done" : undefined;
    item.tooltip = node.step.description || node.step.title;
    // "Build this step" appears only on steps that aren't done.
    item.contextValue = done ? "novaLoopStep.done" : "novaLoopStep.open";
    // A click opens the step and any packet it already has — free. Building is
    // the sparkle button, because a click on a row is something people do to look.
    item.command = { command: "nova.openStep", title: "Open this step", arguments: [node] };
    return item;
  }

  getChildren(node?: LoopsNode): LoopsNode[] {
    if (!node) {
      const result = this.result;
      if (!result) return [];
      if (!result.adopted) return [{ kind: "message", text: "Put this project on its path first." }];
      if (!result.supported) return [{ kind: "message", text: result.message ?? "This path doesn't work in loops." }];
      if (!result.loops.length) return [{ kind: "message", text: "None yet — add one", command: "nova.addLoop" }];
      return result.loops.map((loop) => ({ kind: "loop" as const, loop }));
    }
    if (node.kind === "loop") {
      return (node.loop.steps ?? []).map((step) => ({ kind: "step" as const, step, loopTitle: node.loop.title }));
    }
    return [];
  }
}
