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

**The harness that produced the table in `scaling.md` is not in this
repository.** `.sim-lab/botload.mts` is a simulation-economy script, not an
HTTP driver. So this step needs a tool built first — ask for it, it is a
contained piece of work: sign in N virtual users, replay the real polling
intervals the client uses, report throughput and p50/p95.

Until then treat every instance count below as a starting point, not a plan.

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

At 2,000 users the three polling count endpoints are most of the 733 req/s.
Moving them to SSE **roughly halves the web tier**.

This is code, not a purchase, and it is better value than any line above it
except the Postgres tier. It is also the one that makes every instance count on
this page smaller, so doing it before step 5 means buying fewer instances.

---

## The order, as one list

1. Postgres tier (step 1) — always helps.
2. CDN (step 2) — always helps, now that the headers are right.
3. Cut polling (step 7) — halves what you need to buy next.
4. Counts cache (step 3) — code first, Redis after.
5. PgBouncer + point the lock pools at the direct URL (step 4).
6. Web instances + divide the rate-limit floor (step 5).
7. Worker service (step 6).
8. Build the harness and measure (step 0) — then re-size all of the above.

Steps 1 and 2 can be done today, by you, without a code change. Everything
with code in it, ask.
