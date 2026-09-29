/**
 * The revenue loop in a real browser: generating on the path with the month's
 * Nova actions spent → the payment dialog offering a pack of more → back on
 * the same page with the allowance restored, the prompt gone.
 *
 * Stripe itself isn't reachable here, so the purchase is applied the way the
 * webhook applies it. The subscription tiers this spec used to walk are
 * retired — every plan is free, and what is sold now is a pack of actions.
 * API-level: test/integration/revenue-loop.test.ts.
 */
import { test, expect } from "./test";
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

test("running out of Nova actions on the path offers a pack, and topping up clears the prompt", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.101" } });
  const api = context.request;
  await api.get("/");
  const me = await (await api.post("/api/auth/register", { data: { email: `e2e-revenue-${stamp()}@example.test`, password: "Testpass123!", firstName: "Payer", lastName: "Revenue" } })).json();
  // Accounts start unconfirmed; anything that reaches other people needs the emailed link (server/email-verification.ts).
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: "Payer Revenue", headline: "Out of credits", bio: "Here for the loop." } })).ok()).toBeTruthy();
  const project = await (await api.post("/api/projects", { data: { title: `Revenue Loop ${stamp()}`, description: "A project that runs out of AI credits.", category: "saas", goal: "ship_mvp", subcategory: "saas" } })).json();

  // Low first: the path says so before anything is refused.
  /*
   * 22 of 25, not 17 of 20. The monthly allowance became MONTHLY_SMALL_ACTIONS
   * (25) when pricing moved to pay-per-use, and "low" is the last fifth of it
   * (shared/credits.ts) — so 17 used left 8 remaining, which is comfortably
   * "ok", and the notice this line exists to trigger never appeared.
   */
  await sql("UPDATE users SET credits_used = 22, credits_reset_at = now() WHERE id = $1", [me.id]);
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
  /*
   * Out of allowance, with money on the account.
   *
   * The remedy depends on the balance: at £0 the 402 asks for a top-up first,
   * and only once the balance covers the £5 pack does the dialog offer to buy
   * one outright (server/entitlements.ts, `paymentRequired`). The pack is what
   * this spec is about, so the account is funded the way a top-up leaves it.
   */
  await sql("UPDATE users SET credits_used = 25, balance_cents = 1000 WHERE id = $1", [me.id]);
  await page.reload();
  await expect(page.getByTestId("low-credits-notice")).toContainText("out of AI credits");
  /* The loops live in a Block that is closed by default (path-panel.tsx). */
  await page.getByTestId("loop-tree-section").click();
  await page.getByTestId("button-nova-write-loops").click();

  /*
   * The refusal opens the payment dialog, not the subscription upgrade.
   *
   * This half of the spec used to check "Not enough credits" and a builder
   * tier offering 750 credits a month. Pricing moved to pay-per-use: every
   * plan is free now, and a small action past the monthly allowance answers
   * 402 `payment_required` offering a pack of Nova actions
   * (server/entitlements.ts). The old dialog is still in the codebase and no
   * longer on this path, so asserting it was testing something nothing
   * reaches.
   */
  const pay = page.getByTestId("dialog-payment");
  await expect(pay).toBeVisible();
  await expect(pay.getByTestId("button-buy-day-pass")).toContainText(/more nova actions/i);
  await pay.getByTestId("button-payment-cancel").click();

  // Topped back up, on the page the purchase returns to: the prompt is gone.
  await sql("UPDATE users SET credits_used = 0 WHERE id = $1", [me.id]);
  await page.goto(`/projects/${project.id}/manage`);
  await expect(page.getByTestId("low-credits-notice")).toHaveCount(0);
});
