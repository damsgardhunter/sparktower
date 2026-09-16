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

Then send one real invite to a Gmail address, open the message, and view the
original: `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. That end-to-end check is the
one worth trusting — it proves the mail was actually signed, which a DNS lookup
never can. A third-party validator (mail-tester.com, MXToolbox, Google's Admin
Toolbox) gives the same answer from outside; paste its verdict and the date into
the evidence below when you use one.

## Verification evidence

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
| 2026-09-16 | sparktower.app | MISSING | MISSING | MISSING | scripts/check-email-auth.mjs — domain does not resolve (NXDOMAIN) |
