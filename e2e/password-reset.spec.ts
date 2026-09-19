/**
 * Getting back in after forgetting the password, the way a person does it.
 *
 * This flow had no browser test, and it showed: the landing-page redesign that
 * moved the sign-in form into the right-hand panel dropped the "Forgot your
 * password?" link, and with it the only way anyone could reach /forgot-password
 * — nothing else on the site links there. Every unit of the flow still passed
 * its own tests. A person who forgot their password had no way in.
 *
 * So this starts where they start — the sign-in form — and holds the flow to
 * what it promises in the email it sends: the link works once, and setting a
 * new password signs you out everywhere else. The second is the one that
 * matters most and is least visible: a reset that leaves an old session alive
 * is how someone who stole a laptop keeps the account after its owner "fixed"
 * it.
 */
import { test, expect, type APIRequestContext } from "./test";
import { verifyEmail } from "./verify-email";

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** The newest message of a kind sent to an address, read from the development outbox. */
async function latestMail(reader: APIRequestContext, to: string, tag: string) {
  const res = await reader.get("/api/dev/outbox");
  expect(res.ok(), "the development outbox should be readable in tests").toBeTruthy();
  const { messages } = await res.json() as { messages: { to: string; text: string; tag?: string }[] };
  // Newest first; addresses are stored lowercased.
  return messages.find((m) => m.tag === tag && m.to?.toLowerCase() === to.toLowerCase());
}

test("someone who forgot their password gets back in from the sign-in form, and nobody else stays in", async ({ browser }) => {
  test.setTimeout(120_000);
  const email = `e2e-reset-${stamp()}@example.test`;
  const oldPassword = "Testpass123!";
  // Long and random: the policy refuses common and breached passwords.
  const newPassword = `Harbour-Lantern-${stamp()}-q7`;

  // The account, and a session left open somewhere — a laptop on a train.
  const laptop = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.211" } });
  const left = laptop.request;
  await left.get("/");
  expect((await left.post("/api/auth/register", { data: { email, password: oldPassword, firstName: "Rae", lastName: "Reset" } })).ok()).toBeTruthy();
  await verifyEmail(left, email);
  expect((await left.post("/api/profile/complete-onboarding", { data: { displayName: "Rae Reset", headline: "Locked out", bio: "Forgot it." } })).ok()).toBeTruthy();
  expect((await left.get("/api/auth/user")).status(), "the laptop is signed in").toBe(200);

  // Somewhere else, signed out, the password doesn't work — and the way out is next to the field.
  const phone = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.212" } });
  const page = await phone.newPage();
  await page.goto("/");
  // The panel opens on sign-up; a returning person switches to log in first.
  await page.getByTestId("tab-login").click();
  const forgot = page.getByTestId("link-forgot-password");
  await expect(forgot, "the sign-in form links to the reset — nothing else does").toBeVisible();
  await forgot.click();
  await expect(page).toHaveURL(/\/forgot-password$/);

  await page.getByTestId("input-forgot-email").fill(email);
  await page.getByTestId("button-submit-forgot").click();
  await expect(page.getByTestId("text-forgot-sent")).toBeVisible();

  // The link from the inbox.
  const mail = await latestMail(left, email, "password-reset");
  const link = /https?:\/\/[^\s]+\/reset-password\?token=[^\s]+/.exec(mail?.text ?? "")?.[0];
  expect(link, `a reset email for ${email}`).toBeTruthy();
  const path = new URL(link!).pathname + new URL(link!).search;

  await page.goto(path);
  await expect(page.getByTestId("reset-password-page")).toBeVisible();
  // The token is read once and taken out of the address bar, so it can't leak
  // through history, a screenshot, or the Referer of the next page.
  await expect(page).not.toHaveURL(/token=/);

  await page.getByTestId("input-reset-password").fill(newPassword);
  await page.getByTestId("input-reset-confirm").fill(newPassword);
  await page.getByTestId("button-submit-reset").click();
  await expect(page.getByTestId("reset-password-done")).toBeVisible({ timeout: 15_000 });

  // "Setting a new password signs you out everywhere else" — the email says so; hold it to that.
  expect((await left.get("/api/auth/user")).status(), "the laptop's session ended with the reset").toBe(401);

  // The old password is gone, the new one works — through the same form.
  const again = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.213" } });
  expect((await again.request.post("/api/auth/login", { data: { email, password: oldPassword } })).status(), "the old password").toBe(401);
  const signIn = await again.newPage();
  await signIn.goto("/");
  await signIn.getByTestId("tab-login").click();
  await signIn.getByTestId("input-login-email").fill(email);
  await signIn.getByTestId("input-login-password").fill(newPassword);
  await signIn.getByTestId("button-submit-login").click();
  await expect.poll(async () => (await again.request.get("/api/auth/user")).status(), { timeout: 15_000 }).toBe(200);

  /*
   * And the link is spent. The page only finds that out when the form is
   * submitted — it has no way to ask about a token up front — so a person who
   * clicks the email twice types a password before being told. Worth fixing;
   * what this holds is the part that matters for security: a used link cannot
   * set a password, and the dead end points at a new one.
   */
  const replay = await phone.newPage();
  await replay.goto(path);
  await replay.getByTestId("input-reset-password").fill(`${newPassword}-again`);
  await replay.getByTestId("input-reset-confirm").fill(`${newPassword}-again`);
  await replay.getByTestId("button-submit-reset").click();
  await expect(replay.getByTestId("reset-password-dead")).toBeVisible({ timeout: 15_000 });
  await expect(replay.getByTestId("link-request-new-reset")).toBeVisible();
  // The password it tried to set did not take.
  expect((await again.request.post("/api/auth/login", { data: { email, password: `${newPassword}-again` } })).status()).toBe(401);

  await laptop.close();
  await phone.close();
  await again.close();
});

test("asking for a reset never says whether an account exists", async ({ browser }) => {
  /*
   * The page answers the same way for an address with an account and one
   * without — otherwise the form is a free way to check whether someone uses
   * SparkTower. Compared as the person sees it: the same message, no error.
   */
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.214" } });
  const page = await context.newPage();
  await page.goto("/forgot-password");
  await page.getByTestId("input-forgot-email").fill(`nobody-${stamp()}@example.test`);
  await page.getByTestId("button-submit-forgot").click();
  await expect(page.getByTestId("text-forgot-sent")).toBeVisible();
  await expect(page.getByTestId("text-forgot-error")).toHaveCount(0);
  await context.close();
});
