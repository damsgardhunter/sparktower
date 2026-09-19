/**
 * The loop, all the way round, in a browser.
 *
 * Everything else about the simulation is tested either side of the moment
 * that matters. The lobby specs get five people into a company; the desk specs
 * get a decision filed; the integration suites resolve a year against the
 * database with no browser anywhere near it. Nothing joined them up — nothing
 * proved that a player who files a decision and comes back the next day is
 * shown what it did.
 *
 * That is the product. A fortnight of turning up is fourteen repetitions of
 * exactly this: read what happened, decide, come back. If the first half works
 * and the second half works and the seam between them does not, the whole
 * thing is a form that swallows things.
 *
 * ## Why this test moves the clock by hand
 *
 * A year resolves once a real day, which is the right cadence for the product
 * and an impossible one for a test. There is no API to hurry it and there
 * should not be — a route that advances the season would be a route somebody
 * could call. So the season's due time is pulled into the past directly in the
 * database and the background job, which wakes about once a minute, finds it
 * there and does the ordinary thing.
 *
 * Nothing else is faked. The job is the real job, the resolver is the real
 * resolver, and what the browser then loads is what a player would see.
 *
 * Note the `at time zone 'utc'` in that update: these columns are zoneless
 * timestamps holding UTC, which is Drizzle's convention and not something SQL
 * written by hand gets for free. See the note in server/simulation-tick.ts.
 */
import { test, expect, type APIRequestContext, type Browser } from "./test";
import { verifyEmail } from "./verify-email";
import { clearStrayLobbies } from "./sim-lobbies";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** This spec's own market, so no other spec's lobby holds up its season. */
const NICHE = "podcasts";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

async function sql(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await client.connect();
  try { return await client.query(text, params); } finally { await client.end(); }
}

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", {
    data: { email: `e2e-year-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Year" },
  })).ok()).toBeTruthy();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Year`, headline: "Running a company", bio: "Here for the simulation." },
  })).ok()).toBeTruthy();
  return { context, api };
}

async function desk(api: APIRequestContext, ventureId: string): Promise<any> {
  return (await api.get(`/api/sim/ventures/${ventureId}/desk`)).json();
}

/** Poll until the desk says what we are waiting for, or give up loudly. */
async function until(
  api: APIRequestContext,
  ventureId: string,
  what: string,
  ready: (d: any) => boolean,
  ms = 180_000,
): Promise<any> {
  const deadline = Date.now() + ms;
  let last: any;
  while (Date.now() < deadline) {
    last = await desk(api, ventureId);
    if (ready(last)) return last;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`waited ${ms / 1000}s for ${what}; the desk last said phase=${last?.phase} year=${last?.year}`);
}

test("a year is filed, resolves overnight, and comes back as something to read", async ({ browser }) => {
  test.setTimeout(420_000);

  const names = ["Ada", "Bo", "Cleo", "Dev", "Esme"];
  const people = [];
  for (const [i, name] of names.entries()) {
    people.push(await personIn(browser, `203.0.117.${60 + i}`, name));
  }

  let ventureId = "";
  // Nobody left sitting in this market's lobby from an earlier test — see e2e/sim-lobbies.ts.
  await clearStrayLobbies(NICHE);
  for (const person of people) {
    ventureId = (await (await person.api.post("/api/sim/join", { data: { nicheId: NICHE } })).json()).ventureId;
  }
  for (const [i, person] of people.entries()) {
    expect((await person.api.post(`/api/sim/ventures/${ventureId}/claim`, { data: { role: ROLES[i] } })).ok()).toBeTruthy();
  }
  expect((await people[0].api.post(`/api/sim/ventures/${ventureId}/name`, {
    data: { name: "Longwave", product: "Shows people finish" },
  })).ok()).toBeTruthy();

  const opened = await until(people[1].api, ventureId, "the season to start", (d) => d.phase === "running");
  expect(opened.year, "a season opens on year one").toBe(1);
  expect(opened.lastYear, "and there is nothing behind you yet").toBeFalsy();

  /*
   * Year one, filed by hand, on the screen a player would use. The number
   * matters later: whatever else the year did, a company that spent two
   * million telling people it exists should not come out of it unchanged.
   */
  const cmo = await people[1].context.newPage();
  await cmo.goto(`/simulation/${ventureId}`);
  await cmo.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(cmo.getByTestId("text-company-name")).toContainText("Longwave", { timeout: 40_000 });
  await expect(cmo.getByTestId("card-last-year"), "year one has no year behind it").toHaveCount(0);

  await cmo.getByTestId("input-brandSpend").fill("2000000");
  await cmo.getByTestId("button-file-decision").click();
  await expect(cmo.getByTestId("badge-filed")).toBeVisible({ timeout: 20_000 });

  /*
   * Overnight. The other four seats are deliberately left unfiled: four of
   * five people forgetting is the ordinary case, not the exceptional one, and
   * a year that only resolves when everybody turns up would strand the season
   * the first time somebody went on holiday.
   */
  const moved = await sql(
    `UPDATE sim_seasons SET next_tick_at = (now() at time zone 'utc') - interval '1 minute'
     WHERE id = (SELECT season_id FROM sim_ventures WHERE id = $1)`,
    [ventureId],
  );
  expect(moved.rowCount, "the season's clock was found and moved").toBe(1);

  const after = await until(people[1].api, ventureId, "the year to resolve", (d) => d.year === 2);

  /*
   * What the API now holds. Asserted before the screen, so a failure says
   * whether the year resolved wrongly or merely displayed wrongly.
   */
  expect(after.lastYear, "the year that just ran").toBeTruthy();
  expect(after.lastYear.year).toBe(1);
  expect(Number.isFinite(after.lastYear.revenue), "a real number, not a NaN").toBe(true);
  expect(after.lastYear.revenue).toBeGreaterThanOrEqual(0);
  expect(after.lastYear.rank, "a position in a market of nine").toBeGreaterThanOrEqual(1);
  expect(after.lastYear.notes.length, "and something said about it in words").toBeGreaterThan(0);

  /*
   * And on the screen. This is the seam: the same page that took the decision
   * yesterday has to open tomorrow with the result on it, above a fresh form.
   */
  await cmo.reload();
  await expect(cmo.getByTestId("card-last-year")).toBeVisible({ timeout: 40_000 });
  await expect(cmo.getByTestId("text-last-year")).toHaveText("Year 1");
  await expect(cmo.getByTestId("text-last-rank")).toContainText("in the market");
  await expect(cmo.getByTestId("card-last-year").getByText("Revenue", { exact: true })).toBeVisible();
  await expect(cmo.getByTestId("card-last-year").getByText("Turned away", { exact: true }), "including the number nobody wants to see").toBeVisible();

  // A new year is a new decision, not yesterday's still sitting there filed.
  await expect(cmo.getByTestId("badge-filed"), "last year's filing does not carry over").toHaveCount(0);
  await expect(cmo.getByTestId("button-file-decision")).toBeEnabled();
  await expect(cmo.getByTestId("text-company-name")).toContainText("Longwave");

  /*
   * The empty chairs are named in the results, rather than the year quietly
   * reading as though five people made it happen. A caretaker decision is a
   * reasonable default and an honest one only if it admits to being a default.
   *
   * And it names them — it does not say "nobody filed". Four of five missing
   * is the ordinary bad week, and the person most likely to be reading this is
   * the one who did file. The note used to tell them nobody had.
   */
  const cfo = await people[2].context.newPage();
  await cfo.goto(`/simulation/${ventureId}`);
  await cfo.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(cfo.getByTestId("card-last-year")).toBeVisible({ timeout: 40_000 });
  await expect(cfo.getByText(/No decisions came in from/i).first()).toBeVisible();
  await expect(cfo.getByTestId("card-last-year")).not.toContainText(/nobody filed/i);

  /*
   * The forecast, and what each segment weighs — the two things the next
   * decision should be made against. On every seat's desk, because the
   * argument between marketing and operations about how many people will
   * turn up is one the whole table has.
   */
  await expect(cfo.getByTestId("card-forecast")).toBeVisible();
  await expect(cfo.getByTestId("text-forecast-range")).toContainText(/between .* and .* listeners/i);
  await expect(cfo.getByTestId("text-capacity-verdict")).toBeVisible();
  await expect(cfo.locator('[data-testid^="criteria-"]').first()).toContainText(/price \d+%/);

  /*
   * And the whole year, one tap from the summary. This is the screen a team
   * learns from: which line lost the money, and who took the customers.
   */
  await cfo.getByTestId("button-open-report").click();
  await expect(cfo.getByTestId("text-report-title")).toContainText("Year 1", { timeout: 30_000 });
  await expect(cfo.getByTestId("card-accounts")).toBeVisible();
  await expect(cfo.getByTestId("row-pnl-marketing")).toBeVisible();
  await expect(cfo.getByTestId("row-pnl-idle-capacity")).toBeVisible();
  await expect(cfo.getByTestId("row-pnl-profit")).toBeVisible();
  await expect(cfo.getByTestId("text-cash-summary"), "started with, ended with").toContainText(/Started the year with .* and ended it with/);
  await expect(cfo.locator('[data-testid^="segment-"]')).toHaveCount(3);
  await expect(cfo.getByTestId("card-rivals")).toContainText("The Daily Brief");

  // For looking at, not for asserting: set E2E_SCREENSHOTS to a directory.
  if (process.env.E2E_SCREENSHOTS) {
    // The app scrolls inside its own container, so each card is captured on its own.
    for (const card of ["card-accounts", "card-cash", "card-customers", "card-rivals"]) {
      await cfo.getByTestId(card).screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${card}.png` });
    }
    await cfo.getByTestId("button-back").click();
    await expect(cfo.getByTestId("card-forecast")).toBeVisible({ timeout: 30_000 });
    await cfo.getByTestId("card-forecast").screenshot({ path: `${process.env.E2E_SCREENSHOTS}/card-forecast.png` });
    await cfo.locator('[data-testid^="criteria-"]').first().locator("..").screenshot({ path: `${process.env.E2E_SCREENSHOTS}/criteria.png` });
  }

  for (const person of people) await person.context.close();
});
