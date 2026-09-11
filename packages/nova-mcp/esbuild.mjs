/**
 * One bundled file.
 *
 * `@sparktower/nova-core` is local to this repository and isn't published, so
 * it's compiled in rather than depended on — a published package can't have a
 * `file:` dependency, and splitting the two on npm would mean two versions to
 * keep in step for no one's benefit.
 *
 * The MCP SDK stays external: it's a real dependency, it's large, and npm is
 * better at resolving it than we are at vendoring it.
 */
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  platform: "node",
  target: "node20",
  format: "esm",
  /*
   * Only the SDK. `packages: "external"` would externalise nova-core too,
   * which is the one thing that has to be compiled in — and the failure would
   * be a package that installs fine and crashes on first run.
   */
  external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*"],
  sourcemap: watch,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
