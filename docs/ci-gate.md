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

## What is actually enforced today

Verified against GitHub on 16 September 2026 (`gh api repos/{owner}/{repo}/branches/main/protection`):

| Setting | State | What that means |
|---|---|---|
| Required checks | the 7 above | A pull request can't merge until all seven are green. |
| Enforce for administrators | **off** | **An owner's push to `main` lands without the checks running first.** Every push today is one of those: CI reports afterwards, in the Actions tab. |
| Branch up to date before merge (`strict`) | off | A PR may merge on checks that ran against a slightly older `main`. Deliberate: with one person shipping, the risk is small and it avoids rebasing every open PR on each push. |
| Force pushes / branch deletion | off | History can't be rewritten or the branch removed. |

So the honest description is: **the gate binds pull requests, and advises the owner.** A contributor cannot merge anything red. The owner can — and does, on every direct push — which is the right trade while one person ships and the wrong one once other people depend on the site.

**Before real users**, enforcement for administrators goes on, and everything moves through pull requests. It's a step in `docs/release-checklist.md` with the command, and `node scripts/check-branch-protection.mjs --launch` fails until it's done.

**Verifying it.** `node scripts/check-branch-protection.mjs` reads the protection through `gh` and fails on a missing required check, on force pushes being allowed, or on `main` being deletable; `--launch` also fails while administrators are exempt. CI can't run either: reading branch protection needs an administrator's token, which CI's own token isn't.

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
