/**
 * The build loop's last step, in a real browser: a project credits someone's
 * feedback in an update, and the next time that person opens their feed they
 * can see it was used — with the update's own questions, which is where the
 * loop starts again. The API-level version is test/integration/feedback-loop.test.ts;
 * this is the proof a person can see it.
 */
import { test, expect, type Browser } from "@playwright/test";
import { verifyEmail } from "./verify-email";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  const res = await api.post("/api/auth/register", { data: { email: `e2e-fb-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Loop" } });
  expect(res.ok()).toBeTruthy();
  // Accounts start unconfirmed; posting, commenting and reporting need the emailed link (server/email-verification.ts).
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Loop`, headline: "Here for the build loop", bio: "Testing feedback." },
  })).ok()).toBeTruthy();
  return { context, api };
}

test("feedback a project credits shows up for the person who gave it, with the next questions to answer", async ({ browser }) => {
  const builder = await personIn(browser, "203.0.113.51", "Builder");
  const ada = await personIn(browser, "203.0.113.52", "Ada");

  // 1. A progress post that asks something specific.
  const project = (await (await builder.api.post("/api/projects", {
    data: { title: `Loop Closer ${stamp()}`, description: "A meal planner that plans dinners from the fridge.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  })).json()) as { id: string; title: string };
  const first = await (await builder.api.post("/api/feed", {
    data: { postType: "project_update", projectId: project.id, content: "Shipped fridge scanning.", asks: ["Would you scan your fridge weekly?"] },
  })).json();

  // 2. Ada answers.
  const comments = await (await ada.api.post(`/api/feed/${first.id}/comments`, { data: { content: "Only if it makes a shopping list first." } })).json();
  const adaComment = comments.find((c: any) => c.content.startsWith("Only if"));

  // 3. The team turns it into a task, finishes it, and credits it in the next update — which asks the next question.
  const applied = await (await builder.api.post(`/api/feed/comments/${adaComment.id}/apply`, { data: {} })).json();
  expect((await builder.api.patch(`/api/kanban/${applied.task.id}`, { data: { status: "done" } })).ok()).toBeTruthy();
  const next = "Does the shopping list cover what you'd buy?";
  const update = await builder.api.post("/api/feed", {
    data: { postType: "project_update", projectId: project.id, content: "Added a shopping list before the plan.", closesCommentIds: [adaComment.id], asks: [next] },
  });
  expect(update.ok()).toBeTruthy();
  const updateId = (await update.json()).id as string;

  // 4. Ada's next feed load: she can see it was used, and what they're asking now.
  const page = await ada.context.newPage();
  await page.goto("/");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  const card = page.getByTestId("feedback-used-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Your feedback was used");
  await expect(card).toContainText(project.title);
  await expect(card).toContainText("Only if it makes a shopping list first.");
  await expect(page.getByTestId(`feedback-used-asks-${updateId}`)).toContainText(next);

  // The bell says so too.
  await expect(page.getByTestId("notifications-unread")).toBeVisible();
  await page.getByTestId("button-notifications").click();
  await expect(page.getByTestId("notifications-panel")).toContainText("used your feedback in an update");
  await page.keyboard.press("Escape");

  // 5. The loop starts again: she opens the update and answers it, and the card is put away.
  await page.getByTestId(`button-answer-update-${updateId}`).click();
  await expect(page).toHaveURL(new RegExp(`/posts/${updateId}$`));
  await page.getByTestId(`textarea-comment-${updateId}`).fill("Yes — group it by aisle.");
  await page.getByTestId(`button-submit-comment-${updateId}`).click();
  await expect(page.getByText("Yes — group it by aisle.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("feedback-used-card")).toHaveCount(0);
});
