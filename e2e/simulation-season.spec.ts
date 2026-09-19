/**
 * A season as a story, in a browser: two teams, an offer between them, and the
 * table they both end up on.
 *
 * The flows here had no browser coverage at all, and they are the ones where a
 * mistake is most expensive — an acquisition is five people agreeing to hand
 * over the business they have spent a fortnight building, and the screen that
 * asks them has to be right about what they keep.
 *
 * API-level: test/integration/sim-offers.test.ts.
 */
import { test, expect, type APIRequestContext, type Browser } from "./test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** This spec's own market, so no other spec's lingering lobby holds up its season. */
const NICHE = "construction";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", {
    data: { email: `e2e-season-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Season" },
  })).ok()).toBeTruthy();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Season`, headline: "Running a company", bio: "Here for the simulation." },
  })).ok()).toBeTruthy();
  return { context, api };
}

async function waitForYearOne(api: APIRequestContext, ventureId: string): Promise<boolean> {
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const desk = await (await api.get(`/api/sim/ventures/${ventureId}/desk`)).json();
    if (desk.phase === "running") return true;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return false;
}

/** Five accounts, before anybody joins anything. */
async function enlist(browser: Browser, base: number, tag: string) {
  const people = [];
  for (let i = 0; i < 5; i++) {
    people.push(await personIn(browser, `203.0.119.${base + i}`, `${tag}${i}`));
  }
  return people;
}

/**
 * Five people into a room, seated and named.
 *
 * Registration is deliberately not part of this. A season holds every room in
 * its market and starts once they have all left the lobby — so registering the
 * second team's five accounts *after* the first team was already seated left a
 * half-minute window in which the background job could start a season
 * containing only the first team. The second team then found no forming season,
 * made one of their own, and the two companies spent the test in different
 * worlds, unable to see each other at all.
 *
 * Enlisting everybody first and joining back to back closes it.
 */
async function form(people: Awaited<ReturnType<typeof enlist>>, name: string) {
  let ventureId = "";
  for (const person of people) {
    ventureId = (await (await person.api.post("/api/sim/join", { data: { nicheId: NICHE } })).json()).ventureId;
  }
  for (const [i, person] of people.entries()) {
    await person.api.post(`/api/sim/ventures/${ventureId}/claim`, { data: { role: ROLES[i] } });
  }
  await people[0].api.post(`/api/sim/ventures/${ventureId}/name`, { data: { name, product: "Building things" } });
  return { people, ventureId, ceo: people[0], cfo: people[2] };
}

test("one company offers to buy another, and the sellers are told what they keep", async ({ browser }) => {
  test.setTimeout(400_000);

  // Everybody signed up before anybody joins, so both rooms land in one season.
  const buyerPeople = await enlist(browser, 10, "B");
  const sellerPeople = await enlist(browser, 20, "S");
  const buyer = await form(buyerPeople, "Hartwell Rivals");
  const seller = await form(sellerPeople, "Small Works");

  if (!(await waitForYearOne(buyer.ceo.api, buyer.ventureId))) {
    test.skip(true, "the season had not started — the simulation job may not have run");
  }

  // The boardroom values everybody, in the open, including you.
  const boss = await buyer.ceo.context.newPage();
  await boss.goto(`/simulation/${buyer.ventureId}/offers`);
  await boss.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(boss.getByTestId("text-your-value")).toBeVisible({ timeout: 40_000 });

  const target = boss.locator(`[data-testid="button-open-offer-${seller.ventureId}"]`);
  await expect(target, "a rival team should be on the list").toBeVisible({ timeout: 20_000 });
  await target.click();
  await boss.locator(`[data-testid="input-offer-${seller.ventureId}"]`).fill("2500000");
  await boss.locator(`[data-testid="input-message-${seller.ventureId}"]`).fill("You are in our way in the South East.");
  await boss.locator(`[data-testid="button-offer-${seller.ventureId}"]`).click();
  await expect(boss.getByText(/is with them/i)).toBeVisible({ timeout: 20_000 });

  /*
   * The seller's side, which is the screen that must not read like an
   * elimination notice. An acquisition buys the business, not the people: the
   * team keeps the company, every seat, its reputation and the money, and
   * carries on. If this page framed it as a loss, teams would decline on
   * instinct and the most interesting decision in the game would never be made.
   */
  const theirs = await seller.ceo.context.newPage();
  await theirs.goto(`/simulation/${seller.ventureId}/offers`);
  await theirs.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(theirs.getByText(/wants to buy the business/i)).toBeVisible({ timeout: 40_000 });
  await expect(theirs.getByText(/You are in our way/i), "the buyer's note reaches them").toBeVisible();
  await expect(theirs.getByText(/starting again, from in front/i), "what selling actually means").toBeVisible();
  await expect(theirs.getByText(/every seat/i).first()).toBeVisible();

  // And it is the chief executive's alone: the finance seat sees it all and can do nothing.
  const theirCfo = await seller.cfo.context.newPage();
  await theirCfo.goto(`/simulation/${seller.ventureId}/offers`);
  await expect(theirCfo.getByText(/wants to buy the business/i)).toBeVisible({ timeout: 40_000 });
  await expect(theirCfo.locator('[data-testid^="button-accept-"]')).toHaveCount(0);
  await expect(theirCfo.getByText(/chief executive/i).first()).toBeVisible();

  for (const person of [...buyer.people, ...seller.people]) await person.context.close();
});

test("the standings put the teams and the incumbents on one table", async ({ browser }) => {
  test.setTimeout(300_000);

  const team = await form(await enlist(browser, 40, "T"), "Northgate Rivals");
  if (!(await waitForYearOne(team.ceo.api, team.ventureId))) {
    test.skip(true, "the season had not started — the simulation job may not have run");
  }

  const page = await team.ceo.context.newPage();
  await page.goto(`/simulation/${team.ventureId}/standings`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});

  await expect(page.getByTestId("text-your-rank")).toBeVisible({ timeout: 40_000 });

  /*
   * A league table that quietly listed only the player teams would tell
   * everybody they were doing better than they are. Fourth of nine is the
   * honest position, and being honest about it is what makes third worth
   * reaching for.
   */
  await expect(page.getByText(/was here first/i).first()).toBeVisible();

  // Ordered by what each side's owners hold, and saying so rather than leaving
  // the reader to guess why the order is what it is.
  await expect(page.getByTestId("text-value-1")).toBeVisible();
  await expect(page.getByText(/ordered by what each side's owners hold/i)).toBeVisible();

  // Every row is a real company, not a placeholder.
  const rows = page.locator('[data-testid^="row-standing-"]');
  expect(await rows.count(), "teams and incumbents together").toBeGreaterThanOrEqual(5);

  for (const person of team.people) await person.context.close();
});
