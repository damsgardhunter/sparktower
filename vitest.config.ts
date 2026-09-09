import { defineConfig } from "vitest/config";
import path from "path";
import { loadEnvFile } from "./test/setup/env";
import { testDatabaseUrl } from "./test/setup/database";

/*
 * Resolved here, in the main process, because `test.env` is the only reliable
 * way to get a variable into the workers before they evaluate imports — and
 * `server/db.ts` reads DATABASE_URL at import time and throws without it.
 *
 * Pointing it at the test database in the config, rather than trusting each
 * test to do so, is also the safety rail: there is no way to run this suite
 * against the development database by forgetting something, and the suite
 * truncates every table it can see.
 */
loadEnvFile();
const DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  resolve: {
    // Mirrors vite.config.ts. Server code imports @shared/* the same way the
    // client does, so the aliases have to match or nothing resolves.
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/setup/global-setup.ts"],
    setupFiles: ["./test/setup/each-test.ts"],
    env: {
      DATABASE_URL,
      TEST_DATABASE_URL: DATABASE_URL,
      NODE_ENV: "test",
      /*
       * Fixed rather than inherited. Several modules branch on these, and a
       * suite whose results depend on who is in the developer's .env is not a
       * suite — it passes locally and fails in CI, or worse, the reverse.
       */
      SESSION_SECRET: "test-session-secret-not-used-in-production",
      PLATFORM_REVIEWER_EMAILS: "reviewer@test.local",
      PLATFORM_OWNER_EMAIL: "owner@test.local",
      /*
       * Uploads go to a scratch directory on local disk, not a bucket.
       * PRIVATE_OBJECT_DIR is deliberately left unset — that, plus NODE_ENV
       * "test", is what selects the local fallback, so CI needs no cloud
       * credentials and writes nothing to anyone's storage.
       */
      LOCAL_OBJECT_ROOT: path.resolve(import.meta.dirname, "test", ".objects"),
      // Pinned so the presigned URL and the path derived back from it agree;
      // both default to the PORT, which tests do not set.
      SERVER_BASE_URL: "http://localhost:5001",
    },
    /*
     * One worker. The tests share a single database and truncate it before
     * each test, so two running at once would delete each other's fixtures.
     * Isolating per file would mean a database per worker — worth doing when
     * the suite is slow enough to care, and not before.
     */
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
