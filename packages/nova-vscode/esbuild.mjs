/**
 * One bundled file, because a marketplace extension has no npm install.
 *
 * `@sparktower/nova-core` is a file: dependency in this repository and won't
 * exist on anyone's machine, so it is bundled in rather than required at
 * runtime. `vscode` is the one thing that must stay external — it's injected
 * by the host and has no package behind it.
 */
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  sourcemap: watch,
  minify: !watch,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
