/**
 * The landing page's live tracker, in both of its states.
 *
 * The panel exists to show a stranger that somebody else is building here, so
 * the thing worth testing is that a real project — created by a real account,
 * through the real route — appears on the page to a visitor with no account at
 * all. And that when nothing has been started lately it says so and offers an
 * idea instead, rather than rendering an empty shelf.
 *
 * The signed-out check uses a fresh browser context: the tracker reads
 * `GET /api/projects`, which shows an owner their own private projects, and a
 * panel that only works when you are already signed in would prove nothing.
 */
import { test, expect } from "@playwright/test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

test("a brand-new project shows up on the landing page, to somebody with no account", async ({ page, browser }) => {
  // Someone starts a project.
  await page.goto("/");
  const registered = await page.request.post("/api/auth/register", {
    data: { email: `e2e-live-${stamp()}@example.test`, password, firstName: "Marlowe", lastName: "Builder" },
  });
  expect(registered.ok(), await registered.text()).toBeTruthy();
  await verifyEmail(page.request);

  const title = `Tidepool Ferry Times ${stamp()}`;
  const created = await page.request.post("/api/projects", {
    data: {
      title,
      description: "Live ferry times for one island, on a page that loads on a bad signal.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  // A stranger, in their own browser, with no cookies.
  const stranger = await browser.newContext();
  const theirPage = await stranger.newPage();
  await theirPage.goto("/");

  const lead = theirPage.getByTestId("live-project-lead");
  await expect(lead).toBeVisible();
  // The newest one is the one in front, with the person who made it on it.
  await expect(theirPage.getByTestId("text-live-title")).toHaveText(title);
  await expect(theirPage.getByTestId("text-live-owner")).toHaveText("Marlowe");
  // A first name, and never the address they signed up with.
  await expect(lead).not.toContainText("@example.test");

  await stranger.close();
});

test("with nothing started lately, it offers an idea instead of an empty shelf", async ({ page }) => {
  /*
   * The real panel switches on project age, which a test can't wind forward.
   * Answering the request with an empty list is the same thing the component
   * sees on a quiet day, and it is the branch that has no data behind it — the
   * one that would otherwise ship untested and render nothing at all.
   */
  await page.route("**/api/projects", (route) => route.fulfill({ status: 200, body: "[]", contentType: "application/json" }));
  await page.goto("/");

  await expect(page.getByTestId("live-idea-carousel")).toBeVisible();
  await expect(page.getByTestId("live-project-lead")).toHaveCount(0);

  // An idea is on screen, and the rotation moves to another one.
  const first = await page.getByTestId("text-idea-title").textContent();
  expect(first?.trim()).toBeTruthy();
  await expect.poll(async () => page.getByTestId("text-idea-title").textContent(), { timeout: 12_000 })
    .not.toBe(first);
});
