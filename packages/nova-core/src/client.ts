/**
 * Talking to Nova.
 *
 * Thin on purpose. This holds the token, fills path parameters, and turns
 * Nova's error shape into something a caller can act on. It contains no
 * opinion about the plan, which is the point — every opinion lives on the
 * server, so changing one is a deploy rather than a release nobody installs.
 *
 * Two ways in. `call` runs a tool from the manifest, which is what the MCP
 * shim does because its tool list is whatever Nova offers. `fetch` names an
 * endpoint, which is what the extension does because a UI has a button per
 * thing it does.
 */
/** The manifest Nova serves. Mirrors `shared/mcp.ts`; kept loose so an older shim survives a newer server. */
export interface ManifestTool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  costly?: boolean;
  collectsFiles?: boolean;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  call: { method: "GET" | "POST" | "DELETE"; path: string };
}

export interface Manifest {
  version: number;
  instructions: string;
  tools: ManifestTool[];
  limits: { maxFiles: number; maxFileBytes: number; maxTotalBytes: number };
  account: { userId: string; email: string | null };
  pinnedProjectId: string | null;
}

export class NovaError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/** All a client needs to make a call. The rest of a config is the caller's business. */
export interface Credentials { baseUrl: string; token: string }

export class NovaClient {
  constructor(private readonly config: Credentials, private readonly agent = "nova-core/0.1") {}

  get baseUrl(): string { return this.config.baseUrl; }

  async manifest(): Promise<Manifest> {
    return this.request("GET", "/api/mcp/manifest", null) as Promise<Manifest>;
  }

  /**
   * Runs one tool.
   *
   * Path parameters are consumed from the arguments; whatever is left is the
   * body for a POST or the query string for a GET. That's the entire mapping,
   * and it's why adding a tool on the server needs no change here.
   */
  async call(tool: ManifestTool, args: Record<string, unknown>): Promise<unknown> {
    const remaining = { ...args };
    const path = tool.call.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => {
      const value = remaining[name];
      if (value === undefined || value === null || value === "") {
        throw new NovaError(`This tool needs "${name}".`, 400, "invalid_input");
      }
      delete remaining[name];
      return encodeURIComponent(String(value));
    });

    // GET and DELETE take no body; whatever is left over becomes the query.
    if (tool.call.method !== "POST") {
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(remaining)) if (v !== undefined && v !== null) query.set(k, String(v));
      const suffix = query.toString();
      return this.request(tool.call.method, suffix ? `${path}?${suffix}` : path, null);
    }
    return this.request("POST", path, remaining);
  }

  /**
   * A call by path, for the extension.
   *
   * The MCP shim goes through the catalogue because its tool list is whatever
   * Nova offers. A UI is written against specific endpoints — it has a button
   * per thing it does — so it says which one it wants.
   */
  async fetch<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    return this.request(method, path, body ?? null) as Promise<T>;
  }

  private async request(method: "GET" | "POST" | "DELETE", path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json",
          "user-agent": this.agent,
        },
        body: body === null ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // A network failure and a refusal are different problems with different
      // fixes, and an agent that can't tell them apart retries the wrong one.
      throw new NovaError(`Couldn't reach Nova at ${this.config.baseUrl}: ${(err as Error).message}`, 0, "unreachable");
    }

    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* handled below */ }

    if (!response.ok) {
      const message = parsed?.message ?? `Nova answered ${response.status}.`;
      throw new NovaError(message, response.status, parsed?.code);
    }
    if (parsed === null && text) throw new NovaError("Nova returned something that wasn't JSON.", response.status, "bad_response");
    return parsed;
  }
}
