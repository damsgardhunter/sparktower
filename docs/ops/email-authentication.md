# The sending domain: SPF, DKIM, DMARC

This app sends mail people are waiting for — the address-verification link, a
project invite, a password they asked to change. Unauthenticated mail from a new
domain lands in spam, and the person concludes the product is broken. Worse, a
domain with no policy is one anybody can send *as*: a convincing "SparkTower
security alert" from your own domain costs an attacker nothing.

Three records, in this order. They live in DNS, so nothing in this repository can
prove they exist — this file is the written record of what should be there and
who checked. The check in the audit says the same thing about itself.

## 1. SPF — which servers may send as us

One TXT record at the root of the sending domain. One record only: two SPF
records is a permanent failure, not a merge.

```
sparktower.example.  TXT  "v=spf1 include:_spf.resend.com ~all"
```

`include:` names the provider actually sending (Resend here — `RESEND_API_KEY`,
`EMAIL_FROM`). Add an include for anything else that sends as this domain
(support desk, marketing tool); each one costs a DNS lookup and there is a hard
limit of ten. `~all` is softfail while you are watching the reports; `-all` once
they are clean.

## 2. DKIM — the mail is signed, and the signature checks out

The provider generates the key pair and gives you the record; you publish it and
they sign with the private half. In Resend: Domains → Add domain → copy the
CNAME (or TXT) rows it prints. Do not invent these by hand.

```
resend._domainkey.sparktower.example.  CNAME  …   # exactly as the provider prints it
```

DKIM survives forwarding, which SPF does not — it is the one that matters most
for mailing lists and "forward to my other address" users.

## 3. DMARC — what receivers should do when the first two fail, and tell us

```
_dmarc.sparktower.example.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@sparktower.example; pct=100; adkim=s; aspf=s"
```

Start at `p=none`. It changes nothing about delivery and starts the daily
aggregate reports arriving at `rua=`. Read them for two or three weeks: they
tell you every source sending as your domain, which is how you find the one
legitimate sender you forgot before it gets quarantined. Then `p=quarantine`,
and `p=reject` once that is quiet.

Skipping straight to `p=reject` is how people silently lose their own invoices.

## Publishing them, on the setup this domain actually has

DNS is at **GoDaddy** (`ns23`/`ns24.domaincontrol.com`), so the records go in
GoDaddy → My Products → Domains → `sparktower.app` → DNS → Manage Zones. The
sender is **Resend** (`RESEND_API_KEY`, `EMAIL_FROM` in `server/email.ts`).

Do these in order. Publishing the sender before the records is what puts
verification links in spam.

**1. Add the domain in Resend first.** Resend → Domains → Add Domain →
`sparktower.app` (or a sending subdomain such as `mail.sparktower.app`, which is
the tidier arrangement and keeps a marketing tool's SPF out of the site's).
Resend prints the exact DKIM and SPF rows for *your* account. Copy them; don't
retype the ones below, which are shapes rather than values — a DKIM key is
account-specific and cannot be guessed.

**2. Publish what Resend printed.** In GoDaddy's zone editor:

| Type | Name | Value |
|---|---|---|
| TXT | `@` (or `send` for a subdomain) | `v=spf1 include:_spf.resend.com ~all` |
| CNAME/TXT | `resend._domainkey` | exactly as Resend printed it |

GoDaddy appends the domain itself, so enter `resend._domainkey`, not
`resend._domainkey.sparktower.app` — typing the full name yields
`resend._domainkey.sparktower.app.sparktower.app`, which is the single most
common way this goes wrong.

**3. Replace GoDaddy's DMARC record.** There is already one at `_dmarc`, which
GoDaddy published when the domain was registered. It enforces `p=quarantine` and
sends the reports to `dmarc_rua@onsecureserver.net` — GoDaddy, not you. Edit it,
don't add a second:

```
_dmarc   TXT   "v=DMARC1; p=none; rua=mailto:dmarc@sparktower.app; pct=100; adkim=s; aspf=s"
```

`p=none` on purpose, and it is a *relaxation* of what is published today. It
enforces nothing while you read a fortnight of reports and find every legitimate
sender; then `p=quarantine`, then `p=reject`. Going back to quarantine before
SPF and DKIM are verified re-arms the exact failure this section exists to undo.

For `rua=` to work, `dmarc@sparktower.app` has to receive mail — and the domain
currently has **no MX records at all**, so it receives nothing. Either add MX
for a mailbox, or point `rua` at an address you do read.

**4. Point the domain at the deployment.** `sparktower.app` currently serves a
GoDaddy Website Builder page, and `/_health` answers 404. Until it serves this
app, every link in every email — `PUBLIC_URL`-based, one builder for all three
(`server/public-url.ts`) — resolves to that placeholder. See
[custom-domain.md](custom-domain.md).

**5. Only then set the sender.** `EMAIL_FROM` must be on the domain you just
authenticated: `SparkTower <hello@sparktower.app>`. A From on any other domain
fails DMARC however perfect the records, because alignment compares the visible
From domain with the one SPF or DKIM signed for. The server checks this
relationship at boot and says so (`warnIfSenderMisaligned`, `server/public-url.ts`);
`test/unit/email-links.test.ts` holds it to its word.

## Checking, and the record of who did

Run the checker. It asks the real DNS — through Cloudflare's and Google's public
resolvers rather than whatever this machine is pointed at, so a VPN or a stale
local cache can't produce a comforting answer — and prints a row for the table
below:

```sh
node scripts/check-email-auth.mjs                 # domain from EMAIL_FROM, else sparktower.app
node scripts/check-email-auth.mjs example.com --selector resend
```

It exits non-zero until all three are published, so it can become a pre-deploy
gate. It is deliberately not in CI: CI has no business going red because
somebody else's DNS is slow.

### The delivery test, which no script here can do for you

DNS says the records exist. Only a real message proves they signed anything and
that a receiver believed it, so this part needs two mailboxes and a person.

Send **20 messages: 10 verification, 10 invite**, half to Gmail and half to
Outlook/Hotmail. Both flows, because they are built and sent separately and only
share the link builder — an invite carries a project name and a different
template, and a template is a thing that can get a message filtered on its own.

For each, record: **inbox or spam**, and from *Show original* (Gmail) or *View
message source* (Outlook):

```
spf=pass       header.from=sparktower.app
dkim=pass      header.d=sparktower.app
dmarc=pass     header.from=sparktower.app
```

`header.from` is the part that matters and the part people skip. `dkim=pass` on
a signature from the provider's own domain is a pass that does nothing for you:
DMARC wants the signing domain to be *yours*. A verdict line without
`header.d=sparktower.app` means the domain was never really authenticated.

Then click the link in one of each and check it opens `PUBLIC_URL` and that the
form on the far end submits — a confirm, an accept, a new password. A link that
loads a page which then refuses the button is a CSRF trusted-origin mismatch,
not a mail problem (`emailLinkHostIsTrusted`, `server/public-url.ts`).

Anything in spam: don't re-run it and hope. Read the aggregate reports at `rua=`
first; they name the source that failed.

A third-party validator (mail-tester.com, MXToolbox, Google's Admin Toolbox)
gives the same answer from outside in one send. It is a good smoke test and not
a substitute for the batch — it tells you nothing about placement, and placement
is what the task is about.

| flow | to | inbox/spam | spf | dkim (header.d) | dmarc | link opens PUBLIC_URL |
|---|---|---|---|---|---|---|
| | | | | | | |

## Verification evidence

Newest first. Each entry is what the DNS actually said on the day, not what
anyone meant to publish.

### 2026-09-17 — the domain exists now, and its DMARC is quarantining our own mail

The situation changed overnight: yesterday `sparktower.app` did not resolve at
all. It is now registered through GoDaddy (`ns23`/`ns24.domaincontrol.com`) and
serves a GoDaddy Website Builder placeholder — `<title>SparkTower</title>`,
`generator: Go Daddy Website Builder`, and marketing copy about "network
management tools". **The app is not on it**: `https://sparktower.app/_health`
answers 404, where the real deployment answers 200.

```
MISSING  SPF    no v=spf1 record at the domain root
MISSING  DKIM   no key at any of the selectors tried
BROKEN   DMARC  p=quarantine, reports on — enforcing with nothing to align
      ^ rua points at dmarc_rua@onsecureserver.net — not an address on sparktower.app.
```

Three things follow, and the middle one is the dangerous one.

**The DMARC record is not ours.** `onsecureserver.net` is GoDaddy's. Registering
the domain published `v=DMARC1; p=quarantine; adkim=r; aspf=r;
rua=mailto:dmarc_rua@onsecureserver.net` on our behalf. So the audit's "DMARC
missing" is out of date, and the criterion "receiving aggregate reports" is not
met either — the reports exist and go to GoDaddy.

**Enforcing with nothing to align is worse than publishing no DMARC at all.**
A message aligns through SPF or DKIM. Neither is published, so every message
fails, and `p=quarantine` tells every receiver to put it in spam. The moment
`RESEND_API_KEY` and `EMAIL_FROM` are set, verification links and invites start
being sent *and quarantined* — Resend reports them as delivered, the recipient
never sees them, and the only symptom is that nobody completes signup. This is
the failure mode the task describes, and it is armed and waiting rather than
hypothetical.

**Nothing is being lost today**, because nothing is being sent: `RESEND_API_KEY`
and `EMAIL_FROM` are unset, so `emailConfigured()` is false and mail goes to the
server log and `GET /api/dev/outbox` (`server/email.ts`). The order below
matters — publish the records *before* configuring the sender, not after.

### 2026-09-16 — nothing is published, because the domain does not exist

Checked with `node scripts/check-email-auth.mjs`, against Cloudflare 1.1.1.1 and
Google 8.8.8.8. Both answered the same:

```
Sending domain: sparktower.app
Checked: 2026-09-16T16:57:41.989Z via Cloudflare 1.1.1.1 and Google 8.8.8.8

The domain does not resolve at all (ENOTFOUND). There is no zone, so there are
no records to find:
SPF, DKIM and DMARC are all MISSING, and nothing can send authenticated mail as
sparktower.app — including you.
```

`dig sparktower.app` returns **NXDOMAIN**: no SOA, no NS, no A record. The
domain is unregistered (or expired). So:

- There is no DNS to publish SPF, DKIM or DMARC into. This is not "the records
  are wrong" — there is no zone.
- `sparktower.app` is nevertheless the domain this codebase already commits to
  in public: `SECURITY.md` invites researchers to mail `security@sparktower.app`,
  `server/security-txt.ts` serves it as the canonical contact, and the VS Code
  extension and MCP client both default to `https://sparktower.app`. That
  address currently reaches nobody, and the disclosure route in SECURITY.md is
  a dead end.
- No mail is being sent from anywhere today either: `RESEND_API_KEY` and
  `EMAIL_FROM` are unset, so `emailConfigured()` is false and verification
  links and invites are written to the server log and `GET /api/dev/outbox`
  (`server/email.ts`). Nothing is landing in spam because nothing is being sent.

**What has to happen before launch, in order:** register the domain → point it
at the deploy → set `EMAIL_FROM` on it → publish the three records above → run
the checker until it exits 0 → send the Gmail test → add the row.

Until that row exists, treat every claim about deliverability in this
repository as an intention rather than a fact.

| date | domain | SPF | DKIM | DMARC policy | checked by |
|---|---|---|---|---|---|
| 2026-09-22 | sparktower.app | published | resend | p=quarantine | scripts/check-email-auth.mjs — still passing four days on; MX now points at Microsoft 365 |
| 2026-09-18 | sparktower.app | published | resend | p=quarantine | scripts/check-email-auth.mjs — SPF via send.* CNAME, DKIM resend TXT, DMARC rua on-domain |
| 2026-09-17 | sparktower.app | MISSING | MISSING | p=quarantine (BROKEN — nothing aligns) | scripts/check-email-auth.mjs — GoDaddy's default record, rua to onsecureserver.net |
| 2026-09-16 | sparktower.app | MISSING | MISSING | MISSING | scripts/check-email-auth.mjs — domain does not resolve (NXDOMAIN) |
