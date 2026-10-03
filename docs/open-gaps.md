# Open gaps

A living list, kept in the repository rather than in a conversation. It carries
three sections on purpose:

- **Open** — what is still wrong, ranked by what the failure would cost.
- **Closed** — what was fixed, with the test that now holds it, so a fix cannot
  quietly come undone without a name attached.
- **Checked and not a gap** — claims that looked like defects and were not, with
  the evidence. This section exists because most of the cost of an audit is
  re-investigating the same false positive, and because two of the findings
  below recommended changes that would have made the product worse.

Last reviewed: **30 September 2026.** Production verified live the same day (see gap 3).

---

## Open

### 0. Two advisories carried on purpose, and they expire on 2026-11-15

`scripts/audit-gate.mjs` is letting two high-severity advisories through, named,
with the reasoning beside them:

| Advisory | Package | Reached through |
|---|---|---|
| GHSA-86w9-cpqp-85rv | `node-forge` | `expo` → `@expo/cli` → `@expo/code-signing-certificates` |
| GHSA-vfj7-8cjw-p6xm | `braces` | `expo` → `@expo/cli` → `@expo/metro-file-map` → `micromatch` |

Both have an affected range of *every published version*, so there is nothing to
upgrade to, and npm's only offered remedy is `expo@44.0.6` — SDK 44, three years
backwards, which is a resolver artifact rather than a fix. Both are build-time:
one signs development builds, the other globs this repository's own files while
bundling. Neither is in the app bundle.

**On 2026-11-15 the build fails again** unless somebody renews or removes them.
That is the point of the date. The gate also fails if either stops matching
anything, so a stale exception cannot sit there looking load-bearing.

What to check when the date comes: whether `node-forge` has published a fix, and
whether a later `expo` has dropped `@expo/code-signing-certificates`.

### 0b. One CodeQL alert left, and it is a different shape of claim

Seven of the eight high alerts were `js/tainted-format-string` and are fixed — a
request-derived id in a log's format string, where a newline can forge a line. The
eighth is `js/missing-rate-limiting` pointing at `setupAuth` in `server/routes.ts`,
which is a claim about a route handler rather than a string, and it is not obvious
from the alert which handler it means. Worth reading properly rather than
guessing at.


### 1. Deploy verification — the public half is now observed, the private half is not

`npm run check:live` was run against production on 30 September and passed
every check:

```
Checking https://sparktower.app
  ✓ /_health answers — 200 in 485ms
  ✓ /_ready answers — 200 in 120ms
  ✓ database reachable — ok
  ✓ migrations applied — every migration in the repo has run
  ✓ the site publishes its own address — publishes https://sparktower.app
  database round trip: 2ms
```

That settles the three `fatal` env rules, two directly and one by inference:
`DATABASE_URL` works, `PUBLIC_URL` is the canonical domain and the site agrees,
and `SESSION_SECRET` must be set and strong because `assertSecretsAtBoot()`
throws otherwise — a process that is up has already passed it.

**The quickest answer is already in the logs.** Every boot prints a
`[preflight]` line naming each feature that is off for want of configuration,
so the last production boot has already said which of these are missing —
search the Render logs for `[preflight]`.

**Made durable rather than left to log retention:** a production boot with
features off now also reports down the same channel as a 500
(`ERROR_WEBHOOK_URL`), naming the variables and what they break. A line at
boot is the quietest possible place for "nobody who signs up can be
confirmed", and it is gone when the retention window rolls.

**Still not observed by me:** the `degraded` variables, which by design let the
process boot with a feature off — `RESEND_API_KEY`/`EMAIL_FROM` (without them
nobody who signs up can be confirmed), `STRIPE_SECRET_KEY`, `PRIVATE_OBJECT_DIR`,
`AI_INTEGRATIONS_OPENAI_API_KEY`. None can be checked from outside. Two ways
to close it, both needing the owner's own credentials:

1. Sign in as the owner and read `GET /api/admin/deployment`, which reports
   build identity, readiness and `set: true|false` per variable, plus a
   `missingRequired` list.
2. Run `npm run check:env` in the Render shell, where the production
   environment actually is.

### 2. Access control is correct but held together by convention

There is no defect here — see *Checked and not a gap* — but twelve different
access helpers do this job with no shared type and no common middleware:

```
isProjectMember  isMember  isOwner  memberOf  teamProject  projectFor
loadProject  ownedProject  companyCan  companyMember  powersOf  projectTeam
```

`project-access-sweep.test.ts` now proves the behaviour from the outside, which
is the part that matters. Unifying the helpers would additionally make the
property *readable* — and would have saved four failed attempts to determine it
statically. Worth doing, not urgent now that the sweep exists.

### 3. Product and simulation

- A tier priced past its own segment's ceiling still floors at 10% appeal, so
  raising a price past every buyer can still win customers.
- Latecomers cannot join a running season; a test pins the current behaviour
  deliberately.
- No per-project analytics dashboard for builders.
- `valuation = revenue × 1.2 + assets − debt` has no term for customers served.
- 34 tables are named by no test.
- `script/` and `scripts/` should be one directory.
- Branch protection has `strict: false` — a stale branch can merge. Changing it
  needs a `gh api -X PUT .../branches/main/protection` call, which this
  environment refuses as a CI-settings change; the payload is in
  [docs/ops/branch-protection.md](ops/branch-protection.md) for an owner to run.

---

## Closed

- **No write route is named by no test any more** — closed 2026-10-02. The
  repository's own sweep (`summarizeUntestedRoutes`) reports **0 of 507 writes**
  untested, down from 12. Four suites, 36 tests:

  | Suite | What it holds |
  |---|---|
  | [kanban-reorder.test.ts](../test/integration/kanban-reorder.test.ts) | The one board write that takes a list of ids from the client, including that foreign ids cannot be used to renumber another project's cards |
  | [investor-artifacts.test.ts](../test/integration/investor-artifacts.test.ts) | The four paid artifacts on the success path, and the clamps each applies to model output |
  | [project-ai-writes.test.ts](../test/integration/project-ai-writes.test.ts) | Gap detection, progress summary, persona generation, next actions — and that a success *is* billed |
  | [last-ai-writes.test.ts](../test/integration/last-ai-writes.test.ts) | The mock interview, the résumé read, the game's idea suggestions |

  Two of these are the inverse of what `ai-metering-sweep.test.ts` proves. That
  sweep drives every AI route with a model that throws, says nothing, or answers
  prose, and shows nothing is charged — it never sees one succeed. So a route broken
  on a *good* answer passed it, and nothing anywhere proved that a success is
  charged at all: a route that forgot to deduct would spend real money on every call
  and bill nobody, a leak that gets louder with use and that no error reports.

  The other new thing is the clamps. Each artifact route takes a JSON object from
  the model and writes parts of it down, bounding what it takes — a score to 0–100,
  a verdict to four known words, a list to eight, a string to five hundred
  characters. A model is the one input in this product that will hand over
  `"overall": 5000` without anybody attacking it, and not one of those bounds was
  tested. All four hold.

  Four of my own assumptions were wrong and are recorded in the tests that corrected
  them: a new project already has a roadmap, so the "build a roadmap first" branch is
  not reachable that way; `ai/summarize-progress` asks for markdown and returns it,
  so prose is a correct answer there and billing it is honest; a mock interview's
  question is prose by design, so only silence fails it; and the game's ideas come
  back under `ideas`, each needing a name and a pitch or it is dropped.

  What remains is 12 reads, no writes.

- **The project list resources were never driven** — closed 2026-10-02. Interviews,
  experiments, legal documents, the deploy checklist, support tickets, launch tasks,
  analytics events and pricing tiers are the same four routes eight times over, and
  nothing had ever posted to most of them: a route that 500s on every call would have
  been found by the first person to use the feature.

  Their *security* turned out to be covered already, and better than I assumed —
  [request-body-writes.test.ts](../test/integration/request-body-writes.test.ts)
  loops all eight segments attacking them across projects and tests the field
  allowlist in depth. So the new suite was trimmed to what it adds: a full round
  trip per family, who may do it, and the one line worth repeating for all eight
  (that a patch naming nothing writable is refused rather than reported as success).
  43 tests, in [project-list-crud.test.ts](../test/integration/project-list-crud.test.ts).

  It carries a `// covers-routes:` declaration, which is the repository's own
  mechanism for a table-driven test: the paths never appear whole in the file, so
  without it the coverage sweep counted every one of them as untested while they
  were being thoroughly tested.

- **The native build could not have worked** — closed 2026-10-02. `expo-doctor` was
  failing three checks, and one of them mattered: `newArchEnabled` has not been a
  valid config property since SDK 53 removed it, so the schema check failed on every
  run — and a check that is always red is a check nobody reads. Ten Expo packages
  were also behind the version the installed SDK expects.

  Both fixed, and the failure mode they were hiding is now a test:
  [app-config.test.ts](../mobile/test/app-config.test.ts) evaluates `app.config.js`
  as a build would and asserts the things that fail *silently* — the EAS project id
  without which no push token can be issued, `savePhotosPermission` without which
  saving a picture is refused, the photo-library string, and that no plugin was
  filtered out for a missing module.

  The one remaining doctor warning is a false positive: it does not understand a
  dynamic `app.config.js` that spreads the static `app.json`. The resolved config
  was checked by hand — 11 plugins, both bundle identifiers, the EAS id.

- **A contest's entries were readable by anybody** — found and closed 2026-10-02
  while building the entrants list. `GET /api/contests/:id/participants` takes no
  authentication and answered with the rows as the database returns them: each
  entrant's whole account row, their profile, and their `submissionUrl`,
  `submissionNote` and `score`. So every entrant's work, and the judges' scores,
  were public before judging had finished.

  No credential or email was ever in it — the global scrubber in
  [server/app.ts](../server/app.ts) strips those from every response, which is why
  — but a contest entry is not an account field, so nothing held it back. The
  route now answers a shape written out on purpose: who is in, whether they have
  filed, and your own entry. Judging will want the entries themselves and that
  wants its own route behind the contest's owner, not a widening of this one.

  Two account columns were also riding out on *every* embedded account row,
  because `PRIVATE_ACCOUNT_FIELDS` is a list and a new column is public by
  default: `appleId` (never added — `googleId` beside it was) and `pushEnabled`
  (added to the schema the day before, by me, and not here). Four entitlement
  columns were in the same state. All are now listed, and
  [account-fields-classified.test.ts](../test/integration/account-fields-classified.test.ts)
  makes every column on `users` account for itself — adding one to the schema
  fails that test until somebody says which side it is on, which is the only
  moment the question is cheap.

- **Filing a contest entry on the web** — closed 2026-10-02. The phone got it
  first; the asymmetry is gone, and both now call the route that had no caller at
  all. The entrants list is on the phone too.

- **The weekly rhythm's other half on the phone** — closed 2026-10-02. The
  check-in was there; the quarter's goals, the monthly report and the check-in
  day were not, so three of eleven rhythm routes had a caller. Now all but the
  two long setup forms (the recurring jobs' CRUD, and which numbers a project
  tracks) do. Holding test:
  [rhythm-and-contest-entry.test.ts](../test/unit/rhythm-and-contest-entry.test.ts).

- **Filing a contest entry** — closed 2026-10-02 on the phone, and it was missing
  from both clients: `POST /api/contests/:id/submit` had no caller anywhere, and
  the list route carried only `isParticipant` so nothing could tell a joiner from
  an entrant. The routes now carry the viewer's own `submission` (null until
  filed), the URL is parsed rather than merely truthy, and the refusals say which
  way the contest is shut. **The web still cannot file an entry** — the phone is
  ahead of it here, which is worth doing something about.

- **Push notifications on the phone** — were absent end to end; built 2026-10-02.
  A notification used to exist only while the app was open. Now: `push_tokens` and
  `push_receipts` (migration `0090`), a `users.push_enabled` switch, sending over
  `fetch` from `server/push.ts`, four routes, one hook at the `notify()` funnel,
  and the receipt sweep behind the leader lock so an address whose app was deleted
  is forgotten rather than written to for ever. About a third of the notification
  kinds push — the ones needing an answer, carrying money, or time-boxed.
  Holding tests: [push.test.ts](../test/integration/push.test.ts),
  [push-routes.test.ts](../test/integration/push-routes.test.ts),
  [push-wiring.test.ts](../test/unit/push-wiring.test.ts) — 63 together, checked
  by breaking each guarantee on purpose. Reasoning in
  [mobile-parity.md](mobile-parity.md). Not yet reaching a phone: needs a
  development build for the new native module and an APNs key in EAS.

| What | Fixed in | Held by |
|---|---|---|
| 15 of 56 money-spending routes had no kill switch; three surfaces (`tasks`, `milestones`, `projects`) owned no API prefix at all | `92389da0` | `route-guards.test.ts` (every costly route has a surface; every surface owns routes or carries a reason) + 7 outside probes in `kill-switches.test.ts` |
| The mobile 2FA screen offered recovery codes the product had removed: a button POSTing to a route that never existed, a `recoveryCodesLeft` field the server never sent, and a promise of a way back in that could not be kept | `3a674b2f` | `mobile-api-paths.test.ts` (every `/api/...` literal under `mobile/` resolves to a mounted route; the 2FA status shape matches the route's own `res.json`) |
| `env-contract.md` filed the OpenAI key as required to boot when it is `degraded`, recorded the wrong production `PUBLIC_URL`, and omitted `PUBLIC_URL` from the fatal table | `9574b24b` | `env-requirements.test.ts` (the documented fatal table equals the `fatal` rules; the address matches the runbook) |
| No test proved a stranger cannot read a private project; the only check walked 5 of 200 project-scoped routes | `d6ec1474` | `project-access-sweep.test.ts` (all 200 routes swept as a stranger against a private project; the project stub asserted field by field) |
| `projects` was the one registered surface owning no API routes, so its admin toggle changed nothing on the server — an open question rather than a defect | decided 2026-09-30 | **Stays client-only.** Its prefix would be `/api/projects`, which is every project route and every other project surface with it, so the switch would mean "the whole product off" rather than what its label says. Recorded in `route-guards.test.ts` as `NO_API_OF_ITS_OWN` with the reasoning, and the test refuses to excuse any *other* surface — so a new switch that reaches nothing still fails. Revisit by renaming the toggle or dropping it from the console, not by quietly giving it the broad prefix |
| Four E2E specs failed locally and passed in CI, and the reason was two separate things. `testDatabaseUrl` consulted `TEST_DATABASE_URL` for the default suffix only, so every session got its own `*_test` database and then all shared one `project_e2e` that each run truncates — three of the four. The fourth was a real flake that `retries: 1` had been hiding: the awaited element arrived just after Playwright's default 5s assertion timeout, so the spec failed every local run and passed CI on the retry | this change | `test-database-url.test.ts` (the E2E database is derived from the pinned base, and CI's resolution is unchanged); the flake verified by three consecutive local passes where it had failed every time |
| `POST /api/documents/:docId/tighten` applied the model's reply by block id across the whole document, so an id belonging to a page nobody asked about was written anyway. One hallucinated id away from rewriting a builder's prose on an unselected page — silently, with no undo, since the original is replaced. `pageIndex` in particular promises one page | this change | `document-tighten.test.ts` (a reply is only honoured for the blocks it was shown; also: a document that fits costs nothing, and a failed rewrite is not a partial save) |
| `POST /api/projects/:id/backing/badge-preview` took an image permit and never recorded it, so `freeRunUsed` was never true and **every press was the free one** — unlimited `images.edit` calls for nothing, on the route whose own comment says it was "the one picture nobody paid for". Every other image route records its run; this one did not | this change | `badge-preview.test.ts` (the second preview is refused; a typo does not spend the free image; owner-only) |
| `POST /api/projects/:id/backing/submit-review` had no test: the door into the payout review queue, where a project with no Stripe account must not be reviewable, an approved campaign must not be knocked back to pending by its own creator, and a rejected one must be able to return without the old reviewer notes | this change | `backing-submit-review.test.ts` (all four properties; removing the four checks fails exactly four tests) |
| `GET /api/merch-orders/:orderId/print/:face.png` had no test, and its central claim — renders from the order's artwork snapshot, never the campaign's live config, so a creator changing their logo cannot change what somebody already bought — was enforced by nothing. No defect found; the `Cache-Control: immutable` header is only honest because of that property, so the two are now asserted together | this change | `merch-print-file.test.ts` (asserted against the regression: reading live config fails it. A control test also caught the first version passing vacuously, because the `front` face draws a fixed tagline and cannot vary — only `back` renders the name) |
| `PATCH /api/backings/:id/privacy` read `Boolean(req.body.isAnonymous)`, so a request that never mentioned the field — empty body, misspelled key, a retry that lost it — came out `false` and published the name of a backer who had chosen not to be listed, silently and with a 200 | this change | `backing-privacy.test.ts` (the flag must be said, not inferred; anonymity leaves the public wall and stays on the creator's roster; neither a stranger nor the project owner can change it) |

---

## Checked and not a gap

Each of these was read against the code and found to be wrong. Recorded so the
next pass does not spend the time again.

- **"AI spend could run away with no way to stop it."** There is a
  platform-wide daily brake: `requireCredits` → `overCeiling` →
  `overPlatformCeiling`, checked before charging and before the model is
  called, and adjustable live from the console without a rebuild. The real gap
  was the absence of *selective* control, which is what `92389da0` closed.
- **"The codebase-audit feature under-reports kill-switch coverage 38×"**
  (9/592 against a true 343/592). A measurement error: `detectSurfacePrefixes`
  reads the prefix table out of `shared/surfaces.ts`, and the scan had been
  given only `server/`. Given `shared/`, it finds 100 prefixes and 374 routes.
- **"No recorded live URL or evidence of a live deployment."**
  `ops/deploy.md` records the canonical domain, the Render hostname that still
  answers, and a verified `/_ready` response; `npm run check:live` re-checks it.
- **"Not verifiable which env vars hard-fail boot versus degrade."** That is
  exactly `shared/env-requirements.ts`: every rule carries `fatal` or
  `degraded`, and `npm run check:env` prints the two lists separately.
- **"Mobile auth parity is evidenced by one test."** There are ~22 mobile test
  files, including `mobile-mirror.test.ts`, which runs the phone's hand-copied
  arithmetic and the engine's on the same inputs.
- **"Mobile has no `/reset-password` screen"** and **"no dedicated `/mfa`
  route"**. Both are deliberate platform idiom, and the first is explained in
  `forgot-password.tsx`: the emailed link opens the browser, and the screen
  says so.
- **`/_health` does not check the database.** Deliberate, and documented in
  `app.ts`: restarting a process whose database is unreachable turns one outage
  into a crash loop. `/_ready` answers the deeper question, and a bad
  `DATABASE_URL` in production is a *fatal* boot refusal by name, so the
  scenario cannot reach a live service anyway.
- **Two findings recommended changes that would have been harmful**: renaming
  `ai_spend`'s integer token columns to `*_sealed` (reasoned from the column
  name, not its type), and sealing a domain-verification challenge that has to
  be publicly readable to work.
