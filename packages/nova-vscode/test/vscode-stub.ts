/**
 * Enough of the editor API to test the apply flow.
 *
 * The alternative is `@vscode/test-electron`, which downloads a real VS Code
 * and drives it. That's the right tool for testing that a view renders or a
 * command shows up in the palette. It is the wrong tool for "does classify
 * call a file identical when it is" — a hundred and fifty megabytes and a
 * display server to exercise a comparison.
 *
 * So: the real thing for the parts that need a real editor, and this for the
 * decisions. What's stubbed here is deliberately faithful about the two
 * behaviours the code depends on — `joinPath` normalises, and `fs.readFile`
 * throws for a file that isn't there.
 */
import { readFile } from "node:fs/promises";
import { posix } from "node:path";

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly path: string,
    readonly authority = "",
    readonly query = "",
  ) {}
  static file(p: string): Uri { return new Uri("file", p); }
  /**
   * Faithful about authority and query, because that's what the URI handler
   * reads. A parse that lumps them into `path` would make the handler look
   * broken when it isn't — or, worse, pass while the real one failed.
   */
  static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?/.exec(value);
    if (!match) return new Uri("", value);
    return new Uri(match[1], match[3] ?? "", match[2] ?? "", match[4] ?? "");
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, posix.normalize(posix.join(base.path, ...parts)));
  }
  get fsPath(): string { return this.path; }
  toString(): string { return `${this.scheme}:${this.path}`; }
}

/** Every edit the code under test asked for, in order. */
export interface RecordedEdit { uri: Uri; contents: string; overwrite: boolean }

export class WorkspaceEdit {
  readonly edits: RecordedEdit[] = [];
  createFile(uri: Uri, options: { overwrite?: boolean; contents?: Buffer }): void {
    this.edits.push({
      uri,
      contents: options.contents ? Buffer.from(options.contents).toString("utf8") : "",
      overwrite: !!options.overwrite,
    });
  }
}

export class ThemeIcon { constructor(readonly id: string) {} }

export const applied: WorkspaceEdit[] = [];
export let applyEditResult = true;
export const setApplyEditResult = (value: boolean) => { applyEditResult = value; };

export const workspace = {
  fs: {
    async readFile(uri: Uri): Promise<Uint8Array> {
      return new Uint8Array(await readFile(uri.fsPath));
    },
  },
  async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    applied.push(edit);
    return applyEditResult;
  },
};

export const executed: { command: string; args: unknown[] }[] = [];
export const commands = {
  async executeCommand(command: string, ...args: unknown[]): Promise<void> {
    executed.push({ command, args });
  },
};

export const terminals: { name: string; cwd?: unknown; sent: string[] }[] = [];
export const window = {
  createTerminal(options: { name: string; cwd?: unknown }) {
    const record = { name: options.name, cwd: options.cwd, sent: [] as string[] };
    terminals.push(record);
    return { show() {}, sendText(text: string) { record.sent.push(text); } };
  },
  createQuickPick() { throw new Error("not stubbed: the picker needs a real editor"); },
};

export class EventEmitter<T> {
  private handlers: ((value: T) => void)[] = [];
  readonly event = (handler: (value: T) => void) => {
    this.handlers.push(handler);
    return { dispose: () => {} };
  };
  fire(value: T): void { for (const handler of this.handlers) handler(value); }
  dispose(): void { this.handlers = []; }
}

export function reset(): void {
  messages.length = 0;
  nextChoice = undefined;
  applied.length = 0;
  executed.length = 0;
  terminals.length = 0;
  applyEditResult = true;
}

// --- what activate() touches ----------------------------------------------
//
// Below here is scaffolding rather than behaviour: activation registers a lot
// of things, and the assertion worth making is *that* it registers them.

export const registeredCommands = new Map<string, (...args: any[]) => any>();
export const registeredViews: string[] = [];

export enum StatusBarAlignment { Left = 1, Right = 2 }
export enum ProgressLocation { SourceControl = 1, Window = 10, Notification = 15 }
export enum ConfigurationTarget { Global = 1, Workspace = 2, WorkspaceFolder = 3 }
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }

export class TreeItem {
  description?: string; iconPath?: unknown; contextValue?: string; command?: unknown;
  constructor(readonly label: string, readonly collapsibleState?: TreeItemCollapsibleState) {}
}

const disposable = { dispose() {} };

Object.assign(commands, {
  registerCommand(name: string, handler: (...args: any[]) => any) {
    registeredCommands.set(name, handler);
    return disposable;
  },
});

export const webviewProviders = new Map<string, { resolveWebviewView(view: unknown): void }>();

/** The tree providers the extension registers, so a test can walk what the sidebar would draw. */
export const treeProviders = new Map<string, any>();

/**
 * A webview the extension can render into, and a test can read back.
 *
 * Faithful about the one thing under test: setting `.html` is how the view
 * changes, so the last value set is what the person would be looking at.
 */
export function fakeWebviewView() {
  const messageHandlers: ((message: unknown) => void)[] = [];
  const view = {
    webview: {
      html: "",
      options: {},
      onDidReceiveMessage(handler: (message: unknown) => void) {
        messageHandlers.push(handler);
        return disposable;
      },
    },
    /** Deliver a message as the page would. */
    post(message: unknown) { for (const handler of messageHandlers) handler(message); },
  };
  return view;
}

/** The handler the extension registers for `vscode://…` links, so a test can fire one. */
export let uriHandler: { handleUri(uri: Uri): unknown } | null = null;

/** What the next confirmation returns. Undefined means the person dismissed it. */
export let nextChoice: string | undefined;
export const setNextChoice = (value: string | undefined) => { nextChoice = value; };

export const messages: { kind: string; text: string }[] = [];

Object.assign(window, {
  registerUriHandler(handler: { handleUri(uri: Uri): unknown }) {
    uriHandler = handler;
    return disposable;
  },
  createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
  createStatusBarItem: () => ({ text: "", tooltip: "", command: "", show() {}, hide() {}, dispose() {} }),
  registerTreeDataProvider: (id: string, provider: unknown) => {
    registeredViews.push(id);
    treeProviders.set(id, provider);
    return disposable;
  },
  registerWebviewViewProvider: (id: string, provider: { resolveWebviewView(view: unknown): void }) => {
    registeredViews.push(id);
    webviewProviders.set(id, provider);
    return disposable;
  },
  showInformationMessage: async (text: string) => { messages.push({ kind: "info", text }); return nextChoice; },
  showWarningMessage: async (text: string) => { messages.push({ kind: "warning", text }); return nextChoice; },
  showErrorMessage: (text: string) => {
    messages.push({ kind: "error", text });
    return { then: (fn: (v: unknown) => void) => fn(undefined) };
  },
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  showTextDocument: async () => undefined,
  withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
});

/** Settings live in here so a test can pretend a workspace is configured. */
export const settings = new Map<string, unknown>([["nova.baseUrl", "https://example.test"], ["nova.projectId", ""]]);

Object.assign(workspace, {
  workspaceFolders: undefined as unknown,
  name: "stub",
  textDocuments: [] as unknown[],
  getConfiguration: (section: string) => ({
    get: (key: string) => settings.get(`${section}.${key}`),
    async update(key: string, value: unknown) { settings.set(`${section}.${key}`, value); },
  }),
  registerTextDocumentContentProvider: () => disposable,
  onDidChangeConfiguration: () => disposable,
  openTextDocument: async () => ({ uri: Uri.file("/untitled"), getText: () => "" }),
});

export const env = { clipboard: { text: "", async writeText(value: string) { env.clipboard.text = value; } } };

/** The minimum of an ExtensionContext: somewhere to put disposables and a secret store. */
export function fakeContext() {
  const store = new Map<string, string>();
  return {
    subscriptions: [] as { dispose(): void }[],
    extensionUri: Uri.file("/ext"),
    secrets: {
      async get(key: string) { return store.get(key); },
      async store(key: string, value: string) { store.set(key, value); },
      async delete(key: string) { store.delete(key); },
      onDidChange: () => disposable,
    },
  };
}
