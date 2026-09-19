/**
 * The funding path and investment applications in a real browser.
 *
 * A founder with an owner role on their résumé opens a funding project: Nova
 * asks why they want to own a business, the capital profile is answered in
 * bubbles (business history filled from the résumé), the score card appears,
 * the route bubbles show how each fits, and picking one brings its roadmap.
 * Then the founder opens investment applications, an investor applies from
 * the public page, and the founder marks it. Stops short of Nova's plans —
 * there's no model here.
 */
import { test, expect, type Browser } from "./test";
import { verifyEmail } from "./verify-email";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();
const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.E2E_SCREENSHOTS;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  const email = `e2e-${first.toLowerCase()}-${stamp()}@example.test`;
  const res = await api.post("/api/auth/register", { data: { email, password, firstName: first, lastName: "Capital" } });
  expect(res.ok()).toBeTruthy();
  // Accounts start unconfirmed; anything that reaches other people needs the emailed link (server/email-verification.ts).
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: `${first} Capital`, headline: "Building a business", bio: "Here for the money." } })).ok()).toBeTruthy();
  return { context, api, email, id: (await res.json()).id as string };
}

async function sql(text: string, params: unknown[]) {
  const client = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await client.connect();
  try { await client.query(text, params); } finally { await client.end(); }
}

test("a founder builds a capital profile, picks a route, and takes an investment application", async ({ browser }) => {
  const founder = await personIn(browser, "203.0.113.192", "Dana");
  const investor = await personIn(browser, "203.0.113.193", "Ivan");
  // A résumé Nova already read, with an owner role on it.
  await sql(`UPDATE user_profiles SET resume_parsed_at = now(), experience = $2::jsonb WHERE user_id = $1`, [founder.id, JSON.stringify([
    { title: "Owner", company: "Sparkle Pro Cleaning", startDate: "2016-01", endDate: "2021-06", current: false, description: "Office cleaning, 9 staff" },
  ])]);

  const created = await founder.api.post("/api/projects", {
    data: { title: "Brightside Acquisition", description: "Buying a commercial cleaning company and growing it across the city.", category: "services", goal: "raise_funding", subcategory: "other" },
  });
  const projectId = (await created.json()).id as string;
  const page = await founder.context.newPage();

  // 1. Nova opens on why.
  await page.goto(`/projects/${projectId}/manage`);
  const welcome = page.getByTestId("nova-money-first");
  await expect(welcome).toContainText("Let's find the money for your business");
  await welcome.getByTestId("intake-why-wealth").click();
  await welcome.getByTestId("intake-why-legacy").click();
  await welcome.getByTestId("intake-path-buy").click();
  await welcome.getByTestId("intake-role-operator").click();
  await welcome.getByTestId("intake-horizon-forever").click();
  await welcome.getByTestId("button-intake-save").click();
  await expect(page.getByTestId("nova-onboarding-overlay")).toHaveCount(0);

  // 2. Money today, then experience — and the score appears.
  await page.getByTestId("intake-cash-25k_100k").click();
  await page.getByTestId("intake-credit-670_739").click();
  await page.getByTestId("intake-income-100k_200k").click();
  await page.getByTestId("intake-debt-500_1500").click();
  await page.getByTestId("intake-assets-home_equity").click();
  await page.getByTestId("button-intake-save").click();
  await expect(page.getByTestId("capital-profile-card")).toBeVisible();
  await page.getByTestId("intake-industry_years-5_10").click();
  await page.getByTestId("intake-level-manager").click();
  await page.getByTestId("intake-managed-6_20").click();
  await page.getByTestId("intake-pnl-some").click();
  await page.getByTestId("button-intake-save").click();

  // 3. Business history, filled from the résumé; the follow-up questions appear with it.
  await expect(page.getByTestId("intake-q-owned")).toBeVisible();
  await expect(page.getByTestId("intake-q-revenue")).toHaveCount(0);
  await page.getByTestId("button-intake-prefill").click();
  await expect(page.getByTestId("intake-owned-once")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("intake-idea-text")).toHaveValue("Sparkle Pro Cleaning — Office cleaning, 9 staff");
  await expect(page.getByText("Found: Owner, Sparkle Pro Cleaning")).toBeVisible();
  await page.getByTestId("intake-industry-services").click();
  await page.getByTestId("intake-revenue-250k_1m").click();
  await page.getByTestId("intake-profit-50k_250k").click();
  await page.getByTestId("intake-employees-6_20").click();
  await page.getByTestId("intake-customers-50_500").click();
  await page.getByTestId("intake-outcome-sold").click();
  await page.getByTestId("button-intake-save").click();

  // 4. The capital goal.
  await page.getByTestId("intake-amount-500k_1m").click();
  await page.getByTestId("intake-uses-acquisition").click();
  await page.getByTestId("intake-uses-working_capital").click();
  await page.getByTestId("intake-timeline-6_12").click();
  await page.getByTestId("intake-equity-lt10").click();
  await page.getByTestId("intake-debt_ok-guarantee").click();
  await page.getByTestId("intake-ownership-75_plus").click();
  await page.getByTestId("button-intake-save").click();
  await expect(page.getByTestId("button-work")).toHaveText(/Have Nova build this plan/);
  const score = Number(await page.getByTestId("capital-score").textContent());
  expect(score).toBeGreaterThan(50);
  if (SHOTS) await page.getByTestId("capital-profile-card").screenshot({ path: `${SHOTS}/capital-card.png` });

  // 5. Past Nova's two plans (no model here), to the route: each bubble shows its fit.
  const tasks = (await (await founder.api.get(`/api/projects/${projectId}/kanban`)).json()) as any[];
  for (const id of ["FUND.C1.6", "FUND.C2.1"]) {
    const t = tasks.find((x) => x.tags?.includes(`backbone:${id}`));
    expect((await founder.api.patch(`/api/kanban/${t.id}`, { data: { status: "done" } })).ok()).toBeTruthy();
  }
  await page.reload();
  await expect(page.getByTestId("intake-q-route")).toBeVisible();
  await expect(page.getByTestId("intake-route-seller")).toContainText(/fit \d+/);
  if (SHOTS) await page.getByTestId("intake-q-route").screenshot({ path: `${SHOTS}/route-bubbles.png` });
  await page.getByTestId("intake-route-seller").click();
  await page.getByTestId("button-intake-save").click();
  await expect(page.getByText("Route chosen — your roadmap is ready").first()).toBeVisible();
  await expect(page.getByText("Acquisition criteria").first()).toBeVisible();
  await expect(page.getByTestId("route-fit-seller")).toContainText("your route");

  // 6. Open investment applications from the Investors tab.
  await page.goto(`/projects/${projectId}/manage?tab=investors`);
  await page.getByTestId("input-ask-headline").fill("Raising $250k to buy a second route");
  await page.getByTestId("ask-amount-100k_250k").click();
  await page.getByTestId("ask-instrument-profit_share").click();
  await page.getByTestId("switch-investment-open").click();
  await expect(page.getByText("Applications are open on your project page").first()).toBeVisible();

  // 7. An investor applies from the public page.
  const pub = await investor.context.newPage();
  await pub.goto(`/projects/${projectId}`);
  const card = pub.getByTestId("invest-card");
  await expect(card).toContainText("Raising $250k to buy a second route");
  await card.getByTestId("button-apply-invest").click();
  await pub.getByTestId("apply-amount-25k_100k").click();
  await pub.getByTestId("apply-instrument-profit_share").click();
  await pub.getByTestId("apply-type-angel").click();
  await pub.getByTestId("apply-accredited-yes").click();
  await pub.getByTestId("apply-message").fill("I've backed two local service businesses and know this market well.");
  const send = pub.getByTestId("button-send-application");
  await expect(send).toBeDisabled();
  await pub.getByTestId("apply-consent").click();
  if (SHOTS) await pub.screenshot({ path: `${SHOTS}/apply-dialog.png` });
  await send.click();
  await expect(pub.getByTestId("invest-applied")).toContainText("You applied · New");

  // 8. The founder sees it, with the investor's email, and marks it.
  await page.reload();
  const row = page.getByTestId(/^application-/).first();
  await expect(row).toContainText("Ivan Capital");
  await expect(row).toContainText(investor.email);
  await row.getByRole("button", { name: "Want to talk" }).click();
  await expect(row).toContainText("Want to talk");
  if (SHOTS) await page.getByTestId("investment-inbox").screenshot({ path: `${SHOTS}/inbox.png` });
  await pub.reload();
  await expect(pub.getByTestId("invest-applied")).toContainText("Want to talk");

  await Promise.all([founder.context.close(), investor.context.close()]);
});
