/**
 * Featured tools in a real browser: one shows up near the top of the home
 * feed; the next visit leads with a different one; hiding one takes it away;
 * an admin's video plays muted on its own, under our sound, pause and title controls, and a
 * referral link shows its perk. API-level: test/integration/promotions.test.ts.
 */
import { test, expect } from "@playwright/test";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();
// Real Chrome: the bundled test Chromium has no codecs for YouTube's streams, so videos buffer forever there.
test.use({ channel: "chrome" });

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("featured tools rotate through the feed, can be hidden, and play an admin's video", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "203.0.113.120" } });
  const api = context.request;
  await api.get("/");
  const me = await (await api.post("/api/auth/register", { data: { email: `e2e-promo-${stamp()}@example.test`, password: "Testpass123!", firstName: "Promo", lastName: "Viewer" } })).json();
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: "Promo Viewer", headline: "x", bio: "y" } })).ok()).toBeTruthy();
  for (let i = 0; i < 3; i++) await api.post("/api/feed", { data: { postType: "project_update", content: `Progress note ${i} ${stamp()}` } });

  // Near the top: first, or right after the first post.
  const page = await context.newPage();
  const firstPromo = async () => {
    await page.goto("/");
    const promo = page.locator('[data-testid^="promo-"][data-promo-slot="0"]');
    await expect(promo).toBeVisible();
    const cards = page.locator('[data-testid^="promo-"][data-promo-slot], [data-testid^="post-author-"]');
    expect(await cards.count()).toBeGreaterThan(1);
    return (await promo.getAttribute("data-testid"))!.replace("promo-", "");
  };
  const visited = new Set<string>();
  const first = await firstPromo();
  visited.add(first);
  const card = page.getByTestId(`promo-${first}`);
  await expect(card.getByTestId(`promo-cta-${first}`)).toHaveAttribute("target", "_blank");
  await expect(card.getByText(/Promotion ·/)).toBeVisible();

  // Each visit leads with one not seen before.
  for (let i = 0; i < 3; i++) {
    const next = await firstPromo();
    expect(visited.has(next), `visit ${i + 2} repeated ${next}`).toBe(false);
    visited.add(next);
  }

  // Hide one: gone, and it stays gone.
  const hideId = [...visited].pop()!;
  await page.getByTestId(`promo-hide-${hideId}`).click();
  await expect(page.getByTestId(`promo-${hideId}`)).toHaveCount(0);

  // An admin gives Replit a video, a referral link and a headline.
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { await db.query("UPDATE users SET platform_role = 'admin' WHERE id = $1", [me.id]); } finally { await db.end(); }
  await page.goto("/admin/promotions");
  await page.getByTestId("promo-admin-row-replit").click();
  await page.getByTestId("promo-admin-headline").fill("Agent builds, tests and deploys your app");
  await page.getByTestId("promo-admin-videoUrl").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByTestId("promo-admin-referralUrl").fill("https://replit.com/refer/sparktower");
  await expect(page.getByTestId("promo-cta-replit")).toContainText("Get $10 in credits");
  await page.getByTestId("promo-admin-save").click();
  await expect(page.getByText("Replit saved").first()).toBeVisible();

  // In the feed (only Replit left to show, so it's the one): poster, then the player in place.
  const others = await (await api.get("/api/admin/promotions")).json();
  for (const row of others.promotions) {
    if (row.promotion.id !== "replit") await api.put(`/api/admin/promotions/${row.promotion.id}`, { data: { active: false } });
  }
  await page.evaluate(() => localStorage.removeItem("st_promos_hidden"));
  await page.goto("/");
  const replit = page.getByTestId("promo-replit");
  await expect(replit).toBeVisible();
  await expect(replit.getByTestId("promo-headline-replit")).toHaveText("Agent builds, tests and deploys your app");
  await expect(replit.getByTestId("promo-cta-replit")).toHaveAttribute("href", "https://replit.com/refer/sparktower");
  await expect(replit.getByTestId("promo-cta-replit")).toHaveAttribute("rel", /sponsored/);
  await expect(replit.getByText("Referral link — SparkTower may earn a reward.")).toBeVisible();
  // The video plays by itself, muted, with captions asked for, under our own controls and the video's real title.
  const player = replit.getByTestId("promo-video-replit");
  await player.scrollIntoViewIfNeeded();
  await expect(player.locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ.*cc_load_policy=1/, { timeout: 20_000 });
  await expect(player).toHaveAttribute("data-playing", "true", { timeout: 30_000 });
  await expect(player).toHaveAttribute("data-muted", "true");
  await expect(replit.getByTestId("promo-video-replit-title")).toContainText("Never Gonna Give You Up", { timeout: 15_000 });
  // Sound on from the corner button.
  await replit.getByTestId("promo-video-replit-sound").click();
  await expect(player).toHaveAttribute("data-muted", "false");
  await expect(replit.getByTestId("promo-video-replit-sound")).toHaveAttribute("aria-pressed", "true");
  // The middle pauses, and plays again — still with sound.
  await replit.getByTestId("promo-video-replit-toggle").click();
  await expect(player).toHaveAttribute("data-playing", "false");
  await replit.getByTestId("promo-video-replit-toggle").click();
  await expect(player).toHaveAttribute("data-playing", "true", { timeout: 15_000 });
  await expect(player).toHaveAttribute("data-muted", "false");
  // And mute again.
  await replit.getByTestId("promo-video-replit-sound").click();
  await expect(player).toHaveAttribute("data-muted", "true");

  // Put the catalog back for other specs.
  for (const row of others.promotions) await api.put(`/api/admin/promotions/${row.promotion.id}`, { data: { active: true } });
});
