/**
 * Connecting an editor, in a browser.
 *
 * The reason this is a browser test rather than an API one: the whole point of
 * the work was that the token was findable. It existed behind a tab on the
 * profile that nobody would think to open, so it moved to the top of the
 * dashboard — and "is it on the screen someone actually looks at" is a
 * question only a real page can answer.
 *
 * The second thing it pins down is the moment the token is shown. It is shown
 * once, and if that dialog ever renders without it, the feature is silently
 * broken in the only way that costs someone their credential.
 */
import { test, expect, type Page } from "@playwright/test";

const password = "Testpass123!";

/** An account and a project, through the API — none of that is what's under test here. */
async function projectFor(page: Page): Promise<string> {
  await page.goto("/");
  const email = `e2e-editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  expect((await page.request.post("/api/auth/register", { data: { email, password, firstName: "Casey", lastName: "Builder" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: "Casey Builder", headline: "Shipping weekly", bio: "Here for the loop." },
  })).ok()).toBeTruthy();

  const created = await page.request.post("/api/projects", {
    data: {
      title: "Weeknight Recipes", description: "A small app that plans a week of dinners from what is already in the fridge.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    },
  });
  expect(created.ok()).toBeTruthy();
  return (await created.json()).id;
}

test("the dashboard offers an editor connection, and shows the token once", async ({ page }) => {
  const projectId = await projectFor(page);

  await page.goto(`/projects/${projectId}/manage`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 10_000 }).catch(() => {});

  // Above the path, on the screen the builder lands on — not behind a tab.
  const card = page.getByTestId("card-connect-editor");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Work on this project in your editor");

  await page.getByTestId("button-connect-editor").click();
  const label = page.getByTestId("input-token-label");
  await expect(label).toBeVisible();
  await label.fill("MacBook · VS Code");
  await expect(label).toHaveValue("MacBook · VS Code");

  /*
   * The pin defaults to this project. A token made from a project's dashboard
   * and left reachable across the whole account is the security default this
   * screen exists to get right.
   */
  await expect(page.getByTestId("select-token-project")).toContainText("Weeknight Recipes");

  await page.getByTestId("button-confirm-token").click();

  const token = page.getByTestId("text-new-token");
  await expect(token).toBeVisible();
  await expect(token).toContainText(/^nova_pat_/);
  // Read it now: after the dialog closes there is nowhere left to get it from,
  // which is the property being tested.
  const secret = (await token.textContent())!.trim();

  /*
   * Both ways in, and both carrying this server's address. The extension ships
   * with a default that is a guess about a deployment, so a token handed over
   * without the URL fails against a host the person has never heard of — which
   * is exactly what happened the first time someone used it.
   */
  await expect(page.getByTestId("tab-connect-vscode")).toBeVisible();
  // `asChild` merges the button onto the anchor, so the test id is on the link itself.
  const deepLink = await page.getByTestId("button-open-vscode").getAttribute("href");
  expect(deepLink).toContain("vscode://sparktower.nova-sparktower/connect");
  expect(deepLink).toContain(`url=${encodeURIComponent(page.url().replace(/\/projects.*$/, ""))}`);
  expect(deepLink).toContain(encodeURIComponent(secret));

  await page.getByText("Or do it by hand").click();
  await expect(page.getByTestId("text-server-url")).toHaveText(new URL(page.url()).origin);

  await page.getByTestId("tab-connect-agent").click();
  await expect(page.getByText("@sparktower/nova-mcp")).toBeVisible();
  await expect(page.getByText("NOVA_BASE_URL")).toBeVisible();

  await page.getByTestId("button-done-token").click();

  /*
   * And it goes quiet. The card is an invitation; once it's been accepted,
   * leaving it shouting is how people learn to stop seeing it.
   */
  await expect(page.getByTestId("editor-connected")).toBeVisible();
  await expect(page.getByTestId("card-connect-editor")).toHaveCount(0);

  // The profile still lists it, with a prefix rather than the token.
  await page.goto("/profile#editor");
  await expect(page.getByTestId("card-editor-access")).toBeVisible();
  const list = page.getByTestId("list-tokens");
  await expect(list).toContainText("MacBook · VS Code");
  await expect(list).toContainText("Weeknight Recipes only");
  await expect(list).toContainText("never used");
  await expect(list).not.toContainText(secret);
});
