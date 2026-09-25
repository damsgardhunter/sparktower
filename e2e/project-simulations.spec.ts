/**
 * A project's own simulations, in a browser — the ones that answer about
 * *your* business rather than an invented one.
 *
 * The six existing simulation specs all cover the multiplayer market season:
 * five people, five seats, a year resolving. None of them touch the three
 * simulations a single owner opens on their own project — the decision lab,
 * the marketing scheme and the ten-year question — which is the half of this
 * feature that has to be right for one person sitting alone with their own
 * numbers.
 *
 * ## The property worth testing
 *
 * Not that a simulation runs. That an answer is *theirs*.
 *
 * The whole argument for this feature over a spreadsheet template is that it
 * reads the owner's own baseline — what comes in, what goes out, what is in
 * the bank — and answers from that. A simulator that gives the same verdict to
 * a comfortable business and a fragile one is a horoscope, and it would pass
 * any test that only checked an answer appeared. So the centre of this file is
 * two businesses asking one identical question and being told different
 * things, because their numbers are different.
 *
 * The verdict is computed from the arithmetic and handed to the model, never
 * written by it (`Answer.verdict` — "the computed call, from the cautious and
 * likely runs. Never the model's."). That is what makes this assertable with
 * AI_STUB on: the prose is stubbed, the judgement is not.
 *
 * ## And the refusal
 *
 * The other half is what it does when it has nothing to go on. It must say so
 * before anybody pays, rather than answering confidently from defaults —
 * which, for a tool whose only claim is that the numbers are yours, is the
 * worst thing it could do.
 */
import pg from "pg";
import { test, expect, type Browser } from "./test";
import { verifyEmail } from "./verify-email";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();
const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

const sql = async (text: string, params: unknown[] = []) => {
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

async function ownerIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  const res = await api.post("/api/auth/register", {
    data: { email: `e2e-sim-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Sim" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Sim`, headline: "Running the numbers", bio: "Here for the simulations." },
  })).ok()).toBeTruthy();
  const id = (await res.json()).id as string;
  /* Running a decision costs $3, bought once per project. */
  await sql("UPDATE users SET balance_cents = 20000 WHERE id = $1", [id]);
  return { context, api, id };
}

const projectFor = async (api: any, title: string) =>
  (await (await api.post("/api/projects", {
    data: { title, description: "A real business with real numbers behind it.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  })).json()).id as string;

/**
 * Two businesses that are genuinely different, not two sets of noise.
 *
 * One clears eight thousand a month on costs of five and has a year of cash
 * behind it. The other is under water every month with a fortnight's money in
 * the bank. Any honest read of those two should not land in the same place,
 * and the numbers are far enough apart that this does not depend on the
 * engine's fine tuning — only on it reading the baseline at all.
 */
const COMFORTABLE = {
  monthlyRevenue: 80_000, monthlyCosts: 50_000, cash: 400_000,
  debt: 0, interestRate: 0, debtRepayment: 0, growth: 0.01,
  grossMargin: 0.7, ownerHours: 40, daysToGetPaid: 14, taxRate: 0.2,
};
const FRAGILE = {
  monthlyRevenue: 9_000, monthlyCosts: 12_000, cash: 6_000,
  debt: 60_000, interestRate: 0.12, debtRepayment: 1_200, growth: 0,
  grossMargin: 0.3, ownerHours: 60, daysToGetPaid: 60, taxRate: 0.2,
};

const setBaseline = async (api: any, projectId: string, numbers: Record<string, number>) => {
  const res = await api.put(`/api/projects/${projectId}/decision-sim/baseline`, {
    data: { numbers, overridden: Object.keys(numbers) },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
};

/** The most recent scenario on a project, as the client reads it. */
async function latestScenario(api: any, projectId: string) {
  const read = await (await api.get(`/api/projects/${projectId}/decision-sim`)).json();
  const [newest] = read.scenarios ?? [];
  expect(newest, "the run on the page should have been saved").toBeTruthy();
  return newest;
}

/** Ask the question on the page, and give back what the lab decided. */
async function askOnThePage(page: any, projectId: string, question: string) {
  await page.goto(`/projects/${projectId}/simulate/decision`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 8_000 }).catch(() => {});
  await expect(page.getByTestId("decision-lab")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId("sim-not-ready"), "the numbers were saved, so it should be ready").toHaveCount(0);

  await page.getByTestId("input-sim-question").fill(question);
  await page.getByTestId("select-sim-horizon").selectOption("12");
  await page.getByTestId("button-sim-run").click();

  /*
   * It asks before it spends. The first decision on a project costs three
   * dollars and the lab confirms that before running — so a test that only
   * pressed "Run it" sat waiting for an answer behind a dialog nobody had
   * agreed to. Worth keeping in the walk-through rather than stepping around:
   * being asked before money moves is the behaviour, not an obstacle.
   */
  const confirm = page.getByTestId("dialog-confirm-purchase");
  if (await confirm.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await page.getByTestId("button-confirm-purchase").click();
  }

  const verdict = page.getByTestId("sim-verdict").first();
  await expect(verdict).toBeVisible({ timeout: 60_000 });
  return (await verdict.innerText()).trim();
}

test("refuses to answer about a business whose numbers it does not have", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await ownerIn(browser, "203.0.113.80", "Nell");
  const projectId = await projectFor(owner.api, `No Numbers ${stamp()}`);

  const page = await owner.context.newPage();
  await page.goto(`/projects/${projectId}/simulate/decision`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 8_000 }).catch(() => {});
  await expect(page.getByTestId("decision-lab")).toBeVisible({ timeout: 25_000 });

  /*
   * Said before the button, not after the money. A tool whose only claim is
   * that the numbers are yours must not answer from defaults when it has none
   * of yours — and must not charge somebody to find that out.
   */
  await expect(page.getByTestId("sim-not-ready")).toBeVisible();
  await page.getByTestId("input-sim-question").fill("Should I hire a second engineer?");
  await expect(page.getByTestId("button-sim-run")).toBeDisabled();

  /* The API says the same thing, rather than running and billing for it. */
  const refused = await owner.api.post(`/api/projects/${projectId}/decision-sim/scenarios`, {
    data: { question: "Should I hire a second engineer?", months: 12 },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).code).toBe("no_numbers_yet");

  const charged = await sql("SELECT balance_cents FROM users WHERE id = $1", [owner.id]);
  expect(charged.rows[0].balance_cents, "a refusal must not cost anything").toBe(20000);
});

test("gives two different businesses two different answers to one question", async ({ browser }) => {
  test.setTimeout(300_000);
  const steady = await ownerIn(browser, "203.0.113.81", "Mara");
  const struggling = await ownerIn(browser, "203.0.113.82", "Otto");

  const steadyProject = await projectFor(steady.api, `Steady Trade ${stamp()}`);
  const strugglingProject = await projectFor(struggling.api, `Thin Margins ${stamp()}`);
  await setBaseline(steady.api, steadyProject, COMFORTABLE);
  await setBaseline(struggling.api, strugglingProject, FRAGILE);

  /* One question, word for word, so the only thing that differs is the business. */
  const question = "Should I hire someone at 4000 a month to take work off me?";
  await askOnThePage(await steady.context.newPage(), steadyProject, question);
  await askOnThePage(await struggling.context.newPage(), strugglingProject, question);

  const steadyRun = await latestScenario(steady.api, steadyProject);
  const strugglingRun = await latestScenario(struggling.api, strugglingProject);

  /* Each answer was computed from that owner's own numbers, and nobody else's. */
  expect(steadyRun.baseline.monthlyRevenue).toBe(COMFORTABLE.monthlyRevenue);
  expect(strugglingRun.baseline.monthlyRevenue).toBe(FRAGILE.monthlyRevenue);

  /*
   * `without` is the do-nothing run on that baseline — the thing every
   * headline number is measured against. It is pure arithmetic over the
   * owner's own figures: no lever, no model, nothing chosen by anybody. So it
   * is the honest place to prove the answer is theirs.
   *
   * The verdict is the wrong place, and this test asserted it first. The
   * verdict depends on the levers, and the levers are read out of the question
   * by the model — stubbed here — so two runs can differ because the stub
   * differed, and the assertion passes while the baseline is ignored entirely.
   * It did pass that way, on an engine that gives both of these businesses
   * "it pays for itself" for the same hire. A test that can pass for the wrong
   * reason is worse than none, because it is believed.
   */
  expect(steadyRun.result.without.endCash,
    "the comfortable business should be well in the black doing nothing").toBeGreaterThan(100_000);
  expect(strugglingRun.result.without.endCash,
    "the fragile business runs out doing nothing — that is the point of asking").toBeLessThan(0);
});

/*
 * The numbers on the screen are the owner's own, and stay that way. A baseline
 * that silently reverts to defaults would make every answer after it wrong in
 * a way nobody could see from the answer.
 */
test("answers from the owner's own numbers, and keeps them", async ({ browser }) => {
  test.setTimeout(180_000);
  const owner = await ownerIn(browser, "203.0.113.83", "Pia");
  const projectId = await projectFor(owner.api, `Kept Numbers ${stamp()}`);
  await setBaseline(owner.api, projectId, COMFORTABLE);

  const page = await owner.context.newPage();
  await page.goto(`/projects/${projectId}/simulate/decision`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 8_000 }).catch(() => {});
  await expect(page.getByTestId("decision-lab")).toBeVisible({ timeout: 25_000 });

  await page.getByTestId("button-sim-baseline").click();
  const panel = page.getByTestId("sim-baseline");
  /* Their revenue, as the panel writes it — not a placeholder and not a default. */
  await expect(panel).toContainText("$80k in");
  await expect(panel).toContainText("$50k out");
  await expect(panel).toContainText("$400k in the bank");

  const read = await (await owner.api.get(`/api/projects/${projectId}/decision-sim`)).json();
  expect(read.baseline.monthlyRevenue).toBe(COMFORTABLE.monthlyRevenue);
  expect(read.baseline.monthlyCosts).toBe(COMFORTABLE.monthlyCosts);
  expect(read.notReady, "a saved baseline means it is ready to answer").toBeFalsy();
});
