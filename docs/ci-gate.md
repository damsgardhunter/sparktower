# The CI gate

What has to be green before `main` moves. Branch protection on GitHub
requires these status checks by job name, so the names in
`.github/workflows/ci.yml` are load-bearing.

| Job | What it proves |
| --- | --- |
| `server-web` | lint clean, **zero** type errors, the API and unit suites against a real Postgres |
| `e2e` | the browser journeys (sign up → project → path → check-in; a stranger reads a shared check-in) |
| `secrets` | gitleaks over the full history, every run, whatever the trigger |
| `mobile` | the Expo app typechecks |
| `dependencies` | no known high or critical vulnerability in production dependencies, server/web and mobile |
| `codeql` | GitHub's static analysis for JavaScript/TypeScript, security-and-quality queries |

Settings on `main`: required checks as above; branches must be up to date
before merging is **off** (pushes land directly on main today); enforce for
administrators is **off**, so the owner can push a fix through a red gate
when the gate itself is what's broken — and is expected to say so in the
release log.

**Verifying it.** `node scripts/check-branch-protection.mjs` reads the
protection through `gh` and fails if a required check is missing. CI can't
run it: reading branch protection needs an administrator's token.

**Why there is no ratchet.** Type errors used to be compared with a
committed baseline. The baseline is gone and the count is zero; a new
error is a red build.

**Dependabot** opens weekly, grouped upgrade PRs (production, development,
mobile, actions), so the `dependencies` job is rarely the first to notice.
