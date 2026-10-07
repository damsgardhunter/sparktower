/**
 * What a stranger sees on a project's public page, and how they apply.
 *
 * Two things are being held here. The first is that the page does not publish
 * the project's internals: the tab bar used to read Overview, Updates,
 * Roadmap, Milestones, Team, Open Roles, Media, Discussion, Followers, and
 * four of those were the team's own working material shown to anybody who
 * wandered past. They live on the manage page now, which is why this checks
 * they are gone from here and still there for the owner.
 *
 * The second is the only thing on the page a stranger can act on. Applying
 * used to mean one Apply button for the project as a whole, so an owner with
 * three roles open could not tell which job an application was for. A role is
 * now the thing you press, it carries into the application, and the owner sees
 * it next to the applicant's name.
 */
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";
import { finishOnboarding } from "./onboarding";

test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.190" } });

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** The four tabs that moved to the manage page. */
const GONE = ["roadmap", "milestones", "team", "roles"];
/**
 * The five that are left. Media became the backer wall: the people who paid
 * for a project are more interesting to a visitor than its screenshots, and
 * the names were the one thing on the pledge panel nobody could reach without
 * opening the form that asks for money.
 */
const KEPT = ["overview", "updates", "backers", "discussion", "followers"];

test("the public page shows five tabs, and a role is what you apply to", async ({ page, browser }) => {
  test.setTimeout(180_000);

  // Mara owns the project and is recruiting for two roles.
  const maraCtx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.191" } });
  const mara = maraCtx.request;
  await mara.get("/");
  const maraEmail = `e2e-mara-${stamp()}@example.test`;
  expect((await mara.post("/api/auth/register", { data: { email: maraEmail, password, firstName: "Mara" } })).ok()).toBeTruthy();
  await verifyEmail(mara, maraEmail);
  await finishOnboarding(mara, { displayName: "Mara Okonkwo", headline: "Building a scheduling tool", bio: "Shipping in public." });

  const created = await mara.post("/api/projects", {
    data: {
      title: "Tempo", description: "A scheduling tool for people who run their own small studios.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
      rolesNeeded: ["iOS Engineer", "Product Designer"], teamSize: 3, estimatedWeeks: 12,
    },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).id as string;

  // One question, so the application has something to ask.
  const question = { id: crypto.randomUUID(), question: "What have you shipped on your own?", required: false };
  expect((await mara.patch(`/api/projects/${projectId}`, { data: { applicationQuestions: [question] } })).ok()).toBeTruthy();

  // Devi is a stranger who finds the project.
  await page.goto("/");
  const deviEmail = `e2e-devi-${stamp()}@example.test`;
  expect((await page.request.post("/api/auth/register", { data: { email: deviEmail, password, firstName: "Devi" } })).ok()).toBeTruthy();
  await verifyEmail(page.request, deviEmail);
  await finishOnboarding(page.request, { displayName: "Devi Raman", headline: "iOS, mostly", bio: "Looking for a team." });

  await page.goto(`/projects/${projectId}`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 4_000 }).catch(() => {});
  await expect(page.getByTestId("project-tab-overview")).toBeVisible({ timeout: 20_000 });

  // Five tabs, and the project's working material is not among them.
  for (const id of KEPT) await expect(page.getByTestId(`project-tab-${id}`)).toBeVisible();
  for (const id of GONE) await expect(page.getByTestId(`project-tab-${id}`)).toHaveCount(0);

  /*
   * And all five on one line, at any width.
   *
   * The row used to wrap, so on a narrow window "Followers 156" dropped
   * underneath and the five tabs became a two-line block whose height changed
   * as the counts arrived. It scales the type down instead. This is the only
   * place that can be checked — it needs a real browser, because the whole
   * mechanism is a measurement of laid-out text — and the assertion is
   * geometric rather than visual: every tab shares a top edge, and none of
   * them sticks out past the bar.
   */
  const bar = page.getByTestId("project-tab-bar");
  const measure = () => bar.evaluate((el) => {
    const tabs = [...el.querySelectorAll("[data-testid^='project-tab-']")];
    return {
      tops: tabs.map((t) => Math.round(t.getBoundingClientRect().top)),
      count: tabs.length,
      /* Rounded: sub-pixel layout differs by a fraction between platforms. */
      overflow: Math.round(el.scrollWidth - el.clientWidth),
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      /* Dropped before the row is allowed to scroll, so worth counting. */
      iconsShown: [...el.querySelectorAll("svg")].filter((i) => getComputedStyle(i).display !== "none").length,
    };
  });

  for (const width of [1280, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });

    /*
     * Polled, not measured once.
     *
     * The bar fits itself by measuring the row and then writing a font size
     * onto it, so there is a frame or two between a viewport change and the
     * answer — and reading inside that gap catches it mid-flight. It did
     * exactly that on CI: 14px with every icon still showing at 820 wide, and
     * 10.29px half way down at 320, both while still overflowing. Neither was
     * the component failing to fit; both were this test asking before it had.
     */
    await expect(async () => {
      const rows = await measure();
      const where = `${width}px: ${JSON.stringify(rows)}`;
      expect(rows.count, `five tabs at ${where}`).toBe(KEPT.length);
      /* The point of the whole thing: never two lines, at any width. */
      expect(new Set(rows.tops).size, `one line at ${where}`).toBe(1);
      /* Smaller when it has to be, never smaller than readable, never stretched. */
      expect(rows.fontSize, `font size at ${where}`).toBeGreaterThanOrEqual(8.9);
      expect(rows.fontSize, `font size at ${where}`).toBeLessThanOrEqual(14);

      /*
       * And it fits — unless it has already given up everything it has to
       * give. Below roughly 360 pixels the five labels and their counts need
       * more room than the screen has at the smallest readable size, so the
       * row scrolls sideways instead. That is the last resort and deliberately
       * the third thing tried, after shrinking the type and after dropping the
       * icons: a row scrolled half out of view needs the visitor to work out
       * that it scrolls, which is worse than small type and much worse than no
       * hearts.
       *
       * What this holds is that scrolling only happens once there is nothing
       * left to give — at the floor, with the icons already gone. It no longer
       * asserts *which* widths those are: that is a fact about font metrics,
       * and this suite runs on two platforms whose fonts are not the same
       * width. Pinning 360 here was a claim about one of them dressed up as a
       * claim about the component.
       */
      if (rows.overflow > 1) {
        expect(rows.fontSize, `only scrolls once the type is as small as it goes — ${where}`).toBeLessThanOrEqual(9);
        expect(rows.iconsShown, `and the icons were given up first — ${where}`).toBe(0);
      }
    }).toPass({ timeout: 15_000 });
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  /*
   * Open roles sit on the overview rather than behind a tab, because they are
   * the one thing here a visitor can do something about.
   */
  await expect(page.getByTestId("overview-open-roles")).toBeVisible();
  await expect(page.getByTestId("open-role-Product Designer")).toBeVisible();

  // Pressing a role opens the application for that role, carrying the question.
  await page.getByTestId("open-role-iOS Engineer").click();
  await expect(page.getByRole("heading", { name: "Apply as iOS Engineer" })).toBeVisible();
  await page.getByTestId(`input-question-${question.id}`).fill("A tiny habit app, on the App Store.");
  await page.getByTestId("textarea-apply-message").fill("I'd like the iOS seat.");
  await page.getByTestId("button-submit-application").click();
  await expect(page.getByTestId("button-submit-application")).toHaveCount(0, { timeout: 20_000 });

  /*
   * The point of recording the role: the owner is told which job it was for,
   * rather than being handed an application to the project in general.
   */
  const applications = await mara.get(`/api/projects/${projectId}/applications`);
  expect(applications.ok()).toBeTruthy();
  const [application] = await applications.json();
  expect(application.role).toBe("iOS Engineer");

  const ownerPage = await maraCtx.newPage();
  await ownerPage.goto(`/projects/${projectId}/manage?tab=team`);
  await ownerPage.getByTestId("btn-skip-onboarding").click({ timeout: 4_000 }).catch(() => {});
  await expect(ownerPage.getByTestId(`application-role-${application.id}`)).toHaveText("iOS Engineer", { timeout: 20_000 });

  await maraCtx.close();
});
