/**
 * The way out when the path is not where the builder actually is.
 *
 * This control went in next to "Tell Nova" and "Re-evaluate", which is where
 * it belongs by meaning and nowhere by visibility: that row lives inside the
 * Progress block, which is collapsed until somebody opens it. A builder whose
 * plan has drifted is the least likely person to go hunting behind a fold for
 * the thing that fixes it, and the first report was simply "I don't see it".
 *
 * So the assertion is on the button, visible, without expanding anything. The
 * first version of this test asserted on the row that contains it, which
 * passed while the button was in doubt — a test that watches the wrapper does
 * not watch the control.
 */
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";
import { finishOnboarding } from "./onboarding";

test.use({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.212" } });
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("a builder can reach 'catch up with my direction' without opening anything", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const email = `dir-${stamp()}@example.test`;
  expect((await page.request.post("/api/auth/register", {
    data: { email, password: "Rt7wqz!Mk4vLp", firstName: "Dee" },
  })).ok()).toBeTruthy();
  await verifyEmail(page.request, email);
  await finishOnboarding(page.request, { displayName: "Dee Rivers", headline: "building", bio: "here to build" });
  const made = await page.request.post("/api/projects", {
    data: {
      title: "Direction Co", description: "A project for checking the catch-up control is reachable.",
      category: "saas", goal: "ship_mvp", subcategory: "saas",
    },
  });
  const projectId = (await made.json()).id as string;

  await page.goto(`/projects/${projectId}/manage`);
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 4_000 }).catch(() => {});

  /* The button itself, visible, with nothing expanded first. */
  const button = page.getByTestId("button-nova-direction");
  await expect(button).toBeVisible({ timeout: 25_000 });
  await expect(button).toContainText("Catch up with my direction");

  // And it opens onto the asks rather than being a dead control.
  await button.click();
  await expect(page.getByText("What no longer matches my plan?")).toBeVisible({ timeout: 15_000 });
});
