# How this product is deployed

**This file is the single source of truth for how SparkTower is deployed. If
another document in this repository disagrees with it, that document is wrong —
fix it or delete it rather than believing it.**

There is one production host, and it is **Render**. There is no second one.
Replit is where this repository was originally written, and the repo still
carries `.replit` and a `server/replit_integrations/` directory because of that
history — but nothing in production runs there any more, and no production value
is stored there. Any instruction to "deploy on Replit", "set this in Replit
Secrets" or "restore from the Replit snapshot" is out of date.

## The shape of it

| | |
|---|---|
| Host | Render |
| Service type | Web Service (one process: API, built client, background loops) |
| Blueprint | [`render.yaml`](../../render.yaml) in the repository root |
| Region | Oregon |
| Branch | `main`, auto-deploy on |
| Build | `npm ci && npm run build` |
| Pre-deploy | `npm run db:migrate && npm run db:verify` — migrations land, and are checked to have landed, before the new version takes traffic |
| Start | `npm run start` (the script sets `NODE_ENV=production` itself) |
| Health check path | `/_health` |
| Database | Render Postgres, same region, wired by `fromDatabase` in the blueprint |
| Environment variables | Render dashboard → your service → **Environment** |
| Uploads | a Google Cloud Storage bucket — *not* the container disk, which Render wipes on every deploy |

## Why this shape, and not another

**A Web Service, not a Static Site.** A Static Site serves files from a CDN
with no Node process, so every `/api/*` route would 404. Not a Private Service
either (unreachable from the internet), not a Background Worker (can't take
HTTP), not a Cron Job (short-lived). One Web Service runs the API, serves the
built client, and holds the background loops.

**Not the free instance.** Boot starts five background loops (backing,
analytics, promotions, moderation, retention) and the owner's console holds an
open SSE stream at `/api/admin/analytics/live`. A free instance sleeps when
idle, and a sleeping process runs no jobs. Pre-deploy commands are a paid-plan
feature too, and the migration step is one.

**Not the 512MB instance.** The client build peaks around 1.05GB in a single
process — measured — so 512MB dies mid-build with an out-of-memory that reads
like a broken repository.

**From the blueprint, not from the form.** Render → **New → Blueprint**,
pointed at this repository, reads [`render.yaml`](../../render.yaml) and
prompts for every value marked `sync: false`. The alternative — **New → Web
Service** and filling the form with the values in the table above — produces
the same service and a configuration nobody else can reproduce. Prefer the
blueprint; if the live service was built by hand, that is one of the open
questions at the bottom.

## The live URL

| | address | state |
|---|---|---|
| **Canonical** | `https://sparktower.app` | **this is the site.** The apex is a custom domain on Render (`A` → `216.24.57.1`); `www` CNAMEs to the Render service and 301s to the apex. Verified 2026-09-17: `/_ready` → `{"ready":true,"database":"ok","ms":1}`, and the sitemap publishes `https://sparktower.app/` |
| Also answers | `https://sparktower.onrender.com` | Render's own hostname. Still serves the app, and should keep doing so — links shared before the cutover point here |

`PUBLIC_URL` is `https://sparktower.app`, which is what makes the second row a
spare address rather than a second identity: emails, share links, the sitemap
and the OAuth callback are all built from `PUBLIC_URL`.

**A note on checking this yourself.** For the first hour or so after the
cutover, `sparktower.app` answered from two places depending on whose cache you
asked: a resolver holding GoDaddy's old parking record (`13.248.243.5`) served
a 404 parked page, while authoritative DNS had already moved to Render. `dig`
showed the new record while `curl` on the same machine still reached the old
one, because they don't share a cache. If that happens, it is propagation, not
a broken deploy — confirm with:

```sh
curl -s --resolve sparktower.app:443:216.24.57.1 https://sparktower.app/_ready
```

which bypasses every cache between you and Render. A 200 there means the
deployment is fine and only caches are behind.

## `PUBLIC_URL` is the site's identity, not a label

Read this before you change a domain, and read it again before you decide the
change is cosmetic.

`PUBLIC_URL` is the string every outbound address is built from. It is not
decoration and it is not derived from the hostname a request arrived on:

| Built from `PUBLIC_URL` | Where |
|---|---|
| Email verification links, the thing a new account needs to click before it can post at all | `server/email-verification.ts` |
| Invite links | `server/invite-routes.ts` |
| Published artifact / share URLs — the links people paste to other people | the client's share affordances, built on the same base |
| `sitemap.xml` `<loc>` entries and whether `robots.txt` says indexable at all | `server/sitemap.ts` |
| The Stripe webhook endpoint the app registers for itself at boot | `server/index.ts` |
| The Google OAuth callback URL | `server/replit_integrations/auth/replitAuth.ts` |
| CSRF trusted origins | `server/csrf.ts` |

Consequences worth being blunt about:

- **`PUBLIC_URL` is `https://sparktower.app`, and production agrees.** Verified
  2026-09-22 by asking the site rather than the dashboard: `npm run check:live`
  reads `sitemap.xml`, which is built from the same base URL as every emailed
  link, and it publishes `https://sparktower.app/`. That is the check to run
  after any deploy that touches the domain.
- **`sparktower.onrender.com` still answers, and should.** Links shared before
  the cutover point there. It publishes the canonical address, which is right —
  `npm run check:live -- https://sparktower.onrender.com --publishes https://sparktower.app`
  is how to say that to the checker so it doesn't read a correct secondary host
  as a fault.
- **If the domain moves again, `PUBLIC_URL` changes in the same sitting as DNS,
  not afterwards.** A domain that resolves to the app while `PUBLIC_URL` still
  names the old host produces a site that works and emails that send people
  somewhere else — and a Google sign-in that returns them to the other host,
  where their session cookie isn't, so they arrive signed out with nothing in
  the log to explain it. Session cookies are host-only.
- Changing it needs a redeploy (or restart) to take effect, and the Google
  console's authorised redirect URI has to change in the same sitting.
- Links already in the wild are not rewritten. Keep the old hostname answering;
  do not delete the Render subdomain.

`render.yaml` deliberately carries **no value** for `PUBLIC_URL` (`sync: false`).
The blueprint once declared one, and the dashboard held a different one — so
re-syncing the blueprint would have silently repointed the product at a host
that had no app behind it. The site's address is an operational fact that
changes on the day DNS moves, not a constant of the repository.

## How a deploy is triggered

1. **Merge to `main`.** Auto-deploy is on, so a merge is a deploy. Everything
   else below is the manual path for the same thing.
2. **Manually:** Render dashboard → the service → **Manual Deploy** → *Deploy
   latest commit*, or *Clear build cache & deploy* when a build fails in a way
   that smells like stale `node_modules`.
3. The pre-deploy command runs `npm run db:migrate && npm run db:verify`
   **before** the new version takes traffic. A failed migration fails the
   deploy and the old version keeps serving. That is the whole reason it is a
   pre-deploy command and not a step in the start script. The verify is there
   because the migrate alone could not fail — see below.
4. Render builds, boots the new instance, waits for `/_health`, then shifts
   traffic.

Before you press it, walk [release-checklist.md](../release-checklist.md).

## Environment variables

Set in the **Render dashboard → the service → Environment**. Nowhere else — not
in a committed file, not in the build command, not in a comment. `render.yaml`
lists every variable the service needs and marks each secret `sync: false`,
which means Render prompts for it and stores it; the repo never holds a value.

Editing an environment variable in the dashboard triggers a redeploy on its
own. That is convenient and also means a typo ships immediately.

Two checks exist so a missing variable is found before 2am rather than during a
boot:

```sh
npm run check:env          # scripts/check-env.mjs — what is set, what is missing, what looks wrong
npm run check:email-auth   # SPF / DKIM / DMARC for the sending domain; exits 0 only when all three are live
```

The server also refuses to boot without `SESSION_SECRET`, `MOBILE_TOKEN_SECRET`,
`DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` and `PLATFORM_OWNER_EMAIL`
(`server/secrets.ts`), which is correct and an unhelpful surprise if it is the
first you hear of it. Run `check:env` first.

Which variable does what, per environment: [env-contract.md](../env-contract.md).

## Where the database lives

Render Postgres, in the same region as the web service, wired to the web
service by `fromDatabase` in `render.yaml`. Use the **Internal Database URL**
for `DATABASE_URL` — it stays on Render's private network, so it is faster and
there is no `sslmode` to get right. The **External Database URL** is for
running migrations, `psql`, and backups from your own machine; it needs
`?sslmode=require`.

The most expensive mistake available here is pasting a local `.env`
`DATABASE_URL` (`127.0.0.1:5433`, a Docker container) into Render. The deploy
succeeds, the log says the service is live, `/_health` answers 200, and every
query fails with `ECONNREFUSED`. This is not hypothetical — it is what the first
deploy of this service did, and it is why `/_ready` exists.

Backups and restores: [backups.md](backups.md).

## When `db:migrate` says success and does nothing

`drizzle-kit migrate` does not track which migrations ran. It reads the newest
`created_at` in `drizzle.__drizzle_migrations` and applies every journal entry
stamped later than that — one comparison, one high-water mark. Anything at or
below it is assumed done, and either way the command prints *migrations applied
successfully!* and exits 0.

So a single row stamped later than the newest migration hides all of them. That
is what happened here: eighteen rows in the dev database matched no migration
file — left by files edited or deleted after they ran — and one of them was
stamped past the end of the journal. Ten migrations were skipped on every
deploy, silently, for days.

Two things came out of it:

- **`npm run db:verify`** runs straight after the migrate in pre-deploy and
  asks whether every journal entry is recorded as applied, matching by content
  hash. If one isn't, the deploy goes red instead of quiet.
- **`npm run db:reconcile`** is the repair. It reports by default and changes
  nothing until `-- --apply`. It moves rows whose hash matches a migration onto
  that migration's journal timestamp, and copies rows matching no file into
  `drizzle.__drizzle_migrations_orphaned` before removing them — a row saying a
  migration once ran is the only record that it did.

```bash
DATABASE_URL=<external url> npm run db:reconcile            # read what it intends to do
DATABASE_URL=<external url> npm run db:reconcile -- --apply
DATABASE_URL=<external url> npm run db:migrate
DATABASE_URL=<external url> npm run db:verify
```

Every migration from `0051` on is written to be safe to run twice — `IF NOT
EXISTS`, or an `ALTER TABLE` inside a `DO $$ … EXCEPTION WHEN duplicate_object`
block — so re-applying one against a database that already has it is a no-op
rather than a failed deploy. Keep it that way when adding migrations; the
guard test in `test/unit/migration-journal.test.ts` covers the journal, not the
SQL.

**The root cause, so it isn't repeated:** the journal's `when` values were
edited by hand after those migrations had already run, which is what put the
databases and the file out of step. Don't renumber or restamp an entry that has
shipped. Add a new one.

One wart left alone on purpose: two files are numbered `0056`, from the same
hand-editing. `drizzle-kit` numbers the next migration from the last entry's
`idx`, so it has already absorbed the duplicate and nothing collides. Renaming
a migration that has run everywhere would be churn for no behavioural gain.

## The health endpoints, and which one a monitor should watch

| Endpoint | Touches the database? | What a 200 proves | Who should ask |
|---|---|---|---|
| `/_health` | **No, deliberately** | the process is alive and listening | Render's platform health check, and nothing else |
| `/_ready` | **Yes** — `SELECT 1` | the process is alive *and* can reach Postgres. Returns `{"ready":true,"database":"ok","ms":…}`, or 503 with the address it tried | you, and the uptime monitor |

`/_health` does not query the database on purpose. The only thing a platform
can do about an unhealthy service is restart it, and restarting a server whose
*database* is unreachable turns a degraded service into a crash loop — the
database does not come back faster because the app keeps dying. So the probe
that can kill the process asks the shallow question, and the deep question is
asked by something whose response is to page a person.

A 503 from `/_ready` prints the connection target it failed against, redacted.
A localhost address there means the deployment is carrying a development
connection string.

## Verifying a deploy came up correctly

```sh
export APP=https://sparktower.onrender.com   # today. sparktower.app once DNS moves

curl -s $APP/_health                                            # OK
curl -s $APP/_ready                                             # {"ready":true,"database":"ok","ms":…}
curl -s -o /dev/null -w '%{http_code}\n' $APP/api/auth/user     # 401 — mounted and guarding itself
curl -s -o /dev/null -w '%{http_code}\n' $APP/api/does-not-exist # 404 JSON, not the HTML app
curl -s $APP/sitemap.xml | head -5                              # the <loc> host is PUBLIC_URL — check it is the one you meant
```

A 401 on `/api/auth/user` is the right answer: it means the API is mounted and
protecting itself. A 200 on `/_health` with a broken `/_ready` is the failure
mode this whole section exists to catch.

Then check the Render log for the boot lines that name what the process decided:
the storage bucket and which credentials it will use, the Google OAuth callback
URL it will send people to, and whether it skipped Stripe webhook registration
for want of a public URL. Those three lines are where a wrong `PUBLIC_URL` or a
missing bucket announces itself.

### What a half-configured production deploy now does instead of pretending

Two settings used to be logged and otherwise ignored, so the service came up,
answered `/_health` with a 200, and was quietly missing a whole feature:

- **No `PRIVATE_OBJECT_DIR`** switches the **Uploads** surface off, exactly as
  the admin kill switch would: every upload route answers 404, and
  `/admin/surfaces` shows the reason next to a switch that won't move. Without
  this, each avatar, cover and post image failed on its own, one user at a
  time. Set the variable and deploy again and uploads come back by themselves —
  it is read from the environment at boot, not stored as a decision.
- **No `PUBLIC_URL`** (or `SERVER_BASE_URL`) stops the boot outright. Render
  sets `RENDER_EXTERNAL_URL` on every service by itself, and it used to count
  as an answer here; it isn't one, because nothing that builds a link reads it
  and it names the `onrender.com` host rather than the one people use. The
  Stripe webhook is registered from the same resolver as every emailed link,
  so "payments recorded nothing for a week" and "links pointed at the wrong
  host" can no longer be two different configurations.

The fuller pass — auth, Stripe, uploads, the wedge, the owner's console — is
[release-checklist.md §4](../release-checklist.md).

## Rolling back

- **Code:** Render dashboard → the service → **Events** (or Deploys) → the last
  good deploy → **Rollback**. Sessions live in Postgres, so nobody is signed
  out by a rollback.
- **Schema:** migrations only go forward. An additive migration (new table, new
  nullable column) leaves the old code working, so rolling the code back
  without touching the schema is safe. A destructive one has no automatic undo:
  restore from a Render Postgres backup taken before the deploy
  ([backups.md](backups.md)), or write a new migration that puts back what you
  need.
- **Can't ship a fix in the next ten minutes?** Turn the surface off at
  `$APP/admin/surfaces`. It reaches every instance within ten seconds and
  returns 404 for the whole route prefix, which reads as "this feature doesn't
  exist" rather than "the site is broken".

## Is anything watching? Partly.

**What runs today, without an account anywhere:**

```sh
npm run check:live      # the canonical site: alive, database, migrations, and the address it publishes
```

It asks the site what it believes about itself. `/_health` says a process
answered; `/_ready` says it can reach Postgres and that every migration in the
repo has run; `sitemap.xml` says which address the product is putting in
emails and share links. That last one is the check no ordinary monitor makes,
and it is the failure that has actually happened here: a site that is up,
healthy, and quietly sending everybody to a hostname that is no longer the
product. It exits non-zero, so CI and an uptime service can both run it.

CI runs it after every deploy to `main` (`.github/workflows/ci.yml`), which is
the moment a misconfigured redeploy would otherwise go unnoticed.

**What is still missing: nobody is woken at 3am.** CI checks a deploy; it does
not watch the site between deploys. If production falls over an hour after a
green deploy, the way anybody finds out is by opening it. That needs a service
that runs on a clock and has somewhere to send an alert, which needs an account
and a person's address — the steps below, which only you can do.

**No UptimeRobot account exists yet.** The steps below are the plan, not a
description of something that is running. Do not tick a box until you have done
the thing.

- [ ] **Create the UptimeRobot account** (uptimerobot.com). Use an address more
      than one person can reach, or the alert goes to someone on a plane.
- [ ] **Add an alert contact and confirm it.** An unconfirmed contact doesn't
      receive anything, and a monitor with no contacts watches in silence.
- [ ] **Create the monitor** — with the Main API Key from My Settings → API:

      ```sh
      npm run monitor:setup -- --dry-run   # says what it would do, changes nothing
      npm run monitor:setup                # asks for the key; nothing is echoed or stored
      ```

      It sets everything in the table below, attaches every confirmed alert
      contact, and reads the monitor back to show what was really saved. Safe to
      run again: it matches on the URL and edits the monitor it finds rather
      than adding a second one — which is also how you repoint it after the
      domain moves:

      ```sh
      npm run monitor:setup -- --url https://sparktower.onrender.com/_ready
      ```

      Never pass the key as an argument (the script refuses): your shell keeps
      it in history and `ps` shows it to anyone on the machine. The server never
      needs this key — only this script does — so it is stored nowhere.

      The settings it applies, if you'd rather click them in by hand:

      | Field | Value |
      |---|---|
      | Monitor type | HTTP(s) |
      | Friendly name | `SparkTower production` |
      | URL | `https://sparktower.app/_ready` — the canonical domain, so the monitor watches what people actually use |
      | Interval | 5 minutes. Shorter is available on paid plans; 5 is enough to catch an outage before people do, and infrequent enough not to be noise |
      | Timeout | 30 seconds — a cold or busy instance can take a while to answer |

      Watch `/_ready`, not `/_health`. `/_health` answers 200 while the
      database is unreachable, which is precisely the outage you want to be
      told about.
- [x] **Check the body, not just the status code** — the script sets a keyword
      condition: alert when the response does **not** contain `"ready":true`.
      Without it, any 200 counts as healthy. If the script reports the monitor
      came back as HTTP-status-only, the plan didn't accept a keyword check and
      this box is not ticked after all.
- [x] **Alert contacts** are attached by the script — every confirmed one on the
      account. It refuses to pretend otherwise: with none, it says so and the
      monitor would notice an outage and tell nobody. At minimum an email
      address that reaches a person on their phone. Better, add the same Slack or Discord incoming webhook that
      `ERROR_WEBHOOK_URL` already points at, so outages and 500s land in the
      same place.
- [ ] **Set the alert threshold so one blip doesn't page.** Notify after two
      consecutive failures rather than one; Render instances occasionally take
      a moment.
- [ ] **Prove it fires.** Pause the Render service (or point the monitor at a
      deliberately wrong path) and confirm the alert actually arrives at every
      contact. An untested alert channel is the same as no alert channel.
- [ ] **Write the date and who set it up here** once it is done, so the next
      person knows this paragraph is no longer a plan.

**When it fires,** in order:

1. `curl -s https://sparktower.onrender.com/_ready`. A 503 names the failure;
   `"database":"unreachable"` and a connection target is usually the whole
   answer.
2. `curl -s https://sparktower.onrender.com/_health`. 200 here with a failing
   `/_ready` means the process is fine and Postgres is not — check the Render
   Postgres instance's own status page and metrics before touching the web
   service.
3. Render dashboard → the service → **Logs**. If a deploy went out in the last
   few minutes, that is the suspect; roll back (above) and diagnose afterwards.
4. Render's status page (status.render.com) for a platform-wide incident, which
   is the case where the answer is "wait" and the useful action is telling
   people.
5. If it is one feature rather than the whole site, turn that surface off at
   `$APP/admin/surfaces` instead of shipping under pressure.
6. Write what happened in the release log at the bottom of
   [release-checklist.md](../release-checklist.md).

## Open questions — things nobody has confirmed

Written down rather than guessed at. Each is a question for whoever holds the
Render account.

- [ ] **What is `PUBLIC_URL` actually set to on the running service?**
      `render.yaml` declares `https://sparktower.app`; the live sitemap
      publishes `https://sparktower.onrender.com/`, so the dashboard value
      differs from the blueprint. Read the dashboard, and make the blueprint
      say the same thing so the next blueprint deploy doesn't silently change
      the site's identity.
- [ ] **Which instance plan is the web service actually on?** The blueprint
      asks for `standard`. It must not be Free: boot starts five background
      loops (backing, analytics, promotions, moderation, retention) and the
      owner's console holds an open SSE stream, and a free instance sleeps when
      idle — a sleeping process runs no jobs. Pre-deploy commands are also
      paid-plans-only, and the migration step depends on one.
- [ ] **Which Postgres plan, and what backup retention does it give?** The
      blueprint asks for `basic-256mb`. Retention differs by plan and Render
      has changed it before; read the database's own Backups tab rather than
      trusting a number written here. See [backups.md](backups.md).
- [ ] **Was the service created from `render.yaml` (a Blueprint) or by hand?**
      If by hand, the blueprint is documentation rather than the deployed
      truth, and every drift between them is invisible until someone
      re-deploys from it.
- [ ] **Is the uploads bucket configured on the live service?** Production
      refuses to fall back to container disk, so either `PRIVATE_OBJECT_DIR`
      and its credentials are set or uploads are failing. The boot log says
      which; nobody has read it since the switch.
- [ ] **Is `ERROR_WEBHOOK_URL` set, and does anyone receive it?** Unset, a 500
      in production is one line on stderr and nobody is told.
