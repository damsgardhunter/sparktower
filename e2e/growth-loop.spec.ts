/**
 * The growth loop in a real browser: finish a path step → publish it as an
 * artifact → its public page previews properly and reads with no account →
 * a stranger signs up from it, choosing the same goal → its author hears →
 * the newcomer publishes their own. API-level: test/integration/path-artifacts.test.ts.
 */
import { test, expect, type Browser } from "@playwright/test";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", { data: { email: `e2e-growth-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Growth" } })).ok()).toBeTruthy();
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: `${first} Growth`, headline: "Building in public", bio: "Here for the loop." } })).ok()).toBeTruthy();
  return { context, api };
}

async function finishFirstStep(api: any, title: string, answer: string) {
  const project = await (await api.post("/api/projects", { data: { title, description: "A meal planner built in public.", category: "saas", goal: "ship_mvp", subcategory: "saas" } })).json();
  const tasks = await (await api.get(`/api/projects/${project.id}/kanban`)).json();
  const step = tasks.find((x: any) => (x.tags ?? []).includes("backbone:SHIP.M1.1"));
  expect((await api.patch(`/api/kanban/${step.id}`, { data: { status: "done", description: answer } })).ok()).toBeTruthy();
  return { project, step };
}

test("a published step brings a stranger in, and they publish their own", async ({ browser }) => {
  const author = await personIn(browser, "203.0.113.91", "Author");
  const { project } = await finishFirstStep(author.api, `Growth Loop ${stamp()}`, "Plan a week of dinners from what's already in your fridge.");

  // Publish from the path: generate, title, tags, publish.
  const page = await author.context.newPage();
  await page.goto(`/projects/${project.id}/manage`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 10_000 }).catch(() => {});
  await expect(page.getByTestId("nova-onboarding-overlay")).toHaveCount(0);
  await page.getByTestId("button-publish-finished-step").click();
  const dialog = page.getByTestId("publish-artifact-dialog");
  await expect(dialog.getByTestId("artifact-preview")).toContainText("fridge");
  await dialog.getByTestId("input-artifact-title").fill("Our one-line product statement");
  await dialog.getByTestId("input-artifact-tags").fill("positioning, meal planning");
  await dialog.getByTestId("button-publish-artifact").click();
  const url = await dialog.getByTestId("text-artifact-url").inputValue();
  expect(url).toMatch(/\/a\/[0-9a-f-]{36}$/);
  const path = new URL(url).pathname;

  // The page itself carries its title and preview tags, for link unfurls and search.
  const html = await (await author.api.get(path, { headers: { accept: "text/html" } })).text();
  expect(html).toContain("<title>Our one-line product statement");
  expect(html).toContain('property="og:title"');

  // A stranger, with no account, reads it and starts their own path.
  const strangerContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.92" } });
  const stranger = await strangerContext.newPage();
  await stranger.goto(path);
  await expect(stranger.getByTestId("text-artifact-title")).toHaveText("Our one-line product statement");
  await expect(stranger.getByTestId("artifact-project")).toContainText(project.title);
  await expect(stranger.getByTestId("button-explore-project-path")).toBeVisible();
  await stranger.getByTestId("button-start-own-path").click();
  await expect(stranger).toHaveURL(/\?signup=1&artifact=[0-9a-f-]{36}$/);
  expect(await stranger.evaluate(() => localStorage.getItem("st_pending_path"))).toContain("ship_mvp");
  await stranger.getByTestId("input-signup-firstname").fill("Newcomer");
  await stranger.getByTestId("input-signup-lastname").fill("Growth");
  await stranger.getByTestId("input-signup-email").fill(`e2e-growth-newcomer-${stamp()}@example.test`);
  await stranger.getByTestId("input-signup-password").fill(password);
  await stranger.getByTestId("input-signup-confirm").fill(password);
  await stranger.getByTestId("button-submit-signup").click();
  await expect(stranger).toHaveURL(/\/onboarding/);

  // Its author hears about it.
  await expect.poll(async () => {
    const bell = await (await author.api.get("/api/notifications")).json();
    return bell.items.some((x: any) => x.kind === "artifact_signup" && x.text === "Newcomer Growth joined SparkTower from your artifact");
  }).toBe(true);

  // The newcomer finishes their first step and publishes their own.
  const api = strangerContext.request;
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: "Newcomer Growth", headline: "New here", bio: "Came from an artifact." } })).ok()).toBeTruthy();
  const theirs = await finishFirstStep(api, `Newcomer ${stamp()}`, "Budget trips for students.");
  const artifact = await (await api.post(`/api/projects/${theirs.project.id}/path/tasks/${theirs.step.id}/artifact`)).json();
  const published = await (await api.post(`/api/artifacts/${artifact.id}/publish`, { data: { title: "My first product statement" } })).json();
  await stranger.goto(published.url);
  await expect(stranger.getByTestId("text-artifact-title")).toHaveText("My first product statement");
});
