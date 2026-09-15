/**
 * The Explore loop's message/comment step in a real browser, and the way back
 * from it: following a builder puts their progress in the Following feed, a
 * comment on it is the loop's action, and their reply comes back through the
 * bell to the post. The API version is test/integration/explore-comment.test.ts;
 * messaging is e2e/discover-actions.spec.ts.
 */
import { test, expect } from "@playwright/test";

const password = "Testpass123!";
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.71" } });

test("commenting on a followed builder's progress comes back round when they reply", async ({ page, browser }) => {
  const beaContext = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.72" } });
  const bea = beaContext.request;
  await bea.get("/");
  const beaUser = await (await bea.post("/api/auth/register", { data: { email: `e2e-bea-xc-${stamp()}@example.test`, password, firstName: "Bea", lastName: "Builder" } })).json();
  await bea.post("/api/profile/complete-onboarding", { data: { displayName: "Bea Builder", headline: "Shipping a meal planner", bio: "Building in public." } });
  const update = `Shipped fridge scanning ${stamp()}`;
  const post = await (await bea.post("/api/feed", { data: { postType: "project_update", content: update } })).json();

  await page.goto("/");
  expect((await page.request.post("/api/auth/register", { data: { email: `e2e-ari-xc-${stamp()}@example.test`, password, firstName: "Ari", lastName: "Explorer" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/profile/complete-onboarding", { data: { displayName: "Ari Explorer", headline: "Looking for builders", bio: "Here for the loop." } })).ok()).toBeTruthy();
  expect((await page.request.post(`/api/users/${beaUser.id}/follow`, { data: { following: true } })).ok()).toBeTruthy();

  // Her progress is in Following; Ari answers it.
  await page.goto("/?feed=following");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  await expect(page.getByText(update)).toBeVisible();
  await page.getByTestId(`button-comment-${post.id}`).click();
  await page.getByTestId(`textarea-comment-${post.id}`).fill("How accurate is the scan?");
  await page.getByTestId(`button-submit-comment-${post.id}`).click();
  await expect(page.getByText("How accurate is the scan?")).toBeVisible();

  // Bea replies to him.
  const comments = await (await bea.get(`/api/feed/${post.id}/comments`)).json();
  const ariComment = comments.find((c: any) => c.content === "How accurate is the scan?");
  expect((await bea.post(`/api/feed/${post.id}/comments`, { data: { content: "About 90% so far.", parentCommentId: ariComment.id } })).ok()).toBeTruthy();

  // The bell brings Ari back to the post, where the reply is.
  await page.goto("/");
  await expect(page.getByTestId("notifications-unread")).toBeVisible();
  await page.getByTestId("button-notifications").click();
  const reply = page.getByTestId("notifications-panel").getByText("Bea Builder replied to your comment");
  await expect(reply).toBeVisible();
  await reply.click();
  await expect(page).toHaveURL(new RegExp(`/posts/${post.id}$`));
  await expect(page.getByText("About 90% so far.")).toBeVisible();
});
