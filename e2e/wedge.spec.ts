/**
 * The wedge, in a browser.
 *
 * Two journeys. The builder's: sign up, make a project, post the first
 * check-in. The receiver's: someone with no account opens the shared link and
 * reads it. Between them that is the whole product; if both pass, most things
 * do.
 *
 * Onboarding is completed through the API rather than clicked through. It is
 * seven steps of profile detail that have nothing to do with the wedge, and a
 * smoke test that spends most of its time on skill tags is a smoke test that
 * fails for reasons nobody cares about. Every step that *is* the wedge is a
 * real click in a real browser.
 */
import { test, expect, type Page } from "@playwright/test";

const password = "Testpass123!";
const newEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

/** Signs up through the landing page and lands the account past onboarding. */
async function signUp(page: Page, first = "Casey") {
  const email = newEmail();
  await page.goto("/");
  // The form is a modal; the nav button opens it already on the signup tab.
  await page.getByTestId("button-signup-nav").click();
  await expect(page.getByTestId("tab-signup")).toBeVisible();
  await page.getByTestId("input-signup-firstname").fill(first);
  await page.getByTestId("input-signup-lastname").fill("Builder");
  await page.getByTestId("input-signup-email").fill(email);
  await page.getByTestId("input-signup-password").fill(password);
  await page.getByTestId("input-signup-confirm").fill(password);
  await page.getByTestId("button-submit-signup").click();

  // A brand-new account is sent to onboarding; that redirect is the proof
  // the session was created and the profile provisioned.
  await page.waitForURL(/\/onboarding/, { timeout: 15_000 });

  // Same cookie jar as the page, so this is the signed-in user completing it.
  const done = await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Builder`, headline: "Shipping weekly", bio: "Here for the loop." },
  });
  expect(done.ok()).toBeTruthy();
  return email;
}

test("a new builder signs up, creates a project, and posts the first check-in", async ({ page }) => {
  await signUp(page);

  // Home, with the create-project bar at the top of the feed.
  await page.goto("/");
  await page.getByTestId("button-create-project-home").click();
  await page.waitForURL(/\/projects\/new/);

  // The intro hands off to the create page.
  await page.getByTestId("button-launch-nova").click();
  await page.waitForURL(/\/projects\/new\/create/);

  // The manual fields — no conversation with Nova needed to get a project.
  await page.getByTestId("input-project-title").fill("Weeknight Recipes");
  await page.getByTestId("textarea-project-description").fill(
    "A small app that plans a week of dinners from what is already in the fridge.",
  );
  await page.getByTestId("button-create-project").click();
  // Creating a project lands on its manage page, which is where check-ins live.
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/manage/, { timeout: 15_000 });
  const projectId = page.url().match(/\/projects\/([0-9a-f-]{36})/)![1];

  /*
   * The first check-in, from the home rail. Each of your projects gets a
   * "Check in" shortcut there — the manage page has a check-in list too, but
   * it sits behind a tab that defaults elsewhere, and the shortcut is the
   * path the product actually pushes you down.
   */
  await page.goto("/");
  await page.getByRole("button", { name: /^\s*check in\s*$/i }).first().click();
  await page.getByTestId("input-checkin-goal").fill("Get the meal planner generating a full week");
  await page.getByTestId("input-checkin-proof").fill(
    "Shipped the generator and wired it to the fridge inventory screen",
  );
  await page.getByTestId("input-checkin-next").fill("Add a shopping list export");
  await page.getByTestId("button-publish-checkin").click();

  // It exists, attached to this project, readable back through the API the
  // page itself uses.
  await expect.poll(async () => {
    const res = await page.request.get(`/api/projects/${projectId}/check-ins`);
    const body = await res.json();
    const rows = Array.isArray(body) ? body : body.checkIns ?? [];
    return rows.some((c: any) => c.goal === "Get the meal planner generating a full week");
  }, { timeout: 10_000 }).toBe(true);

  // And the composer is gone — the page moved on rather than sitting open.
  await expect(page.getByTestId("button-publish-checkin")).toBeHidden();
});

test("someone with no account opens a shared check-in and reads it", async ({ page, browser }) => {
  // Set up the artifact as a builder, entirely through the API: the browser
  // part of this journey is the stranger's.
  await signUp(page, "Sender");
  const project = await (await page.request.post("/api/projects", {
    data: {
      title: "Quiet Project",
      description: "Something worth a second pair of eyes.",
      category: "saas",
    },
  })).json();
  const checkIn = await (await page.request.post(`/api/projects/${project.id}/check-ins`, {
    data: {
      goal: "Decide whether the smaller version is the right one",
      proof: "Wrote up both versions and shipped the smaller one to three people",
      nextStep: "Ask those three what confused them",
      visibility: "public",
      needsFeedback: true,
    },
  })).json();
  expect(checkIn.id).toBeTruthy();

  // A fresh context: no cookies, no account, just a link somebody sent them.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  try {
    await strangerPage.goto(`/c/${checkIn.id}`);
    await expect(strangerPage.getByTestId("text-goal")).toHaveText(
      "Decide whether the smaller version is the right one",
    );
    await expect(strangerPage.getByTestId("text-proof")).toContainText("shipped the smaller one");
    await expect(strangerPage.getByTestId("text-next-step")).toContainText("Ask those three");
    // The share control is there for them to pass it on.
    await expect(strangerPage.getByTestId("button-copy-link")).toBeVisible();
    // And nothing asked them to sign in to read it.
    expect(strangerPage.url()).toContain(`/c/${checkIn.id}`);
  } finally {
    await stranger.close();
  }
});
