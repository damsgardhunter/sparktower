/**
 * A floor under the whole API, beneath the per-action limits.
 *
 * `server/moderation.ts` already limits the things people abuse on purpose —
 * posting, commenting, messaging, checkout, connecting an account — and it is
 * good at it: it counts the content itself rather than keeping a tally, so its
 * numbers cannot drift from what was actually written. What it does not do, by
 * design, is cover reading. A limit defined as "how many rows did this author
 * write lately" has nothing to say about somebody pulling `/api/feed` ten
 * thousand times an hour.
 *
 * That left 75 public endpoints with no ceiling of any kind — the feed, public
 * profiles, comment threads, the MCP surface, artifact pages — every one of
 * them doing real database work for anybody who asks. None of that is a bug in
 * a route; it is a missing floor, and a floor is the right shape of fix. Adding
 * a per-route limiter to four hundred handlers would be the wrong instrument
 * applied four hundred times.
 *
 * ## What this is not
 *
 * It is not the security control for abuse. Somebody determined gets a second
 * address; the per-action limits key on the *account*, which is what actually
 * costs an abuser something. This is the ceiling that stops one script from
 * making the database answer as fast as it can, and it is set where no real
 * person will ever meet it.
 *
 * ## The numbers, and why they are loose
 *
 * A limit a real user can reach is a bug report you get instead of an outage
 * you prevented. A page of this app can fire a dozen requests as it settles,
 * somebody flicking between projects can do a few hundred in a minute, and an
 * office behind one NAT address is many people sharing one number. So: loose
 * enough that a crowd behind one address never meets it, and tighter for
 * requests carrying no session, because an unauthenticated caller has no
 * account to rate limit and is the one this exists for.
 *
 * In-memory and per-process on purpose. A shared store would make this a
 * distributed-systems problem for a guard whose job is "no single client gets
 * to spin the database"; with N instances the effective ceiling is N times
 * this, which is still a ceiling, and the precise per-account rules live in
 * the database-backed limiter where precision is worth paying for.
 */
import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response } from "express";

/** Signed in: high enough that only a script gets here. */
export const SIGNED_IN_A_MINUTE = 1200;
/**
 * Signed out: lower, because this is the traffic the floor is actually for —
 * but not by much, because one address is not one person.
 *
 * An office, a school or a café behind a single NAT address is fifty people
 * sharing this number, and so is a CI runner driving a browser suite. A
 * ceiling tuned to what one human does would lock all of them out together,
 * and the failure would look like the site being down for an entire building.
 * Ten a second sustained is still far below what a scraper wants and far above
 * what a crowd behind one address will ever reach.
 */
export const SIGNED_OUT_A_MINUTE = 600;

const WINDOW_MS = 60_000;

/**
 * Paths this must never refuse, and why each one is on the list.
 *
 * `/_health` and `/_ready` answer a platform's monitor on a schedule; refusing
 * one is precisely what a monitor reports as an outage, and `/_ready` already
 * solved its own load problem by collapsing concurrent queries into one rather
 * than turning callers away (see `createApp`).
 *
 * The Stripe webhook is not a caller we may refuse. Stripe retries a 429, but
 * money events arriving late — or being dropped after its retries run out —
 * is a worse failure than any load this endpoint could put us under, and the
 * signature check already means only Stripe can do anything here.
 */
const NEVER_LIMITED = new Set(["/_health", "/_ready", "/api/stripe/webhook"]);

/**
 * Whether the floor is switched off for this process.
 *
 * On in development and production. Off under test by default, because the
 * suite drives thousands of requests from one address — `trust proxy` is set,
 * and most tests do not bother forging a forwarded address, so the whole suite
 * looks like a single very busy client and would rate-limit itself.
 *
 * `API_RATE_LIMIT=1` turns it back on, which is how the test that proves this
 * works gets to prove it. The alternative — leaving it on and setting the
 * ceiling above whatever the suite happens to do — makes the limit a number
 * nobody chose, that quietly rises every time somebody adds a test.
 */
export function limiterEnabled(): boolean {
  if (process.env.API_RATE_LIMIT === "1") return true;
  if (process.env.API_RATE_LIMIT === "0") return false;
  return process.env.NODE_ENV !== "test";
}

/**
 * Who a request counts against.
 *
 * The account when there is one, so that somebody moving between networks —
 * a phone leaving wifi — carries their own allowance with them rather than
 * inheriting whatever the new address had spent. The address otherwise, which
 * is all an unauthenticated caller has.
 *
 * IPv6 goes through `ipKeyGenerator`, which groups an address into its /64
 * subnet. A single IPv6 host is routinely handed more addresses than it could
 * ever exhaust a limiter with, so counting them individually is the same as
 * not counting at all.
 */
function whoIsAsking(req: Request): string {
  const userId = (req as any).user?.id;
  if (userId) return `user:${userId}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

const refuse = (req: Request, res: Response) => {
  res.status(429).json({
    message: "That's a lot of requests in a short time. Give it a minute.",
    code: "rate_limited",
  });
};

/**
 * One limiter, built to be skipped rather than wrapped.
 *
 * `skip` is the library's own mechanism and every reason to stand aside goes
 * through it: the paths that must never be refused, the test default, and
 * which of the two allowances this particular caller belongs to. An earlier
 * version chose between the two limiters inside a closure and passed that to
 * `app.use` instead — same behaviour, but it hid the limiter from anything
 * reading the middleware chain, static analysis included, and it hand-rolled a
 * branch the library already provides.
 */
function floor(max: number, appliesTo: (req: Request) => boolean): RateLimitRequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: whoIsAsking,
    handler: refuse,
    skip: (req) => !limiterEnabled() || NEVER_LIMITED.has(req.path) || !appliesTo(req),
  });
}

const signedIn = (req: Request) => Boolean((req as any).user?.id);

/**
 * Where the floor is mounted.
 *
 * `/api` is almost all of it, and mounting it bare instead was a mistake worth
 * recording: this process serves the client's own bytes as well, so counting
 * every request meant one page load — hundreds of module, stylesheet and image
 * fetches — emptied a person's allowance before they had done anything.
 *
 * The rest are the public paths that do real work for anybody who asks and do
 * not live under /api:
 *
 *  - `/a` — a published artifact page, which reads the database per request.
 *  - `/objects` — uploaded files, streamed out of cloud storage. The cost here
 *    is somebody else's egress bill, which is the kind that arrives quietly.
 *  - `/sitemap.xml` — three table scans to build. Crawlers are welcome to it;
 *    a script asking for it a thousand times a minute is not, and no crawler
 *    will ever come near the ceiling.
 *
 * Deliberately absent: `/_health` and `/_ready` (a monitor being refused is
 * exactly what it reports as an outage), `/robots.txt` and `/security.txt`
 * (infrastructure a crawler or a researcher must always be able to read), and
 * the client bundle, which is the whole reason this is a list rather than
 * everything.
 */
export const FLOOR_MOUNTS = ["/api", "/a", "/objects", "/sitemap.xml"] as const;

/**
 * The floor, as two middlewares.
 *
 * Two rather than one with a computed ceiling, because `express-rate-limit`
 * reads its limit when the window opens: a caller who signs in mid-window
 * would otherwise keep whichever allowance they started with. Each skips the
 * requests that belong to the other, and because the signed-out key is the
 * address while the signed-in key is the account, the two never share a
 * bucket — so signing in widens the allowance at once and signing out cannot
 * hand somebody a fresh one.
 *
 * Mounted after the session and any bearer token are read, so `req.user` is
 * populated and the choice between them is the real one — and mounted *on
 * `/api`*, because this process serves the client's static bytes too and a
 * single page load is hundreds of module requests. Counting those against a
 * person's API budget empties it before they have done anything.
 */
export const apiRateLimit = (): RateLimitRequestHandler[] => [
  floor(SIGNED_OUT_A_MINUTE, (req) => !signedIn(req)),
  floor(SIGNED_IN_A_MINUTE, signedIn),
];
