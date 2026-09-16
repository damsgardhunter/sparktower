/**
 * The wedge, in a browser.
 *
 * Two journeys. The builder's: sign up, make a project, post the first
 * update about it. The receiver's: someone with no account opens a step the
 * builder shared and reads it. Between them that is the whole product; if
 * both pass, most things do.
 *
 * Onboarding is completed through the API rather than clicked through. It is
 * seven steps of profile detail that have nothing to do with the wedge, and a
 * smoke test that spends most of its time on skill tags is a smoke test that
 * fails for reasons nobody cares about. Every step that *is* the wedge is a
 * real click in a real browser.
 */
import { test, expect, type Page } from "@playwright/test";
import { verifyEmail } from "./verify-email";

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

  // Signing up through the form leaves the address unconfirmed, and posting needs it (server/email-verification.ts).
  await verifyEmail(page.request, email);

  // Same cookie jar as the page, so this is the signed-in user completing it.
  const done = await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Builder`, headline: "Shipping weekly", bio: "Here for the loop." },
  });
  expect(done.ok()).toBeTruthy();
  return email;
}

test("a new builder signs up, creates a project, and posts the first update", async ({ page }) => {
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
  await page.getByTestId("button-next").click();
  await expect(page).toHaveURL(/step=goal/);

  // Which path this project is on — required, and a real choice.
  await page.getByTestId("goal-ship_mvp").click();
  await page.getByTestId("button-next").click();
  await expect(page).toHaveURL(/step=subcategory/);
  await page.getByTestId("subcategory-saas").click();

  // Back, then forward again: the URL carries the step, the draft carries the
  // answers, and neither is lost by moving around.
  await page.goBack();
  await expect(page).toHaveURL(/step=goal/);
  await expect(page.getByTestId("goal-ship_mvp")).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await expect(page).toHaveURL(/step=subcategory/);
  await expect(page.getByTestId("subcategory-saas")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("button-next").click();
  await expect(page).toHaveURL(/step=review/);
  await expect(page.getByTestId("project-review")).toContainText("Weeknight Recipes");
  await page.getByTestId("button-create-project").click();
  // Creating a project lands on its manage page.
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}\/manage/, { timeout: 15_000 });
  const projectId = page.url().match(/\/projects\/([0-9a-f-]{36})/)![1];

  /*
   * The project is born with its path. Nova's screen leads with where you are
   * and the one next action; the structure sits in the rail on the right.
   * Marking the first action done moves the step, on the same screen.
   */
  // A brand-new account meets Nova's first-run overlay here; skip it.
  // It arrives after its own request, so give it a moment rather than racing it.
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 10_000 }).catch(() => {});
  await expect(page.getByTestId("nova-onboarding-overlay")).toBeHidden();
  await expect(page.getByTestId("manager-rail")).toBeVisible();
  await expect(page.getByTestId("path-phase")).toContainText("Week 1");
  await expect(page.getByTestId("next-action-title")).toHaveText("Product statement");
  await page.getByTestId("button-next-done").click();
  await expect(page.getByTestId("next-action-title")).toHaveText("The core loops");
  // Any step in the map opens in place, and says how it got done.
  await page.getByTestId("button-toggle-path").click();
  await page.getByTestId("open-SHIP.M1.1").click();
  await expect(page.getByTestId("milestone-detail")).toContainText("Done");
  await expect(page.getByTestId("milestone-detail")).toContainText("Nova drafts it");
  // The Codebase tab renders before any audit exists — it once crashed on that.
  await page.getByTestId("rail-codebase").click();
  await expect(page.getByTestId("input-repo-url")).toBeVisible();

  /*
   * The first update, from the composer at the top of the home feed: pick the
   * kind of post, say what shipped, and put it on this project.
   */
  const content = `Shipped the meal planner's week generator ${Date.now()}`;
  await page.goto("/");
  await page.getByTestId("button-quick-project_update").click();
  await page.getByTestId("textarea-post-content").fill(content);
  await page.getByTestId("select-post-project").click();
  await page.getByRole("option", { name: "Weeknight Recipes" }).click();
  await page.getByTestId("button-publish-post").click();

  // It exists, attached to this project, readable back through the API the
  // page itself uses.
  await expect.poll(async () => {
    const res = await page.request.get(`/api/feed?projectId=${projectId}`);
    const body = await res.json();
    return (body.posts ?? []).some((p: any) => p.content === content && p.postType === "project_update");
  }, { timeout: 10_000 }).toBe(true);

  // And the composer closed — the page moved on rather than sitting open.
  await expect(page.getByTestId("card-composer")).toBeHidden();
});

test("someone with no account opens a shared step and reads it", async ({ page, browser }) => {
  // Set up the artifact as a builder, entirely through the API: the browser
  // part of this journey is the stranger's.
  await signUp(page, "Sender");
  const project = await (await page.request.post("/api/projects", {
    data: {
      title: "Quiet Project",
      description: "Something worth a second pair of eyes.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    },
  })).json();
  const tasks = await (await page.request.get(`/api/projects/${project.id}/kanban`)).json();
  const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
  expect((await page.request.patch(`/api/kanban/${step.id}`, {
    data: { status: "done", description: "Plan a week of dinners from what's already in your fridge." },
  })).ok()).toBeTruthy();
  const artifact = await (await page.request.post(`/api/projects/${project.id}/path/tasks/${step.id}/artifact`)).json();
  expect(artifact.id).toBeTruthy();
  const published = await page.request.post(`/api/artifacts/${artifact.id}/publish`, {
    data: { title: "The one-line product statement", asks: ["Is it clear who it's for?"] },
  });
  expect(published.ok()).toBeTruthy();
  const { url } = await published.json();

  // A fresh context: no cookies, no account, just a link somebody sent them.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  try {
    await strangerPage.goto(url);
    await expect(strangerPage.getByTestId("text-artifact-title")).toHaveText("The one-line product statement");
    await expect(strangerPage.getByTestId("text-artifact-body")).toContainText("fridge");
    await expect(strangerPage.getByTestId("artifact-project")).toContainText("Quiet Project");
    // The share control is there for them to pass it on.
    await expect(strangerPage.getByTestId("button-copy-artifact-link")).toBeVisible();
    // And nothing asked them to sign in to read it.
    expect(strangerPage.url()).toContain(url);
  } finally {
    await stranger.close();
  }
});
