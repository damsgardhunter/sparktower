/**
 * The security console, doing the job it exists for: somebody lost their
 * phone, wrote in, and an admin gets them back into their account.
 *
 * That person is almost never staff, and the console first shipped listing
 * only admins and reviewers — the one kind of account that would not need it.
 * Its server tests all passed; nobody had walked it as the operator does, from
 * an email in hand to a member signing in again. This does.
 */
import pg from "pg";
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";
import { passMfa } from "./mfa-helper";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();
const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("an admin finds a locked-out member by their address and gets them back in", async ({ browser }) => {
  test.setTimeout(120_000);

  // A member with 2FA on — whose phone is now at the bottom of a lake.
  const memberCtx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.215" } });
  const member = memberCtx.request;
  await member.get("/");
  const email = `e2e-lost-phone-${stamp()}@example.test`;
  const me = await (await member.post("/api/auth/register", { data: { email, password, firstName: "Lake", lastName: "Phone" } })).json();
  await verifyEmail(member, email);
  expect((await member.post("/api/profile/complete-onboarding", { data: { displayName: "Lake Phone", headline: "x", bio: "y" } })).ok()).toBeTruthy();
  await passMfa(member);

  // Without the phone, signing in stops at the code.
  const stuck = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.216" } });
  const attempt = await (await stuck.request.post("/api/auth/login", { data: { email, password } })).json();
  expect(attempt.mfaRequired, "the password alone is not enough").toBe(true);
  expect((await stuck.request.get("/api/auth/user")).status(), "and it did not sign them in").toBe(401);
  await stuck.close();

  // The operator: an admin whose own session has passed its second factor.
  const adminCtx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.217" } });
  const adminApi = adminCtx.request;
  await adminApi.get("/");
  const adminEmail = `e2e-operator-${stamp()}@example.test`;
  const admin = await (await adminApi.post("/api/auth/register", { data: { email: adminEmail, password, firstName: "Opal", lastName: "Operator" } })).json();
  await verifyEmail(adminApi, adminEmail);
  expect((await adminApi.post("/api/profile/complete-onboarding", { data: { displayName: "Opal Operator", headline: "x", bio: "y" } })).ok()).toBeTruthy();
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { await db.query("UPDATE users SET platform_role = 'admin' WHERE id = $1", [admin.id]); } finally { await db.end(); }
  await passMfa(adminApi);

  const page = await adminCtx.newPage();
  await page.goto("/admin/security");
  await expect(page.getByTestId("page-admin-security")).toBeVisible();
  // Not on the staff list — which is the whole problem the lookup solves.
  await expect(page.getByTestId(`row-privileged-${me.id}`)).toHaveCount(0);

  // The address from their email, typed however they typed it.
  await page.getByTestId("input-lookup-email").fill(email.toUpperCase());
  await page.getByTestId("button-lookup").click();
  const row = page.getByTestId(`row-lookup-${me.id}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId(`badge-2fa-on-${me.id}`)).toBeVisible();

  // The reset asks how they were confirmed, and won't run on a shrug.
  await row.getByTestId(`button-reset-mfa-${me.id}`).click();
  await expect(page.getByTestId("card-confirm-action")).toBeVisible();
  await page.getByTestId("input-action-reason").fill("lost");
  await expect(page.getByTestId("button-confirm-action")).toBeDisabled();
  await page.getByTestId("input-action-reason").fill("Wrote in from the address on file; confirmed the project they own over a call.");
  await page.getByTestId("button-confirm-action").click();

  // Done, and the row says so without a reload.
  await expect(row.getByTestId(`badge-no-2fa-${me.id}`)).toBeVisible({ timeout: 15_000 });

  // Every session they had is over — a reset must not leave a thief's session alive.
  expect((await member.get("/api/auth/user")).status(), "the old session ended with the reset").toBe(401);

  // And the member signs in with just their password again.
  const back = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.218" } });
  const signIn = await back.newPage();
  await signIn.goto("/");
  await signIn.getByTestId("tab-login").click();
  await signIn.getByTestId("input-login-email").fill(email);
  await signIn.getByTestId("input-login-password").fill(password);
  await signIn.getByTestId("button-submit-login").click();
  await expect.poll(async () => (await back.request.get("/api/auth/user")).status(), { timeout: 15_000 }).toBe(200);

  await memberCtx.close();
  await adminCtx.close();
  await back.close();
});
