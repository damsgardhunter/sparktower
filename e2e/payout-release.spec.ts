/**
 * Backers' money leaving escrow, in a real browser.
 *
 * This is the most consequential thing anybody does in this product: a
 * reviewer decides that other people's money may be paid to a creator. It had
 * no browser test at all — the word "release" appeared nowhere in e2e/ — and
 * the screen it happens on, /admin/backing, was reachable by nobody in this
 * suite. Its arithmetic and its locking are covered at API level in
 * test/integration/backing-money.test.ts; what was missing is whether the
 * screen a reviewer actually uses joins up.
 *
 * ## Why the creator has no Stripe account here
 *
 * Because that used to be a dead end and is now the interesting path. Release
 * refused outright without a connected account — a 422, and the backers' money
 * sat in escrow indefinitely — so a creator who never got through Stripe's
 * identity checks could not be paid. It now settles into their SparkTower
 * balance instead, which needs no bank and no third party, so this whole
 * journey runs without Stripe being reachable. Paying out to a bank is the
 * other branch and needs Stripe, which is why it is checked in the integration
 * tests rather than here.
 *
 * ## What it holds
 *
 * That a pending campaign is *visible* to a reviewer; that approving does not
 * by itself move money; that releasing moves exactly the held amount, less the
 * platform's fee; and that the creator can then see it. The last one matters
 * most — money that has left escrow and not arrived anywhere a person can see
 * is the failure this pair of specs exists to catch.
 */
import pg from "pg";
import { test, expect, type Browser } from "./test";
import { verifyEmail } from "./verify-email";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";
import { passMfa } from "./mfa-helper";
import { creatorPayoutCents, PLATFORM_FEE_PERCENT } from "../shared/backing";

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
    data: { email: `e2e-pay-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Payout" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Payout`, headline: "In the money path", bio: "Here for the payout." },
  })).ok()).toBeTruthy();
  return { context, api, id: (await res.json()).id as string };
}

/** A pledge of £25, collected and waiting on a decision. */
const PLEDGE_CENTS = 2500;

test("a reviewer releases held pledges, and the creator can see the money arrive", async ({ browser }) => {
  /*
   * Three people, and the third is not optional: a reviewer on the project
   * cannot release its funds (`reviewerHasStake`), so the creator and the
   * reviewer have to be different accounts for this to be reachable at all.
   */
  test.setTimeout(240_000);
  const creator = await personIn(browser, "203.0.113.60", "Cara");
  const backer = await personIn(browser, "203.0.113.61", "Bram");
  const reviewer = await personIn(browser, "203.0.113.62", "Rhys");

  await sql("UPDATE users SET platform_role = 'reviewer' WHERE id = $1", [reviewer.id]);
  // Anything that moves money needs 2FA on the session (server/mfa.ts).
  await passMfa(reviewer.api);

  const project = await (await creator.api.post("/api/projects", {
    data: { title: `Backed Thing ${stamp()}`, description: "Something people pay toward.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  })).json();

  /*
   * The campaign and the pledge are seeded rather than driven through
   * checkout: taking a pledge means Stripe charging a card, which is not
   * reachable here. What is being tested starts once the money is held.
   */
  await sql(
    `INSERT INTO project_backing_campaigns (project_id, review_status, submitted_for_review_at)
     VALUES ($1, 'pending', now())`,
    [project.id],
  );
  await sql(
    `INSERT INTO project_backings (project_id, backer_id, amount_cents, status, stripe_payment_intent_id, unclaimed_preference, created_at)
     VALUES ($1, $2, $3, 'held', $4, 'refund', now())`,
    [project.id, backer.id, PLEDGE_CENTS, `pi_e2e_${stamp()}`],
  );

  // 1. The reviewer finds it waiting, with the held money named.
  const desk = await reviewer.context.newPage();
  await desk.goto("/admin/backing");
  await expect(desk.getByTestId("backing-review")).toBeVisible({ timeout: 20_000 });
  /* Keyed by project id, so this picks out ours and not another spec's. */
  const row = desk.getByTestId(`queue-${project.id}`);
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row, "the queue should say what is held before it is opened").toContainText("held");
  await row.click();

  /*
   * Nothing to release yet. The two steps are deliberately separate —
   * approving says "this project is real", releasing says "send this specific
   * money" — so one mistake cannot do both, and the button is not there to be
   * pressed before the decision it depends on.
   */
  await expect(desk.getByTestId("button-release")).toHaveCount(0);

  // 2. Approved. The money still has not moved.
  await desk.getByTestId("textarea-review-notes").fill("Checked the project and the people behind it.");
  await desk.getByTestId("button-approve").click();
  const heldAfterApproval = await sql(
    "SELECT status FROM project_backings WHERE project_id = $1", [project.id],
  );
  expect(heldAfterApproval.rows.every((r) => r.status === "held"), "approving moved money on its own").toBe(true);

  // 3. Released — and the button says the amount, so nobody presses it blind.
  const release = desk.getByTestId("button-release");
  await expect(release).toBeVisible({ timeout: 20_000 });
  await expect(release).toContainText("25");
  await release.click();

  /*
   * Settled into the creator's balance, less the platform's cut. No transfer
   * id, because there was no transfer — that absence is how the two payout
   * routes are told apart afterwards (server/backing-routes.ts).
   */
  await expect
    .poll(async () => (await sql("SELECT status FROM project_backings WHERE project_id = $1", [project.id])).rows[0]?.status,
      { timeout: 30_000 })
    .toBe("released");

  const settled = (await sql("SELECT stripe_transfer_id FROM project_backings WHERE project_id = $1", [project.id])).rows[0];
  expect(settled.stripe_transfer_id, "settled to a balance, so there is no Stripe transfer").toBeNull();

  const paid = creatorPayoutCents(PLEDGE_CENTS);
  const balance = (await sql("SELECT balance_cents FROM users WHERE id = $1", [creator.id])).rows[0];
  expect(balance.balance_cents, `the creator should hold the pledge less the ${PLATFORM_FEE_PERCENT}% fee`).toBe(paid);

  // 4. And the creator can see it, which is the point of releasing it.
  const earnings = await (await creator.api.get("/api/earnings")).json();
  expect(earnings.toBalanceCents).toBe(paid);
  expect(earnings.heldCents, "nothing should still be held").toBe(0);
});

/*
 * The guard that matters most on this screen, because it is the one a busy
 * reviewer would never think to check about themselves.
 */
test("a reviewer cannot release funds on a project they are on", async ({ browser }) => {
  test.setTimeout(180_000);
  const reviewer = await personIn(browser, "203.0.113.63", "Ivy");
  const backer = await personIn(browser, "203.0.113.64", "Ned");
  await sql("UPDATE users SET platform_role = 'reviewer' WHERE id = $1", [reviewer.id]);
  await passMfa(reviewer.api);

  // Their own project: approved already, with money waiting.
  const mine = await (await reviewer.api.post("/api/projects", {
    data: { title: `My Own Thing ${stamp()}`, description: "A project the reviewer is on.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  })).json();
  await sql(
    `INSERT INTO project_backing_campaigns (project_id, review_status, submitted_for_review_at)
     VALUES ($1, 'approved', now())`,
    [mine.id],
  );
  await sql(
    `INSERT INTO project_backings (project_id, backer_id, amount_cents, status, stripe_payment_intent_id, unclaimed_preference, created_at)
     VALUES ($1, $2, $3, 'held', $4, 'refund', now())`,
    [mine.id, backer.id, PLEDGE_CENTS, `pi_e2e_${stamp()}`],
  );

  const refused = await reviewer.api.post(`/api/admin/backing/${mine.id}/release`, { data: {} });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe("reviewer_conflict");

  const still = (await sql("SELECT status FROM project_backings WHERE project_id = $1", [mine.id])).rows[0];
  expect(still.status, "a refused release must not have moved anything").toBe("held");
});
