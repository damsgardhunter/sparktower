# Rate limits

Durable and database-backed (`server/moderation.ts`, limits in `shared/moderation.ts`), so a limit survives a restart and holds across every instance — an in-memory counter on autoscale is N times the limit, and a deploy is a free reset for whoever is being refused.

## How an action is counted

Two kinds, and the difference decides what happens when nobody is signed in.

**Hit-counted** (`react`, `upload`, `ai`, `login`, `write`, `track`, `post`, `connect`, `review`, `payout`, `webhookReject`, `session`, `workspace`, `follow`, `apply`, `sprint`, `checkout`, `external`, `invite`, `inviteLookup`) — every use writes a row to `rate_limit_hits`, keyed by account **or by address** when there's no account. These are the ones an unauthenticated route can use, which is why sign-in and sign-up are limited at all.

**Content-counted** (`comment`, `feedPost`, `message`, `project`) — counted from the content itself: "how many comments has this author written in the last ten minutes", read from `project_comments` and `feed_comments` together, so a limit that reads one table while two routes write to it isn't a limit.

A content-counted limit is counted **by author id**. On a route with nobody signed in there is no author, the count comes back zero, and the limit allows everything — a write that reads as limited, in the coverage table and to whoever wrote the route, and isn't. So that combination is refused (401) rather than passed through, and two tests keep it from appearing: `test/unit/route-guards.test.ts` fails if an unauthenticated route carries one, and `test/unit/rate-limit-no-author.test.ts` drives the middleware with no user and checks it refuses and says which route in the log.

Every route using one authenticates first today. The guard exists for the day one doesn't.

## The write floor

`app.use(limitWrites)` (`server/routes.ts`) limits every write under `/api` that carries no limit of its own — 240 in ten minutes, keyed by account or address. `test/integration/rate-limit-contract.test.ts` drives a floor-only route past it and holds it to the same refusal contract as everything else, so losing that one line fails a test instead of silently unlimiting hundreds of routes.

One exemption: `POST /api/stripe/webhook`.

- **Why.** A busy account's legitimate deliveries all arrive from Stripe's own addresses. A shared counter would drop real events — and a 429 makes Stripe retry, so throttling a flood of genuine deliveries makes it worse.
- **What limits it instead.** The signature: only Stripe can produce a delivery that verifies. Deliveries that *fail* verification are counted per address (`webhookReject`) and refused, which is the abuse path — anyone can send bytes at the endpoint, nobody else can sign them.
- **What that leaves.** Verified deliveries are unbounded by us. That is Stripe's traffic, and the ledger (`stripe_events`) dedupes retries of it.

## Reading the evidence

The audit's ROUTE COVERAGE section lists **every mounted route** with what limits it: `limit:login`, `limit:credits→ai burst`, or `limit:write floor` for the 62 writes that carry none of their own. The floor-only ones are also named in a line of their own, because "which ones are floor-only" is a question counts can't answer.

A route that limits itself inside the handler — `enforceRateLimit(res, ipKey(req), "login")` — is named there too. It wasn't until recently: the scanner read only as far as the first `)`, which falls inside `ipKey(req)`, so all eight sign-in and sign-up routes reported no named limit while being limited in the code. `test/unit/route-coverage.test.ts` now pins that shape.

## What a refusal looks like

One shape everywhere: 429, `{ message, code: "rate_limited", action, retryAfterSeconds, retryAfterMinutes }` and a matching `Retry-After`. Repeating yourself is 409 with `duplicate_content` and no retry fields, because waiting doesn't help. When the counter itself can't be read, 503 `limit_unavailable` — the action doesn't run unmetered. Every refusal is also a row the daily safety review counts (`docs/safety-loop.md`).
