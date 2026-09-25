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

test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.190" } });

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** The four tabs that moved to the manage page. */
const GONE = ["roadmap", "milestones", "team", "roles"];
/** The five that are left. */
const KEPT = ["overview", "updates", "media", "discussion", "followers"];

test("the public page shows five tabs, and a role is what you apply to", async ({ page, browser }) => {
  test.setTimeout(180_000);

  // Mara owns the project and is recruiting for two roles.
  const maraCtx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.191" } });
  const mara = maraCtx.request;
  await mara.get("/");
  const maraEmail = `e2e-mara-${stamp()}@example.test`;
  expect((await mara.post("/api/auth/register", { data: { email: maraEmail, password, firstName: "Mara" } })).ok()).toBeTruthy();
  await verifyEmail(mara, maraEmail);
  expect((await mara.post("/api/profile/complete-onboarding", {
    data: { displayName: "Mara Okonkwo", headline: "Building a scheduling tool", bio: "Shipping in public." },
  })).ok()).toBeTruthy();

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
  expect((await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: "Devi Raman", headline: "iOS, mostly", bio: "Looking for a team." },
  })).ok()).toBeTruthy();

  await page.goto(`/projects/${projectId}`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 4_000 }).catch(() => {});
  await expect(page.getByTestId("project-tab-overview")).toBeVisible({ timeout: 20_000 });

  // Five tabs, and the project's working material is not among them.
  for (const id of KEPT) await expect(page.getByTestId(`project-tab-${id}`)).toBeVisible();
  for (const id of GONE) await expect(page.getByTestId(`project-tab-${id}`)).toHaveCount(0);

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
