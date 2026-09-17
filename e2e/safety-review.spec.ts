/**
 * The admin safety loop in a real browser:
 *
 *   the daily review shows what needs attention → the reviewer acts in the
 *   reports queue → "See impact" lands on that action's before/after → the
 *   checklist records the review → the sidebar stops saying it's due.
 *
 * The moderation-loop spec proves the act itself; this proves what comes
 * after it, which is the part that closes the loop.
 */
import { test, expect, type Browser } from "@playwright/test";
import { verifyEmail } from "./verify-email";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";
import { passMfa } from "./mfa-helper";

loadEnvFile();
const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  const res = await api.post("/api/auth/register", { data: { email: `e2e-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Safety" } });
  expect(res.ok()).toBeTruthy();
  // Accounts start unconfirmed; posting, commenting and reporting need the emailed link (server/email-verification.ts).
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Safety`, headline: "Here for the loop", bio: "Testing the safety review." },
  })).ok()).toBeTruthy();
  return { context, api, id: (await res.json()).id as string };
}

async function makeReviewer(userId: string) {
  const client = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await client.connect();
  try {
    await client.query("UPDATE users SET platform_role = 'reviewer' WHERE id = $1", [userId]);
  } finally {
    await client.end();
  }
}

test("a reviewer acts on a report, sees what it did, and records the daily review", async ({ browser }) => {
  const author = await personIn(browser, "203.0.113.190", "Author");
  const reporter = await personIn(browser, "203.0.113.191", "Reporter");
  const reviewer = await personIn(browser, "203.0.113.53", "Reviewer");
  await makeReviewer(reviewer.id);
  // Review tools need 2FA on the session.
  await passMfa(reviewer.api);

  // A reported comment, set up through the API.
  const project = await author.api.post("/api/projects", {
    data: { title: "Safety Target", description: "A project that draws a comment that gets reported.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  });
  const projectId = (await project.json()).id as string;
  const text = `Cheap followers at spam.example ${stamp()}`;
  expect((await author.api.post(`/api/projects/${projectId}/comments`, { data: { targetType: "project", targetId: projectId, content: text } })).ok()).toBeTruthy();
  const comments = (await (await author.api.get(`/api/projects/${projectId}/comments?targetType=project&targetId=${projectId}`)).json()) as any[];
  const commentId = comments.find((c) => c.content === text).id as string;
  expect((await reporter.api.post("/api/reports", { data: { targetType: "comment", targetId: commentId, reason: "spam" } })).ok()).toBeTruthy();

  // 1. The review opens with the open report, and the sidebar says it's due.
  const page = await reviewer.context.newPage();
  await page.goto("/admin/safety");
  await expect(page.getByTestId("admin-safety")).toBeVisible();
  await expect(page.getByTestId("safety-reports")).toContainText("Open");
  await expect(page.getByTestId("alert-open-reports")).toBeVisible();
  await expect(page.getByTestId("badge-safety")).toBeVisible();

  // 2. Act in the queue, then follow "See impact" back to that action.
  await page.getByTestId("safety-reports").getByRole("link", { name: "Open queue" }).click();
  await page.getByTestId("type-comment").click();
  const card = page.getByTestId(/^report-/).filter({ hasText: text });
  await card.getByTestId(/^act-action-/).selectOption("remove");
  await card.getByTestId(/^act-reason-/).selectOption("spam");
  await card.getByTestId(/^act-apply-/).click();
  await page.getByTestId("toast-see-impact").click();
  await page.waitForURL(/\/admin\/safety#action-/);
  const logId = new URL(page.url()).hash.replace("#action-", "");

  const impact = page.getByTestId(`impact-${logId}`);
  await expect(impact).toBeVisible();
  await expect(impact).toContainText("Removed a comment");
  await expect(impact).toContainText("Too early");
  await expect(page.getByTestId(`impact-headline-${logId}`)).toContainText("Too soon to read");
  // The report is decided, so the open-reports alert is gone.
  await expect(page.getByTestId("alert-open-reports")).toHaveCount(0);

  // 3. The checklist: complete only once everything is ticked.
  const complete = page.getByTestId("button-complete-review");
  await expect(complete).toBeDisabled();
  for (const id of ["reports", "limits", "impact", "surfaces"]) await page.getByTestId(`check-${id}`).click();
  await page.getByTestId("input-review-note").fill("Removed link spam; nothing else moving.");
  await complete.click();
  await expect(page.getByText("Review recorded").first()).toBeVisible();

  // 4. The next pass starts from here: it names this review, and nothing says it's due.
  await expect(page.getByTestId("safety-checklist")).toContainText("Removed link spam; nothing else moving.");
  await expect(page.getByTestId("alert-review-due")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("admin-safety")).toBeVisible();
  await expect(page.getByTestId("badge-safety")).toHaveCount(0);

  await Promise.all([author.context.close(), reporter.context.close(), reviewer.context.close()]);
});
