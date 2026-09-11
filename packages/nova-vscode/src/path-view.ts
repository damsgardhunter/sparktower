/**
 * The path, in the sidebar.
 *
 * Phases at the top level, milestones under them, and the state of each one
 * shown by icon rather than by text — which of thirty milestones is done is a
 * question you should be able to answer by glancing at a column, not by
 * reading.
 *
 * The distinction the icons keep is the one the whole system turns on: a
 * milestone Nova *verified* from the code doesn't look like one somebody
 * ticked. Collapsing those two into a single check mark would quietly throw
 * away the thing the path is for.
 *
 * Loops aren't here. They have their own view, above this one: they're the
 * product being built, not a stop on the way.
 */
import * as vscode from "vscode";
import type { PathStatus } from "@sparktower/nova-core";
import type { Session } from "./session";

type Node = PhaseNode | MilestoneNode | MessageNode;
interface PhaseNode { kind: "phase"; id: string; title: string; done: number; total: number; optional: boolean; current: boolean }
interface MilestoneNode { kind: "milestone"; backboneId: string; title: string; done: boolean; next: boolean }
interface MessageNode { kind: "message"; text: string; command?: string }

export class PathTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private status: PathStatus | null = null;
  private error: string | null = null;
  /** Filled lazily per phase, because the status reply carries phase totals, not their milestones. */
  private milestones = new Map<string, MilestoneNode[]>();

  constructor(private readonly session: Session, private readonly detail: MilestoneSource) {}

  setStatus(status: PathStatus | null, error: string | null = null): void {
    this.status = status;
    this.error = error;
    this.milestones.clear();
    this.changed.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "message") {
      const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      if (node.command) item.command = { command: node.command, title: node.text };
      return item;
    }
    if (node.kind === "phase") {
      const item = new vscode.TreeItem(
        node.title,
        node.current ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = `${node.done}/${node.total}${node.optional ? " · optional" : ""}`;
      item.iconPath = new vscode.ThemeIcon(
        node.done === node.total ? "pass-filled" : node.current ? "circle-large-outline" : "circle-outline",
      );
      item.contextValue = "novaPhase";
      return item;
    }

    const item = new vscode.TreeItem(node.title, vscode.TreeItemCollapsibleState.None);
    item.description = node.backboneId;
    item.iconPath = new vscode.ThemeIcon(node.done ? "pass-filled" : node.next ? "arrow-right" : "circle-outline");
    item.contextValue = "novaMilestone";
    item.command = { command: "nova.openMilestone", title: "Open milestone", arguments: [node.backboneId] };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      if (this.error) return [{ kind: "message", text: this.error }];
      if (!this.status) return [];
      if (!this.status.adopted) {
        return [{ kind: "message", text: this.status.message ?? "This project isn't on a path yet." }];
      }
      const currentId = this.status.phase?.id;
      return (this.status.phases ?? []).map((p) => ({
        kind: "phase" as const,
        id: p.id, title: p.title, done: p.done, total: p.total, optional: p.optional,
        current: p.id === currentId,
      }));
    }
    if (node.kind !== "phase") return [];

    const cached = this.milestones.get(node.id);
    if (cached) return cached;
    const loaded = await this.detail.milestonesOf(node.id).catch(() => []);
    const nextId = this.status?.next?.backboneId;
    const nodes: MilestoneNode[] = loaded.map((m) => ({
      kind: "milestone", backboneId: m.id, title: m.title, done: m.done, next: m.id === nextId,
    }));
    this.milestones.set(node.id, nodes);
    return nodes;
  }
}

/**
 * Where a phase's milestones come from.
 *
 * The bridge's status is deliberately trimmed — it carries phase totals rather
 * than every milestone of every phase, because that reply is mostly read by
 * agents paying for their context. A tree that expands needs the detail, so it
 * asks for it, once per phase, when the phase is opened.
 */
export interface MilestoneSource {
  milestonesOf(phaseId: string): Promise<{ id: string; title: string; done: boolean }[]>;
}

/**
 * The full tree, in one call.
 *
 * Cached until something changes it, so opening four phases costs one request
 * rather than four. Invalidated by anything that could move a milestone —
 * applying a packet, verifying, marking — because a map that's right until you
 * touch something is worse than no map.
 */
export class RemoteMilestones implements MilestoneSource {
  private all: Map<string, { id: string; title: string; done: boolean }[]> | null = null;

  constructor(private readonly session: Session) {}

  invalidate(): void { this.all = null; }

  async milestonesOf(phaseId: string): Promise<{ id: string; title: string; done: boolean }[]> {
    if (!this.all) {
      const api = await this.session.api();
      const projectId = this.session.projectId;
      if (!api || !projectId) return [];
      const detail = await api.fetch<{ phases: { id: string; milestones: { id: string; title: string; done: boolean }[] }[] }>(
        "GET", `/api/mcp/projects/${encodeURIComponent(projectId)}/phases`,
      );
      this.all = new Map(detail.phases.map((p) => [p.id, p.milestones]));
    }
    return this.all.get(phaseId) ?? [];
  }
}
