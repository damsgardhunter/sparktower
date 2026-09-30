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

### 1. Routes no test names — a working checklist

`summarizeUntestedRoutes` is the source of this list; re-run it rather than
trusting the numbers below. As of 30 September: **33 of 499 routes named by no
test, 13 of them writes** (down from 36/17). Two of the first seven looked at
held a real defect — one of them unpaid AI spend — which is the argument for
continuing.

Ranked by what a silent failure would cost:

| Route | Why it matters | State |
|---|---|---|
| `PATCH /api/backings/:id/privacy` | a backer's anonymity | **done** — found a bug |
| `GET /api/merch-orders/:orderId/print/:face.png` | renders what a backer paid for | **done** |
| `POST /api/projects/:id/backing/submit-review` | puts a project into the escrow review queue | **done** |
| `POST /api/projects/:id/backing/badge-preview` | spends money on an image | **done** — found a bug |
| `GET /api/stripe/connect-onboarding` | the payout path | **done** |
| `GET /api/stripe/connect-dashboard` | the payout path | **done** |
| `POST /api/documents/:docId/tighten` | AI write over a document | next |
| `GET /api/documents/:docId/pdf` | what a customer downloads | |
| `POST /api/profile/evaluate-resume` | AI spend, reads an upload | |
| `POST /api/projects/:id/{pitch-deck,pitch-critique,pricing-analysis,readiness-score,mock-interview}` | five AI spends in one file | |
| `POST /api/projects/:id/ai/{detect-gaps,summarize-progress}` | AI spend | |
| `POST /api/projects/:id/personas/generate`, `roadmap/next-actions`, `kanban/reorder` | AI spend / board order | |
| `POST /api/games/idea-options` | AI spend | |
| the remaining reads (`feed/my-projects`, `health-checks`, `task-history`, `investor-personas`, `looking-for-options`, `resume-status`, `fill-quote`, `layout-report`, `nova-briefing`, `rebuild-quote`, `reports{/:year}`, `scenes/:index/image`, `stripe/publishable-key`) | lower cost of failure | |

The shape that has worked twice now: assert the properties the route's *own
comment* claims, then check each assertion against the bug it describes by
breaking the route and watching the test fail. Both defects so far were found
that way, and one test passed vacuously until a deliberate control caught it.

### 2. `projects` is the one surface with no kill switch, and that is a decision to make

Every other registered surface now owns API routes. `projects` does not,
because its prefix would be `/api/projects` — every project route in the
product and every other project surface with it — so the switch would mean
"the whole product off" rather than what its label says. The admin console
shows the toggle either way.

Three options, none of which should be picked by a test:

1. Leave it, and accept that one console toggle is client-only.
2. Give it `/api/projects` and rename it so the label says what it does.
3. Remove it from the console.

Recorded in `route-guards.test.ts` as `NO_API_OF_ITS_OWN` so it stays visible.

### 3. Deploy verification — the public half is now observed, the private half is not

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

### 4. Access control is correct but held together by convention

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

### 5. Product and simulation

- A tier priced past its own segment's ceiling still floors at 10% appeal, so
  raising a price past every buyer can still win customers.
- Latecomers cannot join a running season; a test pins the current behaviour
  deliberately.
- No per-project analytics dashboard for builders.
- `valuation = revenue × 1.2 + assets − debt` has no term for customers served.
- 34 tables are named by no test.
- `script/` and `scripts/` should be one directory.
- Branch protection has `strict: false` — a stale branch can merge.

---

## Closed

| What | Fixed in | Held by |
|---|---|---|
| 15 of 56 money-spending routes had no kill switch; three surfaces (`tasks`, `milestones`, `projects`) owned no API prefix at all | `92389da0` | `route-guards.test.ts` (every costly route has a surface; every surface owns routes or carries a reason) + 7 outside probes in `kill-switches.test.ts` |
| The mobile 2FA screen offered recovery codes the product had removed: a button POSTing to a route that never existed, a `recoveryCodesLeft` field the server never sent, and a promise of a way back in that could not be kept | `3a674b2f` | `mobile-api-paths.test.ts` (every `/api/...` literal under `mobile/` resolves to a mounted route; the 2FA status shape matches the route's own `res.json`) |
| `env-contract.md` filed the OpenAI key as required to boot when it is `degraded`, recorded the wrong production `PUBLIC_URL`, and omitted `PUBLIC_URL` from the fatal table | `9574b24b` | `env-requirements.test.ts` (the documented fatal table equals the `fatal` rules; the address matches the runbook) |
| No test proved a stranger cannot read a private project; the only check walked 5 of 200 project-scoped routes | `d6ec1474` | `project-access-sweep.test.ts` (all 200 routes swept as a stranger against a private project; the project stub asserted field by field) |
| Four E2E specs failed locally and passed in CI, and the reason was two separate things. `testDatabaseUrl` consulted `TEST_DATABASE_URL` for the default suffix only, so every session got its own `*_test` database and then all shared one `project_e2e` that each run truncates — three of the four. The fourth was a real flake that `retries: 1` had been hiding: the awaited element arrived just after Playwright's default 5s assertion timeout, so the spec failed every local run and passed CI on the retry | this change | `test-database-url.test.ts` (the E2E database is derived from the pinned base, and CI's resolution is unchanged); the flake verified by three consecutive local passes where it had failed every time |
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
