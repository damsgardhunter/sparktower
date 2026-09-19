# Backups, and the restore somebody has actually done

A backup you have never restored is a belief. The morning you need it is the
worst possible morning to discover that the snapshot is of the wrong database,
that it takes four hours, or that it restores fine and the app can't read it.

So this file has two halves: what is backed up, and the log of the times someone
sat down and restored it. The second half is the one that counts.

Production is Render — the app and the Postgres behind it. If you find an older
instruction here or anywhere else about a *Replit* snapshot, it is stale: that
is not where the database lives. [deploy.md](deploy.md) is the source of truth
for the deploy; this file covers only the database behind it.

## What is backed up

| What | Where | How often | Kept | Who can restore it |
|---|---|---|---|---|
| Postgres (everything: accounts, projects, posts, sessions, the Stripe ledger) | Render → the database → **Backups** | Render's automatic daily backup | **unconfirmed — read the database's own Backups tab.** Retention varies by plan, and `render.yaml` asks for `basic-256mb` | whoever holds the Render account |
| Uploaded objects (avatars, covers, artifacts) | the bucket behind `PRIVATE_OBJECT_DIR` | whatever the bucket's own versioning gives | — | the account owner |
| The code and every migration | GitHub, `main` | every push | forever | anyone with the repo |

Two honest gaps, written down rather than implied:

- **The daily backup is the only copy, and it lives with the thing it backs
  up.** It is Render's, on Render, for a database on Render: an account-level
  problem takes both, and so does a deleted database. The fix is a periodic
  `pg_dump` written somewhere else entirely; until that exists, this row is the
  risk. Render's own backups are also not downloadable as a file on every plan
  — see the open questions — which is a second reason to keep an off-site dump
  you control.
- **Objects are not snapshotted on a schedule.** A deleted or overwritten file
  is recoverable only if the bucket keeps versions. Check that it does.

## What restoring actually involves

Postgres holds the sessions table, so a restore signs everybody in to whatever
the world looked like at the snapshot: sessions that were created after it are
gone, and people are signed out. That is correct and worth knowing before you do
it under pressure.

Migrations only go forward. Restoring an older snapshot puts the schema back to
that day, so the running build is then *ahead* of the database. Either redeploy
the build from the same commit, or re-run `npm run db:migrate` against the
restored database before serving traffic.

## Moving a database onto another one

Once, at launch: the development database becomes the production one. It is a
destructive operation with a pasted connection string in it — the command that
wipes the right database looks exactly like the one that wipes the wrong
database — so it is a script with a guard rather than a `DROP SCHEMA` typed into
a terminal.

```sh
node scripts/copy-database.mjs --to "<the target's External Database URL>" --dry-run   # look first
node scripts/copy-database.mjs --to "<the target's External Database URL>"
```

The source defaults to `DATABASE_URL` in `.env`. The script prints both sides
(version, size, tables, accounts), refuses a target that already holds accounts
unless you pass `--force`, and makes you type the target's database name before
it touches anything. Afterwards it compares tables, accounts **and schemas**
against the source and fails if they don't match.

That last part is not decoration. This app's data lives in three schemas —
`public`, `drizzle` (the migration bookkeeping) and `stripe` (stripe-replit-sync's
tables) — and the first version of the script counted `public` only. It
reported a cheerful success over a copy where `stripe` and `drizzle` had both
failed to restore: a green light over a half-copied database, which is worse
than a red one.

Two things that will bite on a managed host:

- **The target's role must own the database**, or `CREATE SCHEMA` is refused
  and `stripe` and `drizzle` silently don't arrive. On Render, the database's
  own user is the owner; use that connection string, not another role's.
- **Copy before anyone signs up.** The guard exists because overwriting a
  database with real accounts in it is unrecoverable without a backup.

Sessions are truncated after the copy: they were signed with the source's
`SESSION_SECRET` and a stale session row reads like a signed-in person.

Then confirm the migration bookkeeping came across, which is what stops the
next deploy trying to re-apply everything:

```sh
DATABASE_URL="<target>" npm run db:migrate     # should apply nothing
```

## What Render gives you, and how a restore actually works there

Render Postgres takes its own daily backups, and a restore there is **not** a
file you download and replay. Two distinct mechanisms, and they behave
differently enough that confusing them under pressure is the failure:

| | Render's own backup | Your own `pg_dump` |
|---|---|---|
| Taken by | Render, automatically, daily | you, by running a command |
| Lives | with the database, on Render | wherever you put it — the point of it |
| Restores into | a **new database instance** Render creates from the backup, at a point in time. The old one is left alone | any empty database, anywhere |
| Cutover | you copy the new instance's connection string into `DATABASE_URL` and redeploy | same |
| Retention | unconfirmed; read the Backups tab | as long as you keep the file |

Two consequences of "restores into a new instance":

- **The connection string changes.** A restore is finished not when Render says
  the new database is ready, but when `DATABASE_URL` on the web service points
  at it and the service has redeployed. `curl /_ready` against the site is what
  tells you which database the app is actually talking to.
- **The old database is still there**, which is the good news (nothing is
  destroyed by trying) and the trap (it is easy to end up with two databases
  and no note saying which one is live). Rename or delete the old one the same
  day, once you are sure.

Your own dump, which is the copy that survives losing the Render account:

```sh
pg_dump "<the External Database URL>?sslmode=require" -Fc -f sparktower-$(date +%F).dump
```

The External URL rather than the Internal one: the internal address only
resolves inside Render's private network. `-Fc` because a custom-format dump is
what `pg_restore` takes, and what lets you restore selectively if you ever need
to.

## The rehearsal

Do this once a quarter, and after any migration big enough to worry you. It
never touches production: everything happens in a scratch database.

1. Get a copy to restore. Either take the dump above from production's External
   Database URL, or — the version this file actually wants proved — use
   Render's own backup, restoring it into a **new** database instance from the
   database's Backups tab and dumping *that* so the scratch restore is of a
   real backup rather than of a live read.
2. Restore it into a scratch database — a name ending in `_test`, so nothing in
   this repository can mistake it for the real one:
   ```sh
   createdb sparktower_restore_test
   pg_restore -d sparktower_restore_test --no-owner path/to/snapshot.dump
   ```
   `--no-owner` matters on a managed host: the roles in the dump do not exist
   on your machine, and without it every `ALTER ... OWNER TO` is an error.
3. Check it is the whole thing, not an empty shell:
   ```sh
   psql sparktower_restore_test -c "select count(*) from users;"
   psql sparktower_restore_test -c "select count(*) from projects;"
   psql sparktower_restore_test -c "select max(created_at) from posts;"   # how much you'd have lost
   ```
   And check all three schemas arrived, not just `public` — `\dn` should list
   `public`, `drizzle` and `stripe`. A restore that quietly dropped `drizzle`
   makes the next deploy try to re-apply every migration.
4. Check the app can read it — the part a `count(*)` never proves:
   ```sh
   DATABASE_URL=postgresql://localhost/sparktower_restore_test npm run db:migrate   # should say nothing to apply
   DATABASE_URL=postgresql://localhost/sparktower_restore_test npm run dev
   ```
   Sign in as a real account, open a project, open the owner's console.
5. Drop the scratch database, and add the row below — including how long it
   took, because that number is your actual recovery time and the one you will
   want when somebody asks.

## Restore log

Newest first. A row here is the only evidence that any of the above works.

| date restored | snapshot date | how long | data lost (gap to snapshot) | went wrong |
|---|---|---|---|---|
| 2026-09-16 | 2026-09-16 (fresh **local** `pg_dump` of **development** — not a production backup, and not taken from the host's own snapshots) | 11s end to end — dump 3s, restore 5s, migrate 3s | none (the dump was taken at the moment of the rehearsal) | nothing |

**What that row proves, and what it doesn't.** It proves the mechanics: a
`pg_dump` of this application restores into an empty database, comes back whole
(102 tables, 17 accounts, 13 projects, 30 posts, newest post intact), the
migration bookkeeping survives the round trip so `db:migrate` finds nothing to
apply (22 applied migrations before and after), and the application's own query
layer reads the result — accounts, projects and posts, through Drizzle, not just
`count(*)`.

It does **not** prove the thing this file exists for: **nobody has yet restored
a real backup of production.** That rehearsal used a `pg_dump` taken locally
against the development database — not a snapshot from the platform holding
production, and at the time that platform was Replit rather than Render, which
only widens the gap. Do not let a later reading of this row upgrade it into
something it isn't.

The differences that could bite are exactly the ones no local rehearsal can
reach — whether the backup is of the database you think it is, whether Render's
restore-into-a-new-instance flow behaves as described above, how long a
production-sized restore takes, and whether the cutover (new connection string
into `DATABASE_URL`, redeploy) goes cleanly. The next rehearsal should use a
real Render backup; the steps above are unchanged, and the timings here are the
floor, not the estimate.

A note on scale while reading those timings: the development database is 3.2MB.
Production time will be dominated by the download and by the largest tables
(`activity_events` first), so treat 11 seconds as "the procedure is sound",
never as the recovery time.

## Open questions

Unverified, and deliberately not guessed at. Each is a question for whoever
holds the Render account; answer them here rather than in a chat window.

- [ ] **What backup retention does this database's plan actually give?** The
      row at the top of this file says "unconfirmed" on purpose. Read the
      database's **Backups** tab in the Render dashboard and write the real
      number here. Retention differs by plan, and Render has changed it before,
      so a number copied from a blog post is worse than none.
- [ ] **Can a backup be downloaded as a file on this plan, or only restored
      into a new instance?** This decides whether an off-site copy needs the
      `pg_dump` above or can just be a download.
- [ ] **Is point-in-time recovery available here, and to what granularity?**
      It changes "how much would we lose" from a day to minutes, which is worth
      knowing before you need it rather than after.
- [ ] **Does the uploads bucket have object versioning on?** The row at the top
      says "whatever the bucket's own versioning gives", which is honest and
      useless until somebody checks.
- [ ] **Nobody has restored a production backup.** Covered above, repeated here
      because it is the open step that matters most.
