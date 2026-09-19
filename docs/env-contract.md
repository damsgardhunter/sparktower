# Environment variable contract

What each environment reads, and where the value comes from. `.env.example`
lists every variable with what it is *for*; this is the other axis — for each
environment, which ones are set and by whom.

There are three environments. There is no staging.

| environment | how the process gets its variables |
|---|---|
| **local** | `.env` in the repo root (gitignored), loaded by `tsx --env-file`. Copy `.env.example` to start. |
| **CI** | the workflow file only. Nothing is read from a `.env`; the test config pins every value it needs to a fixed fake (see `vitest.config.ts` and `playwright.config.ts`). |
| **production** | Render dashboard → the service → **Environment**. Nothing else. The server refuses to boot if the ones marked *required* are missing. [`render.yaml`](../render.yaml) lists every one; [ops/deploy.md](ops/deploy.md) is how the deploy works. |

## Required to boot

| variable | local | CI | production |
|---|---|---|---|
| `DATABASE_URL` | your own Postgres | per-run service container (`ci-<run id>`) | Render → Environment |
| `SESSION_SECRET` | any value | pinned fake | **must be random**; the dev fallback is refused in production |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | real key | pinned fake — tests never call the API | Render → Environment |

## Who runs the site

| variable | local | CI | production |
|---|---|---|---|
| `PLATFORM_OWNER_EMAIL` | your address | `owner@test.local` | Render → Environment |
| `PLATFORM_REVIEWER_EMAILS` | your address | `reviewer@test.local` | Render → Environment |

Roles are re-derived from these at every boot. Removing an address removes
the role on the next restart.

## The site's own address

| variable | local | CI | production |
|---|---|---|---|
| `PUBLIC_URL` | unset in `.env.example`; links then fall back to the request's `Host` header | unset | **set** — today `https://sparktower.onrender.com` |

This one is not a label. Every email verification link, every invite link,
every shared artifact URL, every `<loc>` in the sitemap, the Stripe webhook the
app registers for itself, the Google OAuth callback and the CSRF trusted
origins are all built from it. Links that have already gone out point wherever
it pointed when they were sent, and nothing rewrites them later.

So when DNS moves to `sparktower.app`, **changing `PUBLIC_URL` is a required
step of that move**, not a tidy-up afterwards: a site answering on the new
domain while this still says `onrender.com` sends people to the other host,
where their session cookie isn't. The full explanation, and what breaks in
which way, is in [ops/deploy.md](ops/deploy.md).

## Integrations (optional; the feature is off without them)

| variable | local | CI | production |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` / `_SECRET` | optional | unset | Render → Environment |
| `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` | optional | unset | Render → Environment |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | test-mode keys | unset — the webhook tests stub the client | Render → Environment |
| `PRINTFUL_API_KEY` / `PRINTFUL_STORE_ID` | optional | unset | Render → Environment |
| `RESEND_API_KEY` / `EMAIL_FROM` | optional — unset, emails are written to the server log and `GET /api/dev/outbox` instead | unset (tests always log) | **required in practice** — see below. `EMAIL_FROM` on a domain verified in Resend, e.g. `SparkTower <hello@yourdomain>` |

### Email is not optional in production any more

It used to carry invites only, and an invite has a link you can copy by hand.
It now carries the confirmation link, and confirming an address is what lets a
new account post, comment, message, invite or publish
(`server/email-verification.ts`). Unset in production, every person who signs up
lands in a product they cannot use, and nothing on the screen explains why. The
server says so at boot, loudly, but it does not refuse to start: an existing
site whose key expires should keep serving the people already on it.
| `GITHUB_TOKEN` | personal token, for code audits | unset | Render → Environment |
| `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS` | unset → local disk | unset → local disk | bucket path |

## Switches with a safe default

| Variable | Default | What changing it does |
|---|---|---|
| `PASSWORD_BREACH_CHECK` | on, except under `NODE_ENV=test` | `off` stops every password being checked against the public breach corpus (`server/password-breach.ts`). The check already fails open when the API is unreachable, so this is only for a deployment that must make no outbound calls at all — and it means accepting passwords that are known to be in a dump. The test suite leaves it off so hundreds of account creations don't each wait on a network timeout; the tests that cover the behaviour turn it on and stub the call. |

## Set by the platform, never by hand

Render sets `PORT` (the server reads it; never set it yourself) and
`RENDER_GIT_COMMIT` (the error reporter reads it, so a report names the deploy
it came from). Neither belongs in `.env.example` as something to fill in.

The `REPLIT_*` variables — `REPLIT_DOMAINS`, `REPLIT_DEPLOYMENT`,
`REPL_IDENTITY`, `REPLIT_CONNECTORS_HOSTNAME` — are a leftover of where this
repository was written. **They are set nowhere any more**, production included:
production is Render. Code that still branches on them takes the "absent" path
everywhere, which is the local path, and that is the behaviour to preserve if
you touch it.

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
- **Production values are set in the Render dashboard and nowhere else.** Not
  in a committed file, not in a build step, not in a comment. `render.yaml`
  names each secret with `sync: false`, which means Render prompts for it and
  stores it — the repository never holds the value.
- **Before a deploy, run `npm run check:env`.** It says what is set, what is
  missing and what looks wrong, which is cheaper than finding out from a boot
  that refuses.
