/**
 * The moderation loop in a real browser — the step's recorded test:
 * create content → report → appears in the queue → action changes
 * visibility → the audit entry exists and can be queried.
 *
 * Three people, each with their own address (sign-ups are limited per
 * address, and the other specs share localhost's): an author who comments
 * through the API, a reporter who reports through the check-in page, and a
 * reviewer who decides in the admin queue.
 */
import { test, expect, type Browser } from "@playwright/test";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();
const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

async function personIn(browser: Browser, ip: string, first: string) {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
  const api = context.request;
  await api.get("/");
  const res = await api.post("/api/auth/register", { data: { email: `e2e-${first.toLowerCase()}-${stamp()}@example.test`, password, firstName: first, lastName: "Mod" } });
  expect(res.ok()).toBeTruthy();
  expect((await api.post("/api/profile/complete-onboarding", {
    data: { displayName: `${first} Mod`, headline: "Here for the loop", bio: "Testing moderation." },
  })).ok()).toBeTruthy();
  return { context, api, id: (await res.json()).id as string };
}

/** Roles come from the environment at boot; the test grants one directly. */
async function makeReviewer(userId: string) {
  const client = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await client.connect();
  try {
    await client.query("UPDATE users SET platform_role = 'reviewer' WHERE id = $1", [userId]);
  } finally {
    await client.end();
  }
}

test("a reported comment is removed from the queue with a reason code, and the log shows it", async ({ browser }) => {
  const author = await personIn(browser, "203.0.113.41", "Author");
  const reporter = await personIn(browser, "203.0.113.42", "Reporter");
  const reviewer = await personIn(browser, "203.0.113.43", "Reviewer");
  await makeReviewer(reviewer.id);

  // 1. Content: a comment on the author's own public check-in.
  const project = await author.api.post("/api/projects", {
    data: { title: "Moderated", description: "A project whose check-in gets a comment that is reported.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  });
  const projectId = (await project.json()).id as string;
  const checkIn = await author.api.post(`/api/projects/${projectId}/check-ins`, {
    data: { goal: "Ship the thing", proof: "Shipped it, honestly", nextStep: "Tell people", needsFeedback: true, visibility: "public" },
  });
  expect(checkIn.ok()).toBeTruthy();
  const checkInId = (await checkIn.json()).id as string;
  const text = `Buy followers cheap at spam.example ${stamp()}`;
  expect((await author.api.post(`/api/projects/${projectId}/comments`, { data: { targetType: "check_in", targetId: checkInId, content: text } })).ok()).toBeTruthy();
  const commentsUrl = `/api/projects/${projectId}/comments?targetType=check_in&targetId=${checkInId}`;
  const commentId = ((await (await author.api.get(commentsUrl)).json()) as any[]).find((c) => c.content === text).id as string;

  // 2. Report it, from the check-in page, with a reason and a note.
  const reporterPage = await reporter.context.newPage();
  await reporterPage.goto(`/c/${checkInId}`);
  await expect(reporterPage.getByText(text)).toBeVisible();
  await reporterPage.getByTestId(`button-report-comment-${commentId}`).click();
  await reporterPage.getByTestId("report-reason-spam").click();
  await reporterPage.getByTestId("input-report-note").fill("Selling followers");
  await reporterPage.getByTestId("button-submit-report").click();
  await expect(reporterPage.getByText("Thanks — we'll take a look").first()).toBeVisible();

  // 3. It's in the reviewer's open queue, filtered to comments.
  const admin = await reviewer.context.newPage();
  await admin.goto("/admin/reports");
  await admin.getByTestId("tab-open").click();
  await admin.getByTestId("type-comment").click();
  const card = admin.getByTestId(/^report-/).filter({ hasText: text });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Selling followers");

  // 4. Decide: Apply stays off until both an action and a reason code are chosen.
  const apply = card.getByTestId(/^act-apply-/);
  await expect(apply).toBeDisabled();
  await card.getByTestId(/^act-action-/).selectOption("remove");
  await expect(apply).toBeDisabled();
  await card.getByTestId(/^act-reason-/).selectOption("spam");
  await card.getByTestId(/^act-note-/).fill("Link spam");
  await apply.click();
  await expect(admin.getByText("Remove — Spam or advertising").first()).toBeVisible();
  await expect(card).toHaveCount(0);

  // 5. Visibility changed: the reporter no longer sees it, even after a reload.
  await reporterPage.reload();
  await expect(reporterPage.getByText("Ship the thing").first()).toBeVisible();
  await expect(reporterPage.getByText(text)).toHaveCount(0);

  // 6. The audit entry: in the queue's history, and queryable from the API.
  await admin.getByTestId("tab-actioned").click();
  const history = admin.getByTestId(`history-${commentId}`);
  await expect(history).toContainText("Removed");
  await expect(history).toContainText("Spam or advertising");
  await expect(history).toContainText("Link spam");

  const log = await reviewer.api.get(`/api/admin/moderation-log?targetType=comment&targetId=${commentId}`);
  const [entry] = (await log.json()) as any[];
  expect(entry).toMatchObject({
    action: "comment_remove", actorId: reviewer.id, reasonCode: "spam", reason: "Link spam",
    previousState: { report: { status: "open" }, comment: { hiddenAt: null } },
    resultingState: { report: { status: "actioned" }, comment: { hiddenMode: "removed" } },
  });

  await Promise.all([author.context.close(), reporter.context.close(), reviewer.context.close()]);
});
