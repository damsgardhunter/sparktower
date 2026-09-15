/**
 * The Explore loop, in a real browser.
 *
 * The integration suite proves the server stores and counts these events
 * correctly when handed a batch. This proves the other half — that the app
 * actually sends them: a page opening, a card scrolling into view, a click, a
 * follow from the card (recorded by the follow endpoint itself), a return, and
 * the tab being left — one whole pass round the loop. That half is the one
 * that fails quietly: an event nobody sends looks exactly like a loop nobody
 * uses.
 *
 * The browser batches events for up to four seconds, and flushes on leaving a
 * page, so every check polls the owner's numbers rather than sleeping.
 */
import { test, expect, type Page } from "@playwright/test";

const password = "Testpass123!";

/** The Explore section of the owner's summary, read with the browser's own session. */
const exploreNumbers = async (page: Page) => {
  const res = await page.request.get("/api/admin/analytics/summary?days=1");
  expect(res.ok()).toBeTruthy();
  return (await res.json()).explore;
};
const step = async (page: Page, key: string) =>
  (await exploreNumbers(page)).funnel.find((s: { key: string }) => s.key === key).sessions as number;
const eventCount = async (page: Page, name: string) =>
  (await exploreNumbers(page)).events.find((e: { name: string }) => e.name === name).events as number;

test("a real browser walks the Explore loop, and the owner's dashboard counts it", async ({ page, browser }) => {
  // Pat owns the project, so there's someone else's work to find and follow.
  const patContext = await browser.newContext();
  const pat = patContext.request;
  await pat.get("/");
  expect((await pat.post("/api/auth/register", {
    data: { email: `e2e-pat-${Date.now()}@example.test`, password, firstName: "Pat", lastName: "Poster" },
  })).ok()).toBeTruthy();

  // The owner, because only the owner can read the numbers — and a builder all the same.
  await page.goto("/");
  expect((await page.request.post("/api/auth/register", {
    data: { email: "owner@e2e.local", password, firstName: "Olive", lastName: "Owner" },
  })).ok()).toBeTruthy();
  expect((await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: "Olive Owner", headline: "Shipping weekly", bio: "Here for the loop." },
  })).ok()).toBeTruthy();
  const created = await pat.post("/api/projects", {
    data: {
      title: "Explore Target", description: "A project for the Explore loop to find, see and open in a real browser.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).id as string;

  // Discover, then the project list in the same tab: two opens, and the second is a return.
  await page.goto("/discover");
  await expect(page.getByTestId("input-search-users")).toBeVisible();
  await page.goto("/projects");
  const card = page.getByTestId(`card-project-${projectId}`);
  await expect(card).toBeVisible();

  // The card on screen counts as seen — once the batch goes out.
  await expect.poll(() => step(page, "viewed"), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

  // Follow it from the card: the loop's action, recorded by the follow endpoint —
  // once, not also by the browser. Counted from here, since other specs share the database.
  const followsBefore = await eventCount(page, "explore.follow");
  await page.getByTestId(`button-follow-${projectId}`).click();
  await expect(page.getByTestId(`button-follow-${projectId}`)).toHaveText(/Following/);
  await expect.poll(() => step(page, "acted"), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => eventCount(page, "explore.follow"), { timeout: 15_000 }).toBe(followsBefore + 1);

  // Opening it is the closer look.
  await card.click();
  await page.waitForURL(new RegExp(`/projects/${projectId}$`));

  // Back to Discover closes the pass; leaving for the dashboard flushes it, and ends the session.
  await page.goto("/discover");
  await expect(page.getByTestId("input-search-users")).toBeVisible();
  await page.goto("/admin/analytics");

  await expect.poll(() => step(page, "lookedCloser"), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  expect(await step(page, "opened")).toBeGreaterThanOrEqual(1);
  expect(await step(page, "returned")).toBeGreaterThanOrEqual(1);
  // Open → follow → return, in one visit: the loop went all the way round.
  await expect.poll(async () => (await exploreNumbers(page)).cycles.completedOne, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => eventCount(page, "explore.session_end"), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);

  // And the owner sees it where they'd look: the Explore card, with the funnel filled in.
  await page.reload();
  const panel = page.getByTestId("card-explore-loop");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("explore-funnel")).toContainText("Opened a profile or project");
  await expect(panel).not.toContainText("Nobody opened Discover");
  await patContext.close();
});
