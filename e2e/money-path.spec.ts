/**
 * The money path's first steps in a real browser: a new restaurant opens on
 * "where you stand", answered by tapping bubbles; saving moves the path on; the
 * raise question takes "I don't know"; and the next step is Nova building the
 * plan. Stops before Nova runs — there's no model here.
 *
 * These questions used to be asked in a full-screen Nova welcome that opened
 * over the project, rendering a second copy of the very form the dashboard was
 * already showing behind it. The overlay is gone and the step is answered
 * where it lives, so this drives the path's own card.
 */
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("a founder answers the money questions by tapping, and Nova's plan is next", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.187" } });
  const page = await context.newPage();
  await page.goto("/");
  expect((await page.request.post("/api/auth/register", { data: { email: `e2e-money-${stamp()}@example.test`, password, firstName: "Mo", lastName: "Money" } })).ok()).toBeTruthy();
  // Accounts start unconfirmed; anything that reaches other people needs the emailed link (server/email-verification.ts).
  await verifyEmail(page.request);
  expect((await page.request.post("/api/profile/complete-onboarding", { data: { displayName: "Mo Money", headline: "Opening a bistro", bio: "Starting from zero." } })).ok()).toBeTruthy();
  const project = await page.request.post("/api/projects", {
    data: { title: "Corner Bistro", description: "A neighbourhood bistro, starting from nothing but a plan.", category: "food", goal: "systemize_business", subcategory: "restaurant" },
  });
  expect(project.ok()).toBeTruthy();
  const projectId = (await project.json()).id as string;

  // The path opens with money: the first step asks where you stand, as bubbles.
  await page.goto(`/projects/${projectId}/manage`);
  const welcome = page.getByTestId("next-action");
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText("$0");
  await expect(welcome.getByTestId("intake-form")).toBeVisible();
  // One copy of the form, on the step it belongs to.
  await expect(page.getByTestId("intake-form")).toHaveCount(1);

  // Save stays off until every required question has an answer.
  const save = welcome.getByTestId("button-intake-save");
  await expect(save).toBeDisabled();
  await welcome.getByTestId("intake-cash-zero").click();
  await expect(welcome.getByTestId("intake-cash-zero")).toHaveAttribute("aria-pressed", "true");
  // A single-choice question swaps its answer rather than adding one.
  await welcome.getByTestId("intake-monthly-none").click();
  await welcome.getByTestId("intake-monthly-under_250").click();
  await expect(welcome.getByTestId("intake-monthly-none")).toHaveAttribute("aria-pressed", "false");
  await welcome.getByTestId("intake-credit-unknown").click();
  await welcome.getByTestId("intake-situation-starting").click();
  await expect(save).toBeDisabled();
  await welcome.getByTestId("intake-experience-none").click();
  // The optional, pick-any question takes more than one.
  await welcome.getByTestId("intake-assets-family").click();
  await welcome.getByTestId("intake-assets-equipment").click();
  await expect(welcome.getByTestId("intake-assets-family")).toHaveAttribute("aria-pressed", "true");
  await expect(save).toBeEnabled();
  await save.click();

  // Nothing ever covers the project: the answers land on the path in place.
  await expect(page.getByTestId("nova-onboarding-overlay")).toHaveCount(0);

  // The next step is the raise, and "I don't know" is an answer.
  await expect(page.getByTestId("intake-q-raise")).toBeVisible();
  await page.getByTestId("intake-raise-unknown").click();
  await page.getByTestId("intake-when-6_12").click();
  await page.getByTestId("button-intake-save").click();

  // Then Nova builds the startup-cost plan from those answers.
  await expect(page.getByText("Startup costs and the raise").first()).toBeVisible();
  await expect(page.getByTestId("button-work")).toHaveText(/Have Nova build this plan/);

  // What was tapped is what's saved.
  const tasks = (await (await page.request.get(`/api/projects/${projectId}/kanban`)).json()) as any[];
  const stand = tasks.find((t) => t.tags?.includes("backbone:SYS.F1.1"));
  expect(stand.status).toBe("done");
  expect(stand.description).toContain("$0 — starting from nothing");
  expect(stand.description).toContain("Family who might help, Equipment or vehicles I own");

  await context.close();
});
