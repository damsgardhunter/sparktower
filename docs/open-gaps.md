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

Last reviewed: **30 September 2026.**

---

## Open

### 1. Sixteen write routes that no test names

`summarizeUntestedRoutes` reports 36 of 499 routes named by no test file, 17 of
them writes; one is now done (see *Closed*), and finding a real bug in the
first one looked at is the argument for doing the rest. A mention is not a test, but a route no test names is untested.
The ones that carry money or privacy:

| Route | Why it matters |
|---|---|
| `POST /api/projects/:id/backing/submit-review` | puts a project into the escrow review queue |
| `POST /api/projects/:id/backing/badge-preview` | spends money on an image |
| `GET /api/stripe/connect-onboarding` | the payout path |
| `GET /api/stripe/connect-dashboard` | the payout path |
| `GET /api/merch-orders/:orderId/print/:face.png` | renders a paid order |

Closing it means an integration test per route, in the shape of
`apple-purchase.test.ts`: the properties the route's own comment claims, each
one asserted, and each one checked against the bug it describes by reverting
the fix and watching the test fail.

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

### 3. Deploy-time verification has never been run against production

`npm run check:env` and `npm run check:live` exist and are documented in
`ops/deploy.md`. Neither has been run against the real production environment
in this work. Everything about the deploy is currently reasoned, not observed.

### 4. Four E2E specs fail locally and pass in CI

`discover-actions`, `explore-loop`, `mfa-sign-in`, `safety-review` failed in a
local Playwright run; the same specs pass in CI. Treating them as
environmental is an inference, not a diagnosis — nobody has read the failures.
`ci-stability.md` is the place for the answer.

### 5. Access control is correct but held together by convention

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

### 6. Product and simulation

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
