# Scaling this, as users arrive

What to change, in what order, and how to know it is time. Every number here
comes from this repository or from a load test against it — nothing is a rule
of thumb.

Read [deploy.md](deploy.md) first for how the thing is deployed at all. This is
only about making it hold more people.

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

## What this does not cover

- **AI spend is its own ceiling** and it is not a capacity problem. A Nova build
  is dozens of model calls; per-provider rate limits and cost will bite before
  the server does.
- **Nothing here has been run against Render's tiers.** The load test ran
  locally. The first real traffic is the first real measurement — the harness
  is worth rebuilding against staging before you need it.
