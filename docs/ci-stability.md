# CI stability proof

Ten consecutive green runs of the `ci` workflow on a single commit, each
dispatched only after the previous one completed, so no two ran at once and
none could cancel another. Same code, same database image, ten times.

**Commit:** `bdff787a`
**Date:** 2026-09-09, 12:39–12:58 UTC

| # | run | result |
|---|---|---|
| 1 | 34352307516 | success |
| 2 | 34352618616 | success |
| 3 | 34352821093 | success |
| 4 | 34353021221 | success |
| 5 | 34353200235 | success |
| 6 | 34353384788 | success |
| 7 | 34353585364 | success |
| 8 | 34353785926 | success |
| 9 | 34353973905 | success |
| 10 | 34354175152 | success |

Each run executes all four required checks: `server-web` (lint, typecheck
ratchet, 117 API/unit tests against a real Postgres), `e2e` (two Playwright
browser journeys), `secrets` (gitleaks over full history), `mobile`
(typecheck). Verify with:

```sh
gh run list --workflow ci --branch main --limit 25 --json headSha,conclusion,createdAt
```

## What is not in this table, and why

The preceding commit `0f450c93` had eight consecutive green runs; then the
push of `bdff787a` was green; then one dispatched run on `bdff787a` was
**cancelled**. That cancellation was not a test failure — an earlier proof
script double-dispatched into the workflow's concurrency group, which allows
one running plus one pending run and cancels the rest — but it was a
non-green run on `main`, so the count restarted after it rather than being
explained around. The five runs on `2c13e141` before that (one failure, four
cancelled) were the same script's first attempt; the failure was the
`secrets` job finding the 2025 reCAPTCHA key in history, recorded in
`docs/security/2026-09-ci-database-url.md`.

## Why the suite is deterministic

There is no injected clock, deliberately. Every time window — rate limits,
loop metrics, analytics summaries — is computed inside Postgres with
`now() - interval`, in the database's own clock, in 17 places; there are zero
comparisons of a JavaScript `Date` against a database timestamp. Date logic
in unit tests uses fixed instants and never calls `Date.now()`. No test
sleeps to cross a window. The rate-limit, moderation-drill and check-in
suites were also run three times consecutively locally on the same code:
20/20 each time.
