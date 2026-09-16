/**
 * The revenue loop in a real browser: generating on the path with no credits
 * left → "Upgrade to keep generating" with the plans above yours → (checkout)
 * → back on the same page with the new allowance, the prompt gone.
 * Stripe itself isn't reachable here; the paid tier is set the way the webhook
 * sets it. API-level: test/integration/revenue-loop.test.ts.
 */
import { test, expect } from "@playwright/test";
import { verifyEmail } from "./verify-email";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function sql(query: string, params: unknown[]) {
  const client = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await client.connect();
  try { await client.query(query, params); } finally { await client.end(); }
}

test("out of credits on the path offers an upgrade, and paying brings you back ready to generate", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.101" } });
  const api = context.request;
  await api.get("/");
  const me = await (await api.post("/api/auth/register", { data: { email: `e2e-revenue-${stamp()}@example.test`, password: "Testpass123!", firstName: "Payer", lastName: "Revenue" } })).json();
  // Accounts start unconfirmed; anything that reaches other people needs the emailed link (server/email-verification.ts).
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: "Payer Revenue", headline: "Out of credits", bio: "Here for the loop." } })).ok()).toBeTruthy();
  const project = await (await api.post("/api/projects", { data: { title: `Revenue Loop ${stamp()}`, description: "A project that runs out of AI credits.", category: "saas", goal: "ship_mvp", subcategory: "saas" } })).json();

  // Low first: the path says so before anything is refused.
  await sql("UPDATE users SET credits_used = 17, credits_reset_at = now() WHERE id = $1", [me.id]);
  const page = await context.newPage();
  await page.goto(`/projects/${project.id}/manage`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 10_000 }).catch(() => {});
  await expect(page.getByTestId("low-credits-notice")).toContainText("3 AI credits left this month");
  await page.getByTestId("button-low-credits-upgrade").click();
  const dialog = page.getByTestId("upgrade-to-keep-generating");
  await expect(dialog).toContainText("Upgrade to keep generating");
  for (const tier of ["starter", "builder", "pro"]) await expect(dialog.getByTestId(`upgrade-plan-${tier}`)).toBeVisible();
  await dialog.getByRole("button", { name: "Not now" }).click();

  // Out: a generate is refused, and the refusal itself opens the upgrade.
  await sql("UPDATE users SET credits_used = 20 WHERE id = $1", [me.id]);
  await page.reload();
  await expect(page.getByTestId("low-credits-notice")).toContainText("out of AI credits");
  await page.getByTestId("button-nova-write-loops").click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Not enough credits");
  await expect(dialog.getByTestId("upgrade-plan-builder")).toContainText("750 AI credits a month");
  await dialog.getByRole("button", { name: "Not now" }).click();

  // Paid (as Stripe's webhook records it), back on the page checkout returns to.
  await sql("UPDATE users SET subscription_tier = 'builder', credits_used = 0 WHERE id = $1", [me.id]);
  await page.goto(`/projects/${project.id}/manage?checkout=success`);
  // The toast renders twice: the visible card and the screen-reader announcement alongside it.
  await expect(page.getByText("You're upgraded", { exact: true }).first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/manage(\\?(?!.*checkout).*)?$`));
  await expect(page.getByTestId("low-credits-notice")).toHaveCount(0);
});
