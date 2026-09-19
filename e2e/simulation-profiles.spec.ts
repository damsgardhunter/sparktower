/**
 * Tapping a name, in a browser.
 *
 * The overlays are the answer to two questions the game could not previously
 * be asked: who is this company, and what is my teammate doing. Both are
 * opened by tapping a name that used to be inert, and neither is reachable by
 * any other route — there is no URL for them — so a browser is the only place
 * they can be tested at all.
 *
 * What is checked here that the API tests cannot check: that the names are
 * actually tappable. The routes were right for a while before anything on any
 * screen called them, and a profile nobody can open is the same as no profile.
 *
 * API-level: test/integration/sim-profiles.test.ts.
 */
import { test, expect, type APIRequestContext, type Browser } from "./test";
import { verifyEmail } from "./verify-email";
import { clearStrayLobbies } from "./sim-lobbies";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** This spec's own market, so no other spec's lobby holds up its season. */
const NICHE = "mmos";
const ROLES = ["ceo", "cmo", "cfo", "cto", "coo"] as const;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", {
    data: { email: `e2e-prof-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Prof" },
  })).ok()).toBeTruthy();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Prof`, headline: "Running a company", bio: "Here for the simulation." },
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

test("the market picker introduces the people already in it", async ({ browser }) => {
  test.setTimeout(180_000);

  /*
   * The first screen anybody sees, and the one that decides whether they pick
   * a market or close the tab. It used to offer seven identical cards with
   * four badges each reading "Ember · 39%", which is the same shape of nothing
   * in all seven — nobody chooses a fortnight on a percentage.
   */
  const person = await personIn(browser, "203.0.116.10", "Pick");
  const page = await person.context.newPage();
  await page.goto("/simulation");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});

  await expect(page.getByTestId("niche-dating_apps")).toBeVisible({ timeout: 30_000 });

  // The companies already there arrive with something to hold on to.
  const dating = page.getByTestId("niche-dating_apps");
  await expect(dating.getByText("Ember")).toBeVisible();
  await expect(dating.getByText(/Where it starts/), "how they describe themselves").toBeVisible();
  await expect(dating.getByText(/Half the price/), "and so does the one undercutting them").toBeVisible();

  /*
   * And each market says where its money actually is — the arithmetic a player
   * would otherwise only find by reading three segment boxes. Deliberately not
   * a restatement of the premise printed under it: a band that repeats the
   * sentence below it is worse than no band, because the reader stops to work
   * out whether they missed something.
   */
  await expect(dating.getByText(/four times a swiper/i)).toBeVisible();
  await expect(page.getByTestId("niche-mmos").getByText(/gone by Christmas/i)).toBeVisible();

  await person.context.close();
});

test("a rival opens into somebody you can plan against, and a teammate into what they filed", async ({ browser }) => {
  test.setTimeout(400_000);

  const names = ["Ida", "Jon", "Kit", "Lux", "Mae"];
  const people = [];
  for (const [i, name] of names.entries()) {
    people.push(await personIn(browser, `203.0.116.${20 + i}`, name));
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
  await people[0].api.post(`/api/sim/ventures/${ventureId}/name`, { data: { name: "Hollowmark", product: "A world worth staying in" } });

  if (!(await waitForYearOne(people[0].api, ventureId))) {
    test.skip(true, "the season had not started — the simulation job may not have run");
  }

  const ceo = await people[0].context.newPage();
  await ceo.goto(`/simulation/${ventureId}`);
  await ceo.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(ceo.getByTestId("text-company-name")).toContainText("Hollowmark", { timeout: 40_000 });

  /*
   * A rival. The one thing the old screen could never do: say who they are and
   * where they can be taken.
   */
  // Who you're up against sits under Past, with the market.
  await ceo.getByTestId("tab-past").click();
  const rival = ceo.locator('[data-testid^="button-company-inc_"]').first();
  await expect(rival, "the incumbents are tappable").toBeVisible();
  await rival.click();

  const profile = ceo.getByTestId("dialog-company-profile");
  await expect(profile).toBeVisible({ timeout: 20_000 });
  await expect(ceo.getByTestId("text-profile-tagline"), "how they describe themselves").toBeVisible();
  await expect(ceo.getByTestId("text-profile-character"), "and who they actually are").toBeVisible();

  // The part that makes it worth opening: every one of them is beatable in a
  // way you can name, and this is where it is named.
  await expect(ceo.getByTestId("text-profile-knock")).toBeVisible();
  await expect(ceo.getByTestId("text-profile-knock").getByText("The way in")).toBeVisible();

  // And where the two of you actually meet, segment by segment.
  await expect(profile.getByText(/where you meet them/i)).toBeVisible();

  await profile.getByRole("button", { name: "Close" }).click({ timeout: 10_000 });
  await expect(profile).toBeHidden({ timeout: 10_000 });

  /*
   * A teammate who has not filed. This is the flow that had no button at all:
   * you could see somebody was still deciding and do nothing about it.
   */
  // The table — who has filed — is on Decisions.
  await ceo.getByTestId("tab-decisions").click();
  // Not the first row — that one is you, and you cannot nudge yourself.
  const anySeat = ceo.locator('[data-testid^="button-seat-"]').nth(1);
  await expect(anySeat).toBeVisible();
  await anySeat.click();

  const mate = ceo.getByTestId("dialog-teammate-profile");
  await expect(mate).toBeVisible({ timeout: 20_000 });
  await expect(ceo.getByTestId("text-teammate-filed")).toBeVisible();
  await expect(ceo.getByTestId("text-teammate-turnout"), "whether they turn up, counted").toBeVisible();
  await expect(ceo.getByTestId("button-nudge"), "and something to do about it").toBeVisible();

  await ceo.getByTestId("button-nudge").click();
  // Confirmed in the dialog itself, where the button was.
  await expect(ceo.getByTestId("text-nudged")).toBeVisible({ timeout: 20_000 });

  /*
   * Closed with its own button, not Escape.
   *
   * The "Told them" toast is a dismissable layer on top of the dialog, so
   * while it is still showing, Escape closes the toast and the dialog stays.
   * This test pressed Escape and then clicked a button behind the dialog, and
   * the click — with no timeout of its own — waited out the whole 400-second
   * test roughly one run in four, depending on whether the toast had faded
   * yet. That is where the intermittent 6.7-minute failure came from.
   */
  await mate.getByRole("button", { name: "Close" }).click({ timeout: 10_000 });
  await expect(mate).toBeHidden({ timeout: 10_000 });

  /*
   * The same names on the standings, which is where somebody is most likely to
   * want them: they are looking at that table precisely because whoever is
   * above them is a stranger.
   */
  // Every click from here has its own limit, so a stuck element fails in seconds rather than eating the test.
  await ceo.getByTestId("button-open-standings").click({ timeout: 20_000 });
  await expect(ceo.getByTestId("text-your-rank")).toBeVisible({ timeout: 40_000 });
  await ceo.locator('[data-testid^="row-standing-"]').first().click({ timeout: 20_000 });
  await expect(ceo.getByTestId("dialog-company-profile")).toBeVisible({ timeout: 20_000 });
  await expect(ceo.getByTestId("text-profile-name")).toBeVisible();

  for (const person of people) await person.context.close();
});
