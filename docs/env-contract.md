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
| `RESEND_API_KEY` / `EMAIL_FROM` | optional — unset, emails are written to the server log and `GET /api/dev/outbox` instead | unset (tests always log) | **required in practice** — see below. `EMAIL_FROM` on a domain verified in Resend, e.g. `SparkTower <hello@yourdomain>` |

### Email is not optional in production any more

It used to carry invites only, and an invite has a link you can copy by hand.
It now carries the confirmation link, and confirming an address is what lets a
new account post, comment, message, invite or publish
(`server/email-verification.ts`). Unset in production, every person who signs up
lands in a product they cannot use, and nothing on the screen explains why. The
server says so at boot, loudly, but it does not refuse to start: an existing
site whose key expires should keep serving the people already on it.
| `GITHUB_TOKEN` | personal token, for code audits | unset | Replit Secrets |
| `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS` | unset → local disk | unset → local disk | bucket path |

## Switches with a safe default

| Variable | Default | What changing it does |
|---|---|---|
| `PASSWORD_BREACH_CHECK` | on, except under `NODE_ENV=test` | `off` stops every password being checked against the public breach corpus (`server/password-breach.ts`). The check already fails open when the API is unreachable, so this is only for a deployment that must make no outbound calls at all — and it means accepting passwords that are known to be in a dump. The test suite leaves it off so hundreds of account creations don't each wait on a network timeout; the tests that cover the behaviour turn it on and stub the call. |

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
