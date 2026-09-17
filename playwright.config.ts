import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { loadEnvFile } from "./test/setup/env";
import { testDatabaseUrl } from "./test/setup/database";

/**
 * Browser smoke tests for the wedge journey.
 *
 * These start a real server against their own database (`<name>_e2e`, created
 * and migrated in global-setup) and drive it with a real browser. They are the
 * only tests that prove a person can click through the product; everything
 * else drives the API. Deliberately few: a smoke test is worth running before
 * every release, and a slow suite is one that gets skipped.
 *
 * The server runs in development mode. Production mode marks the session
 * cookie Secure, which a browser will not send back over plain http, and
 * building the client adds a minute for no gain in what these tests check.
 */
loadEnvFile();
const E2E_PORT = 5011;
const DATABASE_URL = testDatabaseUrl("_e2e");

export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The database first, then the server: Playwright can start this before its own global setup has made it.
    command: "npx tsx e2e/ensure-db.ts && npx tsx server/index.ts",
    url: `${E2E_BASE_URL}/_health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "development",
      PORT: String(E2E_PORT),
      DATABASE_URL,
      SESSION_SECRET: "e2e-session-secret-not-used-anywhere-real",
      AI_INTEGRATIONS_OPENAI_API_KEY: "sk-test-not-a-real-key-e2e-never-calls-openai",
      OPENAI_API_KEY: "sk-test-not-a-real-key-e2e-never-calls-openai",
      PLATFORM_OWNER_EMAIL: "owner@e2e.local",
      PLATFORM_REVIEWER_EMAILS: "owner@e2e.local",
      LOCAL_OBJECT_ROOT: path.resolve(import.meta.dirname, "e2e", ".objects"),
      SERVER_BASE_URL: E2E_BASE_URL,
      // The Content Security Policy blocks, not just reports, so a browser test fails the moment the page loads something it doesn't allow.
      CSP_ENFORCE: "1",
      /*
       * The breached-password check, off.
       *
       * It calls Have I Been Pwned for real, and it is ON here because these
       * tests deliberately run with NODE_ENV=development (see the note at the
       * top) — the module only defaults itself off under NODE_ENV=test. So the
       * suite's own password, which is in the public breach corpus like every
       * obvious test password, was being refused at registration: HTTP 400,
       * `breached_password`. It failed open on a 2.5s timeout, so the suite
       * passed when the network was slow and failed when it was quick, which
       * read as flakiness rather than as a browser test depending on a third
       * party being reachable.
       *
       * The behaviour itself is covered, with the range API stubbed, in
       * test/integration/password-policy.test.ts. Nothing is lost here.
       */
      PASSWORD_BREACH_CHECK: "off",

      /*
       * Email included, which it wasn't. These tests run with
       * NODE_ENV=development, and `emailConfigured()` is false only when the
       * key is missing or NODE_ENV is "test" — so once a developer put a real
       * RESEND_API_KEY in their .env, the browser suite inherited it and every
       * account it creates tried to send a real message through Resend. The
       * tests still passed, because a failed send is recorded in the dev outbox
       * they read from, so the only signal was a few dozen refused API calls
       * per run against somebody's live sending quota.
       */
      RESEND_API_KEY: "",
      EMAIL_FROM: "",

      // Nothing that could reach a real service.
      STRIPE_SECRET_KEY: "",
      PRINTFUL_API_KEY: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
    },
  },
});
