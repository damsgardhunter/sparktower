# Scaling to 2,000 concurrent — how to do each step

Decided 2026-09-30: **stay on Render**, keep GCS for objects, add a CDN. No
platform migration.

The sizing and the arithmetic are in [scaling.md](scaling.md). This is the
order of operations and, for each step, what to actually do, how to tell it
worked, and what makes it a waste of money if done early.

Two numbers to keep in view: the load run measured **comfortable at 50
concurrent**, and 2,000 users at the measured 22 requests a minute each is
**~733 req/s**.

---

## Step 0 — measure, before buying anything

Every instance count in `scaling.md` is arithmetic from a per-user request
rate. The only number that will be true for your deployment is requests per
second per instance, measured on the tier you actually buy.

**The harness now exists: [`scripts/sim-load.ts`](../../scripts/sim-load.ts).**

```
npx tsx scripts/sim-load.ts --users 200 --base http://localhost:5021 --seconds 90
```

It registers and confirms N accounts through the real sign-up flow, joins them
all to one market in the same instant, races them for the same seat, names the
tables, then settles everyone into the polling intervals the client actually
uses — read out of `client/src`, with the file and line beside each number in
`POLL`. It reports p50/p95/p99 per endpoint, and it checks the invariants that
only break under concurrency (six people in a five-seat room, two chief
executives at one table, somebody seated twice), because a fast wrong answer is
not a pass. It exits non-zero on a broken invariant or a missed budget, so it
can be a gate.

**Run it from a different machine than the server** when the number is for
sizing. Server, generator and database on one laptop makes every latency
pessimistic and every throughput a floor — fine for comparing a change against
itself, not fine for deciding how many instances to buy.

What it measured locally, 2026-09-30, one laptop, 200 users on one market
(so: a floor, not a capacity):

| | |
|---|---|
| joins through the per-market lock | ~85/s, p99 2.3–3.6s for the 200th joiner across runs |
| steady-state polling, 200 playing | p50 ~11ms, no endpoint over p95 104ms |
| a bystander while 200 accounts register | 2ms, the same as idle (was 225ms; see *Step 8*) |
| total poll requests in a 90s window | 4,261 (was 8,515; see *Step 7*) |

The shape of that: **playing is cheap, and arriving was expensive until the
hashing moved off the request thread.** The simulation's own routes were never
the constraint at this size.

Two things the run found that no amount of arithmetic would have, both now
fixed or recorded: a full lobby could sit unstarted for its whole fifteen
minutes and hold its season's other seven tables behind it
([`simulation-tick.ts`](../../server/simulation-tick.ts), the `bots.filled`
loop), and a season's start waits on its slowest table, so the gap between the
first table ready and the last is the wait a workshop actually experiences.
`sim-load.ts` prints that gap.

---

## Step 1 — Postgres tier. Do this first

`basic-256mb` is the smallest paid tier. It is the bottleneck at 2,000 and it
is the one purchase that is never wasted.

**Do:** Render dashboard → the `sparktower-db` database → change the plan to
**8+ vCPU / 32 GB+**. Then update [`render.yaml`](../../render.yaml) line 167
(`plan: basic-256mb`) to the same value in the same change.

**Both places, or neither.** `render.yaml`'s own `PUBLIC_URL` comment records
what happens otherwise: the blueprint said one thing, the dashboard another,
and re-syncing the blueprint would have silently reverted the live value. A
plan reverted on a re-sync is a database resize nobody asked for.

**Verify:** `npm run check:live` still passes, and
`curl -s https://sparktower.app/_ready` reports `database: "ok"` with a low
`ms`. Compare the `ms` before and after — it is the cheapest evidence the tier
did something.

**Wasted unless:** nothing. Buy it first.

---

## Step 2 — CDN

Static files are served by Node today ([static.ts](../../server/static.ts)),
which means your web instances spend their event loop sending bytes a CDN
sends for pennies.

**Prerequisite — now done.** Until 2026-09-30 `express.static` sent an ETag and
no `Cache-Control`, so a CDN in front of it would have revalidated every asset
against the origin on every navigation and cached almost nothing. Hashed assets
now carry a year and `immutable`, and the shell carries `no-cache`
(`cachePolicyFor`, held by
[static-cache-policy.test.ts](../../test/unit/static-cache-policy.test.ts)).

**Do:** put Cloudflare (or Cloud CDN) in front of the apex, then:

- cache `/assets/*` aggressively — it is immutable by name;
- **never** cache `/api/*` — it is per-user, and a shared cache here leaks one
  person's data to another;
- **never** cache the HTML shell — it is built per request and carries each
  page's own preview tags, so a cached copy serves one artifact's preview for
  every page on the site.

**Verify:** two loads of the same page; the second should fetch the hashed
assets from the edge (`cf-cache-status: HIT`) and still revalidate the shell.

**Wasted unless:** nothing, now that the headers are right.

---

## Step 3 — counts cache

**This is not a purchase. There is no Redis in this codebase.** `scaling.md`
lists it in a table of hardware, which reads as "buy Redis"; grep says
otherwise — nothing in `server/` or `shared/` connects to one. Provisioning
Redis today would buy an idle Redis.

**What it needs:** a cache in front of the three polling count endpoints, and
then sessions moved off Postgres. Both are code. Ask for the first — it is
where the money is, because those three endpoints are most of the 733 req/s.

**Do it in this order:** write the cache against an interface with an in-memory
implementation, prove the hit rate locally, *then* provision Redis and point it
at that. Provisioning first tells you nothing.

---

## Step 4 — PgBouncer, in transaction mode

Not optional at this size. 16 instances × 32 connections (see *The connection
budget* in `scaling.md`) is **512 direct connections**. No tier accepts that,
and exceeding the limit does not degrade — Postgres refuses connections
outright.

**Precondition, already true:** sessions share the application's pool, and the
session-level `SET`s are gone. That was the thing that made transaction pooling
impossible, and `scaling.md` records it as done.

**One interaction to handle at the same time.** Both leader locks in this
codebase take *session-level* advisory locks — `withJobLock`
([job-lock.ts](../../server/job-lock.ts)) and `withLock` in
[simulation-tick.ts](../../server/simulation-tick.ts). A session lock is held
by its connection; under transaction pooling a client is pinned to a server
connection only for the length of a transaction, so the unlock may not arrive
on the connection holding the lock. The fix is in the comment at the top of
`job-lock.ts`: **point those two pools at the direct database URL rather than
through the pooler.** Two or three connections for the jobs is not what a
pooler is for. Do this in the same change as PgBouncer, not after.

**Verify:** jobs still run exactly once with several instances up — the
`[promotions]` and reputation log lines should appear once per tick across the
fleet, not once per instance.

**Wasted unless:** you are actually adding instances. One instance does not
need a pooler.

---

## Step 5 — web instances

**Do:** in [`render.yaml`](../../render.yaml), on the `sparktower` web service:
raise `plan` to a 2-CPU tier and set autoscaling **min 6, max 20**, starting at
8 instances. Marketing traffic arrives as a step change, not a ramp, and a cold
start under a spike is the worst time to discover the minimum was too low.

**Also, in the same change:** divide the in-process rate-limit floor in
[api-rate-limit.ts](../../server/api-rate-limit.ts) by the instance count.
`express-rate-limit` counts per process, so 600 anonymous requests a minute
becomes 9,600 across 16 instances, and nothing says so at the time. It is a
coarse backstop rather than the real limit — the limits that matter are in
Postgres — but a backstop sixteen times looser is worth knowing about.

**Do not raise `DB_POOL_MAX` to compensate.** Connections are the scarce
resource; that is what step 4 is for.

**Verify:** under load, p95 stops climbing as instances come up. If it does
not, the bottleneck is Postgres and the answer is step 1, not more instances.

**Wasted unless:** the scheduled jobs are leader-locked (done) and PgBouncer is
in front (step 4).

---

## Step 6 — worker service

**Do:** a second service in `render.yaml` — same build, `numInstances: 1`, a
start command that runs the jobs and not the HTTP listener — and stop starting
jobs in the web process.

This is the structural version of step 4's leader lock, and it also fixes the
thing the lock cannot: Nova builds and code audits currently run inside a web
request's lifetime ([nova-build.ts](../../server/nova-build.ts),
[code-audit-routes.ts](../../server/code-audit-routes.ts)), so **a deploy kills
whatever is running** and no other instance can resume it. At 16 instances
deploying several times a day, that stops being rare.

**Verify:** jobs log from the worker only; a deploy of the web service does not
interrupt a running build.

---

## Step 7 — cut the polling. The cheapest capacity here

**Half of it is already done, 2026-10-01, and it did not need SSE.** Two polls
were being made for reasons that had stopped applying, and removing them halved
the total request volume of a 200-player run — 8,515 requests to 4,261, measured
the same way before and after:

| | before | after |
|---|---|---|
| the room screen (`/api/sim/ventures/:id`) | 4,363 | **300** |
| `/api/subscription` after each filing | 195 | **0** |
| the slowest filing (`file` p95) | 2,814ms | **1,164ms** |
| every badge poll, p95 | 165–449ms | **48–67ms** |

- The room screen polled every two seconds for the whole season rather than only
  while the room was gathering. Thirty seconds once running, nothing at all once
  retired — `roomPollMs` in `client/src/pages/simulation.tsx`. The transition
  *into* running is still caught at two seconds, because the poll before it is
  still at the lobby rate; only `seasonOver` is noticed slowly, once.
- Every simulation filing triggered a re-read of `/api/subscription`, and a
  period deadline has every table filing within the same minute. `creditsFollow`
  in `client/src/lib/queryClient.ts` skips the prefixes that cannot have spent
  anything, and `test/unit/credit-refresh.test.ts` walks the routes under those
  prefixes so that a charge added to one later fails the suite rather than
  quietly showing somebody a stale balance.

**What is left of this step is the original target, and it is now the majority
of what remains**: the three badge counts — messages at 10s, notifications at
30s, discover at 60s — are 2,694 of the 4,261 requests above, and they poll on
every screen whatever the person is doing. Moving those to SSE is still the
cheapest capacity on this page after the Postgres tier.

This is code, not a purchase. It is also the one that makes every instance count
on this page smaller, so doing it before step 5 means buying fewer instances.

---

## Step 8 — password hashing, which was the arrival cost — DONE 2026-10-01

**Done.** `server/password-hash.ts` now holds the only way to hash a password,
and it uses the native `bcrypt` at the same cost 12. Measured with
`sim-load.ts --users 200`, before and after, on the same laptop:

| | bcryptjs | native |
|---|---|---|
| `register` p50 / p95 | 3991ms / 5335ms | **810ms / 1572ms** |
| a bystander while 200 accounts register | **224ms** p50, 912ms max | **2ms** p50, 33ms max |
| 200 hashes, wall clock | 75,403ms | 16,036ms |
| 200 hashes, event-loop lag p50 | 20,181ms | **1ms** |

A bystander is now indistinguishable from idle (2ms against an idle 3ms), and
registration stopped being the one stage that missed its budget.

Three things were checked before the swap rather than assumed, and are worth
knowing if this ever needs revisiting:

- **It does not compile on deploy.** `bcrypt@6` ships N-API prebuilds via
  `prebuildify`/`node-gyp-build` for linux-x64 in both glibc and musl, so
  `npm ci` takes the binary — no `build/` directory appears and `node-gyp` is
  not in the tree. N-API also means a Node major upgrade needs no rebuild.
- **Stored hashes keep working, in both directions.** Native verifies what
  `bcryptjs` wrote, `bcryptjs` verifies what native writes, both reject wrong
  passwords, and both emit `$2b$12$`. No migration, no rehash-on-login, no
  scheme column. `test/unit/password-hash.test.ts` holds this with *frozen*
  hashes from the old library — a hash generated at runtime would pass even if
  the format changed, because both halves would change together.
- **The cost factor did not move.** Twelve before, twelve after. The speed came
  from where the work runs, not from doing less of it.

The rest of this section is the original finding, kept because the mechanism is
worth understanding and because the bystander probe is how it was found.

`bcryptjs` at cost 12 takes **~420ms of CPU per password**, and `bcryptjs` is
pure JavaScript, so that CPU is the one thread serving every request.
Registering and signing in are the only routes that do it, and they are exactly
what a launch or a workshop consists of.

Measured with [`sim-load.ts`](../../scripts/sim-load.ts)'s bystander probe — a
trivial request on an unrelated screen, which is the only way to see this at all.
(At the time the probe was unauthenticated, which weakens most of its readings
but not this one: a 401 the process cannot answer is a thread that is not running,
which is precisely the symptom. The same conclusion came independently from
measuring event-loop lag.)

| | a bystander's latency |
|---|---|
| idle | **4ms** |
| while 200 accounts register | **225ms** p50, 922ms max |
| while 200 people *play* | **3ms** |

So 200 arrivals is ~84 seconds of CPU that every other request queues behind.
The site stays up and goes roughly fifty times slower for everybody, including
people already playing who did nothing but be there at the wrong moment. At
1,000 in a month this is the thing that makes a marketing push feel broken.

**To be clear about the mechanism**, because it changes the fix: the async
`bcryptjs` path chunks its work with `setImmediate`, so this is *not* one long
stall of the event loop — it is saturation of a single core. The requests do
get served, interleaved, slowly. That is why the bystander sees 225ms rather
than 420ms.

**Do:** move hashing off the request thread. Three ways, in order of how much
there is to go wrong:

1. **Native `bcrypt`** — same API, same cost parameter, and hashes are
   interchangeable both ways (`$2a$`/`$2b$`), so existing passwords keep
   working with no migration. It hashes on libuv's threadpool, so the request
   thread stays free and four hash at once. The catch is a native module in the
   Render build; check it compiles there before committing to it.
2. **A `worker_threads` pool** keeping `bcryptjs` — no new dependency, no
   native build, no change to stored hashes. More code, and the code is on the
   auth path.
3. **`crypto.scrypt`** — built in and async, but a different hash format, so
   it needs rehash-on-next-login and a column to say which scheme a row uses.

**Do not** lower the cost factor to make this go away. It is the one knob here
that trades away the thing the hash is for.

**Verified exactly that way:** the bystander's "while registering" p50 came
down from 224ms to 2ms, against an idle 3ms.

---

## The order, as one list

1. Postgres tier (step 1) — always helps.
2. CDN (step 2) — always helps, now that the headers are right.
3. ~~Password hashing off the request thread (step 8)~~ — **done 2026-10-01**.
4. Cut polling (step 7) — **half done**; the three badge counts are what is left,
   and they are now the majority of the polling.
5. Counts cache (step 3) — code first, Redis after.
6. PgBouncer + point the lock pools at the direct URL (step 4).
7. Web instances + divide the rate-limit floor (step 5).
8. Worker service (step 6).
9. Re-measure with the harness (step 0), from another machine, against the
   tier you bought — then re-size all of the above.

Steps 1 and 2 can be done today, by you, without a code change. Everything
with code in it, ask.

## What has actually been measured

Only run on one laptop so far, so these are floors. Still, the headline is
worth keeping in view: at 200 concurrent, **the simulation was never the
bottleneck**. Joins queued through their per-market lock at ~85/s, polling sat
around 11ms p50, and a bystander was as fast as idle whatever else was happening.

**One correction to that, worth knowing before trusting any latency on this
page.** Until 2026-10-01 the bystander probe asked for `/api/sim/niches`
*without a session*. `isAuthenticated` answers 401 and returns before `next()`,
so it never reached the session store, the database or a handler — what it
measured was whether the process would accept a connection and run one
middleware. It is signed in now and asks a real authenticated count.

The flaw was found by a `--client mixed` run that reported a steady 3ms
bystander while every stage around it took five seconds. What survives
unaffected: every request *count* on this page, every invariant, and the
password-hashing finding — a 401 that cannot be answered is a thread that is not
running at all, which is exactly what blocked hashing does, and that one was
corroborated separately by measuring event-loop lag directly (20,181ms). What
does not survive is the stronger reading of "a bystander was as fast as idle
while 200 played": that was a 401, and the authenticated figure has not been
re-measured on a quiet machine yet.

Four findings, all from running it rather than reading it, and none of which the
arithmetic in `scaling.md` could have produced:

1. A lobby the bots had filled could hold its season's other seven tables for
   fifteen minutes. Fixed.
2. A password cost 420ms of the request thread. Fixed — step 8.
3. Half the request volume was polls whose answers had stopped changing. Fixed —
   step 7.
4. A season waits for its slowest table, so a table ready first waits ~358s.
   Accepted deliberately; `docs/simulation-backlog.md` item 20.

The run now passes as a gate: no broken invariant, no missed budget. Nothing
runs it automatically, which is `docs/simulation-backlog.md` item 23.
