/**
 * The footer, in a browser.
 *
 * Three things live here and only one of them is interesting. The report
 * button and the careers link either navigate or they do not. The language
 * switch is the one worth a real page: it asks before it changes anything,
 * the question has to be readable in *both* languages at once, and the words
 * on the screen have to actually change afterwards — which is the whole
 * difference between a translation layer and a setting nobody reads.
 *
 * Signed out on purpose. Somebody looking for a job does not have an account,
 * and somebody who cannot sign in is exactly the person who needs the report
 * button — so both have to work before anybody logs in.
 */
import { test, expect } from "./test";

/* This spec's own address, so it does not spend another spec's sign-in budget. */
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.191" } });

test.describe("the footer", () => {
  test("switches language, but asks first and says what it will change", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByTestId("footer-site");
    await expect(footer).toBeVisible();

    // It opens in English, named the way English names itself.
    await expect(page.getByTestId("button-language")).toHaveText(/English/);

    await page.getByTestId("button-language").click();
    await page.getByTestId("language-es").click();

    /*
     * The question, in both languages at once. Somebody who picked the wrong
     * row is about to lose the language they can read, so the way out is
     * named in the one they are leaving and the way on in the one they chose.
     */
    const dialog = page.getByTestId("dialog-confirm-language");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Español");
    await expect(page.getByTestId("button-language-cancel")).toHaveText(/English/);

    // Backing out changes nothing at all.
    await page.getByTestId("button-language-cancel").click();
    await expect(page.getByTestId("button-language")).toHaveText(/English/);

    // Going through changes the words on the screen, not just a setting.
    await page.getByTestId("button-language").click();
    await page.getByTestId("language-es").click();
    await page.getByTestId("button-language-confirm").click();

    await expect(page.getByTestId("button-language")).toHaveText(/Español/);
    await expect(page.getByTestId("link-careers")).toHaveText(/Empleo/);
    await expect(page.getByTestId("button-report-problem")).toContainText("problema");
    // And it says how much of the product is actually translated.
    await expect(page.getByTestId("text-translation-note")).toBeVisible();

    // The document's own language moves with it, which is what a screen reader reads.
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
  });

  test("remembers the language across a reload", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("button-language").click();
    await page.getByTestId("language-fr").click();
    await page.getByTestId("button-language-confirm").click();
    await expect(page.getByTestId("button-language")).toHaveText(/Français/);

    await page.reload();
    await expect(page.getByTestId("button-language")).toHaveText(/Français/);
    await expect(page.getByTestId("link-careers")).toHaveText(/Carrières/);
  });

  /* Arabic lays the page out the other way round, which is not decoration. */
  test("turns the page around for a right-to-left language", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("button-language").click();
    await page.getByTestId("language-ar").click();
    await page.getByTestId("button-language-confirm").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("offers all ten languages, and does not offer to switch to the one in use", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("button-language").click();
    for (const code of ["en", "es", "zh", "hi", "ar", "pt", "fr", "de", "ja", "ru"]) {
      await expect(page.getByTestId(`language-${code}`)).toBeVisible();
    }
    // English is already in use: choosing it asks nothing.
    await page.getByTestId("language-en").click();
    await expect(page.getByTestId("dialog-confirm-language")).toHaveCount(0);
  });

  test("takes somebody with no account to the careers page, and says there are none", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("link-careers").click();
    await expect(page).toHaveURL(/\/careers$/);
    await expect(page.getByTestId("text-no-jobs")).toHaveText(/No jobs available/i);
    // The apply button exists and leads somewhere real rather than a dead form.
    await page.getByTestId("button-apply").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("opens the report box from the footer", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("button-report-problem").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
