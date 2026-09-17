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
 * A context made by hand (`browser.newContext()`) does not inherit this — pass
 * the header yourself, or don't authenticate in it.
 */
import { test as base } from "@playwright/test";

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

export const test = base.extend({
  contextOptions: async ({ contextOptions }, use, testInfo) => {
    await use({
      ...contextOptions,
      extraHTTPHeaders: {
        ...contextOptions.extraHTTPHeaders,
        "x-forwarded-for": addressFor(testInfo.titlePath.join(" ")),
      },
    });
  },
});
