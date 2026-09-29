/**
 * The customer console, doing the job it exists for: somebody writes in, and
 * the person answering fixes it without a shell and a production database URL.
 *
 * Its server tests cover who is refused and what every action does — twenty of
 * them, including the money and the undo. This is the other half: walking it
 * as the operator does, from a name in an email to the fix and the record of
 * why. Every one of those refusals could pass while the screen is unusable,
 * and a console nobody can drive at three in the morning is not a console.
 *
 * ## Why the operator here is support rather than the owner
 *
 * The money actions need the single PLATFORM_OWNER_EMAIL address, which in
 * this suite is `owner@e2e.local` — and `explore-loop.spec.ts` registers that
 * account itself and expects to be the one that does. Two specs racing to
 * create one account is a flaky suite, and the loser is whichever happens to
 * run second. So the browser walks the support path, which needs no shared
 * account, and asserts the money boundary from the outside: the owner-only
 * buttons are on screen and disabled, in the words the server would refuse
 * with. The owner's side of that boundary is covered against a real database
 * in test/integration/admin-console.test.ts.
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

/** An ordinary customer, with a project, who is about to need help. */
async function customer(browser: any, ip: string, name: string) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = ctx.request;
  await api.get("/");
  const email = `e2e-cust-${stamp()}@example.test`;
  const me = await (await api.post("/api/auth/register", { data: { email, password, firstName: name } })).json();
  await verifyEmail(api, email);
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: name, headline: "x", bio: "y" } })).ok()).toBeTruthy();
  const made = await api.post("/api/projects", {
    data: { title: `${name}'s cafe`, description: "Trading for six years.", category: "Other", goal: "run_company", subcategory: "restaurant" },
  });
  expect(made.ok(), "the customer needs a project to be supported about").toBeTruthy();
  return { ctx, api, email, id: me.id as string, projectId: (await made.json()).id as string };
}

/**
 * Somebody on support: an admin with a second factor on the session, and
 * deliberately not the owner. Their own address, so nothing is shared with
 * another spec.
 */
async function supportOperator(browser: any, ip: string) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = ctx.request;
  await api.get("/");
  const email = `e2e-support-${stamp()}@example.test`;
  const me = await (await api.post("/api/auth/register", { data: { email, password, firstName: "Sam" } })).json();
  await verifyEmail(api, email);
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: "Sam Support", headline: "x", bio: "y" } })).ok()).toBeTruthy();

  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { await db.query("UPDATE users SET platform_role = 'admin' WHERE id = $1", [me.id]); } finally { await db.end(); }
  await passMfa(api);
  return { ctx, api, id: me.id as string, email };
}

test("support finds a customer, fixes their day, and can put it back", async ({ browser }) => {
  test.setTimeout(180_000);

  const them = await customer(browser, "203.0.113.230", "Wilma");
  const sam = await supportOperator(browser, "203.0.113.231");

  const page = await sam.ctx.newPage();
  await page.goto("/admin/console");
  await expect(page.getByTestId("text-console-title")).toBeVisible();

  // Found the way support finds people: the address pasted out of their email.
  await page.getByTestId("input-console-search").fill(them.email);
  await page.getByTestId("button-console-search").click();
  await page.getByTestId(`console-person-${them.id}`).click();
  await expect(page.getByTestId("console-customer")).toBeVisible();

  // Give them the day they lost.
  await page.getByTestId("console-action-day_pass").click();
  await expect(page.getByTestId("console-confirm")).toBeVisible();
  // The button will not run until the reason is a sentence — that is the point of it.
  await expect(page.getByTestId("button-console-confirm")).toBeDisabled();
  await page.getByTestId("input-console-reason").fill("Lost a day to the outage on Tuesday — ticket 412.");
  await page.getByTestId("button-console-confirm").click();

  // It reaches the customer's own account, not just the operator's screen.
  await expect
    .poll(async () => (await (await them.api.get("/api/nova/wallet")).json()).wallet.dayPassUntil, { timeout: 20_000 })
    .not.toBeNull();

  // And it can be put back from the record, without anybody opening a runbook.
  const undo = page.locator('[data-testid^="button-undo-"]').first();
  await expect(undo).toBeVisible({ timeout: 20_000 });
  await undo.click();
  await page.getByTestId("input-undo-reason").fill("Gave it to the wrong account — ticket 412.");
  await page.getByTestId("button-undo-confirm").click();

  await expect
    .poll(async () => (await (await them.api.get("/api/nova/wallet")).json()).wallet.dayPassUntil, { timeout: 20_000 })
    .toBeNull();

  await them.ctx.close();
  await sam.ctx.close();
});

test("the money boundary is visible rather than discovered by pressing", async ({ browser }) => {
  test.setTimeout(180_000);

  const them = await customer(browser, "203.0.113.232", "Wesley");
  const sam = await supportOperator(browser, "203.0.113.233");

  const page = await sam.ctx.newPage();
  await page.goto("/admin/console");
  await page.getByTestId("input-console-search").fill(them.email);
  await page.getByTestId("button-console-search").click();
  await page.getByTestId(`console-person-${them.id}`).click();
  await expect(page.getByTestId("console-customer")).toBeVisible();

  /*
   * Both owner-only actions are drawn and disabled, so an operator learns the
   * shape of their own permissions by reading rather than by being refused
   * after deciding to help somebody.
   */
  await expect(page.getByTestId("console-action-credit")).toBeDisabled();
  await expect(page.getByTestId("console-action-transfer_project")).toBeDisabled();
  await expect(page.getByTestId("console-action-day_pass")).toBeEnabled();
  await expect(page.getByTestId("console-action-credit")).toContainText(/owner/i);

  // And the server agrees with the screen, which is the half that actually protects the money.
  const refused = await sam.api.post("/api/admin/console/act", {
    data: { action: "credit", userId: them.id, cents: 500, reason: "Trying it from outside the screen." },
  });
  expect(refused.status()).toBe(403);
  const { wallet } = await (await them.api.get("/api/nova/wallet")).json();
  expect(wallet.balanceCents).toBe(0);

  await them.ctx.close();
  await sam.ctx.close();
});

test("an ordinary member cannot find the console at all", async ({ browser }) => {
  test.setTimeout(120_000);
  const them = await customer(browser, "203.0.113.234", "Winona");

  // The API says nothing, and the page draws the same nothing.
  expect((await them.api.get("/api/admin/console/actions")).status()).toBe(404);

  const page = await them.ctx.newPage();
  await page.goto("/admin/console");
  await expect(page.getByTestId("text-console-title")).toHaveCount(0);
  // Nor is there a way in from the sidebar.
  await page.goto("/");
  await expect(page.getByTestId("link-customer-console")).toHaveCount(0);

  await them.ctx.close();
});
