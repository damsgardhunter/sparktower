# The audit's security checklist

`shared/security-checks.ts`. Every audit runs every check against every file, so the same repository always gets the same verdicts, and each verdict carries the files that decided it. The model is handed the gaps to prioritise and explain — it never decides what passes.

A check that can't apply says **n/a** rather than failing a project for a feature it doesn't have (no cookies, no uploads, no webhooks). The score is the weighted share of applicable checks passed, partial counting half; **blockers** are high-severity checks that are missing.

Checks are heuristics over source text. Two rules keep them honest, both learned the hard way (`2026-09-object-path-traversal.md`):

- **Judge where it matters.** A containment check somewhere else in the repository doesn't protect the path being built here, so `path-traversal` is decided per file.
- **Read the code, not the prose.** `log-leakage` matches with string literals emptied, so `console.warn("set MOBILE_TOKEN_SECRET")` isn't a logged secret; `email-verification` wants a column or a send, not the word "verification" in a comment or an OAuth provider's own `email_verified` claim.

Every check has unit tests for both the flagged and the clean shape (`test/unit/security-checks.test.ts`), including a scan of this repository that fails if a secret ever gets a hard-coded default again.


### Headers & transport

| Check | id | Severity |
| --- | --- | --- |
| Security headers | `security-headers` | high |
| HTTPS enforced (HSTS) | `https` | medium |
| CORS locked to your origins | `cors` | medium |

### Accounts & access

| Check | id | Severity |
| --- | --- | --- |
| Ownership checks on writes | `authorization` | high |
| Two-factor sign-in (at least for admins) | `mfa` | low |
| Passwords hashed | `password-hashing` | high |
| Sign-in attempts throttled | `login-throttling` | high |
| Sign-in limited per account, not only per address | `credential-stuffing` | high |
| Ownership checks on reads | `read-authorization` | high |
| Passwords long enough to be worth hashing | `password-policy` | medium |
| Passwords can be changed, and changing one ends the old sessions | `password-change` | medium |
| Email addresses verified | `email-verification` | medium |

### Input & output

| Check | id | Severity |
| --- | --- | --- |
| Request validation | `input-validation` | medium |
| No unsanitised HTML rendering | `xss` | high |
| Queries parameterised | `sql-injection` | high |
| No raw request bodies written to the database | `mass-assignment` | medium |
| No open redirects | `open-redirect` | medium |
| Errors don't leak internals | `error-leakage` | low |
| File paths can't escape their folder | `path-traversal` | high |
| No shell commands built from input | `command-injection` | high |
| Server-side fetches of user URLs guarded | `ssrf` | medium |
| Uploads limited by size and type | `upload-limits` | medium |

### Secrets

| Check | id | Severity |
| --- | --- | --- |
| Secrets required in production | `secret-config` | medium |
| No secrets committed | `committed-secrets` | high |
| Secrets and personal data stay out of logs | `log-leakage` | medium |
| Stored credentials hashed or sealed | `secrets-at-rest` | high |
| Secrets compared in constant time | `timing-safe-compare` | medium |

### Operations

| Check | id | Severity |
| --- | --- | --- |
| Backups, and a restore someone has actually done | `backups` | medium |
| Sensitive actions logged | `audit-log` | low |
| Vulnerability disclosure policy | `disclosure` | low |
| Errors are reported somewhere | `error-monitoring` | low |
| Webhooks verify signatures | `webhook-verification` | high |
| Limits beyond sign-in | `write-rate-limits` | medium |
| The sending domain is authenticated (SPF, DKIM, DMARC) | `email-authentication` | medium |

### Dependencies & CI

| Check | id | Severity |
| --- | --- | --- |
| Secret scanning in CI | `secret-scanning` | low |
| CI actions pinned to a commit | `ci-action-pinning` | medium |
| The dependency scan can fail the build | `dependency-audit-blocking` | medium |
| Vulnerable dependencies caught | `dependency-audit` | medium |
| Dependencies pinned (lockfile) | `lockfile` | low |

### Sessions & cookies

| Check | id | Severity |
| --- | --- | --- |
| Session cookie flags | `cookie-flags` | high |
| CSRF protection | `csrf` | medium |
| Sessions rotate, end and expire | `session-lifecycle` | medium |

### Privacy & data rights

| Check | id | Severity |
| --- | --- | --- |
| Accounts can be deleted and exported | `account-data-rights` | medium |

_Total: 43 checks._

## What this codebase fails today

- `ci-action-pinning` — 20 third-party CI actions are pinned to moving tags.
- `error-monitoring` — nothing collects errors; a 500 is visible only to whoever is reading the logs.
- `email-authentication` — the app sends invites and verification mail with no SPF/DKIM/DMARC recorded.
- `backups` — restoring is mentioned in the release checklist; no restore has been rehearsed.
- `csrf` is partial by design: same-origin checks cover state changes, with no per-form token.

The sign-in gaps this list used to carry — per-address-only throttling, six-character passwords, no way to change one — were fixed on 16 September 2026 (`server/replit_integrations/auth/routes.ts`, `shared/passwords.ts`, `test/integration/sign-in-hardening.test.ts`). Each of those three checks found a real gap the day it was written, which is the argument for adding a check before fixing the thing it checks.

What's left is operational: pin the CI actions, add error reporting, publish the mail records, rehearse a restore.
