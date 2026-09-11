/*
 * Its own config, because vitest otherwise walks up and finds the app's — which
 * insists on a test database, truncates every table in it, and has nothing to
 * do with two pure functions in a standalone package.
 *
 * The inline PostCSS setting is for the same reason: without one, Vite walks up
 * to the app's postcss.config.js and loads Tailwind, which CI's packages job
 * doesn't install — so the tests crashed there before running.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  css: { postcss: {} },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
