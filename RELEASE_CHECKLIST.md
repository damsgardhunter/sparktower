# Release checklist

Run through this before every deploy to production. It is short on purpose:
a long checklist gets skimmed, and the point of each line here is that it has
already gone wrong once, or would be expensive the first time it did.

## Before you deploy

- [ ] **CI is green on `main`** — both `server-web` and `mobile`. Branch
      protection requires it, but check anyway; a force-push or an admin
      bypass doesn't.
- [ ] **`npm run test:e2e` passes locally** against a built server. The
      integration suite drives the API; only the E2E tests prove a person can
      click through signup → project → check-in in a real browser.
- [ ] **No new type errors.** `npm run typecheck:ratchet` is at or below the
      baseline in `typecheck-baseline.json`. If you lowered it, commit the file.
- [ ] **`.env.example` matches reality.** Any new `process.env.X` the server
      reads is listed there with a comment. A deploy that needs a variable
      nobody wrote down is a deploy that fails at 2am.

## Production secrets (Replit → Secrets)

- [ ] `SESSION_SECRET` is a real random value — **not** `dev-session-secret`.
      The server refuses to boot on the fallback, so a wrong value fails
      loudly, but only after the deploy has started.
- [ ] `PLATFORM_OWNER_EMAIL` and `PLATFORM_REVIEWER_EMAILS` point at the right
      account. The owner sees the behaviour console; reviewers release backer
      money. Roles are re-derived from these at every boot.
- [ ] `AI_INTEGRATIONS_OPENAI_API_KEY` is set. The server cannot import its
      route files without one.
- [ ] `DATABASE_URL` points at production, and the schema has been pushed
      (`npm run db:push`) **before** the new build starts serving.

## The moment after

- [ ] Open `/_health` — 200.
- [ ] Sign in as yourself. Open `/admin/analytics` — the behaviour console
      loads, and shows you as "here now". If it 404s, `PLATFORM_OWNER_EMAIL`
      is wrong.
- [ ] Post a check-in on a real project and open its share link in a private
      window. That is the whole product; if it works, most things do.
- [ ] Check `/admin/surfaces`. Anything switched off during the last incident
      that should be back on?

## Rollback

- Replit keeps the previous deployment; roll back from the Deployments tab.
- Schema pushes are additive by default (`drizzle-kit push` prompts before
  anything destructive). If a release added columns, the old build ignores
  them — rolling back the code without rolling back the schema is safe.
- Sessions live in Postgres, so a rollback does not sign anyone out.

## Kill switches

If something is misbehaving and you can't deploy a fix in the next ten
minutes, turn the surface off at `/admin/surfaces`. It reaches every instance
within ten seconds and returns 404 for the whole route prefix, which reads as
"this feature doesn't exist" rather than "the site is broken".
