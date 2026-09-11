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

- [ ] **Migrations checked.** Push the schema to production *before* the new
      build starts serving, and read what it intends to do before saying yes:
      ```sh
      DATABASE_URL="$PROD_DB" npx drizzle-kit push --verbose
      ```
      It prompts on anything destructive (a truncate, a dropped column). If it
      asks, stop and think — the answer is almost never "yes" on production.
      Additive changes (new tables, new nullable columns) are safe to apply
      ahead of the code: the old build ignores columns it doesn't know.

- [ ] **Zero type errors.** `npm run typecheck` passes. There is no baseline
      any more; a new error is a red build.

- [ ] **`.env.example` is still true.** Any new `process.env.X` the server
      reads is listed there. A deploy that needs a variable nobody wrote down
      fails at 2am.

## 2. Production secrets (Replit → Secrets)

- [ ] `SESSION_SECRET` is a real random value. The server **refuses to boot**
      on `dev-session-secret`, so a bad value fails loudly — but only after the
      deploy has started, so check first.
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

- [ ] **Uploads.** Presign is auth-gated, and an existing object still serves.
      ```sh
      curl -s -X POST $APP/api/uploads/request-url -H 'Content-Type: application/json' \
        -d '{"name":"probe.png"}' -w ' %{http_code}\n'                # 401
      ```
      Then open **$APP/profile** and confirm your avatar and a project cover
      image render — that proves `PRIVATE_OBJECT_DIR` and the serving route.

- [ ] **The wedge.** Post a check-in on a real project, copy its link, open it
      in a private window. That is the whole product; if it works, most things
      do.

- [ ] **Your console.** Open **$APP/admin/analytics** — it loads and shows you
      as "here now". A 404 means `PLATFORM_OWNER_EMAIL` is wrong.

- [ ] **Kill switches.** Open **$APP/admin/surfaces**. Anything switched off
      during the last incident that should be back on?

## 5. Rollback

- **Code:** Replit → Deployments → previous deployment → Redeploy. Takes about
  a minute. Sessions live in Postgres, so nobody is signed out.
- **Schema:** `drizzle-kit push` is additive unless you told it otherwise, so
  rolling back the code without touching the schema is safe. If you *did*
  approve something destructive, there is no automatic undo — restore from the
  Replit database snapshot taken before the deploy (Database → Backups).
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
