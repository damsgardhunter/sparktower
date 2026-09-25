/**
 * A company account, end to end in a browser.
 *
 * The company pages were built by four people's worth of work at once and type
 * checked, and that is all — nothing had opened them. This walks the flow an
 * existing business actually takes: create the account, open every tab, post
 * a challenge, and see a founder find it, accept the company's terms and
 * enter. The API-level claims are in test/integration/company-*.test.ts; this
 * is the check that the screens are really there and join up.
 */
import pg from "pg";
import { test, expect, type Browser } from "./test";
import { verifyEmail } from "./verify-email";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();

/*
 * Seeding, the way challenge-prize.spec.ts does it and for the same reason:
 * a company may not be created until its website is proved, and proving one
 * means answering a request on that domain, which the e2e server cannot do.
 * The refusal itself is covered by "a company cannot be created without
 * proving its website"; the transport is covered in
 * test/integration/company-verification.test.ts. What this spec is for is
 * everything that happens *after* a company exists.
 */
const sql = async (text: string, params: any[]) => {
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.E2E_SCREENSHOTS;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  expect((await api.post("/api/auth/register", {
    data: { email: `e2e-co-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Co" },
  })).ok()).toBeTruthy();
  const me = await (await api.get("/api/auth/user")).json();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Co`, headline: "Running a business", bio: "Here for the company tools." },
  })).ok()).toBeTruthy();
  return { context, api, id: me.id as string };
}

test("a company signs up, finds every tool, and a founder answers its challenge", async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await personIn(browser, "203.0.115.10", "Olive");
  const founder = await personIn(browser, "203.0.115.11", "Finn");

  /*
   * The company, already proved. The create form refuses until a domain has
   * been verified — see the note on `sql` above — so this walks in at the
   * point a real owner reaches once their proof has landed.
   */
  const domain = `harbour-${stamp()}.test`;
  const made = await sql(
    `INSERT INTO companies (name, slug, description, website, verified_domain, verified_at, verified_method, created_by, created_at)
     VALUES ($1, $2, $3, $4, $4, now(), 'file', $5, now()) RETURNING id`,
    ["Harbour Logistics", `harbour-${stamp()}`, "Freight forwarding for small importers.", domain, owner.id],
  );
  const companyId = made.rows[0].id as string;
  await sql(
    `INSERT INTO company_members (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())`,
    [companyId, owner.id],
  );
  /*
   * Money to post with. A challenge takes its prize and the posting fee out of
   * the owner's balance the moment it is posted (server/challenge-prizes.ts),
   * so without this the form submits and nothing appears — which is what the
   * missing row below turned out to be.
   */
  await sql(`UPDATE users SET balance_cents = 100000 WHERE id = $1`, [owner.id]);

  const page = await owner.context.newPage();
  await page.goto("/companies");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  // Reachable from the sidebar, not only by typing the address.
  await expect(page.getByTestId("link-companies")).toBeAttached({ timeout: 20_000 });
  await expect(page.getByTestId("link-challenges")).toBeAttached();
  await page.goto(`/companies/${companyId}`);
  await expect(page.getByTestId("text-company-name")).toHaveText("Harbour Logistics", { timeout: 20_000 });

  // Every tab opens onto something, not a blank panel or an error.
  for (const tab of ["run", "team", "training", "talent", "challenges", "scouting", "posts", "admin"]) {
    await page.getByTestId(`tab-${tab}`).click();
    await expect(page.getByRole("tabpanel")).not.toBeEmpty({ timeout: 15_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/company-${tab}.png`, fullPage: true });
  }

  // Post a challenge from the company's side.
  await page.getByTestId("tab-challenges").click();
  await page.getByTestId("button-new-challenge").click();
  await page.getByTestId("input-challenge-title").fill("Cut our customs delays in half");
  await page.getByTestId("input-challenge-brief").fill(
    "Shipments for small importers wait an average of four days at customs because paperwork arrives late or wrong. We want a way to get it right the first time.",
  );
  await page.getByTestId("input-challenge-prize").fill("$5,000 and a paid pilot");
  const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await page.getByTestId("input-challenge-deadline").fill(inAMonth);
  await page.getByTestId("input-challenge-terms").fill(
    "We pay the winner within 30 days of the announcement. Entrants keep ownership of what they submit; we may discuss a pilot with any entrant.",
  );
  await page.getByTestId("button-post-challenge").click();
  await expect(page.locator('[data-testid^="row-challenge-"]').first()).toContainText("Cut our customs delays", { timeout: 20_000 });

  // A founder finds it on the public list, reads the terms, and enters.
  const f = await founder.context.newPage();
  await f.goto("/challenges");
  await f.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await f.getByText("Cut our customs delays in half").first().click({ timeout: 20_000 });
  await expect(f.getByTestId("text-challenge-title")).toHaveText("Cut our customs delays in half", { timeout: 20_000 });
  await f.getByTestId("button-toggle-terms").click();
  await expect(f.getByTestId("text-terms")).toContainText("within 30 days");
  if (SHOTS) await f.screenshot({ path: `${SHOTS}/challenge.png`, fullPage: true });

  await f.getByTestId("input-entry-title").fill("Paperwork checked before it ships");
  await f.getByTestId("input-entry-pitch").fill(
    "A checklist tool importers fill in before the goods leave, which catches the five errors behind most customs holds and sends clean documents ahead.",
  );
  // Terms first: the button stays off until the company's terms are accepted.
  await expect(f.getByTestId("button-enter")).toBeDisabled();
  await f.getByTestId("checkbox-accept-terms").click();
  await f.getByTestId("button-enter").click();
  await expect(f.getByTestId("section-my-entry")).toBeVisible({ timeout: 20_000 });

  // And the company sees the entry.
  await page.reload();
  await page.getByTestId("tab-challenges").click();
  await page.locator('[data-testid^="button-toggle-entries-"]').first().click();
  await expect(page.getByText("Paperwork checked before it ships")).toBeVisible({ timeout: 20_000 });

  // The person's own side of recruiting: the opt-in page exists and starts off.
  const t = await founder.context.newPage();
  await t.goto("/talent");
  await expect(t.getByText(/companies/i).first()).toBeVisible({ timeout: 20_000 });
  if (SHOTS) await t.screenshot({ path: `${SHOTS}/talent.png`, fullPage: true });

  expect(companyId.length).toBeGreaterThan(10);
  await owner.context.close();
  await founder.context.close();
});
