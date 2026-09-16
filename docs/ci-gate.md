# The CI gate

What has to be green before `main` moves. Branch protection on GitHub
requires these status checks by job name, so the names in
`.github/workflows/ci.yml` are load-bearing.

| Job | What it proves |
| --- | --- |
| `server-web` | lint clean, **zero** type errors, the API and unit suites against a real Postgres |
| `e2e` | the browser journeys (sign up → project → path → first update; a stranger reads a shared step) |
| `secrets` | gitleaks over the full history, every run, whatever the trigger |
| `mobile` | the Expo app typechecks, and its own tests pass (`mobile/`: `npm test` — the API client's token refresh, session expiry, visits and API host; project and backing rules) |
| `packages` | the MCP server and the VS Code extension build, the MCP bundle runs with its workspace dependency removed, and the extension packages into a .vsix |
| `dependencies` | no known high or critical vulnerability in production dependencies, server/web and mobile |
| `codeql` | GitHub's static analysis for JavaScript/TypeScript, security-and-quality queries |

`packages` is the gate on everything that ships outside this repository. Both
artefacts bundle `packages/nova-core`, and the failure that job exists to catch
is a bundle that still reaches for it at runtime — which installs cleanly and
crashes on someone else's machine, long after the tag is pushed. Publishing is
separate (`.github/workflows/publish-packages.yml`, tag-driven) and re-runs the
same builds before it releases anything.

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

## Privileged routes

`test/integration/admin-guards.test.ts` drives every `/api/admin/` route the scanner finds — signed out, as an ordinary account, and as a reviewer whose session never passed a second factor — and fails on any that answers. It's built from the scan, not a list, so a new admin route is covered the day it's written and one that loses its guard fails here.

One route answers any signed-in caller on purpose: `GET /api/admin/analytics/access`, which returns whether *you* are the owner so the client knows whether to offer the console. It's written down in the test with that reason, and the test also checks the exception is still real.

Because the sweep builds its URLs from the scan, it names no path — so it declares `// covers-routes: ^/api/admin/`, which the audit's untested-route summary reads (`server/audit-evidence.ts`). Without that, routes it covers would keep coming back as findings.

`test/integration/admin-console.test.ts` then drives those screens as the people they're for. Two aren't driven because calling them reaches outward (the promotions refreshes), and the live analytics screen is opened as the event stream it is rather than awaited like a request — awaiting it hangs, which is probably why nothing had driven it before.
