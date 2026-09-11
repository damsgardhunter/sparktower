#!/usr/bin/env node
/**
 * Nova as an MCP server.
 *
 * The division of labour, which is the reason this exists at all:
 *
 *   Nova owns the plan, the path, the artifacts and the verification.
 *   The editor-side agent owns the reading and the editing.
 *
 * Claude Code, Cursor and VS Code's agent mode all speak MCP, all already know
 * how to read a repository, run tests, and ask a person before touching a
 * file. None of them knows what the next milestone is, what "done" means for
 * it, or whether the thing that was just built actually proves it. That's the
 * half Nova has, and it's the only half this ships.
 *
 * So no tool here writes a file, and none returns code to be pasted in. The
 * agent asks Nova what to build, builds it, reports what it did, and Nova
 * decides whether that counts.
 *
 * The tool list is not compiled in. It's fetched from Nova at startup, so a
 * new tool is a server deploy rather than a release that nobody upgrades to.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { NovaClient, NovaError, collectTree, type Manifest, type ManifestTool } from "@sparktower/nova-core";

const VERSION = "0.1.0";

/**
 * The schema the model sees.
 *
 * Two rewrites of what Nova advertises, both so the agent isn't asked for
 * things it shouldn't be typing:
 *
 *  - `files` is removed and `root` offered instead. The shim reads the disk.
 *  - `projectId` becomes optional when the token or the launch flags already
 *    pin one, so a single-project setup never mentions ids at all.
 */
function advertisedSchema(tool: ManifestTool, defaultProject: string | null) {
  const properties = { ...tool.inputSchema.properties };
  let required = [...(tool.inputSchema.required ?? [])];

  if (tool.collectsFiles) {
    delete properties.files;
    required = required.filter((r) => r !== "files");
    properties.root = {
      type: "string",
      description: "Path to the repository. Defaults to the directory the editor opened; only pass this for a different tree.",
    };
  }
  if (defaultProject) required = required.filter((r) => r !== "projectId");

  return { type: "object" as const, properties, required, additionalProperties: false };
}

/** Nova's replies are JSON, and every client renders text. */
const asText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

async function main() {
  const config = loadConfig();
  const client = new NovaClient(config, `nova-mcp/${VERSION}`);

  let manifest: Manifest;
  try {
    manifest = await client.manifest();
  } catch (err) {
    /*
     * Failing here rather than starting with no tools. A server that connects
     * and then offers nothing looks like a broken editor to the person using
     * it; a process that exits with the reason is something they can fix.
     */
    console.error(`[nova-mcp] ${(err as Error).message}`);
    process.exit(1);
  }

  const defaultProject = config.projectId ?? manifest.pinnedProjectId;
  const byName = new Map(manifest.tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "nova", version: VERSION },
    { capabilities: { tools: {} }, instructions: manifest.instructions },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: manifest.tools.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.costly
        ? `${tool.description}\n\n(Spends credits on the builder's account — don't call it speculatively.)`
        : tool.description,
      inputSchema: advertisedSchema(tool, defaultProject),
      annotations: { readOnlyHint: tool.readOnly, openWorldHint: true },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name);
    if (!tool) return { isError: true, ...asText({ error: `Unknown tool "${request.params.name}".` }) };

    const args: Record<string, unknown> = { ...(request.params.arguments ?? {}) };
    if (defaultProject && !args.projectId) args.projectId = defaultProject;

    let collected: { files: number; read: number; truncated: boolean } | null = null;
    if (tool.collectsFiles) {
      const root = typeof args.root === "string" && args.root ? args.root : config.root;
      delete args.root;
      const tree = await collectTree(root, manifest.limits);
      if (!tree.files.length) {
        return { isError: true, ...asText({ error: `Nothing to send: no source files under ${root}.` }) };
      }
      args.files = tree.files;
      collected = { files: tree.files.length, read: tree.read, truncated: tree.truncated };
    }

    try {
      const result = await client.call(tool, args);
      // What was sent is part of the answer for a truncated tree: an agent
      // that doesn't know the snapshot was cut short reads "unproven" as
      // "not built".
      return asText(collected ? { ...(result as object), sent: collected } : result);
    } catch (err) {
      if (err instanceof NovaError) {
        return { isError: true, ...asText({ error: err.message, status: err.status, code: err.code }) };
      }
      return { isError: true, ...asText({ error: (err as Error).message }) };
    }
  });

  await server.connect(new StdioServerTransport());
  // stderr, always: stdout is the protocol.
  console.error(`[nova-mcp] connected to ${config.baseUrl} as ${manifest.account.email ?? manifest.account.userId}${defaultProject ? ` (project ${defaultProject})` : ""}`);
}

main().catch((err) => {
  console.error(`[nova-mcp] ${(err as Error).message}`);
  process.exit(1);
});
