# Backups, and the restore somebody has actually done

A backup you have never restored is a belief. The morning you need it is the
worst possible morning to discover that the snapshot is of the wrong database,
that it takes four hours, or that it restores fine and the app can't read it.

So this file has two halves: what is backed up, and the log of the times someone
sat down and restored it. The second half is the one that counts.

## What is backed up

| What | Where | How often | Kept | Who can restore it |
|---|---|---|---|---|
| Postgres (everything: accounts, projects, posts, sessions, the Stripe ledger) | Replit Database → Backups | automatic daily snapshot | Replit's retention window | the account owner |
| Uploaded objects (avatars, covers, artifacts) | the bucket behind `PRIVATE_OBJECT_DIR` | whatever the bucket's own versioning gives | — | the account owner |
| The code and every migration | GitHub, `main` | every push | forever | anyone with the repo |

Two honest gaps, written down rather than implied:

- **The daily snapshot is the only copy, and it lives with the thing it backs
  up.** An account-level problem takes both. The fix is a periodic `pg_dump`
  written somewhere else entirely; until that exists, this row is the risk.
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

## The rehearsal

Do this once a quarter, and after any migration big enough to worry you. It
never touches production: everything happens in a scratch database.

1. Take the most recent snapshot from Replit → Database → Backups and download
   it.
2. Restore it into a scratch database — a name ending in `_test`, so nothing in
   this repository can mistake it for the real one:
   ```sh
   createdb sparktower_restore_test
   pg_restore -d sparktower_restore_test --no-owner path/to/snapshot.dump
   ```
3. Check it is the whole thing, not an empty shell:
   ```sh
   psql sparktower_restore_test -c "select count(*) from users;"
   psql sparktower_restore_test -c "select count(*) from projects;"
   psql sparktower_restore_test -c "select max(created_at) from posts;"   # how much you'd have lost
   ```
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
| 2026-09-16 | 2026-09-16 (fresh `pg_dump` of **development**, not a Replit snapshot) | 11s end to end — dump 3s, restore 5s, migrate 3s | none (the dump was taken at the moment of the rehearsal) | nothing |

**What that row proves, and what it doesn't.** It proves the mechanics: a
`pg_dump` of this application restores into an empty database, comes back whole
(102 tables, 17 accounts, 13 projects, 30 posts, newest post intact), the
migration bookkeeping survives the round trip so `db:migrate` finds nothing to
apply (22 applied migrations before and after), and the application's own query
layer reads the result — accounts, projects and posts, through Drizzle, not just
`count(*)`.

It does **not** prove the thing this file exists for: nobody has yet downloaded
a *Replit* snapshot of *production* and restored that. The two differences that
could bite are the ones no local rehearsal can reach — whether the snapshot is
of the database you think it is, and how long a production-sized restore takes.
The next rehearsal should use a real downloaded snapshot; the steps above are
unchanged, and the timings here are the floor, not the estimate.

A note on scale while reading those timings: the development database is 3.2MB.
Production time will be dominated by the download and by the largest tables
(`activity_events` first), so treat 11 seconds as "the procedure is sound",
never as the recovery time.
