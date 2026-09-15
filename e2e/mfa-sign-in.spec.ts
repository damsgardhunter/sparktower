/**
 * Two-factor sign-in in a real browser, for a reviewer:
 *
 *   signed in, the header says review tools are locked until 2FA is on → the
 *   security page shows a key, takes a code, shows recovery codes → signing in
 *   again stops at a code step → the right code lands in the app, unlocked.
 *
 * The rules (who needs it, replay, recovery, mobile) are in
 * test/integration/mfa.test.ts; this proves the screens connect them.
 */
import { test, expect } from "@playwright/test";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";
import { timeStep, totpAt } from "../server/totp";

loadEnvFile();
const password = "Testpass123!";

test("a reviewer sets up 2FA, then signs in with a code", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.171" } });
  const page = await context.newPage();
  const api = context.request;
  await api.get("/");
  const email = `e2e-mfa-${Date.now()}@example.test`;
  const me = await (await api.post("/api/auth/register", { data: { email, password, firstName: "Remy", lastName: "Reviewer" } })).json();
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: "Remy Reviewer", headline: "Keeping it clean", bio: "Reviews reports." } })).ok()).toBeTruthy();
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { await db.query("UPDATE users SET platform_role = 'reviewer' WHERE id = $1", [me.id]); } finally { await db.end(); }

  // Locked until 2FA is on, and the notice says where to fix it.
  await page.goto("/");
  await expect(page.getByTestId("mfa-notice")).toBeVisible();
  await page.getByTestId("link-mfa-setup").click();
  await expect(page).toHaveURL(/\/settings\/security$/);

  // Setup: the key, a code from it, then the recovery codes.
  await page.getByTestId("button-mfa-start").click();
  const secret = ((await page.getByTestId("text-mfa-secret").textContent()) ?? "").replace(/\s/g, "");
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expect(page.getByTestId("link-mfa-otpauth")).toHaveAttribute("href", new RegExp(`^otpauth://totp/.*secret=${secret}`));
  await page.getByTestId("input-mfa-enable-code").fill("000000");
  await page.getByTestId("button-mfa-enable").click();
  await expect(page.getByTestId("text-mfa-settings-error")).toBeVisible();
  await page.getByTestId("input-mfa-enable-code").fill(totpAt(secret, timeStep()));
  await page.getByTestId("button-mfa-enable").click();
  await expect(page.getByTestId("mfa-recovery-codes")).toBeVisible();
  await expect(page.getByTestId("badge-mfa-state")).toHaveText("On");
  await expect(page.getByTestId("mfa-notice")).toHaveCount(0);
  expect((await api.get("/api/admin/reports")).status()).toBe(200);

  // Sign out; sign in again: the password isn't enough.
  await page.getByTestId("button-logout").click();
  await expect(page.getByTestId("button-login")).toBeVisible();
  await page.getByTestId("button-login").click();
  await page.getByTestId("input-login-email").fill(email);
  await page.getByTestId("input-login-password").fill(password);
  await page.getByTestId("button-submit-login").click();
  await expect(page.getByTestId("form-mfa-code")).toBeVisible();
  expect((await api.get("/api/auth/user")).status()).toBe(401);

  // A wrong code is refused; the next code in the app signs in, review tools unlocked.
  await page.getByTestId("input-mfa-code").fill("123456");
  await page.getByTestId("button-mfa-verify").click();
  await expect(page.getByTestId("text-mfa-error")).toBeVisible();
  await page.getByTestId("input-mfa-code").fill(totpAt(secret, timeStep() + 1));
  await page.getByTestId("button-mfa-verify").click();
  await expect(page.getByTestId("app-header")).toBeVisible();
  await expect(page.getByTestId("mfa-notice")).toHaveCount(0);
  expect((await api.get("/api/admin/reports")).status()).toBe(200);
  await context.close();
});
