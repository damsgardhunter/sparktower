/**
 * Signed in, the home screen is the path.
 *
 * It used to open on the feed, with everybody's paths folded into a dropdown
 * under a "Create" button — so a builder with a project in flight was shown
 * other people's work and left to go and find their own. The product's loop is
 * come back and take the next step; that has to be the thing the page opens
 * on, and the feed is what you read afterwards.
 *
 * This proves the order in a browser, because "path-first" is a claim about
 * where things actually are on the page rather than about which components
 * exist.
 */
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function signedInBuilder(page: any, first: string) {
  await page.goto("/");
  expect((await page.request.post("/api/auth/register", {
    data: { email: `e2e-first-${stamp()}@example.test`, password, firstName: first, lastName: "Home" },
  })).ok()).toBeTruthy();
  await verifyEmail(page.request);
  expect((await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Home`, headline: "Building something", bio: "Here for the path." },
  })).ok()).toBeTruthy();
}

test("the signed-in home screen leads with the path and keeps the feed below it", async ({ page }) => {
  await signedInBuilder(page, "Pia");
  const project = await (await page.request.post("/api/projects", {
    data: { title: `First Path ${stamp()}`, description: "A tool that turns a week of receipts into one page.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  })).json();

  await page.goto("/");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});

  // 1. The path is there without being asked for, and it names the next step.
  const heading = page.getByTestId("continue-path-heading");
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`continue-path-${project.id}`)).toBeVisible();
  await expect(page.getByTestId(`continue-path-next-${project.id}`)).toContainText("Product statement");
  await expect(page.getByTestId("button-toggle-continue-path"), "nothing to expand any more").toHaveCount(0);

  /*
   * 2. Above the feed, on the page rather than in the markup: a person reads
   *    down the screen, so this is the claim that matters.
   */
  const pathBox = await heading.boundingBox();
  const feedBox = await page.getByTestId("home-feed-heading").boundingBox();
  expect(pathBox, "the path heading is on the page").toBeTruthy();
  expect(feedBox, "so is the feed heading").toBeTruthy();
  expect(pathBox!.y, "the path comes first").toBeLessThan(feedBox!.y);

  // 3. The feed is still there — secondary, not gone.
  await expect(page.getByTestId("home-feed-heading")).toContainText("What people are building");

  // 4. And it is a way in, not just a label: Continue lands on that step.
  await page.getByTestId(`button-continue-path-${project.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/manage(\\?.*)?$`));
  await expect(page.getByTestId("next-action-title")).toHaveText("Product statement");
});

test("with nothing on a path, home says so and offers to start one", async ({ page }) => {
  await signedInBuilder(page, "Ola");

  await page.goto("/");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});

  const empty = page.getByTestId("continue-path-empty");
  await expect(empty, "an empty path is still an answer").toBeVisible({ timeout: 30_000 });
  await expect(empty).toContainText("Nothing waiting on a path right now.");
  await page.getByTestId("button-path-empty-new-project").click();
  await expect(page).toHaveURL(/\/projects\/new/);
});
