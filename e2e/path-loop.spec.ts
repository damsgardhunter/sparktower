/**
 * The product loop in a real browser: follow the path → do the next steps →
 * post the week's progress (the weekly update, which replaced check-ins) →
 * someone comments → the bell brings you to the post → the post takes you back
 * to your next step. API-level: test/integration/path-return.test.ts.
 */
import { test, expect, type Browser } from "./test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", { data: { email: `e2e-path-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Path" } })).ok()).toBeTruthy();
  // Accounts start unconfirmed; anything that reaches other people needs the emailed link (server/email-verification.ts).
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: `${first} Path`, headline: "Following the path", bio: "Here for the loop." } })).ok()).toBeTruthy();
  return { context, api };
}

test("a week of path steps becomes an update, its feedback comes back, and the post leads to the next step", async ({ browser }) => {
  const builder = await personIn(browser, "203.0.113.81", "Builder");
  const reader = await personIn(browser, "203.0.113.82", "Reader");
  const title = `Path Loop ${stamp()}`;
  const project = await (await builder.api.post("/api/projects", { data: { title, description: "A meal planner following the ship path.", category: "saas", goal: "ship_mvp", subcategory: "saas" } })).json();

  // Do the next steps on the path.
  const tasks = await (await builder.api.get(`/api/projects/${project.id}/kanban`)).json();
  for (const b of ["SHIP.M1.1", "SHIP.M1.3"]) {
    const t = tasks.find((x: any) => (x.tags ?? []).includes(`backbone:${b}`));
    expect((await builder.api.patch(`/api/kanban/${t.id}`, { data: { status: "done" } })).ok()).toBeTruthy();
  }

  // Home: the week's steps are offered as an update.
  const page = await builder.context.newPage();
  await page.goto("/");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await page.getByTestId(`button-weekly-update-${project.id}`).click();
  const dialog = page.getByTestId("weekly-update-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("weekly-update-steps")).toContainText("Product statement");
  await page.getByTestId("input-weekly-ask").fill("Is the scope too small?");
  await page.getByTestId("button-post-weekly").click();
  await expect(dialog).toHaveCount(0);
  const week = page.locator('[data-testid^="post-path-week-"]').first();
  await expect(week).toContainText("This week on the path: 2 steps");
  await expect(page.getByTestId(`button-weekly-update-${project.id}`)).toHaveCount(0);

  // Someone answers it.
  const feed = await (await builder.api.get(`/api/feed?projectId=${project.id}&limit=5`)).json();
  const update = feed.posts.find((p: any) => p.entityType === "path_week");
  expect((await reader.api.post(`/api/feed/${update.id}/comments`, { data: { content: "Scope looks right — ship it." } })).ok()).toBeTruthy();

  // The bell brings the builder to the post; the post takes them back to the next step.
  await page.goto("/");
  await expect(page.getByTestId("notifications-unread")).toBeVisible();
  await page.getByTestId("button-notifications").click();
  const note = page.getByTestId("notifications-panel").getByText("Reader Path commented on your post");
  await expect(note).toBeVisible();
  await note.click();
  await expect(page).toHaveURL(new RegExp(`/posts/${update.id}$`));
  await expect(page.getByText("Scope looks right — ship it.")).toBeVisible();
  const next = page.getByTestId("post-next-step");
  await expect(next).toContainText("Your next step:");
  const nextTitle = (await next.locator("span.font-medium").textContent())?.trim();
  await next.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/manage(\\?.*)?$`));
  await expect(page.getByTestId("next-action")).toContainText(nextTitle!);
});
