/**
 * Every write anyone can reach without signing in, named.
 *
 * Each of these trusts something other than a session — a password, an emailed
 * link, a refresh token, Stripe's signature — and each is a route where a
 * mistake is reachable by the whole internet. The set is small and it should
 * stay that way, so it's written down here: adding a public write means
 * editing this list on purpose and saying what the route trusts instead.
 *
 * The reason itself lives next to the route as a `// public-write:` comment,
 * which route coverage reads, so the justification can't drift away from the
 * code it justifies.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { buildRouteCoverage } from "../../server/route-coverage";
import { serverSourceFiles } from "../helpers/server-files";

/** What the internet may POST to, and what each one trusts instead of a session. */
const PUBLIC_WRITES: Record<string, string> = {
  "POST /api/auth/register": "creates the account; limited per address",
  "POST /api/auth/login": "the password it checks",
  "POST /api/logout": "the session it destroys; refuses cross-site requests",
  "POST /api/auth/verify-email": "the emailed link, by hash, spent once",
  "POST /api/auth/forgot-password": "nothing — it sends mail to an address it already holds; limited per address and per account",
  "POST /api/auth/reset-password": "the emailed token, by hash, unexpired, spent once; limited per address",
  "POST /api/auth/mfa/verify": "a pending sign-in held in the session, plus a code",
  "POST /api/auth/mobile/register": "creates the account; limited per address",
  "POST /api/auth/mobile/login": "the password it checks",
  "POST /api/auth/mobile/google": "Google's signed ID token",
  "POST /api/auth/mobile/refresh": "the refresh token, by hash, rotated once, reuse ends every session",
  "POST /api/auth/mobile/mfa/verify": "a signed challenge, plus a code",
  "POST /api/auth/mobile/logout": "the refresh token it revokes; it can only end that session",
  "POST /api/track": "nothing — an analytics beacon, limited per address, no account touched",
  /*
   * The one page on the site built for people with no account is the one page
   * that had no way to report anything on it. Trusts nothing: no free text, a
   * reason from a fixed list, an artifact that must already be public, five an
   * hour per address, and the reporter kept as a hash of that address so a
   * second press is the same report rather than a second row in the queue.
   */
  "POST /api/public/artifacts/:id/report": "nothing — a report on an already-public page, no free text, limited per address",
  "POST /api/stripe/webhook": "Stripe's signature over the raw body",
  "PUT /internal-local-upload/:id": "an id this server issued, once, and never in production",
};

const coverage = () => {
  // What is on disk, not what git tracks — see test/helpers/server-files.ts.
  return buildRouteCoverage(serverSourceFiles().map((f) => ({ ...f, size: 1 })) as any);
};

describe("writes anyone can reach", () => {
  it("are exactly the ones written down here", () => {
    const rows = coverage().rows.filter((r) => r.write && !r.auth && r.mounted !== false);
    const found = rows.map((r) => `${r.method} ${r.path}`).sort();
    const expected = Object.keys(PUBLIC_WRITES).sort();
    // A new public write is a decision, not an accident: add it above with what it trusts.
    expect(found).toEqual(expected);
  });

  it("each say what they trust instead, next to the route", () => {
    const rows = coverage().rows.filter((r) => r.write && !r.auth && r.mounted !== false);
    for (const r of rows) {
      expect(r.publicReason, `${r.method} ${r.path} [${r.file}] needs a "// public-write: …" line saying what it trusts`).toBeTruthy();
    }
  });
});
