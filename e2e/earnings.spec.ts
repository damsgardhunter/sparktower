/**
 * Money arriving, in a real browser.
 *
 * The other half of e2e/payout-release.spec.ts: that one is a reviewer sending
 * backers' money out of escrow, this is the person on the receiving end seeing
 * it. Between them they cover money leaving and money landing, which is the
 * pair you least want to find broken in production.
 *
 * ## What this screen exists to prevent
 *
 * Before it there was nowhere to stand. Stripe Connect onboarding was wired up
 * and the only door to it was inside one project's backing setup, three
 * screens deep, and only if that project was running a campaign. `GET
 * /api/payouts` existed and nothing in the client ever called it. So the thing
 * being checked here is not really the arithmetic — `test/integration/
 * earnings.test.ts` does that — it is that a person can find out where their
 * money is.
 *
 * ## Why the figures are split rather than summed
 *
 * Because "you have earned £450" is not something anybody can act on when
 * £200 is escrowed pending a reviewer, £150 is spendable here now and £100
 * left for a bank a fortnight ago. A single total answers none of those
 * questions, and the split is the property worth holding.
 */
import pg from "pg";
import { test, expect, type Browser } from "./test";
import { verifyEmail } from "./verify-email";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";
import { creatorPayoutCents } from "../shared/backing";

loadEnvFile();
const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const sql = async (text: string, params: unknown[] = []) => {
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  const res = await api.post("/api/auth/register", {
    data: { email: `e2e-earn-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Earner" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Earner`, headline: "Getting paid", bio: "Here for the money." },
  })).ok()).toBeTruthy();
  return { context, api, id: (await res.json()).id as string };
}

const PLEDGE_TO_BANK = 10_000;
const PLEDGE_TO_BALANCE = 4_000;
const PLEDGE_HELD = 2_500;

test("earnings are split by where the money actually is, and the page says what is not yours yet", async ({ browser }) => {
  test.setTimeout(180_000);
  const creator = await personIn(browser, "203.0.113.70", "Elsa");
  const backer = await personIn(browser, "203.0.113.71", "Bo");

  const project = await (await creator.api.post("/api/projects", {
    data: { title: `Earning Thing ${stamp()}`, description: "Something people pay toward.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  })).json();

  /*
   * One pledge down each route and one still waiting. A released pledge with a
   * transfer id went to a bank; without one it settled into the balance, and
   * that absence is the only thing distinguishing them afterwards.
   */
  const pledge = (amount: number, status: string, transfer: string | null) => sql(
    `INSERT INTO project_backings (project_id, backer_id, amount_cents, status, stripe_transfer_id, stripe_payment_intent_id, released_at, unclaimed_preference, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'refund', now())`,
    [project.id, backer.id, amount, status, transfer, `pi_e2e_${stamp()}`, status === "released" ? new Date() : null],
  );
  await pledge(PLEDGE_TO_BANK, "released", `tr_e2e_${stamp()}`);
  await pledge(PLEDGE_TO_BALANCE, "released", null);
  await pledge(PLEDGE_HELD, "held", null);

  const page = await creator.context.newPage();
  await page.goto("/earnings");
  await expect(page.getByTestId("page-earnings")).toBeVisible({ timeout: 20_000 });

  /*
   * Net, not gross. The platform takes its cut on release, so reporting the
   * pledge would promise a creator money that was never going to arrive — and
   * the difference is not small enough to round away.
   */
  const money = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
  await expect(page.getByTestId("text-bank")).toHaveText(money(creatorPayoutCents(PLEDGE_TO_BANK)));
  await expect(page.getByTestId("text-balance")).toHaveText(money(creatorPayoutCents(PLEDGE_TO_BALANCE)));
  await expect(page.getByTestId("text-held")).toHaveText(money(creatorPayoutCents(PLEDGE_HELD)));

  /* The held one has to say why it is held, or the figure is just a number. */
  const lines = page.getByTestId("earnings-lines");
  await expect(lines).toContainText("Held by SparkTower");
  await expect(lines).toContainText("Sent to your bank");
  await expect(lines).toContainText("Added to your SparkTower balance");
});

test("a creator with no bank account is pointed at their balance, and cannot choose a bank they haven't got", async ({ browser }) => {
  test.setTimeout(180_000);
  const creator = await personIn(browser, "203.0.113.72", "Fay");

  const page = await creator.context.newPage();
  await page.goto("/earnings");
  await expect(page.getByTestId("page-earnings")).toBeVisible({ timeout: 20_000 });

  /*
   * Nothing earned yet, and the page still has a job: telling somebody they
   * can set this up before there is money waiting on it.
   */
  await expect(page.getByTestId("earnings-empty")).toBeVisible();
  /*
   * This server has no Stripe: the browser suite blanks STRIPE_SECRET_KEY on
   * purpose (playwright.config.ts). So the card says payouts aren't switched
   * on, and — the part worth holding — it does not offer a button that cannot
   * work. It used to offer one anyway, because `available` was hardcoded true
   * for anybody who had never connected an account, and pressing it failed
   * inside the Stripe client with "Failed to create connect account".
   */
  await expect(page.getByTestId("card-bank")).toContainText("aren't switched on");
  await expect(page.getByTestId("button-connect-bank")).toHaveCount(0);

  // The balance is where money goes until they say otherwise.
  await expect(page.getByTestId("pick-balance")).toHaveAttribute("aria-pressed", "true");

  /*
   * And the bank cannot be chosen yet. Letting somebody point their earnings
   * at an account that cannot receive them is the original dead end arrived at
   * from the other direction — they would find out weeks later, with the money
   * still here.
   */
  await expect(page.getByTestId("pick-bank")).toBeDisabled();
  const refused = await creator.api.patch("/api/earnings/target", { data: { target: "bank" } });
  expect(refused.status()).toBe(422);
  // Either honest reason will do — that it is off here, or that they have no
  // account yet. What matters is that it is refused and said in words.
  expect((await refused.json()).message).toMatch(/switched on|connect/i);

  /* Refusing it must not have changed anything. */
  const after = (await sql("SELECT payout_target FROM users WHERE id = $1", [creator.id])).rows[0];
  expect(after.payout_target, "a refused switch should leave the choice unset").toBeNull();
});

/*
 * A won challenge prize is already money in hand — `releasePrize` credits the
 * winner in the same transaction that takes it out of escrow. This used to be
 * reported as money still to come, which would have had people waiting for
 * what they had already been paid.
 */
test("a won prize shows as already in the balance, not as something still coming", async ({ browser }) => {
  test.setTimeout(180_000);
  const winner = await personIn(browser, "203.0.113.73", "Gil");
  const company = await personIn(browser, "203.0.113.74", "Hana");

  const companyId = (await sql(
    `INSERT INTO companies (name, slug, website, verified_domain, verified_at, verified_method, created_by, created_at)
     VALUES ($1, $2, $3, $3, now(), 'file', $4, now()) RETURNING id`,
    [`Prize Co ${stamp()}`, `prize-co-${stamp()}`, `prize-${stamp()}.test`, company.id],
  )).rows[0].id as string;
  const challengeId = (await sql(
    `INSERT INTO company_challenges (company_id, title, brief, deadline, created_at)
     VALUES ($1, $2, 'Do the thing.', now() + interval '7 days', now()) RETURNING id`,
    [companyId, "Fix our onboarding"],
  )).rows[0].id as string;
  await sql(
    `INSERT INTO challenge_prizes (challenge_id, company_id, amount_cents, fee_cents, state, awarded_to, awarded_at, created_at)
     VALUES ($1, $2, 15000, 0, 'awarded', $3, now(), now())`,
    [challengeId, companyId, winner.id],
  );

  const page = await winner.context.newPage();
  await page.goto("/earnings");
  await expect(page.getByTestId("page-earnings")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("text-balance")).toHaveText("$150");
  await expect(page.getByTestId("text-held"), "a won prize is not held").toHaveText("$0");
  await expect(page.getByTestId("earnings-lines")).toContainText("Fix our onboarding");
  await expect(page.getByTestId("earnings-lines")).toContainText("Added to your SparkTower balance when you won it");
});
