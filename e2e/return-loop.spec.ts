/**
 * Closing the loop, in a browser: come back and see what's new, carry on
 * exploring, and after acting, get offered more like it.
 *
 * Bea is looked at; Ari does the looking. The news is real — Bea posts after
 * Ari has seen her profile — so what's being proven is the whole path: the
 * profile visit remembered, the post counted through the feed's rules, and the
 * banner and badge on the way back.
 */
import { test, expect } from "@playwright/test";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("a return shows what's new since you looked, continues exploring, and acting nudges toward more", async ({ page, browser }) => {
  const beaContext = await browser.newContext();
  const bea = beaContext.request;
  await bea.get("/");
  const beaUser = await bea.post("/api/auth/register", { data: { email: `e2e-bea2-${stamp()}@example.test`, password, firstName: "Bea", lastName: "Builder" } });
  expect(beaUser.ok()).toBeTruthy();
  const beaId = (await beaUser.json()).id as string;
  expect((await bea.post("/api/profile/complete-onboarding", {
    data: { displayName: "Bea Builder", headline: "Shipping a habit tracker", bio: "Building in public." },
  })).ok()).toBeTruthy();
  const created = await bea.post("/api/projects", {
    data: { title: "Plant Swap", description: "A small app for swapping cuttings with neighbours nearby.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).id as string;

  await page.goto("/");
  expect((await page.request.post("/api/auth/register", { data: { email: `e2e-ari2-${stamp()}@example.test`, password, firstName: "Ari", lastName: "Explorer" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: "Ari Explorer", headline: "Looking for a co-builder", bio: "Here for the loop." },
  })).ok()).toBeTruthy();

  // Ari looks at Bea's profile. That's what makes news from her count.
  await page.goto(`/profile/${beaId}`);
  await expect(page.getByText("Bea Builder").first()).toBeVisible();

  // Then Bea posts.
  expect((await bea.post("/api/feed", { data: { postType: "project_update", content: "Shipped reminders today." } })).ok()).toBeTruthy();

  // Back on Discover: the banner names her, and her card carries the news.
  await page.goto("/discover");
  await expect(page.getByTestId("return-banner")).toBeVisible();
  await expect(page.getByTestId("return-banner-detail")).toContainText("Bea Builder: 1 new post");
  await expect(page.getByTestId(`badge-update-${beaId}`)).toHaveText("1 new post");

  // Continue exploring moves on and gets out of the way.
  await page.getByTestId("button-continue-exploring").click();
  await expect(page.getByTestId("return-banner")).toHaveCount(0);

  // Acting brings the nudge, and the nudge leads somewhere real.
  await page.goto("/projects");
  await page.getByTestId(`button-follow-${projectId}`).click();
  const more = page.getByTestId("toast-more-like-this");
  await expect(more).toBeVisible();
  await more.click();
  await expect(page).toHaveURL(/\/projects\?category=saas/);

  await beaContext.close();
});
