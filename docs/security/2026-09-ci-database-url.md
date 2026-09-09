# Incident note: "DATABASE_URL with a password committed in CI"

**Date raised:** 2026-09-09
**Severity:** none — false positive, with follow-up hardening
**Status:** closed

## What was reported

A codebase audit flagged that a `DATABASE_URL` containing a password was
committed to the repository, in the CI workflow.

## What it actually was

The string was a `postgresql://` URL for the `postgres` user on `localhost:5432`, with the container image's documented default password, in
`.github/workflows/ci.yml`. It is the connection string for the Postgres
**service container** that GitHub Actions starts inside a single CI job. That
database:

- exists only for the duration of the job, on the runner's own loopback;
- is created empty, populated by the test suite, and destroyed with the job;
- is not reachable from outside the runner, and holds no data that exists
  anywhere else.

The password was the container image's documented default — the same word as the user. There is no
production, staging, or developer system this value opens.

## What was checked

The full git history was scanned for password-bearing connection strings and
for credential-shaped tokens (OpenAI, Stripe live and webhook, GitHub, Google
API keys):

```sh
# every URL in history that carries credentials before the host
git log -p --all --pretty=format: | grep -oE "[a-z]+://[^/ ]+@[^ \"']+" | sort -u
# provider-shaped tokens
git log -p --all --pretty=format: | grep -oE "(sk-[A-Za-z0-9_-]{20,}|sk_live_|whsec_[A-Za-z0-9]{10,}|gho_|AIza)" | sort -u
# and the full-history scanner CI runs
gitleaks detect --source . --redact --no-banner
```

Findings across the entire history:

| value | what it is |
|---|---|
| a `postgresql://` URL for `postgres` on `localhost:5432` (the image default password) | the CI container above |
| a `postgresql://` URL for `127.0.0.1:5432/sparktower` with a placeholder user and password | the placeholder in `.env.example` |
| `sk-test-not-a-real-key…` | test fixtures, named as fakes |
| `6LdovJor…` in `dd47973b` | a real reCAPTCHA secret — see *The real finding* |

`.env` and `mobile/.env` have been gitignored since before the first commit
that would have needed them.

**Correction (2026-09-09):** the first version of this note said no real
credential had ever been committed. A full-history scan with gitleaks — run
because a manually-triggered CI job scans history where a push scans only the
new commits — found one. See *The real finding* below.

## The real finding

Commit `dd47973b` (2025-08-07, *Prepare for overwrite of GitHub repo*), the
Flask prototype that predates the current platform, contains two values in
`client/backend/`:

| where | what | verdict |
|---|---|---|
| `app.py:18` `app.secret_key = "1234_5…"` | a 14-character placeholder | not a secret |
| `routes/auth.py:49` `# secret key: '6LdovJor…'` | a **Google reCAPTCHA secret key** (the `6L…AAAAA` format) | **a real credential** |

Facts that bound the impact: the file was deleted whole when the platform
replaced the prototype (`18bf87e5`); no Python remains in the tree; the value
appears in zero files at HEAD and in exactly one commit in history; the current
app does not use reCAPTCHA at all. What the key can do, for whoever has read
this public repository since August 2025: verify reCAPTCHA tokens as if they
were that prototype's server — i.e. defeat the captcha on a site that no
longer exists.

**Rotation: yes, at Google.** The key is dead to this codebase but alive at
Google's end until it is deleted. Owner action, not a code change: in the
reCAPTCHA admin console (google.com/recaptcha/admin), find the site whose
secret begins `6LdovJor` and delete it or regenerate the keys.

Rotation log:

| date | decision |
|---|---|
| 2026-09-09 | **Deferred by the owner.** The key belongs to the 2025 prototype, which is deleted; nothing live depends on it and the current app has no reCAPTCHA. It will be deleted at Google, and a fresh pair created, the next time reCAPTCHA is set up. Until then this line is the open item. |

**History rewrite: no.** The value has been public on a public repository for
over a year; rewriting history now un-publishes nothing, and it would
invalidate every clone for no security gain. Deletion at the provider is the
fix. The commit is allowlisted in `.gitleaks.toml` by hash — not by pattern —
so the scan passes on history while anything *new* of the same shape still
fails the build.

## What was rotated

Nothing, because nothing real was exposed. The local development database
(on `127.0.0.1:5433`) is not in the repository and is not
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

## Decisions

**Rotation: one key, at Google** (see *The real finding*); nothing else. The
container default cannot be "rotated" — it is set fresh, per run, by the
workflow, and now derives from the run id so no fixed value exists anywhere.
Production credentials were never in git; local ones never leave the machine.

**History rewrite: no.** Rewriting history to remove a container image's
documented default password would invalidate every clone and every open
reference to a commit, for a string that opens nothing. A rewrite is the right
tool when a *real* credential lands in history and rotation alone leaves a
window; it is the wrong tool for a scanner false positive. If a real
credential is ever committed, the playbook below applies and a rewrite is
part of it.

**Merges blocked on scanning: yes.** The `secrets` CI job (gitleaks, full
history, every push and PR) is a required status check on `main`, alongside
`server-web`, `e2e` and `mobile`. GitHub push protection is enabled on the
repository. A PR that introduces a credential cannot be merged.

**Scanner false positives:** anything that matches a credential *shape*
without being one — the placeholder in `.env.example`, this note — is written
so it no longer matches: credentials are described in words, never spelled in
the `user:password@host` form, because a scanner cannot tell an explanation
from a leak and will keep flagging the explanation. The allowlist in
`.gitleaks.toml` is a structural regex, not a literal, for the same reason.

## If a real credential is ever committed

1. **Rotate first, scrub second.** The moment it is pushed, assume it was
   read; rewriting history does not un-read it. Rotate at the provider, then
   confirm the old value is refused.
2. Remove it from history (`git filter-repo`), force-push, and tell anyone
   with a clone to re-clone.
3. Write a note like this one, with the real timeline.
