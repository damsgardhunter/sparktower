# Putting the app on sparktower.app

The domain is registered at GoDaddy. Nothing serves it yet, and nothing is
deployed yet — so the order below matters: a domain pointed at nothing is worse
than a domain pointed at nowhere, because it looks broken rather than absent.

Do it in this order. Each step says how to know it worked before you move on.

## What is true today (measured 2026-09-16, `node scripts/check-email-auth.mjs`)

| | state |
|---|---|
| Registrar / DNS | GoDaddy — `ns23.domaincontrol.com`, `ns24.domaincontrol.com` |
| `sparktower.app` A | `76.223.105.230`, `13.248.243.5` — GoDaddy's parked page, not the app |
| `www` | CNAME → `sparktower.app` |
| SPF | none |
| DKIM | none |
| DMARC | `v=DMARC1; p=quarantine; … rua=mailto:dmarc_rua@onsecureserver.net` — GoDaddy's default, not yours |
| MX | none |
| The app | not deployed anywhere |

Two things worth understanding before you touch anything:

- **That default DMARC is the strictest possible state to be in while you have
  no SPF or DKIM.** `p=quarantine` tells every receiver to treat unauthenticated
  mail from this domain as spam — and right now *all* mail from it is
  unauthenticated. So email must not go live before step 6, and the reports go
  to GoDaddy rather than to you until you replace the record.
- **The canonical address is the apex, `https://sparktower.app`**, with `www`
  redirecting to it. That is what `SECURITY.md`, `/.well-known/security.txt`,
  the VS Code extension (`packages/nova-vscode`) and the MCP client
  (`packages/nova-mcp`) already publish as the address of this product.

---

## 1. Deploy the app somewhere first

`.replit` already describes the deployment: autoscale, `npm run build`, then
`node ./dist/index.cjs`, serving `dist/public`. Replit → **Deploy** →
**Autoscale**.

Before the first boot, set the production secrets — the server *refuses to
start* without some of them, which is the correct behaviour and an unhelpful
surprise at 2am. The full list is [release-checklist.md §2](../release-checklist.md);
the ones that stop the boot are:

```
SESSION_SECRET              32+ random chars, used nowhere else
MOBILE_TOKEN_SECRET         a different one, same rules
DATABASE_URL                the production Postgres
AI_INTEGRATIONS_OPENAI_API_KEY
PLATFORM_OWNER_EMAIL        the account that gets the owner console
```

Run the migrations against production **before** the new build serves traffic:

```sh
DATABASE_URL="$PROD_DB" npm run db:migrate
```

**Know it worked:** the deployment's own `*.replit.app` URL answers.

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://<your-deployment>.replit.app/_health   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://<your-deployment>.replit.app/api/auth/user  # 401
```

A 401 there is the right answer: the API is mounted and guarding itself.

## 2. Link the domain to the deployment

In Replit: **Deployments → Settings → Link a domain →** `sparktower.app`. It
gives you two records — an **A** record for the apex and a **TXT** record that
proves you own it.

In GoDaddy: **My Products → Domains → sparktower.app → DNS → Manage Zones.**

1. **Delete the two parked A records** on `@` (`76.223.105.230`,
   `13.248.243.5`). Leaving them is the most common way this fails: the domain
   keeps resolving to the parked page for some visitors and to your app for
   others, depending on which record their resolver picked.
2. **Add** `A` · name `@` · value = the IP Replit gave you · TTL 600 (GoDaddy
   defaults to 1 hour; 10 minutes while you are still changing things).
3. **Add** `TXT` · name = exactly what Replit printed (often `@` or
   `_replit-verify`) · value = the token it gave you.
4. **`www`:** keep the existing `CNAME www → sparktower.app`. That makes www
   resolve to the same place, and the app serves both. If you would rather www
   *redirect*, add it as a second linked domain in Replit and let it 301.

DNS is not instant. GoDaddy usually publishes within a few minutes; resolvers
elsewhere can hold the old answer for as long as the old TTL. Watch it:

```sh
dig +short A sparktower.app @1.1.1.1      # the IP Replit gave you, and only that
dig +short TXT sparktower.app @1.1.1.1    # the verification token
```

Then wait for Replit to say **Verified** and to finish issuing the TLS
certificate — that is automatic, and it cannot start until the A record points
at them.

**Know it worked:**

```sh
curl -sI https://sparktower.app | head -3        # HTTP/2 200, a real certificate
curl -s https://sparktower.app/_health           # the app, not a parked page
```

## 3. Tell the app its own address

Set in the deployment's secrets, then redeploy:

```
PUBLIC_URL=https://sparktower.app
```

This one variable is load-bearing. Until it is set the app doesn't know where it
lives, and each of these is either wrong or off:

| What | Without `PUBLIC_URL` |
|---|---|
| Invite and email-verification links | built from the request's `Host` header (`server/invite-routes.ts`, `server/email-verification.ts`) |
| Sitemap / indexing | `robots` stays non-indexable — `indexable()` in `server/sitemap.ts` requires it |
| Stripe webhook registration | skipped entirely at boot (`server/index.ts:60`) |
| CSRF trusted origins | the public host isn't in the trusted set (`server/csrf.ts`) |
| Google sign-in callback | falls back to the platform hostname (below) |
| Printful print-file fetches | refuses, with "no address to fetch print files from" |

**Know it worked:** the boot log stops saying "Skipping Stripe webhook
registration: no public URL", and `curl -s https://sparktower.app/robots.txt`
shows the site as indexable.

## 4. Google sign-in

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
→ your OAuth 2.0 client:

- **Authorised JavaScript origin:** `https://sparktower.app`
- **Authorised redirect URI:** `https://sparktower.app/api/auth/google/callback`

Keep the existing localhost entries so local development still works.

The server builds that callback URL itself, and it now prefers `PUBLIC_URL`
(`server/replit_integrations/auth/replitAuth.ts`). Before that fix it used the
platform's own hostname even when the site answered as sparktower.app — Google
would send people back to the wrong host, the session cookie would be set there,
and they would arrive back at sparktower.app *signed out*, with nothing in the
log to explain it. Session cookies are host-only by design, so this has to
match exactly.

**Know it worked:** sign in with Google in a private window and land on
`https://sparktower.app/` signed in.

## 5. Stripe

Set `STRIPE_SECRET_KEY` and redeploy; with `PUBLIC_URL` set the app registers
its own webhook endpoint at `https://sparktower.app/api/stripe/webhook` on boot.
Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

Both of these must be refused:

```sh
curl -s -X POST https://sparktower.app/api/stripe/webhook \
  -H 'Content-Type: application/json' -d '{}' -w ' %{http_code}\n'        # 400, missing signature
curl -s -X POST https://sparktower.app/api/stripe/webhook \
  -H 'stripe-signature: t=1,v1=forged' -d '{}' -w ' %{http_code}\n'       # 400, verification refused
```

A 500 means the JSON parser ate the raw body and every real webhook will fail
silently from then on. Then send a test event from the Stripe dashboard and
confirm the verdict at `/admin/analytics` → Stripe health moves off
`waiting_for_first_event`.

## 6. Email — and fix that DMARC record

Nothing is sent today (`RESEND_API_KEY` and `EMAIL_FROM` are unset, so invites
and verification links go to the server log and `GET /api/dev/outbox`). Turning
it on is three DNS records and two secrets. The order matters: **publish SPF and
DKIM before you send anything**, because GoDaddy's default `p=quarantine` will
otherwise quarantine your first real emails.

1. Resend → **Domains → Add domain** → `sparktower.app`. It prints the records
   to publish. Add them in GoDaddy's DNS screen exactly as printed — usually a
   DKIM `CNAME` (e.g. `resend._domainkey`) and an SPF `TXT` on `@`:

   ```
   TXT    @                  v=spf1 include:_spf.resend.com ~all
   CNAME  resend._domainkey  <exactly what Resend prints>
   ```

   One SPF record only. Two is a permanent failure at every receiver, not a
   merge.

2. **Replace GoDaddy's DMARC** on `_dmarc` with your own, so the reports come to
   you instead of `onsecureserver.net`, and so it starts permissive while you
   confirm the other two work:

   ```
   TXT  _dmarc  v=DMARC1; p=none; rua=mailto:dmarc@sparktower.app; adkim=s; aspf=s
   ```

   Move to `p=quarantine` once the reports are clean — typically two or three
   weeks. Going straight to `p=reject` is how people silently lose their own
   mail.

3. Set `RESEND_API_KEY` and `EMAIL_FROM` (e.g.
   `SparkTower <hello@sparktower.app>`) and redeploy.

4. **Receiving** mail — `security@sparktower.app` is published in `SECURITY.md`
   and at `/.well-known/security.txt`, and there is no MX record, so that
   address currently reaches nobody. Add an MX (a forwarding service, Google
   Workspace, whatever you use) or change the address the repo publishes.

**Know it worked:**

```sh
node scripts/check-email-auth.mjs      # exits 0 when all three are live
```

Then send yourself an invite at a Gmail address, open **Show original**, and
confirm `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. Record the result in
[email-authentication.md](email-authentication.md) — the audit's
`email-authentication` check reads that table, and will keep reporting mail as
unauthenticated until there is a row in it.

## 7. The rest of the surface

- **Mobile:** the app defaults to localhost for development. Build the release
  against the live API: `EXPO_PUBLIC_API_URL=https://sparktower.app` (or set
  `extra.apiUrl` in `mobile/app.json` for the build).
- **VS Code extension and MCP client:** already default to
  `https://sparktower.app` — they start working when the domain does.
- **`security.txt`:** already claims `https://sparktower.app/.well-known/security.txt`
  as canonical. Once the domain serves the app, that claim becomes true; confirm
  with `curl -s https://sparktower.app/.well-known/security.txt`.
- **Then walk [release-checklist.md §4](../release-checklist.md)** against the
  real domain. It is the same list of curls, and it is the point of having one.

## If something is wrong

| Symptom | Cause, nearly always |
|---|---|
| Parked page still appears for some people | the old A records are still in the zone, or a resolver is holding the old TTL |
| Replit won't verify the domain | the TXT record's *name* is wrong — GoDaddy appends the domain, so enter `@` or the bare prefix, never the full hostname |
| Certificate never issues | the A record doesn't point at Replit yet, or an AAAA record left behind points somewhere else |
| Google sign-in returns to a signed-out page | `PUBLIC_URL` isn't set, or the redirect URI in the Google console doesn't match it exactly |
| Everyone was signed out after the switch | expected: session cookies are host-only, so moving hosts starts fresh sessions |
| Mail lands in spam | SPF/DKIM aren't published yet, and DMARC is already at `p=quarantine` |
