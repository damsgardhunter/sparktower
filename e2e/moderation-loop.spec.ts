/**
 * The moderation loop in a real browser — the step's recorded test:
 * create content → report → appears in the queue → action changes
 * visibility → the audit entry exists and can be queried.
 *
 * Three people, each with their own address (sign-ups are limited per
 * address, and the other specs share localhost's): an author who comments
 * through the API, a reporter who reports through the API (with the reason,
 * detail and note the report form sends) and reads the thread back, and a
 * reviewer who decides in the admin queue, in the browser.
 *
 * The reporter's side used to run on the check-in page, the one page that
 * showed a project comment with a report button. Check-ins were retired; the
 * decision half of the loop, which is the part a reviewer can get wrong, is
 * still clicked through.
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

  // 1. Content: a comment on the author's own public project.
  const project = await author.api.post("/api/projects", {
    data: { title: "Moderated", description: "A project that gets a comment that is reported.", category: "saas", goal: "ship_mvp", subcategory: "saas" },
  });
  const projectId = (await project.json()).id as string;
  const text = `Buy followers cheap at spam.example ${stamp()}`;
  expect((await author.api.post(`/api/projects/${projectId}/comments`, { data: { targetType: "project", targetId: projectId, content: text } })).ok()).toBeTruthy();
  const commentsUrl = `/api/projects/${projectId}/comments?targetType=project&targetId=${projectId}`;
  const commentId = ((await (await author.api.get(commentsUrl)).json()) as any[]).find((c) => c.content === text).id as string;
  const reporterSees = async () => ((await (await reporter.api.get(commentsUrl)).json()) as any[]).some((c) => c.content === text);
  expect(await reporterSees()).toBe(true);

  // 2. Report it, with a reason, the detail and a note — what the report form sends.
  const filed = await reporter.api.post("/api/reports", { data: { targetType: "comment", targetId: commentId, reason: "spam", detail: "selling", note: "Selling followers" } });
  expect(filed.ok()).toBeTruthy();
  expect(await filed.json()).toMatchObject({ received: true });

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

  // 5. Visibility changed: the reporter no longer sees it.
  expect(await reporterSees()).toBe(false);

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

  // 7. Undo, from the same history: its own reason code, the comment back for the reporter, the report open again.
  await history.getByTestId(`button-undo-${entry.id}`).click();
  const confirm = history.getByTestId(`button-confirm-undo-${entry.id}`);
  await expect(confirm).toBeDisabled();
  await history.getByTestId(`select-undo-reason-${entry.id}`).selectOption("reviewer_error");
  await confirm.click();
  await expect(admin.getByText("Undone").first()).toBeVisible();
  expect(await reporterSees()).toBe(true);
  await admin.getByTestId("tab-open").click();
  await expect(admin.getByTestId(/^report-/).filter({ hasText: text })).toBeVisible();
  const [restore] = (await (await reviewer.api.get(`/api/admin/moderation-log?targetType=comment&targetId=${commentId}`)).json()) as any[];
  expect(restore).toMatchObject({ action: "comment_restore", reasonCode: "reviewer_error", details: { undoes: entry.id } });

  // Leave the queue as it was found: the reopened report is decided again, so a later spec's open-reports count starts clean.
  const reopened = ((await (await reviewer.api.get("/api/admin/reports?status=open&type=comment")).json()) as any[]).find((r) => r.targetId === commentId);
  expect((await reviewer.api.post(`/api/admin/reports/${reopened.id}/act`, { data: { action: "dismiss", reasonCode: "no_violation" } })).ok()).toBeTruthy();

  await Promise.all([author.context.close(), reporter.context.close(), reviewer.context.close()]);
});
