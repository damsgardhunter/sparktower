# Incident note: "DATABASE_URL with a password committed in CI"

**Date raised:** 2026-09-09
**Severity:** none — false positive, with follow-up hardening
**Status:** closed

## What was reported

A codebase audit flagged that a `DATABASE_URL` containing a password was
committed to the repository, in the CI workflow.

## What it actually was

The string was `postgresql://postgres:postgres@localhost:5432/postgres` in
`.github/workflows/ci.yml`. It is the connection string for the Postgres
**service container** that GitHub Actions starts inside a single CI job. That
database:

- exists only for the duration of the job, on the runner's own loopback;
- is created empty, populated by the test suite, and destroyed with the job;
- is not reachable from outside the runner, and holds no data that exists
  anywhere else.

`postgres` / `postgres` is the container image's default. There is no
production, staging, or developer system this value opens.

## What was checked

The full git history was scanned for password-bearing connection strings and
for credential-shaped tokens (OpenAI, Stripe live and webhook, GitHub, Google
API keys):

```sh
git log -p --all --pretty=format: | grep -oE "[a-z]+://[^/:@]+:[^@]+@[^ \"']+" | sort -u
git log -p --all --pretty=format: | grep -oE "(sk-[A-Za-z0-9_-]{20,}|sk_live_|whsec_[A-Za-z0-9]{10,}|gho_|AIza)" | sort -u
```

Findings across the entire history:

| value | what it is |
|---|---|
| `postgresql://postgres:…@localhost:5432/postgres` | the CI container above |
| `postgresql://user:password@127.0.0.1:5432/sparktower` | the placeholder in `.env.example` |
| `sk-test-not-a-real-key…` | test fixtures, named as fakes |

No real credential has ever been committed. `.env` and `mobile/.env` have been
gitignored since before the first commit that would have needed them.

## What was rotated

Nothing, because nothing real was exposed. The local development database
(`project`/`project` on `127.0.0.1:5433`) is not in the repository and is not
reachable off the machine. Production credentials live in Replit Secrets and
were never in git.

Rotating a credential that was not exposed would not have made anything
safer, and recording a rotation that did not happen would make this note
worthless the next time someone reads it.

## What changed anyway

The report was wrong about the facts and right that the situation was
fragile: a scanner *will* flag that string, and a repo where scanners are
ignored is a repo where the next, real finding is ignored too.

1. **No literal password in CI.** The workflow derives a per-run value
   (`ci-<run id>-<attempt>`) and references it in both the service container
   and `DATABASE_URL`. There is now nothing in the repository for a scanner
   to match, and nothing for a human to copy somewhere it doesn't belong.
2. **Secret scanning fails the build.** A `secrets` CI job runs gitleaks over
   the full history on every push and PR, and is a required check on `main`.
   Its allowlist (`.gitleaks.toml`) names the test fixtures explicitly.
3. **GitHub push protection is on**, which blocks a recognised provider
   secret before the push lands. GitHub's generic-pattern scanning could not
   be enabled on this plan; gitleaks in CI covers generic passwords and
   connection strings instead.
4. **The env var contract is written down** — see `docs/env-contract.md` —
   so "what variables exist and where they come from" has one answer per
   environment.

## If a real credential is ever committed

1. **Rotate first, scrub second.** The moment it is pushed, assume it was
   read; rewriting history does not un-read it. Rotate at the provider, then
   confirm the old value is refused.
2. Remove it from history (`git filter-repo`), force-push, and tell anyone
   with a clone to re-clone.
3. Write a note like this one, with the real timeline.
