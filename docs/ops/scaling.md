# Scaling this, as users arrive

What to change, in what order, and how to know it is time. Every number here
comes from this repository or from a load test against it — nothing is a rule
of thumb.

Read [deploy.md](deploy.md) first for how the thing is deployed at all. This is
only about making it hold more people.

> **If you are launching straight into 200+ concurrent users**, the running
> order is not the one below. Go to
> [Launching above 200](#launching-above-200) — the work that this document
> calls Stage 3 becomes prerequisite, and two things in the request path have
> to change before any amount of hardware helps.

## What you are running today

| | Setting | Where |
|---|---|---|
| Web | `plan: standard`, **one instance**, no autoscaling | [render.yaml](../../render.yaml) |
| Process | One Node process, **no clustering** — one event loop | [package.json](../../package.json) `start` |
| Database | `plan: basic-256mb` — the smallest paid tier | [render.yaml](../../render.yaml) |
| Static files | Served **by Node**, not a CDN | [server/static.ts](../../server/static.ts) |
| Sessions | Postgres (`connect-pg-simple`), own pool | [replitAuth.ts](../../server/replit_integrations/auth/replitAuth.ts) |
| Rate limits | Postgres | [server/moderation.ts](../../server/moderation.ts) |
| Objects | Google Cloud Storage | [objectStorage.ts](../../server/replit_integrations/object_storage/objectStorage.ts) |

### The connection budget

Each instance opens **three** pools. This is the number that governs how far
you can raise anything else:

| Pool | Default | Env |
|---|---|---|
| Main query pool | 10 | `DB_POOL_MAX` |
| Session store | 10 | — (hard-coded by `connect-pg-simple`) |
| Project lock | 12 | `PROJECT_LOCK_POOL_MAX` |
| **Per instance** | **32** | |

Before raising any of these, or adding an instance, check the Postgres tier's
own connection limit. Two instances at defaults is 64 connections. Exceeding
the limit does not degrade — it refuses connections outright.

## What it currently holds

Measured with a driver replaying the client's real polling intervals against a
production-shaped build. Local hardware and local Postgres, so treat throughput
as **optimistic** — the `basic-256mb` tier is smaller than the machine this ran
on. Latency shape and failure modes carry over; absolute numbers do not.

| Concurrent users | Throughput | p50 | p95 | Errors |
|---|---|---|---|---|
| 25 | 9 req/s | 12 ms | 204 ms | 0 |
| 50 | 18 req/s | 28 ms | 355 ms | 0 |
| 100 | 37 req/s | 113 ms | 1.6 s | 0 |
| 200 | 63 req/s | 1.7 s | 13 s | 318 |

**Comfortable at 50. Watchful at 100. Past 150 you are over the line.**

### Why a user costs what they cost

Nobody has to click anything for this load to exist. Every open page polls:

| Poll | Every | Where |
|---|---|---|
| `/api/messages/unread-count` | 10 s | [app-sidebar.tsx](../../client/src/components/app-sidebar.tsx) |
| `/api/notifications/count` | 30 s | [notification-bell.tsx](../../client/src/components/notification-bell.tsx) |
| `/api/discover/new-count` | 60 s | sidebar |
| `/api/projects/:id/tracks` | 15 s | [lib/sections.ts](../../client/src/lib/sections.ts) |
| `/api/projects/:id/path` | 15 s | `lib/sections.ts` |
| `/api/projects/:id/nova-build` | 30 s | [lib/build-status.ts](../../client/src/lib/build-status.ts) |
| `/api/projects/:id/code-audit` | 20 s | [lib/audit-status.ts](../../client/src/lib/audit-status.ts) |

- Any page: **9 requests/minute**
- A project dashboard: **22 requests/minute**
- A live simulation: **40+/minute** — [simulation.tsx](../../client/src/pages/simulation.tsx) polls every **2 seconds**

100 people sitting on dashboards is ~37 req/s before anyone does anything.

---

# The stages

## Stage 0 — before you take real traffic

Do these regardless of how many users you expect. They are all small.

1. **Repair the migration journal on production.** `db:migrate` can silently
   apply nothing. Run `db:reconcile` in report mode first, read what it intends
   to delete, then apply. Steps in [deploy.md](deploy.md).
2. **Point the health check at `/_health` only for liveness, and monitor
   `/_ready` separately.** `/_health` returns 200 unconditionally. During the
   load test a fully wedged server answered it correctly for fourteen minutes.
   `/_ready` touches the database and would have caught it.
3. **Set `GCS_SERVICE_ACCOUNT_KEY`** — see [Cloud storage](#cloud-storage).
4. **Turn the 2-second simulation poll down** unless a simulation genuinely
   needs that. It is the single most expensive client behaviour in the app.
5. **Decide what happens to in-flight work on deploy.** A Nova build is ~14
   minutes of in-process model calls. A deploy kills it. At one instance, every
   deploy is a small outage for anyone mid-build.

## Stage 1 — first 50 concurrent

Nothing to do. This is inside what was measured clean. Watch, don't act.

Set up before you need it:
- An alert on p95 latency and on 5xx rate.
- An alert on `503` with code `database_busy` — that is pool exhaustion
  specifically, and it means "act now", not "act soon".

## Stage 2 — 50 to 200 concurrent

In this order, cheapest and highest-yield first.

1. **Upgrade the Postgres tier.** `basic-256mb` is a hobby tier and it is the
   binding constraint. 256 MB of RAM means almost no cache; queries that should
   be served from memory hit disk. This is one dropdown and it buys the most.
2. **Put the static bundle on a CDN.** Node currently serves every JS and image
   byte from the same single CPU that runs your queries
   ([static.ts](../../server/static.ts)). Cloudflare or Render's own CDN in
   front of the service costs nothing in code.
3. **Raise `DB_POOL_MAX`** once the tier can take it — check the connection
   limit against the budget above. Raise it *after* the tier, never before: a
   bigger pool against a small database just moves the queue into Postgres.
4. **Cut polling.** Longer intervals, or replace the busiest polls with
   server-sent events. Halving the dashboard poll rate halves baseline load,
   and costs nothing but a constant.
5. **Add `statement_timeout`** to the main pool. There is none today, so one
   pathological query can hold a connection indefinitely. Pick a value well
   above the slowest legitimate query.

## Stage 3 — past 200, or you want zero-downtime deploys

Also the floor for anyone launching at 200+. See [Launching above 200](#launching-above-200).

This is where you add a second instance, and **it is not a dropdown** — the app
has state in process memory that two instances would not share.

### Blockers, in the order they will hurt

1. **Credit and money reservations live in memory.**
   [credit-reservations.ts](../../server/credit-reservations.ts) holds `holds`
   and `moneyHolds` in `Map`s. Instance A's hold is invisible to instance B,
   and a restart loses them. This is money. **Move it to Postgres before you
   add an instance.**

2. **Fourteen background jobs run in every process** (`setInterval` across
   `server/`). Two instances run all of them twice. Some are guarded and fine;
   some are not:

   | Job | Guarded? | What double-running costs |
   |---|---|---|
   | [simulation-tick.ts](../../server/simulation-tick.ts) | yes (advisory locks) | safe |
   | [backing-jobs.ts](../../server/backing-jobs.ts) | yes | safe |
   | [startup-game.ts](../../server/startup-game.ts) | yes | safe |
   | [company-rhythm-jobs.ts](../../server/company-rhythm-jobs.ts) | partly | check before scaling |
   | [retention.ts](../../server/retention.ts) | no | harmless — deletes are idempotent |
   | [promotion-sync.ts](../../server/promotion-sync.ts) | no | wasted work |
   | **[reputation-jobs.ts](../../server/reputation-jobs.ts)** | **no** | **`refreshDueNovaReads` calls the model with `forceAi: true`. Two instances means paying twice.** |

   Fix: either a leader lock around each job (an advisory lock keyed on the job
   name is enough), or move scheduled work out of the web process entirely into
   a worker service that runs as exactly one instance. The second is the better
   shape and also fixes the deploy-kills-your-build problem.

3. **Long-running work is in the web process.** Nova builds and code audits run
   inside request handlers' lifetimes
   ([nova-build.ts](../../server/nova-build.ts),
   [code-audit-routes.ts](../../server/code-audit-routes.ts)). With several
   instances, a build started on A cannot be observed or resumed by B, and any
   deploy kills whatever is running. Same fix: a worker service.

4. **Assorted in-memory caches** (`views.ts`, `moderation.ts` exemptions,
   `error-reporting.ts` dedupe, `password-breach.ts`). These are caches, not
   truth — two instances means two caches and slightly more work, not
   incorrect behaviour. Fine to leave.

### What is already ready

Worth knowing, because it is the expensive half and it is done:

- **Sessions are in Postgres**, so any instance can serve any user.
- **Rate limiting is in Postgres**, so limits are global rather than per
  instance.
- **Object storage is external**, so uploads are not tied to a disk.

### Order of operations

1. Move credit reservations to the database.
2. Extract scheduled jobs and long-running work into a worker service (one
   instance, `numInstances: 1`).
3. Confirm the connection budget against the database tier.
4. Add web instances.

---

# Launching above 200

At 200 concurrent the app is not short of hardware, it is short of shape. Two
things in the request path stop more hardware from helping, and one thing in
process memory stops you from adding instances at all. Fix those three and the
rest is a credit card.

## The arithmetic

Baseline load, before anybody clicks anything, from the polling table above:

| Concurrent users on dashboards | Requests/second | Of which `/path` (write-locked) |
|---|---|---|
| 200 | 73 | 13 |
| 500 | 183 | 33 |
| 1,000 | 366 | 67 |
| 2,000 | 733 | 133 |

The second column is the one that hurts, and it is explained next.

## 1. Make `/path` a read (do this first)

`pathStatus` defaults to `sync: true`
([phase-trees.ts](../../server/phase-trees.ts)), so **every poll of
`/api/projects/:id/path` takes the project's advisory lock and performs a
read-modify-write**. A dashboard polls it every 15 seconds.

Three consequences, all fatal at scale:

- It cannot be cached, and it cannot be served by a read replica, because it
  writes.
- It **serialises per project**. Five teammates with the tab open do not poll
  concurrently; they queue behind each other's lock.
- It consumes a lock-pool connection *and* main-pool connections for what is,
  almost every time, a sync that finds nothing to do.

Options, cheapest first:

1. **Debounce the sync.** Keep a `path_synced_at` per project and skip the sync
   when it ran in the last N seconds. One column, and it removes ~95% of lock
   acquisitions immediately — the poll still returns fresh data because the
   read below it is unchanged.
2. **Sync on writes, not reads.** The tree only changes when something changes
   it; run the sync where that happens and pass `{ sync: false }` from the
   status route.
3. **Sync in the worker.** Once a worker service exists (below), a periodic
   pass keeps trees correct and the read path never writes.

Do (1) before launch whatever else you choose. It is small and it is the
difference between 13 write-locked requests a second and roughly none.

## 2. Stop paying 10 connections per instance for sessions

`connect-pg-simple` is handed a `conString`
([replitAuth.ts](../../server/replit_integrations/auth/replitAuth.ts)), so it
builds a second pool. Hand it the existing pool instead and the per-instance
budget drops from 32 to 22 — a third of your connection headroom back for a
one-line change.

## 3. Put a connection pooler in front of Postgres

This is the constraint that decides how many instances you can run at all.
Even at 22 connections per instance, eight instances is 176 connections, and
managed Postgres tiers cap well below what you would want.

Run **PgBouncer in transaction mode** (as a private service, or a managed
Postgres that includes a pooler) and point `DATABASE_URL` at it. Hundreds of
application connections then multiplex onto a few dozen real ones.

Two things in this codebase to check before you do:

- **Advisory locks are transaction-scoped** (`pg_advisory_xact_lock` in
  [project-lock.ts](../../server/project-lock.ts)), which is compatible with
  transaction pooling. Session-scoped locks would not be. This was already the
  right choice.
- **`SET` statements must be transaction-local.** The lock's `lock_timeout` uses
  `set_config(..., true)` and is fine. The connect-time
  `idle_in_transaction_session_timeout` in the same file and the `SET TIME ZONE`
  in [db.ts](../../server/db.ts) are session-level and will not survive
  transaction pooling — move both into the pooler's server-side settings, or
  set them on the database role, before switching.

## 4. Cut the polling

73 req/s at 200 users is self-inflicted. Nobody has clicked anything.

- Raise the intervals. Doubling every one halves baseline load and costs a
  constant.
- Replace the count polls (`unread-count`, `notifications/count`,
  `discover/new-count` — 9 req/min per user, on every page) with one
  server-sent-events stream. That alone is 40% of baseline.
- The 2-second poll in [simulation.tsx](../../client/src/pages/simulation.tsx)
  is not viable at this scale.

## 5. Then the infrastructure

In this order, and not before the four above:

1. **Postgres tier** sized for the working set. `basic-256mb` is a hobby tier.
2. **A worker service** at `numInstances: 1` for the scheduled jobs and the
   long-running work (Nova builds, code audits). This also removes the
   double-run and double-spend problems in the Stage 3 blocker table, and stops
   deploys from killing builds.
3. **Web instances**, once the blockers below are cleared. Start at 3 and
   measure; the per-user cost is known, so capacity is close to linear once
   nothing serialises.
4. **A CDN** for the static bundle and public objects.
5. **A cache** (Redis) for the hot reads — counts especially. There is no cache
   layer today; every count is a query.
6. **Read replicas** for the read-heavy endpoints, which only becomes possible
   after item 1 above makes them actual reads.

## What must be true before instance number two

These are prerequisites, not improvements. From the Stage 3 table:

- Credit and money reservations moved out of process memory
  ([credit-reservations.ts](../../server/credit-reservations.ts)).
- Scheduled jobs moved to the worker, or given leader locks — particularly
  [reputation-jobs.ts](../../server/reputation-jobs.ts), which calls the model
  and would otherwise be paid for twice per instance.
- Long-running work moved to the worker, so a build is observable and resumable
  from any web instance.

## A realistic order for a 200+ launch

| | Work | Why it is here |
|---|---|---|
| 1 | Debounce the `/path` sync | Removes the serialisation; small |
| 2 | Session store shares the main pool | One line, a third of the budget |
| 3 | Credit reservations into Postgres | Blocks every instance after the first |
| 4 | Worker service; jobs and builds move to it | Blocks instances; stops double AI spend |
| 5 | Postgres tier up, PgBouncer in front | Now the connections exist |
| 6 | Scale web instances to 3+, CDN in front | The easy part, last |
| 7 | Cut polling, then cache counts | Buys the next multiple |

Items 1–4 are application work and cannot be bought. Do them before you open
the doors, not after.

---

# Hardware: what it buys, and what it cannot

Written for the case of arriving at ~1,000 concurrent inside the first month
off paid advertising.

## The one that surprises people: a bigger web box does almost nothing

`startCommand` is `node dist/index.cjs` — **one process, one thread, one core**
([package.json](../../package.json)). Moving the web service from a 1-CPU plan
to a 4-CPU plan leaves three cores idle. Web capacity comes from *processes*,
not from the size of the machine they sit on:

- **More instances.** Set `numInstances` in [render.yaml](../../render.yaml) —
  there is none today, so it runs exactly one.
- **Or cluster inside the instance**, forking one worker per core.

Both are the same thing to this codebase: more than one process. Which means
both need the same prerequisites as Stage 3 — in-memory credit holds, the
unguarded jobs, the in-process builds. **Clustering is not a way around that
work.** A second core and a second machine break identical things.

Extra RAM on the web service is worth a little (bigger builds, more in-flight
requests) but it is not the constraint. Extra CPU is worth nothing until there
is a process to use it.

## Where a bigger box *does* buy capacity: Postgres

Postgres uses a backend process per connection and will genuinely use every
core you give it. This is where the money goes.

- **RAM** so the working set is cached. `basic-256mb` caches essentially
  nothing; every query that should be a memory hit goes to disk. This is the
  single largest win available to you right now.
- **CPU** for concurrent queries.
- **Connection limit** high enough for your instance count — or a pooler, which
  is cheaper than the tier that would offer the connections directly.

## 1,000 clicks is not 1,000 dashboards

This changes the sizing more than any tier choice, so work it out before you
buy anything.

| Visitor | Requests/minute | Cacheable? |
|---|---|---|
| Anonymous, on the landing page | ~3 (`/api/projects` every 20 s) | **Yes — identical for everyone** |
| Signed in, any page | 9 | Partly (counts are per user) |
| Signed in, on a project dashboard | 22 | No (per project) |
| In a live simulation | 40+ | No |

An ad click is the first row. 1,000 anonymous visitors is ~50 req/s of a query
whose answer is *the same for all of them*
([live-projects.tsx](../../client/src/components/live-projects.tsx)). Put a
20-second cache in front of `/api/projects` — edge or in-process — and 50 req/s
becomes roughly nothing.

So the real question is not "can I serve 1,000 clicks" but "how many of them
sign in, open a project, and leave the tab open". Provision for *that* number.
Assume it is lower than you hope, and make the anonymous path free.

## A starting configuration for ~1,000 concurrent signed-in users

Provision this, then measure — the numbers below are a starting point derived
from the measured per-user request rates, not a guarantee.

| Piece | Start at | Why |
|---|---|---|
| Web instances | **4–8** at 1–2 CPU | 1,000 × 22 req/min ≈ 366 req/s; budget 50–100 req/s per process and keep headroom |
| Web autoscaling | min 3, max 10 | Ad traffic is spiky; a cold start under a spike is the worst time to find out |
| Postgres | **4+ vCPU, 16 GB+** | Must hold the working set; 366 req/s of small queries is CPU-bound on a small tier |
| PgBouncer | transaction mode | 8 instances × 22 connections = 176; see the caveats in [Launching above 200](#launching-above-200) |
| Redis | small | Counts cache, and move sessions off Postgres |
| CDN | in front of everything | Static bundle, public objects, and the cacheable anonymous API |
| Worker service | 1 instance | Jobs and long-running builds, off the web path |

If polling is cut (SSE for the three count endpoints), the web tier halves.
That is the cheapest capacity in this table by a wide margin.

## What each purchase is wasted without

Buy in this order, because each of these is money spent on nothing until the
line above it is true.

| Purchase | Wasted unless |
|---|---|
| More web instances | credit holds are in Postgres and jobs have moved to a worker |
| A bigger Postgres tier | nothing — buy this first, it always helps |
| PgBouncer | the session pool is shared and the session-level `SET`s have moved |
| Read replicas | `/path` no longer writes on read |
| A counts cache | nothing — it always helps |
| A CDN | nothing — it always helps |

Three of those are unconditional: **Postgres tier, CDN, counts cache.** Start
there today; none of them need a code change first.

## How to size it properly rather than by this table

1. Fix `/path` and share the session pool — otherwise you measure the
   bottleneck rather than the app.
2. Deploy one instance on the tier you intend to use.
3. Drive it with the load harness until p95 crosses your limit. That gives
   **requests per second per instance**, measured, on real hardware.
4. Divide your expected peak by it, add 50% headroom, set `numInstances`.
5. Re-measure after every change that alters the per-user request rate.

Step 3 is the only number in this document that will be true for your
deployment, because it will have been measured on it.

---

## Cloud storage

You are already on Google Cloud Storage — [objectStorage.ts](../../server/replit_integrations/object_storage/objectStorage.ts)
picks credentials three ways, and **local disk is only used in development and
test, never in production**. So "switching to cloud storage" is configuration,
not a migration.

To run it off Replit:

1. Create a GCS bucket in the same region as the service.
2. Create a service account with object read/write on that bucket only.
3. Set on Render:
   - `GCS_SERVICE_ACCOUNT_KEY` — the whole JSON key file. The code handles
     escaped newlines, so pasting it into a form is fine.
   - `GOOGLE_CLOUD_PROJECT`
   - `PRIVATE_OBJECT_DIR` — **required in production.** Without it the code
     refuses rather than silently writing to a disk that vanishes on deploy.
   - `PUBLIC_OBJECT_SEARCH_PATHS`
4. Verify by uploading through the app and confirming the object appears in the
   bucket — not by reading logs.

Scaling notes, once it is live:

- **Serve public objects through a CDN**, not through Node. Same reasoning as
  the static bundle: bytes through your one CPU are bytes not spent on queries.
- **Image rendering is CPU work on the web instance.** `sharp` and the merch
  renderers ([merch-render.ts](../../server/merch-render.ts)) compete with every
  request on the same core. They are behind `rateLimit("render")` today. If
  render traffic grows, move it to the worker service.
- **Storage costs scale with users; egress usually dominates.** A CDN in front
  cuts the bill as well as the CPU.

---

## How to know it is time

Watch these four. Each has an action attached, which is the point.

| Signal | Means | Do |
|---|---|---|
| p95 latency climbing on `/api/projects/:id/path` | Database is the constraint | Upgrade the tier (Stage 2) |
| `503` / `database_busy` appearing at all | Pool exhausted | Raise `DB_POOL_MAX` **after** the tier; find what is holding connections |
| Deploys interrupting user work | One instance | Worker service, then a second web instance (Stage 3) |
| Postgres CPU steady above ~70% | Tier is done | Upgrade before latency shows it |
| Connection count near the tier's limit | Instances are multiplying connections | PgBouncer, and share the session pool |
| One project's users all slow together | The `/path` sync is serialising them | Debounce or move the sync |

## What this does not cover

- **AI spend is its own ceiling** and it is not a capacity problem. A Nova build
  is dozens of model calls; per-provider rate limits and cost will bite before
  the server does.
- **Nothing here has been run against Render's tiers.** The load test ran
  locally. The first real traffic is the first real measurement — the harness
  is worth rebuilding against staging before you need it.
