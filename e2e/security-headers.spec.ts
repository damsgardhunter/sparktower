/**
 * The Content Security Policy against the real pages: the headers are there,
 * the app can't be framed, and nothing the app itself loads is blocked — the
 * home feed with a YouTube promotion playing, a public artifact page, the
 * project manager, the invite screen. The browser tests all run with the
 * policy enforced (CSP_ENFORCE=1); this one fails on any violation it sees.
 */
import { test, expect, type Page } from "@playwright/test";
import pg from "pg";
import { loadEnvFile } from "../test/setup/env";
import { testDatabaseUrl } from "../test/setup/database";

loadEnvFile();
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** Every CSP violation the page reports, from the browser's own event. */
async function watchViolations(page: Page) {
  const violations: string[] = [];
  await page.exposeFunction("__cspViolation", (v: string) => { violations.push(v); });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => (window as any).__cspViolation(`${e.violatedDirective} blocked ${e.blockedURI || "(inline)"} on ${location.pathname}`));
  });
  page.on("console", (m) => { if (/Content[- ]Security[- ]Policy/i.test(m.text())) violations.push(m.text().slice(0, 300)); });
  return violations;
}

test("security headers are set, the app can't be framed, and the pages load nothing the policy blocks", async ({ browser, request }) => {
  test.setTimeout(240_000);

  // Headers on a page and on an API response.
  const html = await request.get("/", { headers: { accept: "text/html" } });
  const h = html.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["content-security-policy-report-only"]).toBeUndefined();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
  expect((await request.get("/api/surfaces")).headers()["x-frame-options"]).toBe("DENY");

  // A signed-in builder with a project, a published artifact, and a YouTube promotion.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const api = context.request;
  await api.get("/");
  const me = await (await api.post("/api/auth/register", { headers: { "x-forwarded-for": "203.0.113.170" }, data: { email: `e2e-csp-${stamp()}@example.test`, password: "Testpass123!", firstName: "Cee", lastName: "Esspee" } })).json();
  expect((await api.post("/api/profile/complete-onboarding", { data: { displayName: "Cee Esspee", headline: "x", bio: "y" } })).ok()).toBeTruthy();
  const project = await (await api.post("/api/projects", { data: { title: `CSP ${stamp()}`, description: "A project to load every kind of page.", category: "saas", goal: "ship_mvp", subcategory: "saas" } })).json();
  const tasks = await (await api.get(`/api/projects/${project.id}/kanban`)).json();
  const step = tasks.find((t: any) => (t.tags ?? []).includes("backbone:SHIP.M1.1"));
  await api.patch(`/api/kanban/${step.id}`, { data: { status: "done", description: "Plan a week of dinners from the fridge." } });
  const artifact = await (await api.post(`/api/projects/${project.id}/path/tasks/${step.id}/artifact`)).json();
  const published = await (await api.post(`/api/artifacts/${artifact.id}/publish`, { data: { title: "Our product statement" } })).json();
  await api.post("/api/feed", { data: { postType: "project_update", projectId: project.id, content: "Shipped the statement." } });
  const db = new pg.Client({ connectionString: testDatabaseUrl("_e2e") });
  await db.connect();
  try { await db.query("UPDATE users SET platform_role = 'admin' WHERE id = $1", [me.id]); } finally { await db.end(); }
  const all = (await (await api.get("/api/admin/promotions")).json()).promotions as any[];
  for (const r of all) await api.put(`/api/admin/promotions/${r.promotion.id}`, { data: r.promotion.id === "webflow" ? { videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } : { active: false } });

  const page = await context.newPage();
  const violations = await watchViolations(page);

  // Home: fonts, the feed, and the YouTube player actually playing.
  await page.goto("/");
  await page.getByTestId("btn-skip-onboarding").click({ timeout: 5_000 }).catch(() => {});
  const player = page.getByTestId("promo-video-webflow");
  await player.scrollIntoViewIfNeeded();
  await expect(player).toHaveAttribute("data-playing", "true", { timeout: 40_000 });
  expect(await page.evaluate(() => document.fonts.status)).toBe("loaded");

  // The project manager, the public artifact page, an invite screen, the admin console.
  await page.goto(`/projects/${project.id}/manage`);
  await expect(page.getByTestId("next-action")).toBeVisible({ timeout: 20_000 });
  await page.goto(published.url);
  await expect(page.getByTestId("text-artifact-title")).toHaveText("Our product statement");
  const invite = await (await api.post(`/api/projects/${project.id}/invites`, { data: {} })).json();
  await page.goto(new URL(invite.url).pathname);
  await expect(page.getByTestId("invite-project-title")).toBeVisible();
  await page.goto("/admin/surfaces");
  await expect(page.getByTestId("surface-sequencing")).toBeVisible();
  await page.waitForTimeout(1500);

  expect(violations, violations.join("\n")).toEqual([]);

  // The watcher does see a violation when there is one: a request to a host the policy doesn't allow is blocked, and reported.
  await page.evaluate(() => fetch("https://example.com/not-allowed").catch(() => {}));
  await expect.poll(() => violations.some((v) => /connect-src/.test(v))).toBe(true);

  // And framing is refused: a page that frames the app gets nothing.
  const framer = await context.newPage();
  const frameErrors: string[] = [];
  framer.on("console", (m) => frameErrors.push(m.text()));
  await framer.setContent(`<iframe id="f" src="${new URL("/", page.url()).toString()}" width="600" height="400"></iframe>`);
  await framer.waitForTimeout(2500);
  expect(frameErrors.join("\n")).toMatch(/frame-ancestors|X-Frame-Options|refused to (display|connect)/i);

  for (const r of all) await api.put(`/api/admin/promotions/${r.promotion.id}`, { data: { active: true, videoUrl: "" } });
  await context.close();
});
