/**
 * The desk, in a real browser: the screen a player opens every day for a
 * fortnight.
 *
 * Every assertion here exists because the thing it checks was broken at some
 * point and nothing caught it:
 *
 *   - The desk white-screened, twice. Once because the live total needed a
 *     field the payload did not send, and once because a season that had not
 *     started has no preview at all. Both lost the entire page — last year's
 *     results, the form, the deadline — over one number.
 *   - The commitment meter sat unmoved while somebody selected a city worth a
 *     million, which is the exact moment it exists to speak.
 *   - What one seat commits has to be visible to the other four. That is the
 *     whole design: five people privately making reasonable decisions that are
 *     collectively ruinous is the failure the screen is built around.
 *
 * API-level: test/integration/sim-desk.test.ts.
 */
import { test, expect, type APIRequestContext, type Browser } from "./test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** A market of this spec's own, so no other spec's room can hold up its season. */
const NICHE = "coffee";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", {
    data: { email: `e2e-desk-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Desk" },
  })).ok()).toBeTruthy();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Desk`, headline: "Running a company", bio: "Here for the simulation." },
  })).ok()).toBeTruthy();
  return { context, api };
}

/**
 * Wait for the season to open.
 *
 * Seasons are started by the background job rather than by anything a player
 * does, so there is nothing to click and nothing to await but the clock. The
 * job runs about once a minute; this polls rather than sleeping so a fast
 * machine is not punished for being fast.
 *
 * This is also the only test anywhere that the job actually runs. Nothing else
 * exercises `startSimulationJobs` — the unit and integration suites call the
 * pass directly, which proves the work is right and says nothing about whether
 * anything ever calls it. If somebody removes the line from `server/index.ts`,
 * or the interval stops firing, every desk spec below times out here.
 */
async function waitForYearOne(api: APIRequestContext, ventureId: string): Promise<void> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const desk = await (await api.get(`/api/sim/ventures/${ventureId}/desk`)).json();
    if (desk.phase === "running") return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error("the season never started — the simulation job may not be running");
}

test("a seat files a year, and the rest of the table can see what it cost", async ({ browser }) => {
  test.setTimeout(300_000);

  const names = ["Nell", "Omar", "Pia", "Quinn", "Rhys"];
  const people = [];
  for (const [i, name] of names.entries()) {
    people.push(await personIn(browser, `203.0.118.${40 + i}`, name));
  }

  let ventureId = "";
  for (const person of people) {
    ventureId = (await (await person.api.post("/api/sim/join", { data: { nicheId: NICHE } })).json()).ventureId;
  }
  for (const [i, person] of people.entries()) {
    expect((await person.api.post(`/api/sim/ventures/${ventureId}/claim`, { data: { role: ROLES[i] } })).ok()).toBeTruthy();
  }
  expect((await people[0].api.post(`/api/sim/ventures/${ventureId}/name`, {
    data: { name: "Kettle & Co", product: "Coffee people queue for" },
  })).ok()).toBeTruthy();

  /*
   * The gap between naming the company and year one, which is where a team
   * lands the moment the lobby ends. It used to be a white screen.
   */
  const waiting = await people[1].context.newPage();
  await waiting.goto(`/simulation/${ventureId}`);
  await waiting.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(waiting.getByTestId("text-company-name")).toContainText("Kettle & Co");

  await waitForYearOne(people[1].api, ventureId);

  // The marketing seat's desk.
  const cmo = await people[1].context.newPage();
  await cmo.goto(`/simulation/${ventureId}`);
  await expect(cmo.getByTestId("text-company-name")).toContainText("Kettle & Co", { timeout: 30_000 });
  await expect(cmo.getByTestId("text-challenge-title"), "every seat gets something of its own").toBeVisible();

  const meter = cmo.getByTestId("text-commitment");
  await expect(meter).toBeVisible();
  const atRest = await meter.textContent();

  // Spending moves the number while a hand is still on the control. A total
  // that only updates after you submit is a post-mortem.
  await cmo.getByTestId("input-brandSpend").fill("2000000");
  await expect(meter).not.toHaveText(atRest ?? "", { timeout: 10_000 });
  const afterSpending = await meter.textContent();

  /*
   * And so does opening a city — the largest single movement of cash a
   * marketing seat can make, and one the meter ignored entirely until a
   * browser showed it sitting still.
   */
  const shut = cmo.locator('[data-testid^="city-"]').filter({ hasNotText: "already open" }).first();
  await shut.click();
  await expect(meter).not.toHaveText(afterSpending ?? "", { timeout: 10_000 });
  await expect(cmo.getByTestId("text-opening-cost")).toBeVisible();

  await cmo.getByTestId("button-file-decision").click();
  await expect(cmo.getByTestId("badge-filed")).toBeVisible({ timeout: 20_000 });

  /*
   * The point of the whole screen: the operations seat can see what marketing
   * just committed, before the year runs rather than after it.
   */
  const coo = await people[4].context.newPage();
  await coo.goto(`/simulation/${ventureId}`);
  await expect(coo.getByTestId("text-commitment")).toBeVisible({ timeout: 30_000 });
  await expect(coo.getByTestId("text-commitment")).not.toHaveText(atRest ?? "");
  await expect(coo.getByText(/still deciding/i).first(), "and who has not filed yet").toBeVisible();

  // Standings: ordered by what each side owns, and saying so.
  await coo.getByTestId("button-open-standings").click();
  await expect(coo.getByTestId("text-your-rank")).toBeVisible({ timeout: 30_000 });
  await expect(coo.getByTestId("text-value-1"), "the figure the table is ordered by").toBeVisible();
  await expect(coo.getByText(/was here first/i).first(), "the incumbents are in the table").toBeVisible();

  for (const person of people) await person.context.close();
});

test("the chief executive's chair has a company to run, and the others cannot sell it", async ({ browser }) => {
  test.setTimeout(300_000);

  const names = ["Sam", "Tess", "Uri", "Vic", "Wren"];
  const people = [];
  for (const [i, name] of names.entries()) {
    people.push(await personIn(browser, `203.0.118.${60 + i}`, name));
  }

  let ventureId = "";
  for (const person of people) {
    ventureId = (await (await person.api.post("/api/sim/join", { data: { nicheId: NICHE } })).json()).ventureId;
  }
  for (const [i, person] of people.entries()) {
    await person.api.post(`/api/sim/ventures/${ventureId}/claim`, { data: { role: ROLES[i] } });
  }
  await people[0].api.post(`/api/sim/ventures/${ventureId}/name`, { data: { name: "Brew Union", product: "Coffee" } });
  await waitForYearOne(people[0].api, ventureId);

  /*
   * The chief executive's seat was, for a while, the most contested chair in
   * the lobby and the only one whose decision could not change anything. It
   * now has three levers, and this is the cheapest way to notice if that ever
   * quietly stops being true.
   */
  const ceo = await people[0].context.newPage();
  await ceo.goto(`/simulation/${ventureId}`);
  await ceo.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(ceo.getByTestId("text-company-name")).toContainText("Brew Union", { timeout: 30_000 });
  await expect(ceo.getByText(/Where the year goes/i)).toBeVisible();
  await expect(ceo.getByText(/Who the company is for/i)).toBeVisible();

  // Selling the company is the chief executive's alone. The finance seat can
  // see the boardroom and must not be offered the button.
  const cfo = await people[2].context.newPage();
  await cfo.goto(`/simulation/${ventureId}/offers`);
  await expect(cfo.getByTestId("text-your-value")).toBeVisible({ timeout: 30_000 });
  await expect(cfo.getByText(/chief executive's call/i).first()).toBeVisible();

  for (const person of people) await person.context.close();
});

test("a sealed bid is placed, shown back, and tells you nothing about anyone else", async ({ browser }) => {
  /*
   * The marketplace's whole design rests on not knowing. Every instinct in an
   * auction interface is to show you where you stand — the high bid, how many
   * people are watching, whether you have been outbid — and all of it is
   * deliberately absent, because a visible high bid turns this into a
   * countdown won by whoever is awake last. In a game played across time zones
   * for a fortnight, that means the market belongs to whoever sleeps least.
   *
   * So this checks the blank as carefully as the number: your own bid comes
   * back, and a rival's does not appear anywhere in the page.
   */
  test.setTimeout(300_000);

  const names = ["Xan", "Yves", "Zara", "Ana", "Bo"];
  const people = [];
  for (const [i, name] of names.entries()) {
    people.push(await personIn(browser, `203.0.118.${80 + i}`, name));
  }
  const rival = await personIn(browser, "203.0.118.90", "Rival");

  let ventureId = "";
  for (const person of people) {
    ventureId = (await (await person.api.post("/api/sim/join", { data: { nicheId: NICHE } })).json()).ventureId;
  }
  for (const [i, person] of people.entries()) {
    await person.api.post(`/api/sim/ventures/${ventureId}/claim`, { data: { role: ROLES[i] } });
  }
  await people[0].api.post(`/api/sim/ventures/${ventureId}/name`, { data: { name: "Percolate", product: "Coffee" } });
  await waitForYearOne(people[0].api, ventureId);

  const ceo = await people[0].context.newPage();
  await ceo.goto(`/simulation/${ventureId}/market`);
  await ceo.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(ceo.getByTestId("text-funds"), "what a bid can be backed by").toBeVisible({ timeout: 30_000 });

  // Everyone in the season sees the same three things, priced and explained.
  const listings = ceo.locator('[data-testid^="input-bid-"]');
  await expect(listings.first()).toBeVisible();
  const listingId = (await listings.first().getAttribute("data-testid"))!.replace("input-bid-", "");

  /*
   * A rival's bid, planted through the API from a team that is not this one.
   * Nothing about it may reach the page below.
   */
  const rivalVenture = (await (await rival.api.post("/api/sim/join", { data: { nicheId: NICHE } })).json()).ventureId;
  await rival.api.post(`/api/sim/ventures/${rivalVenture}/bids`, { data: { listingId, amount: 9_123_456 } })
    .catch(() => { /* a lone joiner may still be in a lobby; the leak check below is the point */ });

  await ceo.getByTestId(`input-bid-${listingId}`).fill("1250000");
  await ceo.getByTestId(`button-bid-${listingId}`).click();

  // Your own bid comes back, and says it is sealed.
  await expect(ceo.getByTestId(`text-your-bid-${listingId}`)).toContainText(/sealed/i, { timeout: 20_000 });

  const body = await ceo.locator("body").innerText();
  expect(body, "a rival's bid must not appear anywhere").not.toContain("9,123,456");
  expect(body).not.toMatch(/outbid|highest bid|other bidders|\d+ bids?\b/i);

  for (const person of [...people, rival]) await person.context.close();
});
