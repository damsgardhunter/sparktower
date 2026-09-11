/**
 * The step's own evidence, in a browser: following a builder makes their
 * updates appear in the Following feed, and a reload keeps them there.
 *
 * Before the follow the feed says how to fill it; after it, the notification
 * leads straight to it. That's the named risk — following that changes
 * nothing you can see — checked end to end.
 */
import { test, expect } from "@playwright/test";

const password = "Testpass123!";

/*
 * Sign-ups are limited per address (8 in 15 minutes), and every spec runs from
 * localhost. This one's own addresses keep it from spending the budget the
 * other specs sign up on — the limit itself stays exactly as it is.
 */
const ARI = { "x-forwarded-for": "203.0.113.31" };
const BEA = { "x-forwarded-for": "203.0.113.32" };
test.use({ extraHTTPHeaders: ARI });
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("following a builder fills the Following feed, immediately and for good", async ({ page, browser }) => {
  const beaContext = await browser.newContext({ extraHTTPHeaders: BEA });
  const bea = beaContext.request;
  await bea.get("/");
  const beaUser = await bea.post("/api/auth/register", { data: { email: `e2e-bea3-${stamp()}@example.test`, password, firstName: "Bea", lastName: "Builder" } });
  expect(beaUser.ok()).toBeTruthy();
  const beaId = (await beaUser.json()).id as string;
  expect((await bea.post("/api/profile/complete-onboarding", {
    data: { displayName: "Bea Builder", headline: "Shipping a habit tracker", bio: "Building in public." },
  })).ok()).toBeTruthy();

  await page.goto("/");
  expect((await page.request.post("/api/auth/register", { data: { email: `e2e-ari3-${stamp()}@example.test`, password, firstName: "Ari", lastName: "Explorer" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: "Ari Explorer", headline: "Looking for a co-builder", bio: "Here for the loop." },
  })).ok()).toBeTruthy();

  // Bea has news — but Ari follows nobody, so the Following feed doesn't carry
  // it: it says how to fix that. (Showing everyone's posts here would fail this.)
  const update = `Bea launched the waitlist ${stamp()}`;
  expect((await bea.post("/api/feed", { data: { postType: "project_update", content: update } })).ok()).toBeTruthy();
  await page.goto("/?feed=following");
  await expect(page.getByTestId("following-empty")).toContainText("Follow builders to see updates");
  await expect(page.getByText(update)).toHaveCount(0);

  // Follow her from her profile. The button changes at once; the notice leads to the feed.
  await page.goto(`/profile/${beaId}`);
  const follow = page.getByTestId(`button-follow-user-${beaId}`);
  await follow.click();
  await expect(follow).toHaveText(/Following/);
  await page.getByTestId("toast-open-following").click();

  await expect(page).toHaveURL(/\?feed=following/);
  await expect(page.getByText(update)).toBeVisible();

  // And it's the server's to remember, not the page's.
  await page.reload();
  await expect(page.getByText(update)).toBeVisible();

  await beaContext.close();
});
