/**
 * The two things a builder is now told before they spend a fortnight, driven
 * in a real browser: who is actually asking, and that the money is already
 * paid in.
 *
 * The server tests cover the rules. What they cannot see is whether the
 * screens say any of it — and the whole point of holding the prize is the
 * sentence on the page. A safe nobody is told about protects the same money
 * and persuades nobody to enter.
 *
 * ## Why the company is verified in the database here
 *
 * Proving a domain means answering a request on it, and the e2e server has no
 * internet and no nameserver. The proof itself is covered against a fake
 * transport in test/integration/company-verification.test.ts; what this walks
 * is everything after it. Verifying by UPDATE is the same shortcut
 * admin-console.spec.ts takes for a platform role, and for the same reason.
 */
import pg from "pg";
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();
const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function member(browser: any, ip: string, name: string) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = ctx.request;
  await api.get("/");
  const email = `e2e-ch-${stamp()}@example.test`;
  const me = await (await api.post("/api/auth/register", { data: { email, password, firstName: name } })).json();
  await verifyEmail(api, email);
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: name, headline: "x", bio: "y" } })).ok()).toBeTruthy();
  return { ctx, api, email, id: me.id as string };
}

const sql = async (text: string, params: any[]) => {
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

test("a company cannot be created without proving its website", async ({ browser }) => {
  test.setTimeout(120_000);
  const them = await member(browser, "203.0.113.250", "Carla");

  // The API refuses, which is the half that actually protects it.
  const refused = await them.api.post("/api/companies", { data: { name: "Totally Real Bank" } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).code).toBe("verification_required");

  // And the screen does not offer a way past it: the button stays disabled
  // until a domain is proved, so nobody fills a form to be told no at the end.
  const page = await them.ctx.newPage();
  await page.goto("/companies");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await page.getByTestId("button-new-company").click({ timeout: 20_000 }).catch(() => {});
  await expect(page.getByTestId("verify-domain")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("input-company-name").fill("Totally Real Bank");
  await expect(page.getByTestId("button-create-company")).toBeDisabled();

  await them.ctx.close();
});

test("a posted challenge shows the entrant a held prize and a checked domain", async ({ browser }) => {
  test.setTimeout(180_000);

  const company = await member(browser, "203.0.113.251", "Cora");
  // A verified company with money on its balance, seeded the way a platform
  // role is seeded elsewhere: the proof has its own coverage.
  const made = await sql(
    `INSERT INTO companies (name, slug, website, verified_domain, verified_at, verified_method, created_by, created_at)
     VALUES ($1, $2, $3, $3, now(), 'file', $4, now()) RETURNING id`,
    [`Acme ${stamp()}`, `acme-${stamp()}`, `acme-${stamp()}.test`, company.id],
  );
  const companyId = made.rows[0].id as string;
  await sql(`INSERT INTO company_members (company_id, user_id, role, joined_at) VALUES ($1,$2,'owner',now())`, [companyId, company.id]);
  await sql(`UPDATE users SET balance_cents = 100000 WHERE id = $1`, [company.id]);

  const posted = await company.api.post(`/api/companies/${companyId}/challenges`, {
    data: {
      title: "Read our spreadsheets",
      brief: "Build something that reads a spreadsheet and tells us, accurately, what is wrong with it before we send it.",
      terms: "Entries stay yours and we claim no rights over them. We may offer to hire you, and we will say so if you win.",
      deadline: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      prizeCents: 50_000,
    },
  });
  expect(posted.status(), await posted.text()).toBe(201);
  const challengeId = (await posted.json()).id as string;

  // The money really left the balance: $500 prize plus the $4.99 to post.
  const wallet = await (await company.api.get("/api/nova/wallet")).json();
  expect(wallet.wallet.balanceCents).toBe(100_000 - 50_000 - 499);

  // Now the person deciding whether to spend a fortnight on it.
  const entrant = await member(browser, "203.0.113.252", "Eddie");
  const page = await entrant.ctx.newPage();
  await page.goto(`/challenges/${challengeId}`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});

  await expect(page.getByTestId("text-challenge-title")).toBeVisible({ timeout: 20_000 });
  // The amount, the fact that it is already paid in, and who is asking.
  await expect(page.getByTestId("prize-held")).toContainText("$500");
  await expect(page.getByTestId("prize-assurance")).toContainText(/held by SparkTower/i);
  await expect(page.getByTestId("prize-assurance")).toContainText(/not a promise/i);
  await expect(page.getByTestId("company-verified")).toBeVisible();

  await company.ctx.close();
  await entrant.ctx.close();
});
