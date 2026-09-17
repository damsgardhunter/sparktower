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

Verified against GitHub on 17 September 2026 (`gh api repos/{owner}/{repo}/branches/main/protection`):

| Setting | State | What that means |
|---|---|---|
| Required checks | the 7 above | Nothing reaches `main` until all seven are green. |
| Enforce for administrators | **on** | The owner is bound by the same rule as everyone else. A direct push to `main` is refused, and so is `gh pr merge --admin`. |
| Branch up to date before merge (`strict`) | off | A PR may merge on checks that ran against a slightly older `main`. Deliberate: with one person shipping, the risk is small and it avoids rebasing every open PR on each push. |
| Force pushes / branch deletion | off | History can't be rewritten or the branch removed. |

So the honest description is now: **the gate binds everyone.** There is no
role that can put something on `main` without the checks having passed on it
first.

### What that looks like when it stops you

Verified on 17 September 2026, not assumed — each of these was actually run:

```
$ git push origin main
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - 7 of 7 required status checks are expected.

$ gh pr merge 13 --squash
X Pull request #13 is not mergeable: the base branch policy prohibits the merge.

$ gh pr merge 13 --squash --admin
GraphQL: 2 of 7 required status checks are in progress. (mergePullRequest)
```

The third one is the whole point: `--admin` used to merge regardless. Work
reaches `main` through a branch and a pull request that goes green, and by no
other route.

### The exception process

There isn't a standing one, and that's deliberate — an exception you can take
without deciding to is not an exception. To ship past the gate you turn it off
by name, and turning it off is visible:

```sh
gh api -X DELETE repos/{owner}/{repo}/branches/main/protection/enforce_admins
# … ship the fix …
gh api -X PUT   repos/{owner}/{repo}/branches/main/protection/enforce_admins
node scripts/check-branch-protection.mjs --launch   # must exit 0 again
```

If that `DELETE` 404s — it did on the token this was set up with, while the
full-object write worked — go through `PUT …/branches/main/protection` with
the whole configuration instead, which carries `enforce_admins` as a field.
Read the current settings first and put them all back; that endpoint replaces
everything it is given, so a partial body silently drops the rest.

Record it in the release log with the reason. An undocumented hour with the
gate open is indistinguishable from never having closed it.

**Verifying it.** `node scripts/check-branch-protection.mjs --launch` exits 0
only while all seven checks are required, administrators are bound, and `main`
can't be force-pushed or deleted.

`node scripts/check-branch-protection.mjs` (without `--launch`) reads the same
protection and fails on a missing required check, on force pushes being
allowed, or on `main` being deletable. CI can't run either: reading branch
protection needs an administrator's token, which CI's own token isn't.

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
