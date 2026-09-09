# Environment variable contract

What each environment reads, and where the value comes from. `.env.example`
lists every variable with what it is *for*; this is the other axis — for each
environment, which ones are set and by whom.

There are three environments. There is no staging.

| environment | how the process gets its variables |
|---|---|
| **local** | `.env` in the repo root (gitignored), loaded by `tsx --env-file`. Copy `.env.example` to start. |
| **CI** | the workflow file only. Nothing is read from a `.env`; the test config pins every value it needs to a fixed fake (see `vitest.config.ts` and `playwright.config.ts`). |
| **production** | Replit → Secrets. Nothing else. The server refuses to boot if the ones marked *required* are missing. |

## Required to boot

| variable | local | CI | production |
|---|---|---|---|
| `DATABASE_URL` | your own Postgres | per-run service container (`ci-<run id>`) | Replit Secrets |
| `SESSION_SECRET` | any value | pinned fake | **must be random**; the dev fallback is refused in production |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | real key | pinned fake — tests never call the API | Replit Secrets |

## Who runs the site

| variable | local | CI | production |
|---|---|---|---|
| `PLATFORM_OWNER_EMAIL` | your address | `owner@test.local` | Replit Secrets |
| `PLATFORM_REVIEWER_EMAILS` | your address | `reviewer@test.local` | Replit Secrets |

Roles are re-derived from these at every boot. Removing an address removes
the role on the next restart.

## Integrations (optional; the feature is off without them)

| variable | local | CI | production |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` / `_SECRET` | optional | unset | Replit Secrets |
| `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` | optional | unset | Replit Secrets |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | test-mode keys | unset — the webhook tests stub the client | Replit Stripe connector, or Secrets |
| `PRINTFUL_API_KEY` / `PRINTFUL_STORE_ID` | optional | unset | Replit Secrets |
| `GITHUB_TOKEN` | personal token, for code audits | unset | Replit Secrets |
| `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS` | unset → local disk | unset → local disk | bucket path |

## Set by the platform, never by hand

`REPLIT_DOMAINS`, `REPLIT_DEPLOYMENT`, `REPL_IDENTITY`,
`REPLIT_CONNECTORS_HOSTNAME`. Present in production, absent everywhere else.
Code that branches on them must treat "absent" as the local case.

## Mobile

`mobile/.env` holds `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`. These are compiled into
the app binary and are OAuth client ids, not secrets. See
`mobile/.env.example`.

## Rules

- **A new `process.env.X` in the server is added to `.env.example` in the
  same commit**, with a comment. The release checklist checks this.
- **Tests never read a real credential.** Anything a test needs is pinned to
  a value that is obviously fake in `vitest.config.ts`. If a test would need a
  real key, it is not a test that belongs in CI.
- **No secret in the workflow file.** CI-only values are derived per run
  (`${{ github.run_id }}`); anything else goes in repository secrets and is
  referenced as `${{ secrets.NAME }}`.
- **Production values are set in Replit and nowhere else.** Not in a
  committed file, not in a build step, not in a comment.
