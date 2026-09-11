/**
 * Who we are, where Nova is, and which project this workspace belongs to.
 *
 * Three separate lifetimes, deliberately stored in three places:
 *
 *  - **The token** goes in `SecretStorage`. Not settings: settings sync to
 *    other machines in plaintext and end up in screen shares and dotfile
 *    repositories, and a long-lived credential should do neither.
 *  - **The base URL** is a normal setting. It's not a secret and a self-hosted
 *    instance wants it committed.
 *  - **The project id** is a workspace setting, so a repository remembers what
 *    it belongs to and a second checkout doesn't inherit the first one's.
 */
import * as vscode from "vscode";
import { NovaClient, NovaError, type Manifest } from "@sparktower/nova-core";

const TOKEN_KEY = "nova.token";

/**
 * Where SparkTower is, unless told otherwise.
 *
 * A default has to be something, and this is a guess about someone else's
 * deployment — which is why the sign-in flow treats "couldn't reach it" as a
 * question to ask rather than an error to report. Self-hosted and local
 * instances are the normal case here, not the exception.
 */
export const DEFAULT_BASE_URL = "https://sparktower.app";

export class Session {
  private client: NovaClient | null = null;
  private manifestCache: Manifest | null = null;

  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when the token or the chosen project changes — the views redraw off this. */
  readonly onDidChange = this.changed.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get baseUrl(): string {
    const configured = vscode.workspace.getConfiguration("nova").get<string>("baseUrl") ?? "";
    return (configured || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  async setBaseUrl(url: string): Promise<void> {
    await vscode.workspace.getConfiguration("nova").update(
      "baseUrl", url.replace(/\/+$/, ""), vscode.ConfigurationTarget.Global,
    );
    this.reset();
  }

  get projectId(): string | null {
    return vscode.workspace.getConfiguration("nova").get<string>("projectId") || null;
  }

  async setProjectId(id: string | null): Promise<void> {
    const config = vscode.workspace.getConfiguration("nova");
    /*
     * Workspace scope when there's a folder open, global otherwise. Writing a
     * project id into the user's global settings from inside a repository is
     * how the next repository they open ends up pointed at the wrong project.
     */
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update("projectId", id ?? "", target);
    this.changed.fire();
  }

  async token(): Promise<string | null> {
    return (await this.context.secrets.get(TOKEN_KEY)) ?? null;
  }

  async setToken(token: string | null): Promise<void> {
    if (token) await this.context.secrets.store(TOKEN_KEY, token);
    else await this.context.secrets.delete(TOKEN_KEY);
    this.client = null;
    this.manifestCache = null;
    this.changed.fire();
  }

  /** The client, or null when there's no token yet. Callers show the sign-in path rather than throwing. */
  async api(): Promise<NovaClient | null> {
    const token = await this.token();
    if (!token) return null;
    if (!this.client) this.client = new NovaClient({ baseUrl: this.baseUrl, token }, "nova-vscode/0.1");
    return this.client;
  }

  /**
   * The manifest, which is also the token check.
   *
   * Cached for the session: it carries the snapshot limits every audit and
   * verify needs, and re-fetching it per command would mean a round trip
   * before every button.
   */
  async manifest(): Promise<Manifest | null> {
    if (this.manifestCache) return this.manifestCache;
    const api = await this.api();
    if (!api) return null;
    this.manifestCache = await api.manifest();
    return this.manifestCache;
  }

  /** Invalidate everything derived from the base URL, which the settings listener calls. */
  reset(): void {
    this.client = null;
    this.manifestCache = null;
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }
}

/** True when nothing answered — a wrong URL, a server that isn't running, no network. */
export const isUnreachable = (error: unknown): boolean =>
  error instanceof NovaError && error.code === "unreachable";

/** A refused request tells the user what to do; anything else is a bug and goes to the log. */
export function describe(error: unknown): string {
  if (error instanceof NovaError) {
    if (error.code === "unreachable") return error.message;
    if (error.status === 401) return "That token isn't valid any more. Sign in again.";
    if (error.code === "token_scope") return "This token is limited to one project, and that isn't it.";
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
