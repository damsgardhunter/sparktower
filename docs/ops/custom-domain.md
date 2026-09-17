# Putting the app on sparktower.app

The domain is registered at GoDaddy. The app is deployed on Render at
`sparktower.onrender.com`; the domain does not point at it yet. The order below
matters: a domain pointed at nothing is worse than a domain pointed at nowhere,
because it looks broken rather than absent.

This file covers one job: moving the site's address from `onrender.com` to
`sparktower.app`. **How the deploy works at all — the host, the service,
environment variables, the database, rollback, monitoring — is
[deploy.md](deploy.md), and that file wins wherever this one disagrees.**

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
| The app | live at `sparktower.onrender.com` (Render, Oregon) since 2026-09-16 |

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

## 0. The production build, already tested (2026-09-16)

Before any of this, the exact artefact Render will run was built and booted
locally against the real `.env`, on a spare port, as `NODE_ENV=production`:

```sh
npm run build                                          # dist/index.cjs + dist/public
NODE_ENV=production PORT=5055 node --env-file=.env dist/index.cjs
```

It came up clean, and every answer was the right one:

| | |
|---|---|
| `/_health` | 200 |
| `/api/auth/user` | 401 — mounted and guarding itself |
| `/api/does-not-exist` | 404 JSON, not the HTML app |
| `/`, `/projects`, `/a/<id>` | 200 HTML — the SPA fallback serves client routes |
| `/assets/index-*.js` | 200, 2.6 MB — the hash in the served HTML matches the built file |
| `/.well-known/security.txt`, `/sitemap.xml`, `/api/plans` | 200 |
| headers | CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy |
| unsigned Stripe webhook | 400 |

Booting it a second time with `PUBLIC_URL=https://sparktower.app` showed
exactly what step 3 changes:

```
Google OAuth callback URL: https://sparktower.app/api/auth/google/callback
robots.txt:  Allow: /$ … Sitemap: https://sparktower.app/sitemap.xml
sitemap.xml: <loc>https://sparktower.app/</loc>
```

Two warnings it printed, both expected locally and both worth fixing in
production:

- `Skipping Stripe webhook registration: no public URL` — gone once
  `PUBLIC_URL` is set (step 3).
- `MOBILE_TOKEN_SECRET is not set; mobile access tokens use a key derived from
  SESSION_SECRET` — set a separate one in the Render dashboard
  ([deploy.md](deploy.md#environment-variables)), so rotating one secret
  doesn't invalidate the other.

The build runs. What follows is entirely about hosting and DNS.

## 1. The deployment itself

Already done: the app is live on Render at `sparktower.onrender.com`. How that
deploy works — the service, the blueprint, where environment variables are set,
the database, how a deploy is triggered, how to roll back, what the health
endpoints prove — is **[deploy.md](deploy.md)**, which is the source of truth
for all of it. This file does not restate it.

What this file needs from that one is only the two facts the rest of the steps
depend on:

- the service answers at `https://sparktower.onrender.com`, and
- `PUBLIC_URL` is set in the Render dashboard, which is what step 3 changes.

**Know it is up before you touch DNS:**

```sh
curl -s https://sparktower.onrender.com/_health     # OK
curl -s https://sparktower.onrender.com/_ready      # {"ready":true,"database":"ok","ms":…}
```

`/_ready` asks the database; `/_health` deliberately doesn't (the platform's
only response to an unhealthy service is a restart, and restarting a server
whose database is unreachable is a crash loop). Pointing a domain at a service
that answers `/_health` but not `/_ready` just gives the outage a nicer name.

One thing that is this file's business rather than deploy.md's: **uploads need a
bucket before launch, not after.** Render's disk is wiped on every deploy, and
production deliberately refuses to fall back to it
(`server/replit_integrations/object_storage/objectStorage.ts`) rather than
writing someone's avatar somewhere it will vanish. That is the next step.

## 1b. The uploads bucket

In Google Cloud: create a bucket, then a service account with **Storage Object
Admin** on it, and download a JSON key.

```
PRIVATE_OBJECT_DIR          /<bucket>/private        e.g. /sparktower-uploads/private
PUBLIC_OBJECT_SEARCH_PATHS  /<bucket>/public
GCS_SERVICE_ACCOUNT_KEY     the whole JSON key, or base64 of it
GOOGLE_CLOUD_PROJECT        the project id
```

Base64 is there because dashboards mangle pasted multi-line values, and an
escaped `\n` in the private key fails signing with an error that names nothing
useful — the key is repaired on read either way
(`parseServiceAccountKey`).

Until this moved off Replit, the storage client authenticated through a sidecar
at `127.0.0.1:1106` that only exists inside that platform. On any other host
the credentials resolved to nothing, every upload failed, and the signer's
advice was "make sure you're running on Replit".

**Know it worked:** the boot log says which credentials it will use —

```
[storage] bucket /sparktower-uploads/private via service-account credentials
```

— and then change your avatar on the deployed site and reload. If
`PRIVATE_OBJECT_DIR` is missing the log says so outright, because production
does not fall back to disk.

## 2. Link the domain to the deployment

In Render: **your service → Settings → Custom Domains → Add** `sparktower.app`,
and again for `www.sparktower.app`. Render then tells you what to publish —
for an apex domain that is an **A record pointing at a Render IP** (they print
the current one; don't copy it from anywhere else), and for `www` a **CNAME to
your `*.onrender.com` hostname**. Render verifies by seeing the records
resolve, so there is usually no separate TXT token.

This is the reason the apex needs an A record at all: a CNAME is not allowed at
the zone apex, and GoDaddy does not flatten one. Hosts that only give you a
CNAME (Railway, Heroku) force the apex onto a DNS provider that does — Render
giving an IP is what keeps this simple.

In GoDaddy: **My Products → Domains → sparktower.app → DNS → Manage Zones.**

1. **Deal with the parked `A @` record.** In the zone it shows as a single row
   whose value reads **“WebsiteBuilder Site”** rather than an IP address —
   that is GoDaddy's Websites + Marketing product holding the apex, which is
   why the two parked IPs answer `dig` but no IP appears in the UI. GoDaddy
   will not let you simply delete a record it manages.

   **Edit it, don't delete it.** Pencil icon on that row → replace the value
   with the IP Render gave you → Save. GoDaddy warns that this disconnects the
   Website Builder site; that is exactly what you want, and the row becomes an
   ordinary A record afterwards.

   If the field won't accept an IP, detach the product first: **My Products →
   Websites + Marketing → your site → Settings → unpublish or delete the
   site**, then come back and the `A @` row is editable (or deletable, and you
   add your own).

   Do not leave both: a zone with GoDaddy's parked IPs *and* yours resolves to
   the parked page for some visitors and to your app for others, depending on
   which record their resolver happened to pick.
2. That edited row **is** the A record: name `@`, value = Render's IP, TTL 600
   (GoDaddy defaults to 1 hour; 10 minutes while you are still changing
   things).
3. **Change the `www` row.** It is currently `CNAME www → sparktower.app`.
   Point it at Render instead: `CNAME www → sparktower.onrender.com`. Render
   then serves www itself and redirects it to the apex, which is what you want
   — a CNAME to the apex would work too, but Render can only issue a
   certificate for a hostname that resolves to it.
4. **If Render asks for a TXT record**, add it with the name exactly as printed
   (`@`, or a bare prefix like `_render`) — GoDaddy appends the domain itself,
   so entering the full hostname produces `_render.sparktower.app.sparktower.app`.

5. **Lower the TTL while you work.** Every row in the zone is at GoDaddy's
   default 1 Hour, which is also how long a mistake sticks around. Set the `A @`
   row to 600 seconds until the site is up, then put it back.

The other rows in the zone are unrelated and can stay: `NS` (GoDaddy's
nameservers), `SOA`, `CNAME _domainconnect` (how GoDaddy's one-click setups
attach), and `CNAME pay → paylinks.commerce.godaddy.com` (GoDaddy Pay Links —
delete it if you don't use it; it does nothing either way). The `TXT _dmarc`
row is GoDaddy's default and is dealt with in step 6.

DNS is not instant. GoDaddy usually publishes within a few minutes; resolvers
elsewhere can hold the old answer for as long as the old TTL. Watch it:

```sh
dig +short A sparktower.app @1.1.1.1      # the IP Render gave you, and only that
dig +short TXT sparktower.app @1.1.1.1    # the verification token
```

Then wait for Render to say **Verified** and to finish issuing the TLS
certificate — that is automatic, and it cannot start until the A record points
at them.

**Know it worked:**

```sh
curl -sI https://sparktower.app | head -3        # HTTP/2 200, a real certificate
curl -s https://sparktower.app/_health           # the app, not a parked page
```

## 3. Tell the app its own address

Set it in the **Render dashboard → the service → Environment**, then redeploy:

```
PUBLIC_URL=https://sparktower.app
```

**This step is not optional and not cosmetic.** Today the value is
`https://sparktower.onrender.com` — that is what production's sitemap
publishes as canonical, and what every verification link, invite and shared
artifact URL sent so far was built from. Those links are not rewritten by
anything you do here; they will keep pointing at `onrender.com`, which is a
reason to keep that hostname answering rather than to hurry. But a site that
resolves at `sparktower.app` while this still says `onrender.com` sends new
visitors to the other host, where their session cookie isn't — so DNS and this
variable move together. [deploy.md](deploy.md#public_url-is-the-sites-identity-not-a-label)
has the full list of what is built from it.

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

A 500 on the *second* one means one of two things, and they're easy to tell
apart in the log: `"Stripe webhook signing secret is not configured"` means
`STRIPE_WEBHOOK_SECRET` isn't set yet — deliberate, because a 400 would make
Stripe give up while a 500 makes it retry for three days. Anything else means
the JSON parser ate the raw body, and every real webhook will fail silently
from then on. Then send a test event from the Stripe dashboard and
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
- **The uptime monitor:** when it exists, its URL is `onrender.com`-based and
  has to be repointed at `https://sparktower.app/_ready` in the same sitting.
  It does not exist yet — the steps are in
  [deploy.md](deploy.md#uptime-monitoring--not-yet-done).
- **`security.txt`:** already claims `https://sparktower.app/.well-known/security.txt`
  as canonical. Once the domain serves the app, that claim becomes true; confirm
  with `curl -s https://sparktower.app/.well-known/security.txt`.
- **Then walk [release-checklist.md §4](../release-checklist.md)** against the
  real domain. It is the same list of curls, and it is the point of having one.

## If something is wrong

| Symptom | Cause, nearly always |
|---|---|
| Deploy succeeds, site loads, everything is empty or 500s; log says `ECONNREFUSED 127.0.0.1` | `DATABASE_URL` is a local address copied from `.env`. Nothing listens on localhost inside the container. `curl /_ready` to confirm |
| `[surfaces] Could not load flags, using defaults` on repeat | same cause: the database is unreachable, and this one retries on a timer |
| Google callback prints `http://localhost:10000/...` at boot | `PUBLIC_URL` isn't set on the service yet |
| Parked page still appears for some people | the old A records are still in the zone, or a resolver is holding the old TTL |
| Render won't verify the domain | the TXT record's *name* is wrong — GoDaddy appends the domain, so enter `@` or the bare prefix, never the full hostname |
| Certificate never issues | the A record doesn't point at Render yet, or an AAAA record left behind points somewhere else |
| Google sign-in returns to a signed-out page | `PUBLIC_URL` isn't set, or the redirect URI in the Google console doesn't match it exactly |
| Everyone was signed out after the switch | expected: session cookies are host-only, so moving hosts starts fresh sessions |
| Mail lands in spam | SPF/DKIM aren't published yet, and DMARC is already at `p=quarantine` |
