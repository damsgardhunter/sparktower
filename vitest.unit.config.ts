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
    /*
     * The few fixed values a pure test can still need.
     *
     * "No environment file" is the rule and it stays — but a handful of unit
     * tests exercise modules that refuse to run without a secret, which is
     * correct of them and meant those tests never ran at all. They failed at
     * import with "SESSION_SECRET must be set", which reads like the suite's
     * usual background noise rather than "the sealing of personal data is
     * untested". The values are obviously fake and pinned here, not read from
     * a developer's `.env`, so the suite still passes on a clean checkout.
     */
    env: {
      SESSION_SECRET: "unit-test-session-secret-not-used-anywhere-real",
      MOBILE_TOKEN_SECRET: "unit-test-mobile-secret-not-used-anywhere-real",
    },
  },
});
