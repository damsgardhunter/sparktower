# Two-factor authentication

Reviewers, admins and the platform owner (`PLATFORM_OWNER_EMAIL`) sign in with a password **and** a code from an authenticator app (TOTP, RFC 6238). Anyone else may turn it on; nobody else is asked to.

Code: `server/totp.ts` (the algorithm), `server/mfa.ts` (the rule, the routes, the checks), `server/platform-roles.ts` and `server/promotion-routes.ts` (where it's enforced).

## The rule

| Account | Signing in | Privileged routes |
|---|---|---|
| Builder, 2FA off | password (or Google) | — |
| Reviewer / admin / owner, 2FA **off** | password works, response says `mfaEnrollmentRequired: true` | `403 mfa_enrollment_required` until they set it up at **Settings → Security** |
| Any account, 2FA **on** | password gives **no session**: `{ mfaRequired: true }`; a code at `POST /api/auth/mfa/verify` within 5 minutes finishes it | work once the session has passed a code |

Roles are checked at request time, so someone promoted while signed in hits the enrolment wall on their next privileged request; setting 2FA up verifies that session in place.

- **Google (web)**: an enrolled account is signed straight back out after Google and sent to `/mfa` for the code.
- **Mobile**: login and Google return `{ mfaRequired, challengeToken }` (signed, 5 minutes, only for this) instead of tokens; `POST /api/auth/mobile/mfa/verify` exchanges it plus a code for tokens. Access tokens carry an `mfa` claim and refresh tokens a column, so a verified sign-in stays verified through rotation, and one that wasn't never becomes so.

## Storage and checks

- The TOTP secret is sealed with AES-256-GCM (`server/secret-box.ts`); recovery codes (10, shown once) are stored as SHA-256. None of the `mfa*` columns are ever sent in a response (`NEVER_SENT`, `server/app.ts`).
- A code is accepted for the current 30-second step ± one. The step used is recorded atomically, so a code (or an earlier one) can't be used twice. A recovery code is removed as it's used.
- Attempts are limited per address (the `login` limit) and per account (`mfa:<userId>`).

## Lost phone and recovery codes

There's no endpoint to turn 2FA off — a stolen password must not be enough to remove the second factor. After confirming who they are some other way:

```sh
DATABASE_URL=… npm run mfa:reset -- person@example.com           # shows the account
DATABASE_URL=… npm run mfa:reset -- person@example.com --apply   # turns 2FA off, signs out every session and device
```

## Tests

- `test/unit/totp.test.ts` — RFC 6238 vectors, the window, replay, challenge tokens
- `test/integration/auth.test.ts` — who needs a second factor: builder, reviewer, admin, owner
- `test/integration/mfa.test.ts` — setup, wrong / reused / recovery codes, the owner console, mobile challenge and refresh
- `e2e/mfa-sign-in.spec.ts` — the notice, the setup page and the code step in a browser
