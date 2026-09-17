/**
 * The growth loop in a real browser: finish a path step → publish it as an
 * artifact → its public page previews properly and reads with no account →
 * a stranger signs up from it, choosing the same goal → its author hears →
 * the newcomer, through onboarding and project create on that goal, finishes
 * their first step and publishes their own. API-level: test/integration/path-artifacts.test.ts.
 */
import { test, expect, type Browser } from "@playwright/test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", { data: { email: `e2e-growth-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Growth" } })).ok()).toBeTruthy();
  // Accounts start unconfirmed; anything that reaches other people needs the emailed link (server/email-verification.ts).
  await verifyEmail(api);
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
  expect(html).toMatch(/<link rel="canonical" href="[^"]*\/a\/[^"]+" \/>/);
  /*
   * And what it says to a reader that doesn't run JavaScript: the app renders
   * into an empty root, so without this copy the page would be a title and
   * nothing else to a crawler, a reader mode or a text browser.
   */
  expect(html).toContain("<noscript>");
  expect(html).toContain("fridge");
  expect(html).toContain(`<a href="/projects/${project.id}">`);

  // And the crawler is told the page exists at all.
  const robots = await (await author.api.get("/robots.txt")).text();
  expect(robots).toContain("User-agent: *");
  const sitemap = await (await author.api.get("/sitemap.xml")).text();
  expect(sitemap).toContain(`<loc>`);

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
  const newcomerEmail = `e2e-growth-newcomer-${stamp()}@example.test`;
  await stranger.getByTestId("input-signup-email").fill(newcomerEmail);
  await stranger.getByTestId("input-signup-password").fill(password);
  await stranger.getByTestId("input-signup-confirm").fill(password);
  await stranger.getByTestId("button-submit-signup").click();
  /*
   * Longer than the 5s default, like the other redirects in this file.
   *
   * Registering hashes a password, writes the account and sends the
   * confirmation mail before the client is told to move; on a loaded CI runner
   * that had been creeping past five seconds, and the failure looked like
   * "signup is broken" rather than "the wait was too short".
   */
  await expect(stranger).toHaveURL(/\/onboarding/, { timeout: 15_000 });

  /*
   * The newcomer confirms their address, as they would from their inbox.
   *
   * Everyone else in this file is created through `personIn`, which confirms;
   * this one signs up through the form, and nothing did it for them. It only
   * shows up at the very end: publishing writes a feed post, and an
   * unconfirmed account may not write anything that reaches other people
   * (server/email-verification.ts), so the publish was silently refused and
   * the dialog simply never advanced to showing a URL.
   */
  await verifyEmail(stranger.request, newcomerEmail);

  // Its author hears about it.
  await expect.poll(async () => {
    const bell = await (await author.api.get("/api/notifications")).json();
    return bell.items.some((x: any) => x.kind === "artifact_signup" && x.text === "Newcomer Growth joined SparkTower from your artifact");
  }).toBe(true);

  /*
   * The newcomer, in the browser the whole way: onboarding sends them into
   * project create with the artifact's goal chosen; the goal survives a reload;
   * the project lands on its path; they write their first step themselves and
   * publish it — the same loop that brought them in.
   */
  await stranger.getByTestId("input-display-name").fill("Newcomer Growth");
  await stranger.getByTestId("input-headline").fill("New here");
  await stranger.getByTestId("input-bio").fill("Came from an artifact.");
  await stranger.getByTestId("input-location").fill("Lisbon");
  for (let i = 0; i < 7; i++) await stranger.getByTestId("button-next").click();
  await stranger.getByTestId("button-submit-onboarding").click();
  await expect(stranger).toHaveURL(/\/projects\/new\/create\?step=setup$/, { timeout: 15_000 });

  await stranger.getByTestId("input-project-title").fill(`Student Trips ${stamp()}`);
  await stranger.getByTestId("textarea-project-description").fill("Budget trips for students, planned around term dates.");
  await stranger.getByTestId("button-next").click();
  await expect(stranger).toHaveURL(/step=goal/);
  await expect(stranger.getByTestId("goal-ship_mvp")).toHaveAttribute("aria-pressed", "true");
  // Still chosen after a reload: the choice is kept until the project exists.
  await stranger.reload();
  await expect(stranger.getByTestId("goal-ship_mvp")).toHaveAttribute("aria-pressed", "true");
  expect(await stranger.evaluate(() => localStorage.getItem("st_pending_path"))).toContain("ship_mvp");
  await stranger.getByTestId("button-next").click();
  await stranger.getByTestId("subcategory-saas").click();
  await stranger.getByTestId("button-next").click();
  await stranger.getByTestId("button-create-project").click();

  // On its path, at the first step, with the choice spent.
  await expect(stranger).toHaveURL(/\/projects\/[0-9a-f-]{36}\/manage\?section=ship_mvp(&|$)/, { timeout: 15_000 });
  expect(await stranger.evaluate(() => localStorage.getItem("st_pending_path"))).toBeNull();
  await stranger.getByTestId("btn-skip-onboarding").click({ timeout: 10_000 }).catch(() => {});
  await expect(stranger.getByTestId("nova-onboarding-overlay")).toHaveCount(0);
  await expect(stranger.getByTestId("next-action-title")).toHaveText("Product statement");
  await stranger.getByTestId("button-next-write").click();
  await stranger.getByTestId("input-next-answer").fill("Weekend trips students can afford, planned around their exams.");
  await stranger.getByTestId("button-next-save-done").click();
  await expect(stranger.getByTestId("path-last-done")).toContainText("Product statement");

  await stranger.getByTestId("button-publish-finished-step").click();
  const theirs = stranger.getByTestId("publish-artifact-dialog");
  await expect(theirs.getByTestId("artifact-preview")).toContainText("students can afford");
  await theirs.getByTestId("input-artifact-title").fill("My first product statement");
  await theirs.getByTestId("input-artifact-tags").fill("travel, students");
  await theirs.getByTestId("button-publish-artifact").click();
  const theirUrl = await theirs.getByTestId("text-artifact-url").inputValue();
  expect(theirUrl).toMatch(/\/a\/[0-9a-f-]{36}$/);

  // Public, with no account, and on the feed.
  const outsider = await browser.newContext();
  const reader = await outsider.newPage();
  await reader.goto(new URL(theirUrl).pathname);
  await expect(reader.getByTestId("text-artifact-title")).toHaveText("My first product statement");
  const feed = await (await strangerContext.request.get("/api/feed?limit=10")).json();
  expect(feed.posts.some((p: any) => String(p.content ?? "").includes("My first product statement") || p.entityType === "path_artifact")).toBe(true);
  await Promise.all([outsider.close(), strangerContext.close(), author.context.close()]);
});
