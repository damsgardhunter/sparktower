/**
 * What both clients need, in one place.
 *
 * There are two front ends onto the same bridge — an MCP server for editors
 * that drive an agent, and a VS Code extension for people who'd rather see
 * the path and press a button. They authenticate the same way, call the same
 * endpoints, and have to agree exactly about which files count as source.
 *
 * Two copies of that would disagree within a release, and the failure would be
 * quiet: an audit that saw a different tree than the one the agent verified,
 * and no way to tell from either side which was right.
 */
export { NovaClient, NovaError, type Manifest, type ManifestTool } from "./client.js";
export { collectTree, type CollectedFile, type Collected, type Limits } from "./tree.js";
export { safeRelativePath } from "./paths.js";
export { rewriteRisk, exportedNames, type RewriteRisk } from "./risk.js";
export * from "./path.js";
