# What the database holds, and what it holds in the clear

A dump of this database — a backup, a support export, a leaked replica — is the thing to design against. Three levels, by what the data is for.

## Hashed (can be compared, never read back)

| Column | How |
|---|---|
| `users.password_hash` | bcrypt |
| `users.mfa_recovery_codes` | SHA-256, one entry removed as it's used |
| `mobile_refresh_tokens.token_hash`, `mcp_tokens.token_hash` | SHA-256 |
| `email_verification_tokens`, invite tokens | SHA-256 of the emailed token |

## Sealed (must be read back, so encrypted: AES-256-GCM under a key derived from `SESSION_SECRET`, `server/secret-box.ts`)

| Column | Why |
|---|---|
| `users.mfa_secret`, `users.mfa_pending_secret` | the shared secret behind every code |
| `project_backings.shipping_address`, `project_merch_orders.shipping_address` | where somebody lives; read by the project's team and the fulfilment job |
| `investment_applications.phone` | a personal number, read only by the project owner |
| builder-supplied connection strings | read back to run a query |

Sealed values read through `server/pii.ts`, which also accepts a plain value — rows written before sealing keep working rather than reading back as null. Rotating `SESSION_SECRET` makes sealed values unreadable; that is the intended failure (the builder re-enters them), and `openPii` answers null rather than guessing.

## In the clear, deliberately

| Column | Why not |
|---|---|
| `users.email`, `first_name`, `last_name` | every sign-in, invite, mention and search looks them up; a sealed column can't be queried or indexed |
| `users.google_id`, `stripe_customer_id`, `stripe_subscription_id` | identifiers issued elsewhere, useless without that provider's keys |
| `sessions.sess` | a user id and flags, no credential |
| posts, comments, project text | the product; people publish it |

For these the control is not a cipher the server would undo on every request. It's who can reach the database, plus the routes that let a person take their data out or have it deleted (`server/account-data.ts`, `docs/security/audit-checks.md`).

## Deleting

- **A post with replies** keeps its row and loses its content, so other people's comments aren't cascade-deleted with it (`feed_posts.deleted_at`; same rule as a comment with replies). A post nobody replied to is deleted outright.
- **An account** scrubs the `users` row to a tombstone and deletes or anonymises everything keyed to it, by a list kept in `server/account-data.ts`.
- **A project** deleted with its owner's account takes its contents with it: 44 foreign keys were given `ON DELETE CASCADE` in migration `0019` so the database enforces that, rather than a delete leaving orphans behind.

## Schema

Migrations only — `migrations/0000_baseline.sql` plus incremental files, applied with `npm run db:migrate`. There is no `drizzle-kit push` in any script; `npm run db:baseline` exists only to mark a database that predates migrations as current. Tests: `test/unit/pii.test.ts` (sealing, legacy rows, rotation), `test/integration/investment-applications.test.ts` (the number is readable by its owner and unreadable in the column), `test/integration/post-delete.test.ts`, `test/integration/account-data.test.ts`.
