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
| Ownership checks on reads | `read-authorization` | high |
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

### Dependencies & CI

| Check | id | Severity |
| --- | --- | --- |
| Secret scanning in CI | `secret-scanning` | low |
| Vulnerable dependencies caught | `dependency-audit` | medium |
| Dependencies pinned (lockfile) | `lockfile` | low |

### Operations

| Check | id | Severity |
| --- | --- | --- |
| Sensitive actions logged | `audit-log` | low |
| Vulnerability disclosure policy | `disclosure` | low |
| Webhooks verify signatures | `webhook-verification` | high |
| Limits beyond sign-in | `write-rate-limits` | medium |

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


_Total: 35 checks._

## What the audit is shown

The model never sees the repository — it sees a digest (`server/code-digest.ts`), and every list in it has a size limit. That is fine until a clipped list reads as a complete one: an audit of this codebase was handed 90 routes of 434 under a header saying "(120)" and reported working features as "not evidenced in the provided files", three times, about code that was there.

The sharpest case: an audit reported `POST /api/artifacts/:id/publish` as "NOT REGISTERED anywhere in this repository" and called the growth loop broken. It is registered — at `server/routes.ts:386`, hundreds of lines past where the excerpt stops — and the coverage section printed counts and exceptions, never names, so there was nowhere to look a route up. **EVERY MOUNTED ROUTE** now lists all of them with their guards and file, and the preamble points at it: if a route is registered it is there, and if it isn't there it isn't registered.

Three more things it couldn't see, all since added: **what runs at boot** (an audit reported the moderation log's TRUNCATE protection as possibly-never-applied, because the call sits at line 90 of the entry file and the excerpt stopped at 70 — the boot sequence is now lifted out and listed in order), and **what's in the rest of a long file** (an excerpt of a 1,200-line file stops mid-route, which reads as a doubt about the code; each excerpt is now followed by an index of the exports and routes that follow, with line numbers to ask for).

So the digest now says what it is: how many files exist, how many were read, how many appear as excerpts (opening lines, ~26 files), that lists are clipped where they say so, and that absence from it is not absence from the code. Counts are of what was **found**, not what fitted; the route list points at the ROUTE COVERAGE table, which holds every route with its guards. `test/unit/digest-honesty.test.ts` fails if a header ever again prints a cap as a total.

## What this codebase fails today

- `csrf` is partial by design: same-origin checks cover state changes, with no per-form token.

`email-verification` and `account-data-rights` were the two outstanding gaps; both now pass. Data rights live in `server/account-data.ts` (which table is exported, deleted or kept, one line each) with `server/account-routes.ts` in front and `test/integration/account-data.test.ts` behind — including a test that fails when a new table keyed to a user is listed nowhere.
