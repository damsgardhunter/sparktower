import { defineConfig } from "vitest/config";
import path from "path";

/**
 * The unit suite, standalone.
 *
 * No global setup, no database, no environment file — so `npm run test:unit`
 * runs with nothing installed but node_modules, in about a second. That matters
 * more than the speed: a unit test that needs Postgres running is an
 * integration test wearing the wrong label, and the first thing it costs you is
 * the habit of running it.
 *
 * `npm test` still runs everything, this config included, through
 * vitest.config.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["test/unit/**/*.test.ts"],
  },
});
