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
| — | — | — | — | *No restore has been rehearsed yet. Until there is a row here, the backups are untested.* |
