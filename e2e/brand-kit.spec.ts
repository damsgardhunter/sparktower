/**
 * The dollar logo, in a browser.
 *
 * The integration test proves the money and the two pictures. What only a real
 * page can answer is whether somebody with an empty project page would ever
 * find this: it lives in the Setup tab, under two upload fields, on a screen
 * that already has a brief, a scope, a links hub and five image slots on it.
 * An offer nobody sees is the same as an offer that isn't there.
 *
 * So this one is about the screen: that the four looks are all on it before
 * anything is pressed (rather than hidden in a dropdown), that pressing one and
 * then the button puts a logo on the project, and that the way back is offered
 * rather than buried — because a generated logo replacing an uploaded one with
 * no undo is the worst thing this feature could do to somebody.
 *
 * It draws for real against `AI_STUB=1`, which answers image calls with a grey
 * PNG in process (server/ai-stub.ts). Before that existed, no browser test could
 * reach any image route: the stub client threw by name on `openai.images`.
 */
import { test, expect, type Page } from "./test";
import { verifyEmail } from "./verify-email";

/* This spec's own address, so its registrations don't spend another spec's sign-in budget. */
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.188" } });

const password = "Testpass123!";

/** An account with a dollar or two, and a project with a brief worth drawing from. */
async function projectFor(page: Page): Promise<string> {
  await page.goto("/");
  const email = `e2e-brand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  expect((await page.request.post("/api/auth/register", {
    data: { email, password, firstName: "Robin", lastName: "Maker" },
  })).ok()).toBeTruthy();
  await verifyEmail(page.request);
  expect((await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: "Robin Maker", headline: "Opening a tea room", bio: "Here for the logo." },
  })).ok()).toBeTruthy();

  const created = await page.request.post("/api/projects", {
    data: {
      title: "Kettle & Fern",
      description: "A booking page a small tea room can set up in ten minutes.",
      oneLiner: "We help small tea rooms take bookings without a website.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const project = await created.json();

  /*
   * A balance, through the dev switch rather than a card.
   *
   * `devUnlimited` makes every price nothing outside production
   * (server/wallet.ts), which is the only way to press a paid button in a test
   * without either a Stripe checkout or a direct write to the balance column.
   */
  const dev = await page.request.post("/api/dev/unlimited", { data: { on: true } });
  expect(dev.ok(), await dev.text()).toBeTruthy();

  return project.id as string;
}

async function openSetup(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}/manage?tab=setup`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 10_000 }).catch(() => {});
  await expect(page.getByTestId("brand-kit")).toBeVisible({ timeout: 15_000 });
}

test("offers four looks under the upload fields, and draws the one that was picked", async ({ page }) => {
  const projectId = await projectFor(page);
  await openSetup(page, projectId);

  /*
   * All four visible at once. The choice between them is the only decision on
   * this card, and three of four behind a press is the wrong way round for
   * somebody who does not know what "symmetric" means until they read the line
   * under it.
   */
  for (const style of ["name", "artistic", "simple", "symmetric"]) {
    await expect(page.getByTestId(`button-logo-style-${style}`)).toBeVisible();
  }

  /* It says what it is: a placeholder, and what it costs. */
  await expect(page.getByTestId("brand-kit")).toContainText(/placeholder/i);

  await page.getByTestId("button-logo-style-artistic").click();
  await expect(page.getByTestId("button-logo-style-artistic")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("button-logo-style-name")).toHaveAttribute("aria-checked", "false");

  await page.getByTestId("button-draw-brand-kit").click();

  /*
   * Drawn, and on the project. Asserted through the API rather than by looking
   * for an <img>: the upload field shows a preview from the same field, so a
   * picture on screen is weaker evidence than the row itself, and the row is
   * what every other surface in the product reads.
   */
  await expect(async () => {
    const project = await (await page.request.get(`/api/projects/${projectId}`)).json();
    expect(project.logoUrl, "a logo was drawn and saved").toMatch(/^\/objects\/uploads\//);
    expect(project.coverUrl, "and a cover built around it").toMatch(/^\/objects\/uploads\//);
  }).toPass({ timeout: 60_000 });
});

test("offers the way back when it replaces images the owner uploaded", async ({ page }) => {
  const projectId = await projectFor(page);

  /* Their own logo first — this is the case the undo exists for. */
  const mine = "/objects/uploads/e2e-my-own-logo";
  expect((await page.request.patch(`/api/projects/${projectId}`, { data: { logoUrl: mine } })).ok()).toBeTruthy();

  await openSetup(page, projectId);
  /* With a logo already there, the card offers a different one rather than a first one. */
  await expect(page.getByTestId("brand-kit")).toContainText(/different placeholder/i);

  await page.getByTestId("button-logo-style-simple").click();
  await page.getByTestId("button-draw-brand-kit").click();

  const undo = page.getByTestId("button-undo-brand-kit");
  await expect(undo, "replacing somebody's own logo has to be one press to undo").toBeVisible({ timeout: 60_000 });
  await undo.click();

  await expect(async () => {
    const project = await (await page.request.get(`/api/projects/${projectId}`)).json();
    expect(project.logoUrl, "their own image is back, because nothing was deleted").toBe(mine);
  }).toPass({ timeout: 30_000 });
});
