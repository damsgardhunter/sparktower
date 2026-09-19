/**
 * The retention loop in a real browser: opening SparkTower shows your path's
 * next step; Continue lands on it; finishing it moves the path; the step you
 * finished can be shared for feedback from the same card, and the post carries
 * a link back to the path. The API-level version is
 * test/integration/path-return.test.ts.
 */
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.61" } });

test("the home screen brings you back to the next step, and a finished step can be shared from it", async ({ page }) => {
  await page.goto("/");
  expect((await page.request.post("/api/auth/register", { data: { email: `e2e-ret-${stamp()}@example.test`, password, firstName: "Rae", lastName: "Return" } })).ok()).toBeTruthy();
  // Accounts start unconfirmed; anything that reaches other people needs the emailed link (server/email-verification.ts).
  await verifyEmail(page.request);
  expect((await page.request.post("/api/profile/complete-onboarding", { data: { displayName: "Rae Return", headline: "Building a meal planner", bio: "Here for the path." } })).ok()).toBeTruthy();
  const title = `Return Path ${stamp()}`;
  const project = await (await page.request.post("/api/projects", {
    data: { title, description: "A meal planner that plans dinners from the fridge.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  })).json();

  // 1. Open SparkTower: the next step is at the top of the feed.
  await page.goto("/");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  // The paths are a closed dropdown on home until opened.
  const card = page.getByTestId(`continue-path-${project.id}`);
  await expect(page.getByTestId("button-toggle-continue-path")).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.getByTestId("button-toggle-continue-path").click();
  await expect(card).toBeVisible();
  await expect(page.getByTestId(`continue-path-next-${project.id}`)).toContainText("Product statement");

  // 2. Continue lands on that step, on the project's path.
  await page.getByTestId(`button-continue-path-${project.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/manage(\\?.*)?$`));
  await expect(page.getByTestId("next-action-title")).toHaveText("Product statement");

  // 3. Finish it (its answer is the step's artifact); the path moves on.
  const tasks = await (await page.request.get(`/api/projects/${project.id}/kanban`)).json();
  const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
  expect((await page.request.patch(`/api/kanban/${step.id}`, { data: { status: "done", description: "Plan a week of dinners from what's in your fridge." } })).ok()).toBeTruthy();

  // 4. Back home: the next step has moved, and the one just finished can be shared for feedback.
  await page.goto("/");
  // The paths are a closed dropdown on home until opened.
  await page.getByTestId("button-toggle-continue-path").click();
  await expect(page.getByTestId(`continue-path-next-${project.id}`)).not.toContainText("Product statement");
  await page.getByTestId(`button-share-last-step-${project.id}`).click();
  await expect(page.getByTestId("share-step-dialog")).toBeVisible();
  await page.getByTestId("input-share-step-ask-0").fill("Does this say who it's for?");
  await page.getByTestId("button-share-step").click();
  await expect(page.getByTestId("share-step-dialog")).toHaveCount(0);

  // 5. The post carries the step, and links back to the path.
  const chip = page.locator('[data-testid^="post-path-step-"]').first();
  await expect(chip).toContainText("From the path: Product statement");
  await expect(page.getByTestId(`button-share-last-step-${project.id}`)).toHaveCount(0);
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/manage(\\?.*)?$`));
});

test("the path page is an address you can return to, and it leads back to the step", async ({ page }) => {
  /*
   * The loop's return: the home card is behind a toggle on a feed that scrolls,
   * so "come back and pick up where you left off" needs somewhere to go. This
   * walks it the way a person does — the sidebar link, the list, the step.
   */
  await page.goto("/");
  expect((await page.request.post("/api/auth/register", { data: { email: `e2e-pathhome-${stamp()}@example.test`, password, firstName: "Pat", lastName: "Home" } })).ok()).toBeTruthy();
  await verifyEmail(page.request);
  expect((await page.request.post("/api/profile/complete-onboarding", { data: { displayName: "Pat Home", headline: "Building something", bio: "Here for the path." } })).ok()).toBeTruthy();

  // Nothing started yet: the page says so and offers the one thing that helps.
  await page.goto("/path");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(page.getByTestId("path-home-empty")).toBeVisible();
  await expect(page.getByTestId("button-path-home-new-project")).toBeVisible();

  const title = `Path Home ${stamp()}`;
  const project = await (await page.request.post("/api/projects", {
    data: { title, description: "A project whose next step should be waiting on the path page.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  })).json();

  // Reachable from the sidebar, not only by typing the address.
  await page.goto("/");
  await page.getByRole("link", { name: "Your path" }).click();
  await expect(page).toHaveURL(/\/path$/);

  // The project's next step is waiting there, and Continue opens it with the card in view.
  const row = page.getByTestId(`continue-path-${project.id}`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId(`continue-path-next-${project.id}`)).toBeVisible();
  await row.getByTestId(`button-continue-path-${project.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/manage\\?.*focus=next`));
  await expect(page.getByTestId("next-action-frame")).toBeVisible({ timeout: 30_000 });
});
