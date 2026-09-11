/*
 * Its own config, because vitest otherwise walks up and finds the app's — which
 * insists on a test database, truncates every table in it, and has nothing to
 * do with two pure functions in a standalone package.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
