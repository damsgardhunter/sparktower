# Release checklist

Run through this before every production deploy, top to bottom, and add a
line to the log at the end. It is short on purpose — a long checklist gets
skimmed — and every item on it is something that has already gone wrong once
in this repository or would be expensive the first time it did.

Set these two once per session and the commands below paste as-is:

```sh
export APP=https://<your-production-domain>     # no trailing slash
export PROD_DB="postgresql://…"                   # from Replit → Secrets → DATABASE_URL
```

## 1. Before you deploy

- [ ] **User testing passed** — every *Blocker* in
  [pre-deploy-user-testing.md](pre-deploy-user-testing.md) is ticked.
- [ ] **CI is green on `main`** — `server-web`, `e2e`, and `mobile`.
      ```sh
      gh run list --branch main --workflow ci --limit 1
      ```
      Branch protection requires it, but check anyway; an admin push bypasses it.

- [ ] **Migrations applied.** Run them against production *before* the new
      build starts serving:
      ```sh
      DATABASE_URL="$PROD_DB" npm run db:migrate
      ```
      Each file in `migrations/` is SQL committed with the change that needed
      it, and CI refuses a schema change without one, so what runs here is what
      was reviewed. Read any new file before running it: `DROP`, `ALTER COLUMN
      … TYPE` and `SET NOT NULL` are the ones that lose data or lock a table.
      Additive changes (new tables, new nullable columns) are safe to apply
      ahead of the code: the old build ignores columns it doesn't know.

      **Once, on the first deploy after the switch to migrations:** production
      was built by `drizzle-kit push` and already has everything
      `0000_baseline.sql` creates. Record it as applied rather than running it —
      check first, then apply, then `db:migrate` as above:
      ```sh
      DATABASE_URL="$PROD_DB" npm run db:baseline               # check only
      DATABASE_URL="$PROD_DB" npm run db:baseline -- --apply
      ```
      If the check lists missing tables or columns, production is behind the
      schema: bring it level with one last reviewed `drizzle-kit push
      --verbose`, then baseline.

- [ ] **Zero type errors.** `npm run typecheck` passes. There is no baseline
      any more; a new error is a red build.

- [ ] **`.env.example` is still true.** Any new `process.env.X` the server
      reads is listed there. A deploy that needs a variable nobody wrote down
      fails at 2am.

## 1b. Close the gate

- [ ] **Make the CI gate bind for everyone, owner included.** Until now an
      owner's push lands on `main` without the seven checks running first
      (`docs/ci-gate.md`). Once other people depend on the site, that stops:

      ```sh
      gh api -X PUT repos/{owner}/{repo}/branches/main/protection/enforce_admins
      node scripts/check-branch-protection.mjs --launch   # must exit 0
      ```

      From then on every change is a branch and a pull request that merges when
      the checks are green. To undo it in an emergency:
      `gh api -X DELETE repos/{owner}/{repo}/branches/main/protection/enforce_admins`
      — and say so in the release log, because it reopens the door this closed.

## 2. Production secrets (Replit → Secrets)

- [ ] `SESSION_SECRET` is a real random value, at least 32 characters, used
      nowhere else. There is no default: the server **refuses to boot** when
      it's unset, short or a published value (`server/secrets.ts`), which fails
      loudly — but only after the deploy has started, so check first.
- [ ] `MOBILE_TOKEN_SECRET` is set, to a different value held to the same rules.
- [ ] `PLATFORM_OWNER_EMAIL` and `PLATFORM_REVIEWER_EMAILS` name the right
      account. Roles are re-derived from these at every boot.
- [ ] `AI_INTEGRATIONS_OPENAI_API_KEY` is set. The server can't import its
      route files without one.

## 3. Deploy

Replit → Deployments → Deploy. Wait for the health probe to go green, then run
section 4 in order. Each check is a curl you can paste; the expected result is
in the comment.

## 4. Sanity, the moment after

- [ ] **Boot**
      ```sh
      curl -s -o /dev/null -w '%{http_code}\n' $APP/_health          # 200
      ```

- [ ] **Auth.** The API is up, protects itself, and issues sessions.
      ```sh
      curl -s -o /dev/null -w '%{http_code}\n' $APP/api/auth/user    # 401 — mounted and guarded
      ```
      Then sign in as yourself in a browser and open **$APP/profile** — your
      name, your projects. If you land on onboarding instead, profile
      provisioning broke.

- [ ] **Stripe webhook.** The route is mounted *above* the JSON parser and
      verifies signatures. Both of these must refuse:
      ```sh
      curl -s -X POST $APP/api/stripe/webhook -H 'Content-Type: application/json' \
        -d '{}' -w ' %{http_code}\n'                                  # 400 "Missing stripe-signature"
      curl -s -X POST $APP/api/stripe/webhook -H 'Content-Type: application/json' \
        -H 'stripe-signature: t=1,v1=forged' -d '{}' -w ' %{http_code}\n'   # 400 — verification refused it
      ```
      A 500 here means the parser ate the raw body — every real webhook will
      fail from now on and nothing else will look wrong. Then, from the Stripe
      dashboard, Developers → Webhooks → your endpoint → **Send test event** →
      confirm a 200 in the dashboard's response log.

- [ ] **The event ledger has actually recorded something.** A 200 in Stripe's
      log only proves the request arrived. Open **$APP/admin/analytics** →
      Stripe health (owner only, `GET /api/admin/stripe/health`) and read the
      verdict, which now also asks Stripe which endpoints it will deliver to:

      | Verdict | What it means |
      |---|---|
      | `not_configured` / `no_webhook_secret` | keys missing — fix before taking money |
      | `no_endpoint_registered` | **the dangerous one**: checkout works, nothing is recorded |
      | `waiting_for_first_event` | wired up, nothing has arrived yet — the test event above should turn this into `receiving` |
      | `receiving_with_failures` | arriving, some failed: see `recentFailures`, fix, and Stripe's retries clear them |
      | `receiving` | working |

      The page prints the next step for whichever verdict it shows. Until one
      real event has been recorded, the idempotency ledger (`stripe_events`,
      which dedupes Stripe's retries) has never run in production — send the
      test event and confirm `events.total` moves.

- [ ] **Uploads.** Presign is auth-gated, and an existing object still serves.
      ```sh
      curl -s -X POST $APP/api/uploads/request-url -H 'Content-Type: application/json' \
        -d '{"name":"probe.png"}' -w ' %{http_code}\n'                # 401
      ```
      Then open **$APP/profile** and confirm your avatar and a project cover
      image render — that proves `PRIVATE_OBJECT_DIR` and the serving route.

- [ ] **The wedge.** Post an update on a real project, publish a finished step,
      copy its link (`/a/<id>`), open it in a private window. That is the whole product; if it works, most things
      do.

- [ ] **Your console.** Open **$APP/admin/analytics** — it loads and shows you
      as "here now". A 404 means `PLATFORM_OWNER_EMAIL` is wrong.

- [ ] **Kill switches.** Open **$APP/admin/surfaces**. Anything switched off
      during the last incident that should be back on?

## 5. Rollback

- **Code:** Replit → Deployments → previous deployment → Redeploy. Takes about
  a minute. Sessions live in Postgres, so nobody is signed out.
- **Schema:** migrations only go forward. An additive one leaves the old code
  working, so rolling back the code without touching the schema is safe. A
  destructive one has no automatic undo — restore from the Replit database
  snapshot taken before the deploy (Database → Backups), or write a new
  migration that puts back what you need.
- **Can't deploy a fix in the next ten minutes?** Turn the surface off at
  **$APP/admin/surfaces**. It reaches every instance within ten seconds and
  returns 404 for the whole route prefix, which reads as "this feature doesn't
  exist" rather than "the site is broken".

---

## Release log

One line per production deploy, newest first. Write it *after* section 4, and
be specific about anything that wasn't clean — "webhook curl returned 500,
fixed by …" is worth more than three green ticks. Three consecutive entries
where the checklist was followed and nothing surprised you is the signal that
this document is doing its job.

| date | commit | deployed by | checklist followed? | notes |
|---|---|---|---|---|
| — | — | — | — | *No production deploys recorded yet. The next one goes here.* |
