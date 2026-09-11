/*
 * `vscode` is injected by the host at runtime and has no package behind it, so
 * a test importing this extension's modules has to be given one. The alias is
 * the whole trick.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { vscode: path.resolve(import.meta.dirname, "test/vscode-stub.ts") },
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
