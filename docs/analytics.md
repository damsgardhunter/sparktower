# Analytics: what's recorded, what isn't, and what can be erased

Two sources, one table (`activity_events`), a 90-day life, and an owner-only console. The gaps below are choices, not omissions — they're written down here because each has been read as a hole more than once.

## What's captured

**The server** records every API write — anything that isn't GET, HEAD or OPTIONS — as one `apiWrite` event (`captureWrites`, `server/analytics.ts`). No body, no query, just the route, the account or visitor, and when.

**The client** batches `pageView` plus a whitelist of Explore and Promotion events to `POST /api/track`. The whitelist is the point: the endpoint refuses anything else, so a client can't invent an action (`test/integration/rate-limits.test.ts` and the Explore loop tests).

**Reads are not captured server-side, deliberately.** Every GET would multiply the table by an order of magnitude — 3,399 rows becomes tens of thousands a week — to record that someone looked at something, which the page itself already reports as a `pageView`. Where a read genuinely matters it gets its own counter rather than an event: a published artifact counts its views, and Explore records what a person has already seen (`explore_seen`) so it doesn't show it twice.

What that costs: a funnel that depends on reads is built from client events, which an ad-blocker or a dead connection can drop. Writes — the actions that change something — are counted server-side and can't be.

## How long it lives

90 days (`RETENTION_DAYS`, `shared/analytics.ts`). A sweep deletes anything older on a timer (`sweepExpiredEvents`), proven by `test/integration/event-retention.test.ts`.

## Erasing a person

`DELETE /api/admin/analytics/people/:userId` (owner only) removes every event for that account **and** every event from any visitor id that ever appeared with it — so the browsing they did before signing in goes too, not just what's keyed to the account. Tested in `test/integration/analytics-data.test.ts`, including that nobody else can call it.

What it cannot reach: browsing by someone who never signed in at all, because nothing connects those rows to a person — there is no identity to match, by design. Those rows hold a visitor id, a route and a time, and they are gone within 90 days by the sweep above. Deleting an account also removes its events (`server/account-data.ts`).

## Project-level metric definitions

`project_analytics_events` holds the metrics a builder names for their own project (`POST /api/projects/:id/analytics-events`). Built and tested (`test/integration/sections.test.ts`, `test/integration/event-retention.test.ts`); empty in production because no builder has defined one yet. Empty and proven is not the same as unbuilt — the audit's DATA IN USE now separates the two (`shared/data-shape.ts`).
