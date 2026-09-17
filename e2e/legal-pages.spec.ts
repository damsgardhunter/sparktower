/**
 * The privacy policy and terms, reachable by someone with no account.
 *
 * Both app stores refuse a first submission without a privacy policy URL a
 * reviewer can open signed out (Apple's guideline 5.1.1(i), Google's Data
 * safety form), and Apple additionally requires the link inside the app. So
 * these two addresses are a release dependency, not a nicety.
 *
 * There is a second reason this is an end-to-end test rather than a unit one.
 * Twice now, client/src/App.tsx has been overwritten in the working tree by an
 * older copy, silently removing routes that were already committed — once the
 * password reset pages, once this. A test that renders the real page through
 * the real router is what notices.
 */
import { test, expect } from "@playwright/test";

for (const { path, heading } of [
  { path: "/privacy", heading: /privacy policy/i },
  { path: "/terms", heading: /terms of service/i },
]) {
  test(`${path} opens with no account and says what it is`, async ({ page }) => {
    // A fresh context, i.e. exactly what a store reviewer has.
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);

    // Not the landing page wearing a different address: before these routes
    // existed, /privacy rendered the marketing page and returned 200, which is
    // the failure a status-code check would have missed.
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    const words = (await page.locator("body").innerText()).split(/\s+/).length;
    expect(words, "a policy this short isn't one").toBeGreaterThan(200);
  });
}

test("the privacy policy names what it must", async ({ page }) => {
  await page.goto("/privacy");
  const text = await page.locator("body").innerText();

  // Apple 5.1.1(i) asks for three things by name: what is collected, who else
  // gets it, and how to have it deleted.
  expect(text).toMatch(/what we collect/i);
  expect(text).toMatch(/who else receives it/i);
  expect(text).toMatch(/delet/i);

  /*
   * And the disclosure that is easiest to leave out and worst to omit: text a
   * person types into an AI feature leaves this system for a third party.
   */
  expect(text, "the AI disclosure is missing").toMatch(/OpenAI/);
});

test("the landing page links to both, where people look", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("link-footer-privacy")).toBeVisible();
  await page.getByTestId("link-footer-privacy").click();
  await expect(page).toHaveURL(/\/privacy$/);
});
