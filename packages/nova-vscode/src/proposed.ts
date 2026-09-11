/**
 * Nova's proposed file contents, as something the diff editor can open.
 *
 * A packet's files don't exist on disk yet — that's the whole point of showing
 * them first — so they need a URI. A virtual document scheme is the way VS Code
 * does this: read-only by construction, no temp files to clean up, and nothing
 * on disk that a build or a git status could pick up before the person has
 * agreed to it.
 */
import * as vscode from "vscode";

export const PROPOSED_SCHEME = "nova-proposed";

export class ProposedContentProvider implements vscode.TextDocumentContentProvider {
  private readonly files = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  /**
   * Registers one proposal and returns its URI.
   *
   * The path is carried in the URI path so the diff editor's title, the
   * language detection and the file icon all come out right — a proposal for
   * `server/routes.ts` should syntax-highlight as TypeScript without being
   * told.
   */
  set(path: string, content: string): vscode.Uri {
    const uri = vscode.Uri.parse(`${PROPOSED_SCHEME}:/${path.replace(/^\/+/, "")}`);
    this.files.set(uri.toString(), content);
    this.changed.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.files.get(uri.toString()) ?? "";
  }

  /** Dropped when a new packet arrives, so a stale proposal can't be diffed against. */
  clear(): void {
    for (const key of this.files.keys()) this.changed.fire(vscode.Uri.parse(key));
    this.files.clear();
  }

  dispose(): void {
    this.changed.dispose();
  }
}
