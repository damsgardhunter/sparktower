/**
 * A company account, end to end in a browser.
 *
 * The company pages were built by four people's worth of work at once and type
 * checked, and that is all — nothing had opened them. This walks the flow an
 * existing business actually takes: create the account, open every tab, post
 * a challenge, and see a founder find it, accept the company's terms and
 * enter. The API-level claims are in test/integration/company-*.test.ts; this
 * is the check that the screens are really there and join up.
 */
import { test, expect, type Browser } from "./test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.E2E_SCREENSHOTS;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", {
    data: { email: `e2e-co-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Co" },
  })).ok()).toBeTruthy();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Co`, headline: "Running a business", bio: "Here for the company tools." },
  })).ok()).toBeTruthy();
  return { context, api };
}

test("a company signs up, finds every tool, and a founder answers its challenge", async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await personIn(browser, "203.0.115.10", "Olive");
  const founder = await personIn(browser, "203.0.115.11", "Finn");

  // Create the company through the screen a business owner would use.
  const page = await owner.context.newPage();
  await page.goto("/companies");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  // Reachable from the sidebar, not only by typing the address.
  await expect(page.getByTestId("link-companies")).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId("link-challenges")).toBeAttached();
  await page.getByTestId("button-new-company").click({ timeout: 20_000 });
  await page.getByTestId("input-company-name").fill("Harbour Logistics");
  await page.getByTestId("input-company-description").fill("Freight forwarding for small importers.");
  await page.getByTestId("button-create-company").click();
  await expect(page.getByTestId("text-company-name")).toHaveText("Harbour Logistics", { timeout: 20_000 });
  const companyId = page.url().split("/companies/")[1].split("?")[0];

  // Every tab opens onto something, not a blank panel or an error.
  for (const tab of ["training", "talent", "challenges", "scouting", "run", "posts", "team", "admin"]) {
    await page.getByTestId(`tab-${tab}`).click();
    await expect(page.getByRole("tabpanel")).not.toBeEmpty({ timeout: 15_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/company-${tab}.png`, fullPage: true });
  }

  // Post a challenge from the company's side.
  await page.getByTestId("tab-challenges").click();
  await page.getByTestId("button-new-challenge").click();
  await page.getByTestId("input-challenge-title").fill("Cut our customs delays in half");
  await page.getByTestId("input-challenge-brief").fill(
    "Shipments for small importers wait an average of four days at customs because paperwork arrives late or wrong. We want a way to get it right the first time.",
  );
  await page.getByTestId("input-challenge-prize").fill("$5,000 and a paid pilot");
  const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByTestId("input-challenge-deadline").fill(inAMonth);
  await page.getByTestId("input-challenge-terms").fill(
    "We pay the winner within 30 days of the announcement. Entrants keep ownership of what they submit; we may discuss a pilot with any entrant.",
  );
  await page.getByTestId("button-post-challenge").click();
  await expect(page.locator('[data-testid^="row-challenge-"]').first()).toContainText("Cut our customs delays", { timeout: 20_000 });

  // A founder finds it on the public list, reads the terms, and enters.
  const f = await founder.context.newPage();
  await f.goto("/challenges");
  await f.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await f.getByText("Cut our customs delays in half").first().click({ timeout: 20_000 });
  await expect(f.getByTestId("text-challenge-title")).toHaveText("Cut our customs delays in half", { timeout: 20_000 });
  await f.getByTestId("button-toggle-terms").click();
  await expect(f.getByTestId("text-terms")).toContainText("within 30 days");
  if (SHOTS) await f.screenshot({ path: `${SHOTS}/challenge.png`, fullPage: true });

  await f.getByTestId("input-entry-title").fill("Paperwork checked before it ships");
  await f.getByTestId("input-entry-pitch").fill(
    "A checklist tool importers fill in before the goods leave, which catches the five errors behind most customs holds and sends clean documents ahead.",
  );
  // Terms first: the button stays off until the company's terms are accepted.
  await expect(f.getByTestId("button-enter")).toBeDisabled();
  await f.getByTestId("checkbox-accept-terms").click();
  await f.getByTestId("button-enter").click();
  await expect(f.getByTestId("section-my-entry")).toBeVisible({ timeout: 20_000 });

  // And the company sees the entry.
  await page.reload();
  await page.getByTestId("tab-challenges").click();
  await page.locator('[data-testid^="button-toggle-entries-"]').first().click();
  await expect(page.getByText("Paperwork checked before it ships")).toBeVisible({ timeout: 20_000 });

  // The person's own side of recruiting: the opt-in page exists and starts off.
  const t = await founder.context.newPage();
  await t.goto("/talent");
  await expect(t.getByText(/companies/i).first()).toBeVisible({ timeout: 20_000 });
  if (SHOTS) await t.screenshot({ path: `${SHOTS}/talent.png`, fullPage: true });

  expect(companyId.length).toBeGreaterThan(10);
  await owner.context.close();
  await founder.context.close();
});
