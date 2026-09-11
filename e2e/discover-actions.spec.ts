/**
 * Follow, Connect and Message from the cards, between two real accounts.
 *
 * Bea is found; Ari does the finding. The flow is the step's own evidence:
 * each action changes the card at once, the change survives a reload because
 * the server has it, and a failure puts the card back and says so. The failure
 * is a real refused request — the route is intercepted to answer 500 — rather
 * than a simulator, which is the part of the original packet that was dropped.
 */
import { test, expect } from "@playwright/test";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("cards connect with a note, message in one tap, follow instantly — and a refusal reverts", async ({ page, browser }) => {
  // Bea, in her own browser context so her session is hers.
  const beaContext = await browser.newContext();
  const bea = beaContext.request;
  await bea.get("/");
  const beaUser = await bea.post("/api/auth/register", { data: { email: `e2e-bea-${stamp()}@example.test`, password, firstName: "Bea", lastName: "Builder" } });
  expect(beaUser.ok()).toBeTruthy();
  const beaId = (await beaUser.json()).id as string;
  expect((await bea.post("/api/profile/complete-onboarding", {
    data: { displayName: "Bea Builder", headline: "Shipping a habit tracker", bio: "Building in public." },
  })).ok()).toBeTruthy();
  const created = await bea.post("/api/projects", {
    data: { title: "Habit Tracker", description: "A small app that helps people keep one habit going for a month.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).id as string;

  // Ari, in the page.
  await page.goto("/");
  const ariUser = await page.request.post("/api/auth/register", { data: { email: `e2e-ari-${stamp()}@example.test`, password, firstName: "Ari", lastName: "Explorer" } });
  expect(ariUser.ok()).toBeTruthy();
  const ariId = (await ariUser.json()).id as string;
  expect((await page.request.post("/api/profile/complete-onboarding", {
    data: { displayName: "Ari Explorer", headline: "Looking for a co-builder", bio: "Here for the loop." },
  })).ok()).toBeTruthy();

  // Connect from Discover, with a note. The card changes at once.
  const note = "Saw your habit tracker — I'm building something similar.";
  await page.goto("/discover");
  await page.getByTestId(`button-connect-${beaId}`).click();
  await page.getByTestId("input-connect-note").fill(note);
  await page.getByTestId("button-send-connect").click();
  await expect(page.getByTestId(`button-requested-${beaId}`)).toBeVisible();
  await expect(page.getByText("Request sent to Bea Builder")).toBeVisible();

  // Bea gets the note with the request, and accepts.
  const requests = (await (await bea.get("/api/connections/requests")).json()) as any[];
  const fromAri = requests.find((r) => r.requesterId === ariId);
  expect(fromAri.note).toBe(note);
  expect((await bea.post(`/api/connections/${fromAri.id}/accept`)).ok()).toBeTruthy();

  // Back on Discover the card offers a message, already written; one tap sends it.
  await page.reload();
  await page.getByTestId(`button-message-${beaId}`).click();
  const draft = page.getByTestId("input-message-draft");
  await expect(draft).not.toHaveValue("");
  const sent = await draft.inputValue();
  await page.getByTestId("button-send-message").click();
  await expect(page.getByText("Sent to Bea Builder", { exact: true })).toBeVisible();
  const thread = (await (await bea.get(`/api/messages/${ariId}`)).json()) as any[];
  expect(thread.some((m) => m.content === sent)).toBe(true);

  // Follow on the project list: instant, and still there after a reload.
  await page.goto("/projects");
  await page.getByTestId(`button-follow-${projectId}`).click();
  await expect(page.getByTestId(`button-follow-${projectId}`)).toHaveText(/Following/);
  await page.reload();
  await expect(page.getByTestId(`button-follow-${projectId}`)).toHaveText(/Following/);

  // A refusal reverts: the server says no to the unfollow, and the card goes back.
  await page.route(`**/api/projects/${projectId}/follow`, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "The server fell over" }) }));
  await page.getByTestId(`button-follow-${projectId}`).click();
  await expect(page.getByText("Couldn't update")).toBeVisible();
  await expect(page.getByTestId(`button-follow-${projectId}`)).toHaveText(/Following/);

  await beaContext.close();
});
