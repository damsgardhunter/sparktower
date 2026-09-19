/**
 * Playwright's `test`, with one difference: every test arrives from its own
 * address.
 *
 * The sign-in and sign-up routes are limited per address — eight attempts in
 * fifteen minutes (`RATE_LIMITS.login`), which is a good limit and the reason
 * credential stuffing doesn't work here. A browser suite has no way to ask for
 * an exemption, so every spec in this folder was arriving as 127.0.0.1, and the
 * limit counted them together.
 *
 * That was survivable while the suite was small. It is not survivable now: a
 * full run registers far more than eight accounts, so whichever specs happen to
 * run last are refused — `wedge` and `growth-loop`, alphabetically — and the
 * failure looks nothing like its cause. It looks like a signup form that
 * silently didn't navigate, and it only ever happens in CI, where the whole
 * suite runs at once.
 *
 * So each test gets a stable address of its own, derived from its title. The
 * limit is still real and still enforced; it simply counts each test separately,
 * which is what it would do for separate people.
 *
 * Use this in place of `@playwright/test` anywhere a spec signs in or signs up.
 * Contexts made by hand with `browser.newContext()` inherit it too — which is
 * most of the specs here, and was the second half of the story below.
 *
 * ## Only to this app
 *
 * The address used to go on *every* request the browser made, because that is
 * what `extraHTTPHeaders` does — including the ones to YouTube's servers when a
 * feed card played a video. feed-promotions.spec.ts already carried the warning
 * ("sent on every request, YouTube's video servers refuse to stream to it"),
 * and this file made the mistake it warns about for the whole suite: from then
 * on, the video specs (feed-promotions and security-headers) failed in CI more
 * often than not, waiting thirty seconds for a video that was never going to
 * start.
 *
 * So the header still goes on — Playwright offers no way to scope it to one
 * origin — and every request to anywhere *else* is routed through a handler
 * that takes it off again. Checked in a real Chromium before relying on it: a
 * page on one origin framing another, the framed origin received the header
 * without the route and nothing with it, while this app kept receiving it on
 * page loads and on `context.request` calls alike.
 */
import { test as base, type Browser, type BrowserContext } from "@playwright/test";

export { expect, type Page, type Locator, type APIRequestContext, type BrowserContext, type Browser } from "@playwright/test";

/**
 * A private address from the test's name, so a test keeps the same one across
 * retries — a retry that arrived from a fresh address would hide a limit the
 * code really did hit.
 */
function addressFor(title: string): string {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  // 10.x.y.z, skipping .0 so nothing reads as a network address.
  return `10.${(hash >> 16) & 0xff}.${(hash >> 8) & 0xff}.${(hash & 0xfd) + 1}`;
}

/** Takes the address back off anything not bound for this app. */
async function keepAddressHome(context: BrowserContext, origin: string | null): Promise<void> {
  if (!origin) return;
  await context.route((url) => url.origin !== origin, (route) => {
    const headers = { ...route.request().headers() };
    delete headers["x-forwarded-for"];
    return route.continue({ headers });
  });
}

const originOf = (baseURL: unknown): string | null => {
  try { return new URL(String(baseURL)).origin; } catch { return null; }
};

export const test = base.extend<{}, { originGuard: void }>({
  contextOptions: async ({ contextOptions }, use, testInfo) => {
    await use({
      ...contextOptions,
      extraHTTPHeaders: {
        ...contextOptions.extraHTTPHeaders,
        "x-forwarded-for": addressFor(testInfo.titlePath.join(" ")),
      },
    });
  },

  // The built-in context, which `page` comes from.
  context: async ({ context, baseURL }, use) => {
    await keepAddressHome(context, originOf(baseURL));
    await use(context);
  },

  /*
   * And every context a spec opens itself. Most of them do, so wrapping only
   * the built-in one would have fixed the specs that were not broken.
   */
  originGuard: [async ({ browser }, use, workerInfo) => {
    const origin = originOf(workerInfo.project.use.baseURL);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args: Parameters<Browser["newContext"]>) => {
      const context = await newContext(...args);
      await keepAddressHome(context, origin);
      return context;
    };
    await use();
    browser.newContext = newContext;
  }, { scope: "worker", auto: true }],
});
