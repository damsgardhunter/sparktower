/**
 * Featured tools in a real browser: one shows up near the top of the home
 * feed; the next visit leads with a different one; hiding one takes it away;
 * an admin's video plays muted on its own, under our sound, pause and title controls, and a
 * referral link shows its perk. API-level: test/integration/promotions.test.ts.
 */
import { test, expect } from "./test";
import { verifyEmail } from "./verify-email";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";
import { passMfa } from "./mfa-helper";

loadEnvFile();
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test("featured tools rotate through the feed, can be hidden, and play an admin's video", async ({ browser }) => {
  // Visits, admin edits across the whole catalog, and a real YouTube video: longer than the default minute.
  test.setTimeout(240_000);
  // The test address goes on the sign-up request only: sent on every request, YouTube's video servers refuse to stream to it.
  const context = await browser.newContext();
  const api = context.request;
  await api.get("/");
  const me = await (await api.post("/api/auth/register", { headers: { "x-forwarded-for": "203.0.113.120" }, data: { email: `e2e-promo-${stamp()}@example.test`, password: "Testpass123!", firstName: "Promo", lastName: "Viewer" } })).json();
  // Accounts start unconfirmed; posting, commenting and reporting need the emailed link (server/email-verification.ts).
  await verifyEmail(api);
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
  // Admin tools need 2FA on the session.
  await passMfa(api);
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

test("scrolling fast past loading videos doesn't throw", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const api = context.request;
  await api.get("/");
  const me = await (await api.post("/api/auth/register", { headers: { "x-forwarded-for": "203.0.113.121" }, data: { email: `e2e-promo-scroll-${stamp()}@example.test`, password: "Testpass123!", firstName: "Fast", lastName: "Scroller" } })).json();
  // Accounts start unconfirmed; posting, commenting and reporting need the emailed link (server/email-verification.ts).
  await verifyEmail(api);
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: "Fast Scroller", headline: "x", bio: "y" } })).ok()).toBeTruthy();
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { await db.query("UPDATE users SET platform_role = 'admin' WHERE id = $1", [me.id]); } finally { await db.end(); }
  // Admin tools need 2FA on the session.
  await passMfa(api);
  for (let i = 0; i < 20; i++) await api.post("/api/feed", { data: { postType: "project_update", content: `Scroll filler ${i} ${stamp()}` } });

  // Every promotion has a video, so every slot in the feed builds a player.
  const all = (await (await api.get("/api/admin/promotions")).json()).promotions as any[];
  const withVideo = all.slice(0, 12).map((r) => r.promotion.id);
  for (const r of all) {
    await api.put(`/api/admin/promotions/${r.promotion.id}`, { data: withVideo.includes(r.promotion.id) ? { videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } : { active: false } });
  }

  const errors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  // A slow connection to YouTube: each player exists for seconds before it's ready, which is the window fast scrolling hits.
  await context.route("https://www.youtube-nocookie.com/embed/**", async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
  await page.goto("/");
  await expect(page.locator('[data-testid^="promo-video-"]').first()).toBeVisible({ timeout: 20_000 });
  // Over the feed, which scrolls in its own panel; and check that it really moves.
  const overFeed = async () => { const box = await page.getByTestId("feed-filter-bar").boundingBox(); await page.mouse.move(box!.x + box!.width / 2, 400); };
  const scrollTop = () => page.evaluate(() => Math.max(...[...document.querySelectorAll("main, main *")].filter((el) => el.scrollHeight > el.clientHeight + 10).map((el) => el.scrollTop), window.scrollY));
  await overFeed();
  await page.mouse.wheel(0, 900);
  await expect.poll(scrollTop).toBeGreaterThan(300);
  // Fast, back and forth: players come into view mid-load and leave before they're ready.
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(40); }
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -900); await page.waitForTimeout(40); }
  }
  // And a reload mid-scroll, which tears every player down while some are still loading.
  await page.mouse.wheel(0, 2000);
  await page.reload();
  await expect(page.getByTestId("feed-filter-bar")).toBeVisible();
  await overFeed();
  for (let i = 0; i < 15; i++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(30); }
  await page.waitForTimeout(3000);
  expect(errors, errors.join("\n")).toEqual([]);

  for (const r of all) await api.put(`/api/admin/promotions/${r.promotion.id}`, { data: { active: true, videoUrl: "" } });
});
