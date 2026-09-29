/**
 * The Simulations page: two games, one door each, and the one-a-day rule.
 *
 * What is worth driving in a browser here is the thing no server test can
 * see — that the button never offers something the server is about to refuse.
 * The daily limit is enforced in two places and surfaced in a third, and the
 * failure that would actually annoy somebody is the screen saying "Play now"
 * on a day they have already played: they have decided to spend half an hour
 * by the time they find out.
 *
 * The rest is reachability, which this product has got wrong before: the whole
 * market simulation was once built, finished and linked from nowhere.
 */
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function member(browser: any, ip: string, name: string) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = ctx.request;
  await api.get("/");
  const email = `e2e-sim-${stamp()}@example.test`;
  const me = await (await api.post("/api/auth/register", { data: { email, password, firstName: name } })).json();
  await verifyEmail(api, email);
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: name, headline: "x", bio: "y" } })).ok()).toBeTruthy();
  return { ctx, api, email, id: me.id as string };
}

test("both games are on one page, and the menu calls it Simulations", async ({ browser }) => {
  test.setTimeout(120_000);
  const them = await member(browser, "203.0.113.240", "Sid");
  const page = await them.ctx.newPage();

  await page.goto("/sprints");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});

  // The page is named for what is on it, not for a feature that was retired.
  await expect(page.getByTestId("text-sprints-title")).toHaveText("Simulations");

  // Both doors, on the one screen.
  await expect(page.getByTestId("button-start-game")).toBeVisible();
  await expect(page.getByTestId("card-simulation-entry")).toBeVisible();
  await expect(page.getByTestId("button-open-simulation")).toBeVisible();

  // And the rule is stated before anybody meets it.
  await expect(page.getByTestId("badge-once-a-day")).toBeVisible();

  await them.ctx.close();
});

test("the day's game is offered once, and afterwards the button says so", async ({ browser }) => {
  test.setTimeout(180_000);
  const them = await member(browser, "203.0.113.241", "Sonia");
  const page = await them.ctx.newPage();

  await page.goto("/sprints");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(page.getByTestId("button-start-game")).toBeEnabled();

  // Play it — which lands them in the game.
  await page.getByTestId("button-start-game").click();
  await expect(page).toHaveURL(/\/sprints\/game\//, { timeout: 30_000 });

  /*
   * End it behind their back, the way finishing it would. The point of the
   * test is the *next* visit to the page, not the half hour in between.
   */
  const active = await (await them.api.get("/api/games/active")).json();
  expect(active.games.length, "they are in a game").toBe(1);
  expect(active.daily.canStart, "and have used the day").toBe(false);
  expect((await them.api.post(`/api/games/${active.games[0].id}/leave`, { data: {} })).ok()).toBeTruthy();

  // Back on the page: no game in progress, and no game available either.
  await page.goto("/sprints");
  await expect(page.getByTestId("button-start-game")).toBeDisabled({ timeout: 20_000 });
  await expect(page.getByTestId("button-start-game")).toContainText("Played today");
  // And it says when, rather than leaving them to guess.
  await expect(page.getByTestId("text-play-again")).toContainText(/opens/i);

  // The server agrees with the screen.
  const refused = await them.api.post("/api/games/solo", { data: {} });
  expect(refused.status()).toBe(429);
  expect((await refused.json()).code).toBe("played_today");

  await them.ctx.close();
});
