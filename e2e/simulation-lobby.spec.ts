/**
 * Five people, five seats, one browser each.
 *
 * The lobby is where this feature's real bugs have lived, and all three of them
 * were concurrency: five simultaneous joins scattered across three rooms, a
 * room that showed "6/5", and a lost race for the chief executive's chair that
 * came back as a server error instead of "somebody was quicker". Every one was
 * found by driving real browsers and missed by tests that acted in order.
 *
 * So this drives real browsers, and the claim is deliberately a race: two
 * people reach for the same seat in the same moment, and exactly one gets it
 * while the other is told who beat them.
 *
 * API-level: test/integration/sim-lobby.test.ts.
 */
import { test, expect, type Browser } from "./test";
import { verifyEmail } from "./verify-email";
import { clearStrayLobbies, sql } from "./sim-lobbies";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** The market this spec plays in. One per spec, so two specs never share a season. */
const NICHE = "dating_apps";

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", {
    data: { email: `e2e-sim-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Sim" },
  })).ok()).toBeTruthy();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Sim`, headline: "Running a company", bio: "Here for the simulation." },
  })).ok()).toBeTruthy();
  return { context, api };
}

test("five people fill a room, race for the same chair, and come out with a company", async ({ browser }) => {
  test.setTimeout(180_000);

  const names = ["Ada", "Brin", "Cleo", "Dara", "Emil"];
  const people = [];
  for (const [i, name] of names.entries()) {
    people.push(await personIn(browser, `203.0.117.${40 + i}`, name));
  }

  // An empty market, so "waiting for 4" is about these five — see e2e/sim-lobbies.ts.
  await clearStrayLobbies(NICHE);

  // The first joins through the screen, so the market list is exercised too.
  const first = await people[0].context.newPage();
  await first.goto("/simulation");
  await first.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(first.getByTestId(`niche-${NICHE}`)).toBeVisible();
  await first.getByTestId(`button-join-${NICHE}`).click();

  // The room appears and knows it is waiting for four more.
  await expect(first.getByTestId("text-phase-title")).toContainText(/waiting for 4/i);

  // The other four join through the API — five browsers pressing a button in
  // the same second is what the integration tests already cover, and what this
  // spec needs is the room reaching five.
  for (const person of people.slice(1)) {
    const join = await person.api.post("/api/sim/join", { data: { nicheId: NICHE } });
    expect(join.ok()).toBeTruthy();
  }

  const ventureId = (await (await people[1].api.post("/api/sim/join", { data: { nicheId: NICHE } })).json()).ventureId;

  // Everybody is here, and seats open.
  await expect(first.getByTestId("text-phase-title")).toContainText(/take a seat|you have a seat/i, { timeout: 20_000 });

  /*
   * The race. Two people reach for the chief executive's chair together; the
   * database settles it, and the loser is told who beat them rather than shown
   * an error. This is the bug that shipped as a 500 because the handler read
   * the error code off Drizzle's wrapper instead of the driver error under it.
   */
  const second = await people[1].context.newPage();
  await second.goto(`/simulation`);
  await expect(second.getByTestId("text-phase-title")).toBeVisible();

  const [firstClaim, secondClaim] = await Promise.all([
    people[0].api.post(`/api/sim/ventures/${ventureId}/claim`, { data: { role: "ceo" } }),
    people[1].api.post(`/api/sim/ventures/${ventureId}/claim`, { data: { role: "ceo" } }),
  ]);

  const statuses = [firstClaim.status(), secondClaim.status()].sort();
  expect(statuses, "exactly one chief executive, and the other told why").toEqual([200, 409]);

  const loser = firstClaim.status() === 409 ? firstClaim : secondClaim;
  const refusal = await loser.json();
  expect(refusal.code).toBe("role_taken");
  expect(refusal.message, "a lost race is news, not an error").toMatch(/first|before you/i);

  // The rest take what is left, so the room can move on.
  const winner = firstClaim.status() === 200 ? people[0] : people[1];
  const others = people.filter((p) => p !== winner);
  for (const [i, person] of others.entries()) {
    const res = await person.api.post(`/api/sim/ventures/${ventureId}/claim`, { data: { role: ["cmo", "cfo", "cto", "coo"][i] } });
    expect(res.ok(), `seat ${i} should have been free`).toBeTruthy();
  }

  // Naming is the chief executive's, and the room waits for it.
  const boss = await winner.context.newPage();
  await boss.goto("/simulation");
  await expect(boss.getByTestId("text-phase-title")).toContainText(/name the company/i, { timeout: 20_000 });
  await boss.getByTestId("input-company-name").fill("Northbound");
  await boss.getByTestId("button-name-company").click();

  // And the company exists, with a way into it.
  await expect(boss.getByTestId("button-open-desk")).toBeVisible({ timeout: 20_000 });
  await boss.getByTestId("button-open-desk").click();
  await expect(boss.getByTestId("text-company-name")).toContainText("Northbound", { timeout: 30_000 });

  for (const person of people) await person.context.close();
});

test("a new player can find the simulation from the app, join, and get back to it", async ({ browser }) => {
  /*
   * The path a person actually takes, which for a long time did not exist.
   *
   * Everything downstream of this was built and tested — the lobby, five
   * desks, a marketplace, a boardroom, standings — and there was no link to
   * any of it anywhere in the web app. The sidebar said "Sprints &
   * simulations", the page it opened said "Co-Founder Sprints" and mentioned
   * no simulation at all, so the only way in was to know the address.
   *
   * The second half is the half that keeps a season alive: a fortnight-long
   * game is only played if getting back to today's decisions takes one tap.
   */
  test.setTimeout(120_000);
  const person = await personIn(browser, "203.0.117.70", "Newcomer");
  const page = await person.context.newPage();

  await page.goto("/sprints");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(page.getByTestId("text-sprints-title")).toContainText(/simulations/i);

  await expect(page.getByTestId("card-simulation-entry")).toBeVisible();
  await page.getByTestId("button-open-simulation").click();

  // The markets, and a room.
  await clearStrayLobbies(NICHE);
  await expect(page.getByTestId(`niche-${NICHE}`)).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`button-join-${NICHE}`).click();
  await expect(page.getByTestId("text-phase-title")).toBeVisible({ timeout: 20_000 });

  // And a way back to it from where they started.
  await page.goto("/sprints");
  const resume = page.locator('[data-testid^="button-resume-"]').first();
  await expect(resume, "a company you are in should be waiting for you").toBeVisible({ timeout: 20_000 });
  await resume.click();
  await expect(page.getByTestId("text-phase-title")).toBeVisible({ timeout: 20_000 });

  await person.context.close();
});

test("somebody who is not in the room is told nothing about it", async ({ browser }) => {
  test.setTimeout(120_000);

  const member = await personIn(browser, "203.0.117.60", "Member");
  const stranger = await personIn(browser, "203.0.117.61", "Stranger");

  await clearStrayLobbies("project_saas");
  const ventureId = (await (await member.api.post("/api/sim/join", { data: { nicheId: "project_saas" } })).json()).ventureId;

  // 404 rather than 403: the existence of a room is not a stranger's business.
  const peek = await stranger.api.get(`/api/sim/ventures/${ventureId}`);
  expect(peek.status()).toBe(404);
  expect(JSON.stringify(await peek.json())).not.toMatch(/seats|userId/);

  await member.context.close();
  await stranger.context.close();
});

test("a finished season says so, and starting again reaches the markets rather than the old room", async ({ browser }) => {
  test.setTimeout(120_000);
  const person = await personIn(browser, "203.0.117.70", "Finley");

  await clearStrayLobbies(NICHE);
  const ventureId = (await (await person.api.post("/api/sim/join", { data: { nicheId: NICHE } })).json()).ventureId;

  // Open the page while the room is live, so its list of rooms says "you're in one".
  const page = await person.context.newPage();
  await page.goto("/simulation");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(page.getByTestId("text-phase-title")).toContainText(/waiting for/i, { timeout: 20_000 });
  // And it counts down the minute before bots, rather than leaving only the fifteen-minute clock.
  await expect(page.getByTestId("text-bots-in")).toContainText(/bots take the empty seats in/i);

  // The season runs its fourteen years out from under the open page.
  await sql(`UPDATE sim_ventures SET phase = 'retired' WHERE id = $1`, [ventureId]);
  await sql(`UPDATE sim_seasons SET status = 'finished' WHERE id = (SELECT season_id FROM sim_ventures WHERE id = $1)`, [ventureId]);

  await expect(page.getByTestId("text-phase-title")).toHaveText("Season over", { timeout: 20_000 });
  await expect(page.getByTestId("button-final-report")).toBeVisible();

  // The bug: this button put you straight back in the room you were leaving.
  await page.getByTestId("button-pick-market").click();
  await expect(page.getByTestId(`niche-${NICHE}`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("card-room-retired")).toHaveCount(0);

  // And joining again lands in a new, live room.
  await clearStrayLobbies(NICHE);
  await page.getByTestId(`button-join-${NICHE}`).click();
  await expect(page.getByTestId("text-phase-title")).toContainText(/waiting for/i, { timeout: 20_000 });

  await person.context.close();
});
