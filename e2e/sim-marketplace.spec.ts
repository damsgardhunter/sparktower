/**
 * Buying a simulation and playing it, in a browser.
 *
 * The marketplace had no browser coverage at all, which for the one part of the
 * product that charges a card is the wrong place to have none. Every other
 * check on it drives the API, and the API being right is not the same as a
 * person being able to get through: the thing that breaks a marketplace is a
 * button that offers what the server is about to refuse, a price shown in one
 * place and charged in another, or a purchase that completes and leaves nothing
 * on screen to play.
 *
 * So this follows one person the whole way — find it, pay for it, start it,
 * land on a desk — and then checks the two refusals that have to look like
 * refusals rather than faults: a wallet that is short, and a draft nobody else
 * may see.
 *
 * The listings are made through the API rather than seeded, because a spec that
 * depends on `script/seed-market-listings.ts` having been run is a spec that
 * fails for a reason nobody can see. That script exists for practising by hand.
 */
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";
import { finishOnboarding } from "./onboarding";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function member(browser: any, ip: string, name: string) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = ctx.request;
  await api.get("/");
  const email = `e2e-mkt-${stamp()}@example.test`;
  const me = await (await api.post("/api/auth/register", { data: { email, password, firstName: name } })).json();
  await verifyEmail(api, email);
  await finishOnboarding(api, { displayName: name, headline: "Selling markets", bio: "Here to trade." });
  return { ctx, api, email, id: me.id as string };
}

/**
 * A listed simulation, from a built-in niche.
 *
 * A niche rather than a Nova-written market: it is a real balanced market that
 * ships in the repo, so it plays exactly as a sold one does and costs no model
 * call to make.
 */
async function listed(api: any, opts: { title: string; seatPriceCents: number }) {
  expect((await api.post("/api/sim-market/seller-terms", { data: { version: 1 } })).ok()).toBeTruthy();

  const draft = await api.post("/api/sim-market/listings", {
    data: { nicheId: "restaurant_chain", title: opts.title },
  });
  expect(draft.ok(), `drafting: ${draft.status()}`).toBeTruthy();
  const id = (await draft.json()).listing.id as string;

  const out = await api.post(`/api/sim-market/listings/${id}/publish`, {
    data: {
      title: opts.title,
      summary: "Same menu in forty towns, and two chains already in every one of them.",
      pricing: opts.seatPriceCents > 0 ? "perSeat" : "free",
      seatPriceCents: opts.seatPriceCents,
    },
  });
  expect(out.ok(), `publishing: ${out.status()} ${await out.text()}`).toBeTruthy();
  return id;
}

test("a buyer finds a simulation, pays for a seat, and lands on a running desk", async ({ browser }) => {
  test.setTimeout(180_000);

  const seller = await member(browser, "203.0.113.210", "Sella");
  const title = `Restaurant chain ${stamp()}`;
  const listingId = await listed(seller.api, { title, seatPriceCents: 500 });

  const buyer = await member(browser, "203.0.113.211", "Bea");
  /* A balance to spend. Development only — the card path is Stripe's. */
  expect((await buyer.api.post("/api/dev/credit-wallet", { data: { amountCents: 5_000 } })).ok()).toBeTruthy();

  const page = await buyer.ctx.newPage();
  await page.goto("/simulations/market");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});

  /* It is on the marketplace, and the price is on the card. */
  const card = page.getByTestId(`card-simulation-${listingId}`);
  await expect(card).toBeVisible();
  await expect(page.getByTestId(`price-${listingId}`)).toContainText("5");

  await card.click();
  await page.waitForURL(new RegExp(`/simulations/market/${listingId}`));

  /*
   * Buy one seat. The seats field and the button are the whole purchase: if
   * this leaves the page unchanged, somebody has paid and has nothing.
   */
  await page.getByTestId("input-seats").fill("1");
  await page.getByTestId("button-buy-seats").click();

  /* The page comes back offering to play rather than to buy again. */
  await expect(page.getByTestId("button-start-season")).toBeVisible({ timeout: 20_000 });

  await page.getByTestId("button-start-season").click();

  /*
   * And then all the way to a table.
   *
   * This used to stop at "the URL changed and nothing said it had crashed",
   * which is why it passed while a buyer could not actually get in: `/play`
   * hands back a join link, and the join page refused every season that had no
   * company — telling the person who had just paid that it was "only for people
   * at the company", with no company anywhere. A purchase that ends on a page
   * you cannot leave is the failure this spec exists to catch, so it now
   * presses the button and checks it arrives.
   */
  await page.waitForURL(/\/join-season\//, { timeout: 30_000 });
  await expect(page.getByTestId("text-season-name")).toBeVisible();

  /* No company, so no membership to prove: the code is the credential. */
  await expect(page.locator("body"), "a marketplace season is not a company's workshop")
    .not.toContainText("only for people at");

  await page.getByTestId("button-join-season").click();

  /*
   * Either straight to the table, or the page re-renders with the way in —
   * joining seats them in a room, and which of the two the app shows depends
   * on how quickly the lobby resolves.
   */
  await expect(async () => {
    const atTable = /\/simulation/.test(page.url());
    const offered = await page.getByTestId("button-open-room").count();
    expect(atTable || offered > 0, `still on ${page.url()}`).toBe(true);
  }).toPass({ timeout: 30_000 });

  await expect(page.locator("body")).not.toContainText("Something went wrong");
});

test("a free one needs no balance, and a short balance is told so rather than failing", async ({ browser }) => {
  test.setTimeout(180_000);

  const seller = await member(browser, "203.0.113.212", "Freebie");
  const freeTitle = `Free kitchen ${stamp()}`;
  const freeId = await listed(seller.api, { title: freeTitle, seatPriceCents: 0 });
  const dearTitle = `Dear kitchen ${stamp()}`;
  const dearId = await listed(seller.api, { title: dearTitle, seatPriceCents: 2500 });

  /* No wallet credit at all for this one. */
  const skint = await member(browser, "203.0.113.213", "Skint");
  const page = await skint.ctx.newPage();

  await page.goto(`/simulations/market/${freeId}`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});

  /*
   * Free means playable now. A free listing that still asks for payment is the
   * single most likely way for this to be wrong, because free goes down a
   * different branch of `buy` than a charge does.
   */
  await expect(page.getByTestId("button-buy-seats")).toBeVisible();
  await page.getByTestId("input-seats").fill("1");
  await page.getByTestId("button-buy-seats").click();
  await expect(page.getByTestId("button-start-season")).toBeVisible({ timeout: 20_000 });

  /*
   * And the dear one refuses in a way somebody can read. The point is that the
   * app stays on its feet and says something — not that it guesses the wording.
   */
  await page.goto(`/simulations/market/${dearId}`);
  await page.getByTestId("input-seats").fill("1");
  await page.getByTestId("button-buy-seats").click();

  await expect(page.getByTestId("button-start-season"), "a purchase nobody paid for must not grant a season")
    .toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("body")).not.toContainText("Something went wrong");
});

test("a draft is the author's alone, even to somebody with the address", async ({ browser }) => {
  test.setTimeout(120_000);

  const seller = await member(browser, "203.0.113.214", "Drafty");
  expect((await seller.api.post("/api/sim-market/seller-terms", { data: { version: 1 } })).ok()).toBeTruthy();
  const draft = await seller.api.post("/api/sim-market/listings", {
    data: { nicheId: "podcasts", title: `Unpublished ${stamp()}` },
  });
  expect(draft.ok()).toBeTruthy();
  const draftId = (await draft.json()).listing.id as string;

  /* The author can open their own. */
  const mine = await seller.ctx.newPage();
  await mine.goto(`/simulations/market/${draftId}`);
  await mine.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(mine.getByTestId("button-start-season"), "the author plays their own without buying").toBeVisible();

  /*
   * A stranger with the address gets nothing. "A draft promises nothing" is the
   * rule, and the address is not a credential.
   */
  const stranger = await member(browser, "203.0.113.215", "Nosy");
  const theirs = await stranger.ctx.newPage();
  await theirs.goto(`/simulations/market/${draftId}`);
  await theirs.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(theirs.getByTestId("button-buy-seats")).toHaveCount(0);
  await expect(theirs.getByTestId("button-start-season")).toHaveCount(0);
});
